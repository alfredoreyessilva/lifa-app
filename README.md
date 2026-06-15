# Calendario LFA — Calendarios de fútbol americano en México

App full-stack: backend Express + SQLite, frontend React (Vite).

## Estructura

```
lifa-app/
  backend/     API REST + base de datos SQLite
  frontend/    Sitio React (público + panel de representantes)
```

## Cómo correrlo

### 1. Backend

```bash
cd backend
npm install
npm run seed     # crea datos de ejemplo (ligas, categorías, partidos)
npm run dev       # http://localhost:4000
```

Usuario de prueba (representante de la liga "LFA"):
- Email: `rep@lfa.mx`
- Password: `password123`

### 2. Frontend

En otra terminal:

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

El frontend hace proxy de `/api` hacia `http://localhost:4000`.

## Flujo de la app

**Público:**
1. Inicio → grid de logos de ligas.
2. Click en liga → lista de categorías (Varonil Mayor, Femenil, etc.).
3. Click en categoría → calendario de partidos, cada uno con botón "Ver el partido" que abre el link de transmisión (si existe).

**Representante de liga:**
1. "Registrar mi liga" → crea cuenta → registra su liga (aparece de inmediato en inicio).
2. Desde "Mi panel": agrega categorías, agrega/edita/elimina partidos, define fecha, sede, jornada, link de transmisión, estado (programado/en vivo/finalizado) y marcador.

## Notas para producción

- Cambia `JWT_SECRET` en `backend/.env`.
- SQLite es ideal para empezar; para producción con más tráfico, migra a Postgres (el código usa SQL estándar, cambios mínimos con `pg` + ajustar `db.js`).
- Para subir logos como archivos (en vez de URLs), se puede agregar un endpoint de upload con `multer` (ya está en las dependencias) que guarde en `/uploads` o un bucket S3/Cloud Storage.
- Para desplegar: backend a un servicio tipo Render/Railway/Fly.io, frontend a Vercel/Netlify (ajustando la URL base del API en `frontend/src/api/client.js`).
