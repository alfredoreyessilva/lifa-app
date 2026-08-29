import express from 'express';
import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// --- Configuración leída de variables de entorno ---
// Mismo patrón que auth.js/upload.js: se lee dentro de funciones, no al
// cargar el módulo, porque ESM importa este archivo antes de que
// dotenv.config() corra en server.js.
function getWhatsappToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('Falta la variable de entorno WHATSAPP_ACCESS_TOKEN');
  return token;
}

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN || '';
}

function getAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Falta la variable de entorno ANTHROPIC_API_KEY');
  return key;
}

const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

// Modelo usado para responder. Haiku es suficiente y barato para
// preguntas de "¿tienen tal talla / cuánto cuesta / hay stock?" — si más
// adelante quieres respuestas más elaboradas (ej. recomendar productos,
// manejar objeciones de venta), se puede subir a claude-sonnet-5 cambiando
// solo esta constante.
const BOT_MODEL = 'claude-haiku-4-5-20251001';

// --- Verificación del webhook (Meta la llama una sola vez al configurar
// la URL en el panel de la App). Responde con el "challenge" tal cual si
// el verify_token coincide con el que tú definiste. ---
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === getVerifyToken()) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Arma el bloque de "base de conocimiento" que se le da a Claude: nombre
// de la tienda y su inventario activo, en texto plano y compacto. Nada de
// JSON crudo — así el modelo lo lee como lo leería un vendedor humano.
function buildKnowledgeBase(org, products) {
  if (!products.length) {
    return `${org.name} todavía no ha cargado productos en su inventario.`;
  }
  const lines = products.map((p) => {
    const price = p.price != null ? `$${Number(p.price).toLocaleString('es-MX')} ${p.currency}` : 'precio a consultar';
    const size = p.size_variant ? `, talla/variante: ${p.size_variant}` : '';
    const stock = p.stock != null ? `, stock: ${p.stock}` : '';
    return `- ${p.name} — ${price}${size}${stock}${p.description ? `. ${p.description}` : ''}`;
  });
  return `Inventario actual de ${org.name}:\n${lines.join('\n')}`;
}

async function askClaude({ org, knowledgeBase, history, userMessage }) {
  const systemPrompt = `Eres el asistente de ventas de "${org.name}" por WhatsApp. ` +
    `Responde dudas de clientes sobre stock, tallas y precios, en español, de forma breve y amable (2-4 líneas máximo). ` +
    `Usa SOLO la información de inventario de abajo — si no tienes el dato, dilo con honestidad y ofrece que el cliente pregunte por otro producto. ` +
    `No inventes precios ni existencias.\n\n${knowledgeBase}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: BOT_MODEL,
      max_tokens: 400,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Error llamando a la API de Claude (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === 'text');
  return textBlock ? textBlock.text : 'Gracias por tu mensaje, en un momento te atendemos.';
}

async function sendWhatsappReply(phoneNumberId, to, text) {
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getWhatsappToken()}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`Error enviando WhatsApp (${response.status}): ${detail}`);
  }
}

// --- Recepción de mensajes entrantes ---
// Un solo endpoint para TODAS las tiendas: Meta manda en
// value.metadata.phone_number_id cuál número recibió el mensaje, y con eso
// buscamos a qué organización pertenece. No hay una URL de webhook por
// tienda — así es como funciona la Cloud API (un WABA puede tener varios
// números, todos apuntando al mismo webhook de tu App).
router.post('/webhook', asyncHandler(async (req, res) => {
  // Respondemos 200 de inmediato salvo error real: si Meta no recibe 200
  // rápido, reintenta el mismo mensaje y podríamos duplicar respuestas.
  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const incomingMessage = value?.messages?.[0];

  if (!incomingMessage || incomingMessage.type !== 'text') {
    // No es un mensaje de texto entrante (puede ser un "status": delivered/read,
    // o un tipo de mensaje que todavía no soportamos, ej. audio/imagen).
    return res.sendStatus(200);
  }

  const phoneNumberId = value.metadata?.phone_number_id;
  const from = incomingMessage.from;
  const userText = incomingMessage.text.body;

  const org = await db.prepare(
    'SELECT * FROM organizations WHERE whatsapp_phone_number_id = ?'
  ).get(phoneNumberId);

  if (!org) {
    console.warn(`Mensaje de WhatsApp recibido para un phone_number_id sin organización asignada: ${phoneNumberId}`);
    return res.sendStatus(200);
  }

  const isPlanActive = org.plan === 'pro' && (!org.plan_expires_at || new Date(org.plan_expires_at) > new Date());
  if (!isPlanActive) {
    // Plan vencido o nunca activado: no contestamos con IA. Se deja
    // silencioso (sin mensaje automático) para no confundir al cliente
    // final con un aviso interno de facturación.
    console.warn(`Organización ${org.id} (${org.name}) recibió un mensaje pero su plan no está activo`);
    return res.sendStatus(200);
  }

  // A propósito NO se filtra por show_on_platform: el bot atiende a
  // CUALQUIER cliente que le escriba a este número, sea o no del nicho de
  // fútbol americano, así que necesita ver todo lo que la tienda vende
  // (is_active), no solo lo que decidió mostrar en el directorio de LIFA.
  const products = await db.prepare(`
    SELECT name, description, price, currency, stock, size_variant
    FROM products WHERE organization_id = ? AND is_active = TRUE
  `).all(org.id);

  // Últimos turnos de esta conversación puntual (por número de origen),
  // para que el bot recuerde de qué se habló antes en el mismo hilo.
  const previousTurns = await db.prepare(`
    SELECT role, content FROM bot_messages
    WHERE organization_id = ? AND wa_from = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(org.id, from);
  const history = previousTurns.reverse().map((m) => ({ role: m.role, content: m.content }));

  await db.prepare(`
    INSERT INTO bot_messages (organization_id, wa_from, role, content) VALUES (?, ?, 'user', ?)
  `).run(org.id, from, userText);

  const knowledgeBase = buildKnowledgeBase(org, products);
  let replyText;
  try {
    replyText = await askClaude({ org, knowledgeBase, history, userMessage: userText });
  } catch (err) {
    console.error('Error generando respuesta con Claude:', err);
    replyText = 'Gracias por tu mensaje. En un momento te atendemos directamente.';
  }

  await db.prepare(`
    INSERT INTO bot_messages (organization_id, wa_from, role, content) VALUES (?, ?, 'assistant', ?)
  `).run(org.id, from, replyText);

  await sendWhatsappReply(phoneNumberId, from, replyText);

  res.sendStatus(200);
}));

export default router;
