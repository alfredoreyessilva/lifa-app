# Calendarios de Fútbol Americano México (LIFA App)

App full-stack para publicar calendarios, resultados y transmisiones de ligas de fútbol americano en México. Cada usuario puede administrar varias organizaciones desde una sola cuenta (ligas, equipos, y más adelante empresas/medios); los equipos pueden entregarse como perfil independiente a su propio representante.

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

- **Nuevo modelo de "Mi panel" — varias organizaciones por cuenta**: al crear una cuenta o iniciar sesión, ya no se entra directo al panel de una liga. `/panel` ahora muestra los logos de todas las ligas y equipos que administras (sin abrir ninguno automáticamente), cada uno con su propia URL (`/panel/liga/:id`, `/panel/equipo/:id`). Un clic abre su panel de trabajo; un segundo clic sobre el mismo logo lo cierra. Esto sienta la base para agregar más tipos de organización (empresa, medio) sin rediseñar de nuevo la navegación.
- **Pantalla "Registrar Organización"**: nuevo botón en el TopBar y nueva ruta (`/panel/registrar-organizacion`) desde donde se registran organizaciones nuevas. Por ahora solo tiene la opción "Registrar liga"; los demás tipos se agregan aquí más adelante.
- **Botón de notificaciones en el TopBar**: ícono nuevo (balón amarillo), con su propia página `/notificaciones` — todavía sin contenido conectado, es solo el punto de entrada.
- **Ligas nuevas quedan pendientes de aprobación**: al registrarse, una liga queda con `status = 'pending'` y no aparece en el sitio público hasta que un admin la aprueba desde `/admin` (pestaña "Ligas", botón "Aprobar"). El dueño puede seguir configurando su liga con normalidad mientras está pendiente.
- **Rediseño de la página pública de liga**: portada, logo, nombre, descripción, botones de "Compartir"/"Notificarme", pestañas (Categorías/Equipos/Sedes) y su contenido ahora viven dentro de un solo panel negro continuo. La foto de portada se muestra completa (sin recortar), en vez de forzarla a una altura fija.
- Arreglada la deformación de logos en las tarjetas de equipo cuando el nombre es largo (ya no se fuerza una altura fija a la tarjeta).
- `node_modules/` se sacó del control de versiones de Git.
- Endurecimiento de seguridad: CORS con whitelist, `JWT_SECRET` obligatorio (sin valor por defecto), rate limiting en login/registro, y reemplazo de la dependencia `xlsx` vulnerable (backend **y** frontend). Detalle completo en la sección "Seguridad" más abajo.
- Las migraciones de `db.js` usan un candado (advisory lock) para no chocar si algún día corren varias instancias del servidor a la vez.
- Se agregó `backend/.env.example` con los nombres de todas las variables de entorno necesarias (sin valores reales).

## En progreso — no terminado todavía

- **Botón de "Rechazar" una liga pendiente**: hoy en `/admin` solo existe "Aprobar" y "Eliminar" (que borra todo permanentemente). Falta el endpoint y el botón correspondiente, y el aviso de "tu liga fue rechazada" en el panel del dueño.
- **Contenido real de "Notificaciones"**: la página y el botón ya existen, pero todavía no muestra nada — falta decidir y construir qué información va ahí.
- **Más tipos de organización**: "Registrar Organización" solo ofrece Liga por ahora. Equipo (fuera del flujo de invitación de una liga), Empresa/Marca y Medio de comunicación quedan pendientes.
- Detalle cosmético menor: `LeagueWorkPanel` y `TeamOnlyPanel` traen su propio `<div className="container">` interno, que ahora queda anidado dentro del `container` de "Mi panel" — funciona bien, pero puede limpiarse más adelante.

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
        auth.js              Registro, login, /me (incluye las ligas y equipos que administra el usuario)
        leagues.js           Lectura pública: ligas, categorías, calendario, partidos
        manage.js            CRUD protegido: ligas, categorías, grupos, equipos, partidos, sedes
        upload.js             Subida de imágenes a Cloudinary
        invites.js           Invitaciones de un solo uso para entregar un equipo a otro usuario
        admin.js             Endpoints exclusivos para role = 'admin' (incluye aprobar ligas)
        notifications.js     Suscripción push + endpoint /trigger para el cronjob externo
      utils/                 Validaciones, manejo de errores async, zonas horarias
      seed.js                Datos de ejemplo para desarrollo local
      server.js              Arranque de Express: CORS, rate limiting, rutas, manejo de errores
  frontend/
    src/
      pages/
        Home, LeaguePage, CalendarPage, MatchPage, Login, Register,
        RegisterLeague, RegisterOrganization, Dashboard, Notifications,
        AdminPanel, InviteClaim
      components/, context/, api/, utils/
```

## Cómo correrlo en local

### 1. Backend

```powershell
cd backend
npm install
```

Copia `backend/.env.example` a `backend/.env` y rellena los valores reales (pide los que no tengas a quien administre las cuentas de Neon/Cloudinary/VAPID):

```powershell
Copy-Item .env.example .env
```

El `.env.example` trae comentarios explicando cada variable, incluyendo cómo generar `JWT_SECRET`.

```powershell
npm run seed     # opcional: crea datos de ejemplo (ligas, categorías, partidos)
npm run dev      # http://localhost:4000
```

### 2. Frontend

En otra terminal:

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173
```

## Flujo de la app

**Público (sin cuenta):**

1. Inicio → grid de logos de ligas.
2. Click en liga → página de la liga: portada, logo, nombre, descripción y pestañas (Categorías/Equipos/Sedes), todo dentro de un mismo panel.
3. Click en categoría → calendario de partidos. Cada tarjeta de partido es un solo link hacia `/partidos/:id` (`MatchPage.jsx`), donde están todos los links de transmisión, todos los de boletos, la sede, la jornada, el botón de "avisarme de este partido" y compartir.

**Cualquier usuario con cuenta:**

1. `/crear-cuenta` → crea su cuenta.
2. Cae en `/panel` ("Mi panel"): si no administra ninguna organización todavía, lo ve vacío salvo la barra de logos (vacía) y el botón "Registrar Organización" en el TopBar.
3. Desde "Registrar Organización" (`/panel/registrar-organizacion`) registra su primera liga. Queda como **pendiente de aprobación** — no aparece en el inicio hasta que un admin la apruebe desde `/admin`.
4. De ahí en adelante, cada liga o equipo que administra (propio o entregado por invitación) aparece como un logo en "Mi panel". Un clic abre su panel de trabajo específico; otro clic sobre el mismo logo lo cierra.
5. Dentro del panel de una liga: agrega categorías, grupos, equipos, sedes y partidos; define fecha, sede, jornada, link de transmisión, estado (programado/en vivo/finalizado) y marcador — todo esto funciona con normalidad aunque la liga siga pendiente de aprobación. También puede importar partidos en bloque desde un Excel (`manage.js`, endpoint `/import`).
6. Puede generar una invitación (`invites.js`) para entregar un equipo específico a otra persona, que lo administra desde su propia cuenta — ese equipo aparece como su propio logo en el panel personal de quien lo recibe, no en el de quien registró la liga original.

**Admin (rol `admin`):**

- Acceso a `/admin` con endpoints propios en `admin.js` (fuera del alcance de un representante normal).
- Pestaña "Ligas": aprueba ligas pendientes (aparecen primero en la lista, marcadas), o las elimina.

## Seguridad — decisiones ya tomadas

- **CORS con whitelist**: solo los orígenes listados en `ALLOWED_ORIGINS` pueden llamar a la API desde un navegador. En local, `localhost:5173` siempre está permitido.
- **JWT_SECRET obligatorio**: el servidor no arranca si falta esta variable (antes tenía un valor por defecto inseguro escrito en el código — ya no).
- **Rate limiting en login/registro**: máximo 20 intentos cada 15 minutos por IP (`middleware/rateLimit.js`), para frenar fuerza bruta de contraseñas.
- **`xlsx` (SheetJS) instalado desde `cdn.sheetjs.com`, no desde el registro de npm — en backend y frontend**: la versión publicada en npm tiene una vulnerabilidad alta (prototype pollution / ReDoS) sin parche ahí; SheetJS solo publica la versión corregida en su propio CDN. Se usa exactamente igual (mismo nombre, misma API) — solo cambia de dónde se instala.
- El backend corre detrás del proxy de Render, por eso `server.js` tiene `app.set('trust proxy', 1)` — necesario para que el rate limiting identifique bien la IP de cada visitante.
- **Candado (advisory lock) en las migraciones de `db.js`**: si algún día corren varias instancias del servidor a la vez, la segunda espera a que la primera termine de migrar el esquema, en vez de correr las mismas instrucciones al mismo tiempo.

### Vulnerabilidades de `npm audit` — evaluadas y aceptadas conscientemente

Estas dos siguen apareciendo en `npm audit` del frontend. No es que se nos olvidó, ya se revisaron y no aplican a como está construido este proyecto hoy:

- **`esbuild`/`vite`** (`GHSA-67mh-4wv8-2f99`): permitiría a un sitio malicioso leer respuestas del servidor de desarrollo local. Solo afecta mientras `npm run dev` está corriendo en tu máquina — no afecta producción. Arreglarlo requiere saltar a `vite@8` (cambio mayor, rompe cosas).
- **`react-router`** (`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`): open redirect e inyección en hidratación SSR. Ambas fallas requieren el modo "Data/Framework" de React Router (`createBrowserRouter` + `RouterProvider`) o renderizado del lado del servidor. Este proyecto usa `<BrowserRouter>` (modo declarativo, en `main.jsx`) — no tiene ese código, así que no está expuesto.

## Pendientes conocidos (deuda técnica, sin urgencia)

- Rotar `CLOUDINARY_API_SECRET` (ver sección "En progreso" arriba para el resto de pendientes funcionales).
- **El verdadero límite hoy es la infraestructura gratuita, no el código**: Render (plan gratuito) corre una sola instancia y se "duerme" tras ~15 min sin tráfico; Neon (plan gratuito) tiene un comportamiento similar. Se resuelve pasando a un plan de pago barato en ambos — decisión pendiente, no técnica.
- No hay ninguna capa de caché todavía; cada visita al calendario consulta Postgres directo.
- El tamaño del pool de conexiones de Postgres (`config/db.js`) usa el valor por defecto de la librería `pg` — revisar si el tráfico crece mucho.
- JWT guardado en `localStorage` (no en cookie `httpOnly`): trade-off aceptado por simplicidad de configuración entre dominios distintos (Vercel + Render).

## Roadmap — en construcción

El modelo de "varias organizaciones por cuenta" ya está en marcha (ver "Cambios recientes" arriba). Lo que falta para completarlo:

1. Agregar los tipos Equipo independiente, Empresa/Marca y Medio de comunicación a "Registrar Organización".
2. Más adelante: permisos de colaboración entre organizaciones — por ejemplo, que un Medio con permiso pueda actualizar directamente el link de transmisión de un partido registrado por una Liga, sin pasar por su dueño original.
