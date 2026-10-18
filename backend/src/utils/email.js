// Envío de correos transaccionales vía Resend (https://resend.com).
//
// OJO: leemos process.env dentro de una función, NO en el top-level del
// módulo. En ESM, los `import` de otros archivos se resuelven y ejecutan
// ANTES de que corra `dotenv.config()` en server.js, así que si leyéramos
// las variables aquí arriba, siempre las veríamos vacías. Mismo patrón que
// middleware/auth.js (JWT_SECRET) y upload.js (Cloudinary).
function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error(
      'Faltan RESEND_API_KEY y/o EMAIL_FROM. Defínelas antes de mandar correos ' +
      '(ver backend/.env.example).'
    );
  }
  return { apiKey, from };
}

// `EMAIL_TRANSPORT=log` es solo para el backend de pruebas del 4100: el backend
// se comporta como si pudiera mandar correos, pero no manda ninguno. Así la
// suite e2e recorre el camino real —el código se guarda, el tope por cuenta se
// cuenta— y lee el código de la base. En Render no se define nunca.
function soloAnotar() {
  return process.env.EMAIL_TRANSPORT === 'log';
}

// true cuando un correo de verdad (o anotado, en pruebas) puede salir. Mientras
// sea false, el frontend no le pide a nadie un código: sería engañoso pedirlo
// si el correo nunca le puede llegar.
export function emailAvailable() {
  return soloAnotar() || Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// El nombre lo escribe quien se registra, y cualquiera puede registrarse con el
// correo de otra persona: sin escapar, "Hola <a href=…>" llegaría como un link
// a una bandeja ajena, firmado por CFBAMX.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Los dos correos son el mismo: un saludo, una línea de para qué es, el código
// grande y la letra chica.
function plantillaDeCodigo({ name, para, code, letraChica }) {
  return `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color:#111;">
          <h2 style="margin-bottom: 4px;">Hola${name ? ` ${escapeHtml(name)}` : ''} 👋</h2>
          <p>${para}</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align:center; margin: 24px 0;">
            ${code}
          </p>
          <p style="color:#666; font-size: 13px;">
            ${letraChica}
          </p>
        </div>
      `;
}

async function sendEmail({ to, subject, html, kind }) {
  if (soloAnotar()) {
    // Sin el código ni el asunto (que lo lleva): una consola también se lee.
    console.log(`[email] EMAIL_TRANSPORT=log: no se mandó el correo de ${kind} para ${to}`);
    return;
  }

  const { apiKey, from } = getResendConfig();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`No se pudo enviar el correo de ${kind}: ${errText || res.status}`);
  }
}

export async function sendVerificationEmail(toEmail, name, code) {
  await sendEmail({
    to: toEmail,
    kind: 'verificación',
    subject: `${code} es tu código de verificación`,
    html: plantillaDeCodigo({
      name,
      code,
      para: 'Usa este código para confirmar tu correo:',
      letraChica: 'Este código vence en 10 minutos. Si tú no pediste esto, puedes ignorar este correo.',
    }),
  });
}

// Recuperar la contraseña (README, "Recuperar la contraseña"). La letra chica
// dice las dos cosas que la persona tiene que saber antes de usarlo: que si no
// lo pidió no pasa nada, y que cambiarla la saca de sus otros aparatos.
export async function sendPasswordResetEmail(toEmail, name, code) {
  await sendEmail({
    to: toEmail,
    kind: 'recuperación de contraseña',
    subject: `${code} es tu código para cambiar tu contraseña`,
    html: plantillaDeCodigo({
      name,
      code,
      para: 'Usa este código para elegir una contraseña nueva en CFBAMX:',
      letraChica: 'Este código vence en 10 minutos. Si tú no lo pediste, ignora este correo: tu contraseña '
        + 'no cambia. Al cambiarla se cierra tu sesión en los demás aparatos donde la tengas abierta.',
    }),
  });
}
