# Cómo se trabaja en este proyecto

App full-stack para ligas y equipos de fútbol americano en México: publica
calendarios y resultados, y les lleva la operación diaria (roster, tabla de
posiciones, cobranza) que hoy viven en WhatsApp + Excel.

Este archivo son **las reglas de trabajo**. El detalle de cada dominio está en
el README; lo histórico, en `docs/CHANGELOG.md`.

---

## El mapa mínimo

```
backend/    Node 22 + Express, ESM. Postgres en Neon.
  src/config/db.js      El esquema COMPLETO (44 tablas) + migraciones al arrancar
  src/routes/           Aquí vive todo el SQL — 19 archivos
  src/middleware/       auth (JWT) · ownership (24 guardas, por permiso) · rateLimit
  src/utils/            Funciones PURAS — lo único que se puede probar sin Postgres
    orgRoles.js         Qué puede cada rol, por tipo de organización. Fuente única
  scripts/              Diagnóstico y limpieza de un solo uso
frontend/   React 18 + Vite. Rutas en español, API en inglés.
  src/api/client.js     Única puerta al backend. Ningún componente hace fetch por su cuenta.
frontend/api/           2 funciones serverless de Vercel (sitemap, social-preview)
frontend/public/sw.js   Service worker: push + que la app abra SIN SEÑAL.
                        Nunca cachea /api/ — los datos van a IndexedDB
```

Dónde buscar antes de preguntar: **README** tiene una sección por dominio
(Cobranza · Cuotas del club · Tabla de posiciones · Predicciones y quinielas ·
Roster · Roster público y pase de lista · Estadísticas por jugada · Capturar
sin señal · Equipos independientes · Transmisiones · Tiendas y bot de WhatsApp ·
Seguridad), cada una con el porqué de sus decisiones.

## Correrlo y probarlo

```powershell
cd backend  && npm install && npm run dev    # :4000
cd frontend && npm install && npm run dev    # :5173
npm test                                      # en cualquiera de los dos: node --test, <1s
```

285 pruebas unitarias (164 backend + 121 frontend) corren en el CI en cada push.
Las **cinco** suites de punta a punta —las dos de cobranza, la de invitaciones
y roles, la de estadísticas por jugada y la de un equipo en varias ligas—
**no**: necesitan Postgres vivo. Instrucciones en `backend/tests/README.md`.

---

## Reglas que no se negocian

**1. Nunca probar contra producción.** Hoy la `DATABASE_URL` local apunta a la
base real: todo lo que registres desde `localhost:5173` crea filas de verdad.
Para cualquier prueba que escriba, crea una rama en Neon (Branches → New branch,
copia instantánea) y apunta ahí.

**2. Nunca levantar un segundo backend en el 4000.** El que falla por
`EADDRINUSE` alcanza a correr `initSchema()` antes de morir, y eso tumba las
consultas del que sí está sirviendo: una tanda de 500 en todos los endpoints sin
causa aparente.

**3. Un script que escribe, simula por defecto.** Sin `--apply`/`--confirm` no
toca una fila. Los de solo lectura usan `pg` directo, sin migraciones, para ser
seguros contra producción. Cualquier script nuevo sigue esta convención.

**4. Se resuelve al leer, no se migra.** La conferencia de un partido sale de
sus equipos; su fase, de `phase_id` o de `week_label`; el campeón, de la tabla o
del partido decisivo. Nadie reescribe filas y un dato mal capturado se corrige
solo. La excepción se guarda aparte (`*_override`), en **columna nueva** — nunca
reusando la vieja, que es el respaldo.

**5. Los libros de dinero son append-only.** `team_ledger_entries` y
`club_ledger_entries`: un movimiento no se edita ni se borra. Cancelar es
`status='void'` en el original **más** una fila `adjustment` con
`reverses_entry_id`. El saldo **nunca se guarda**, se suma.

- No tocar `BALANCE_SUM_SQL`, los estados de un pago (`pending` / `rejected` /
  `withdrawn` / `void`) ni `reverses_entry_id` sin correr las dos suites e2e
  de cobranza antes y después. Ahí ya se pagó el precio de dos bugs de saldo.
- `rejected` y `withdrawn` tienen estado propio a propósito: compartir `void`
  inflaba el saldo por el monto completo.

**6. Un valor que viaja en la API se cambia en los tres lados o en ninguno:**
esquema, backend y frontend. Un `CHECK` "mejorado" sin tocar el código que
escribe ese valor ya tiró todos los pagos reportados desde el link del papá.

**7. Un roster se publica recortado; el padrón del club no se publica.** Son dos
poblaciones distintas —ver README, "Roles y fronteras de información"— y cada una
tiene su regla:

- **Roster de torneo, en público**: nombre, número y posición, nada más. Que
  una categoría publique su roster —y si además publica la foto— lo decide la
  **liga al crearla**, y las dos cosas nacen apagadas; encima de ese techo, el
  **equipo** puede apagar su propia foto pero nunca encenderla. `curp` y
  `birth_date` no salen nunca. Por eso `GET /players/:id/card` nombra sus
  columnas una por una en vez de `SELECT *`, y responde 404 —no 403— a quien
  nunca estuvo en un roster de torneo.
- **Roster completo**, con CURP y fecha de nacimiento: la liga, y el equipo que
  lo tiene o lo tuvo en su roster. Un roster es el registro histórico de ese
  equipo y no caduca.
- **Padrón del club** (`club_members`): no sale en público **ni se le muestra a
  la liga**, en ningún estado del equipo. Ahí viven CURP, fecha de nacimiento,
  foto, contacto del tutor y el `share_token` de familias que en buena parte son
  de menores.

La tarjeta de un jugador es el registro de **la temporada que está jugando**, no
un perfil que lo persigue: no publica su historial de equipos. Que alguien
cambie de equipo se nota porque deja de aparecer en un roster y aparece en otro,
que es como se entera todo el mundo en la práctica.

**8. El esquema se agrega, no se edita.** `db.js` corre ~150 instrucciones
idempotentes en cada arranque, protegidas con `pg_advisory_xact_lock()` y un
`SAVEPOINT` por migración. Una migración ya aplicada no se toca: se agrega otra
al final con su `ALTER`.

**9. A quien solo viene a pagar o a ver, no se le pide cuenta.** El estado de
cuenta del papá (`/cuenta/:token`) vive fuera de `ProtectedRoute` y el token *es*
la credencial. Exigir sesión ahí es exactamente la fricción que mata el cobro.

**10. Registramos la actividad; la regla es de la liga.** La plataforma guarda
lo que pasó —quién asistió, quién anotó, quién pagó— y entrega el conteo. No
decide quién puede jugar playoffs, no bloquea una alineación ni pinta a nadie
en rojo. El criterio cambia de liga en liga y de temporada en temporada: una
plataforma que lo ejerce se equivoca en cuanto la liga lo cambia, y encima se
vuelve responsable de una decisión que no le toca. Es la regla 4 vista desde el
otro lado — con el dato crudo guardado, cualquier criterio se puede aplicar
después; guardado ya interpretado, no hay vuelta.

---

## Convenciones de código

- **Español** en comentarios, mensajes de error y textos de UI. **Inglés** en
  identificadores, columnas y rutas de la API.
- **ESM en todo** (`"type": "module"`), Node >= 22.5.
- **SQL**: `db.prepare('... WHERE id = ?')` con `?` — se traducen a `$n` solos.
  `.get()` una fila · `.all()` varias · `.run()` escribe.
  - **Ningún otro signo de interrogación dentro de esa cadena**, ni siquiera en
    un comentario `--`: la traducción cambia **cada** `?` por `$n` sin mirar
    dónde está, así que una pregunta en español entre signos se vuelve un
    parámetro fantasma y el endpoint responde 500 en cuanto alguien lo abre.
    No lo atrapan las unitarias ni el chequeo de sintaxis; lo atrapa
    `tests/unit/sqlPlaceholders.test.mjs`, que sí corre en el CI.
- **Todo handler async va envuelto en `asyncHandler`**, o el error se pierde.
- **Los permisos viven en `utils/orgRoles.js`** —qué puede cada rol, por tipo
  de organización— y las guardas de `middleware/ownership.js` los piden por
  nombre: `guardaDeLiga('cobranza_liga')`, `guardaDeEquipo('estructura', 'ver')`.
  Nunca una lista de roles escrita a mano dentro de una ruta. Para membresía,
  `isOrgMember()`.
- **Una transacción real no se reparte en varias llamadas**: `db.prepare` toma
  una conexión del pool por consulta y del otro lado hay un pooler en modo
  transacción. Si algo tiene que ser atómico, va en **una sola sentencia** con
  CTEs (ver `POST /organizations/:id/transfer-owner`).
- **No hay ESLint ni Prettier.** Sigue el estilo del archivo que estés tocando.
- **Dependencia nueva solo si de verdad hace falta.** El proyecto usa el runner
  de Node en vez de Jest y dibuja sus gráficas en SVG a mano; `xlsx` se instala
  desde el CDN de SheetJS, no desde npm, porque la de npm tiene una
  vulnerabilidad sin parche ahí.

## Antes de dar algo por hecho

Lo que encontró los peores bugs de este proyecto no fue leer el código: fue
correrlo contra datos reales. Una prueba unitaria no podía atrapar que el estado
de un partido terminado es `'finished'` y no `'final'`, porque el dato de prueba
lo inventaba el mismo código que se estaba probando.

- Cambio de cobranza → las dos suites e2e de cobranza contra una rama de Neon,
  antes y después, **más `billing-multiliga.e2e.mjs`** si toca qué liga le cobra
  a quién. Cambio de permisos, invitaciones o entrega de un equipo →
  `invites-roles.e2e.mjs`, la tercera.
- Cambio de UI → abrirlo en el navegador. Si no se verificó, se dice que no se verificó.
- Cambio de esquema o de consulta → correrlo contra los datos reales dentro de
  una transacción con `ROLLBACK` y `lock_timeout`, y comprobar que las filas que
  no debían moverse no se movieron.

## Documentación

El README documenta **por qué**, no solo qué. Cuando una decisión no sea obvia
—o cuando algo se haya dejado a medias a propósito— se escribe ahí, en la
sección de su dominio. Lo que se termina pasa a `docs/CHANGELOG.md` con fecha;
lo que queda abierto, a "Pendientes abiertos" del README.

Los mensajes de commit son una frase en español que dice qué cambió y, cuando
importa, por qué: *"La conferencia se dice una vez por equipo, no una vez por
partido"*.
