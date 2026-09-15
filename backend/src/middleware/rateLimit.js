import rateLimit from 'express-rate-limit';

// Limita cuántos intentos de login/registro puede hacer una misma IP en una
// ventana de tiempo. Objetivo: frenar fuerza bruta de contraseñas y registros
// masivos automatizados, sin estorbar a una persona normal que se equivoca
// un par de veces.
//
// 20 intentos cada 15 minutos por IP es generoso para un humano (incluso
// compartiendo IP en una oficina/casa con varias personas probando) pero
// vuelve muy lento un ataque de fuerza bruta real.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 20,
  standardHeaders: true, // manda RateLimit-* en la respuesta
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});

// Límite para el registro de eventos (visitas, clics). Es tráfico normal de
// cualquier visitante navegando la app, así que va mucho más holgado que el
// de login — solo busca frenar un abuso obvio (un script mandando miles de
// peticiones), no estorbar el uso real.
export const trackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en un momento.' },
});

// Límite para el estado de cuenta público del jugador (/api/player-billing/
// statement/:shareToken). A diferencia de authLimiter, aquí no hay contraseña
// que adivinar — el token es un UUID v4, así que la fuerza bruta no es la
// amenaza real. Lo que sí importa es que un endpoint SIN sesión no se pueda
// usar para inundar la base (el papá lo abre desde WhatsApp, refresca un par
// de veces y ya). 30 por minuto deja pasar el uso normal de una familia
// completa detrás de la misma IP y corta cualquier script.
export const publicStatementLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en un momento.' },
});

// El reporte de pago sí escribe en el libro, así que va mucho más cerrado:
// un papá reporta un pago al mes, no seis por minuto.
export const reportPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});
