# Pruebas del backend

Hay dos tipos y la diferencia importa: **unas corren solas en el CI y las
otras no pueden**.

| Carpeta | Qué son | ¿Corren en el CI? |
|---|---|---|
| `unit/` | Pruebas de funciones puras, sin base de datos ni red | **Sí**, en cada push |
| `*.e2e.mjs` | Recorridos de punta a punta contra un backend vivo | No — necesitan Postgres |

## Las que corren solas — `unit/`

```
cd backend
npm test
```

Usan el runner que ya trae Node (`node --test`), sin Jest, Vitest ni ninguna
dependencia nueva. Tardan menos de un segundo y no necesitan variables de
entorno, así que el CI las corre en cada push (ver `.github/workflows/ci.yml`).

| Archivo | Qué cubre |
|---|---|
| `unit/timezones.test.mjs` | Conversión hora local ↔ UTC: el desfase de cada zona, que Tijuana sí tenga horario de verano y el resto de México no, la medianoche, y el viaje redondo en las 36 zonas |
| `unit/validation.test.mjs` | Los validadores de correo, URL y links de Google Maps — incluido que `javascript:` no pase |
| `unit/plays.test.mjs` | La aritmética de acreditación de la **NCAA**: que una captura no sea intento de pase, que se parta entre los taqueadores, que los dos puntos no entren en los totales individuales, y que un partido en `scoring` no derive box score |

Por qué estas y no otras: son las funciones que **se pueden** probar sin
levantar nada. Todo lo demás en `src/` toca Postgres en la primera línea, y
para eso están las suites de abajo.

El frontend tiene sus propias pruebas equivalentes en `frontend/tests/unit/`
(dinero, estado de partido, validación de formularios y presentación), y una
de ellas cruza a propósito con el backend: verifica que la lista de zonas
horarias que el backend acepta y la lista de etiquetas que el frontend sabe
mostrar no se separen.

## Las de punta a punta

No son unitarias y no corren en el CI: son cinco scripts que ejercitan contra
un backend vivo lo único que de verdad no se puede revisar leyendo el código —
que el saldo cuadre después de cancelar, rechazar y retirar, y que un lote
reenviado no duplique nada.

| Script | Qué cubre |
|---|---|
| `billing-player.e2e.mjs` | equipo → jugador: padrón sin liga, cuotas, estado de cuenta público, conciliación |
| `billing-league.e2e.mjs` | liga → equipo: cargos, reporte del equipo, confirmar/rechazar/retirar |
| `invites-roles.e2e.mjs` | invitación con rol, la entrega de un equipo y la revocación: quién queda de alta en `organization_members`, y a quién le toca 409, 403 o 200. Desde el 2026-09-21 también el candado de **eliminar un equipo**: que uno sin entregar sí se borre aunque deba dinero, y que uno entregado no se borre aunque no deba nada |
| `plays.e2e.mjs` | estadísticas por jugada: que reenviar el mismo lote sea gratis, que la cascada dé un solo box score, que dos capturistas no se pisen y que las reglas de la NCAA sobrevivan el viaje por la base |
| `billing-multiliga.e2e.mjs` | un equipo en DOS ligas: que los dos libros no se mezclen, que no se adivine de cuál liga es un pago, y que sacarlo de un roster no le esconda la deuda |

Las dos de cobranza **no** cubren nada de roles ni de fronteras: las dos usan
un equipo independiente cuyo dueño es el propio actor, así que nunca hay una
liga entregando un equipo ni intentando entrar donde no le toca. Eso es lo que
cubre la tercera, y por eso existe.

La cuarta cubre lo que ninguna prueba unitaria alcanza a tocar: la idempotencia
del lote vive en un `ON CONFLICT` de Postgres, no en JavaScript. Ya se pagó por
tenerla — encontró que el `PUT` que corrige una jugada la dejaba **sin ningún
participante**, porque el `DELETE` y el `INSERT` compartían snapshot dentro de
la misma sentencia y ninguno de los dos fallaba.

### Cómo correrlos

**Nunca contra producción.** Crea una rama en Neon (Branches → New branch), que
es una copia copy-on-write instantánea, y apunta ahí:

```powershell
cd backend
$env:DATABASE_URL = "<cadena de la rama>"
$env:PORT = 4100
node src/server.js          # en una terminal
node tests/billing-player.e2e.mjs   # en otra, con las mismas variables
node tests/billing-league.e2e.mjs
node tests/invites-roles.e2e.mjs
node tests/plays.e2e.mjs
node tests/billing-multiliga.e2e.mjs
```

`DATABASE_URL` hay que ponerla **en las dos** terminales: los scripts abren su
propio pool para mirar la base por debajo y **no** leen el `.env` (no importan
`dotenv`). Sin ella intentan un Postgres local y fallan con `ECONNREFUSED` en
el 5432, que se lee como si la base estuviera caída y no lo está.

Cada script crea su propio usuario, equipo y jugadores, así que se pueden correr
varias veces sin arrastrar estado. Salen con código 0 si todo pasa.

`npm test` **no** los incluye: el patrón que usa es `tests/unit/*.test.mjs`, así
que un `npm test` por accidente nunca va a intentar hablarle a una base de datos.

### Si ves un 429

`reportPaymentLimiter` permite 10 reportes cada 15 minutos por IP y la suite de
jugador gasta 4 por corrida: a la tercera seguida se activa. Es el limitador
funcionando, no un fallo. El conteo vive en memoria del backend — reinícialo y
vuelve a correr.

## Qué encontraron estas pruebas

1. **Un pago rechazado inflaba el saldo.** Al rechazar un pendiente se le ponía
   `status='void'`, y como la regla del saldo solo descartaba `'pending'`, ese
   pago empezaba a sumar sin tener ajuste que lo revirtiera. De ahí vienen los
   estados `'rejected'` y `'withdrawn'`, separados de `'void'`.
2. **Registrar una liga estaba roto** (`POST /leagues` daba 500): la `INSERT`
   tenía 19 placeholders para 18 columnas. Bug preexistente, sin relación con la
   cobranza — se topó de frente al querer crear una liga de prueba.
