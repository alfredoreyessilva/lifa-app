# Calendarios de Fútbol Americano México (LIFA App)

App full-stack para publicar calendarios, resultados y transmisiones de ligas de fútbol americano en México. Cada liga administra sus propias categorías, equipos y partidos; los equipos pueden entregarse como perfil independiente a su propio representante de medios.

## Stack real

|Parte|Tecnología|
|-|-|
|Backend|Node.js + Express|
|Base de datos|PostgreSQL, hosteado en [Neon](https://neon.tech) (plan gratuito)|
|Frontend|React + Vite|
|Imágenes (logos, fotos)|Cloudinary (plan gratuito)|
|Deploy backend|Render (plan gratuito)|
|Deploy frontend|Vercel (plan gratuito)|
|Notificaciones push|Web Push (VAPID), sin servicio de terceros|

> Nota: versiones antiguas de este README mencionaban SQLite — eso ya no aplica, el proyecto usa Postgres desde hace tiempo.

## Cambios recientes importantes (julio 2026)

* Se cerró una brecha real: `matches.stream\_url` / `matches.tickets\_url` eran columnas viejas que ya no leía nadie más que la importación por Excel y el `seed.js` — los links quedaban guardados pero invisibles en toda la app. Ya guardan en `stream\_links`/`ticket\_links` (arreglos JSONB), igual que el resto del sistema.
* Endurecimiento de seguridad: CORS con whitelist, `JWT\_SECRET` obligatorio (sin valor por defecto), rate limiting en login/registro, y reemplazo de la dependencia `xlsx` vulnerable. Detalle completo en la sección "Seguridad" más abajo.
* La tarjeta de partido en el calendario ahora es un solo link hacia la vista completa del partido, en vez de tener varios botones sueltos encima.
* Las migraciones de `db.js` ahora usan un candado (advisory lock) para no chocar si algún día corren varias instancias del servidor a la vez. Detalle en "Seguridad" más abajo.
* Se agregó `backend/.env.example` con los nombres de todas las variables de entorno necesarias (sin valores reales).

## Estructura

```
lifa-app/
  backend/
    src/
      config/db.js          Conexión a Postgres + creación/migración del esquema al arrancar
      middleware/
        auth.js              JWT: firmar y verificar tokens (authRequired)
        ownership.js         Verifica que el usuario sea dueño de la liga/equipo que intenta editar
        rateLimit.js         Límite de intentos en login/registro (fuerza bruta)
      routes/
        auth.js              Registro, login, /me
        leagues.js           Lectura pública: ligas, categorías, calendario, partidos
        manage.js            CRUD protegido: ligas, categorías, grupos, equipos, partidos, sedes
        upload.js             Subida de imágenes a Cloudinary
        invites.js           Invitaciones de un solo uso para entregar un equipo a otro usuario
        admin.js             Endpoints exclusivos para role = 'admin'
        notifications.js     Suscripción push + endpoint /trigger para el cronjob externo
      utils/                 Validaciones, manejo de errores async, zonas horarias
      seed.js                Datos de ejemplo para desarrollo local
      server.js              Arranque de Express: CORS, rate limiting, rutas, manejo de errores
  frontend/
    src/
      pages/                 Home, LeaguePage, CalendarPage, MatchPage, Login, Register,
                              RegisterLeague, Dashboard, AdminPanel, InviteClaim
      components/, context/, api/, utils/
```

## Cómo correrlo en local

### 1\. Backend

```powershell
cd backend
npm install
```

Copia `backend/.env.example` a `backend/.env` y rellena los valores reales (pide los que no tengas a quien administre las cuentas de Neon/Cloudinary/VAPID):

```powershell
Copy-Item .env.example .env
```

El `.env.example` trae comentarios explicando cada variable, incluyendo cómo generar `JWT\_SECRET`.

```powershell
npm run seed     # opcional: crea datos de ejemplo (ligas, categorías, partidos)
npm run dev      # http://localhost:4000
```

### 2\. Frontend

En otra terminal:

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173
```

## Flujo de la app

**Público (sin cuenta):**

1. Inicio → grid de logos de ligas.
2. Click en liga → lista de categorías (Varonil Mayor, Femenil, etc.).
3. Click en categoría → calendario de partidos. Cada tarjeta de partido es un solo link hacia `/partidos/:id` (`MatchPage.jsx`), donde están todos los links de transmisión, todos los de boletos, la sede, la jornada, el botón de "avisarme de este partido" y compartir — la tarjeta del calendario ya no tiene botones sueltos, solo lleva a esa vista completa.

**Representante de liga:**

1. `/crear-cuenta` → crea su cuenta (rol `rep`).
2. `/registrar-liga` → registra su liga, aparece de inmediato en el inicio.
3. Desde `/panel`: agrega categorías, grupos, equipos, sedes y partidos; define fecha, sede, jornada, link de transmisión, estado (programado/en vivo/finalizado) y marcador. También puede importar partidos en bloque desde un Excel (`manage.js`, endpoint `/import`) — el link de transmisión/boletos del archivo se combina automáticamente con los links predeterminados del equipo local y visitante (sin duplicar si coinciden).
4. Puede generar una invitación (`invites.js`) para entregar un equipo específico a otra persona, que lo administra desde su propia cuenta sin ver el resto de la liga.

**Admin (rol `admin`):**

* Acceso a `/admin` con endpoints propios en `admin.js` (fuera del alcance de un representante normal).

## Seguridad — decisiones ya tomadas

* **CORS con whitelist**: solo los orígenes listados en `ALLOWED\_ORIGINS` pueden llamar a la API desde un navegador. En local, `localhost:5173` siempre está permitido.
* **JWT\_SECRET obligatorio**: el servidor no arranca si falta esta variable (antes tenía un valor por defecto inseguro escrito en el código — ya no).
* **Rate limiting en login/registro**: máximo 20 intentos cada 15 minutos por IP (`middleware/rateLimit.js`), para frenar fuerza bruta de contraseñas.
* **`xlsx` (SheetJS) instalado desde `cdn.sheetjs.com`, no desde el registro de npm**: la versión publicada en npm tiene una vulnerabilidad alta (prototype pollution / ReDoS) sin parche ahí; SheetJS solo publica la versión corregida en su propio CDN. Se usa exactamente igual (mismo nombre, misma API) — solo cambia de dónde se instala. Ver `package.json`.
* El backend corre detrás del proxy de Render, por eso `server.js` tiene `app.set('trust proxy', 1)` — necesario para que el rate limiting identifique bien la IP de cada visitante.
* **Candado (advisory lock) en las migraciones de `db.js`**: si algún día corren varias instancias del servidor a la vez, la segunda espera a que la primera termine de migrar el esquema, en vez de correr las mismas instrucciones al mismo tiempo. No requiere Redis ni nada externo — vive en la propia base de datos.

## Pendientes conocidos (deuda técnica, sin urgencia)

* **El verdadero límite hoy es la infraestructura gratuita, no el código**: Render (plan gratuito) corre una sola instancia y se "duerme" tras \~15 min sin tráfico; Neon (plan gratuito) tiene un comportamiento similar. Si el tráfico crece de golpe, esto se va a sentir antes que cualquier otra cosa. Se resuelve pasando a un plan de pago barato en ambos — decisión pendiente, no técnica.
* No hay ninguna capa de caché todavía; cada visita al calendario consulta Postgres directo. No es un problema con el tráfico actual.
* El tamaño del pool de conexiones de Postgres (`config/db.js`) usa el valor por defecto de la librería `pg` — revisar si el tráfico crece mucho.
* \## Vulnerabilidades conocidas (npm audit) — no urgentes
* \- esbuild/vite: requiere Vite 8 (breaking). Solo afecta al servidor de desarrollo local.
* \- react-router: requiere v8 (breaking). No aplica porque usamos <BrowserRouter> (modo declarativo),
* &#x20; no createBrowserRouter/RouterProvider.

## Roadmap — próximo cambio grande (en planeación, sin implementar aún)

Generalizar el concepto de "equipo con dueño propio" (que ya existe) a un modelo de **perfiles de organización**: una cuenta podrá registrar múltiples organizaciones (ligas, equipos, fotógrafos, medios de comunicación), y los medios podrán publicar su propio link de transmisión en la tarjeta de cada partido — para que la información del ecosistema no dependa de un solo administrador de liga.

