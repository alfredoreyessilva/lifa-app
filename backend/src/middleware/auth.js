import jwt from 'jsonwebtoken';

// Sin valor por defecto a propósito: si JWT_SECRET no está definida, cualquier
// persona podría firmar tokens válidos usando el mismo secreto público que
// tenía este archivo antes. Mejor que el servidor falle a que arranque inseguro.
//
// OJO: leemos process.env.JWT_SECRET dentro de una función (getJwtSecret), NO
// en el top-level del módulo. En ESM, los `import` de otros archivos (como
// este) se resuelven y ejecutan ANTES de que corra `dotenv.config()` en
// server.js, así que si leyéramos process.env.JWT_SECRET aquí arriba,
// siempre lo veríamos vacío y el servidor jamás arrancaría. El mismo patrón
// ya se usa en upload.js para Cloudinary, por la misma razón.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'Falta la variable de entorno JWT_SECRET. Defínela antes de iniciar el servidor ' +
      '(cualquier cadena larga y aleatoria sirve, ej. generada con `openssl rand -hex 32`).'
    );
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
