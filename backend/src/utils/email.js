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
      'Faltan RESEND_API_KEY y/o EMAIL_FROM. Defínelas antes de mandar correos de verificación ' +
      '(ver backend/.env.example).'
    );
  }
  return { apiKey, from };
}

export async function sendVerificationEmail(toEmail, name, code) {
  const { apiKey, from } = getResendConfig();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: toEmail,
      subject: `${code} es tu código de verificación`,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color:#111;">
          <h2 style="margin-bottom: 4px;">Hola${name ? ` ${name}` : ''} 👋</h2>
          <p>Usa este código para confirmar tu correo:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align:center; margin: 24px 0;">
            ${code}
          </p>
          <p style="color:#666; font-size: 13px;">
            Este código vence en 10 minutos. Si tú no pediste esto, puedes ignorar este correo.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`No se pudo enviar el correo de verificación: ${errText || res.status}`);
  }
}
