# Pruebas del backend

Hay dos tipos y la diferencia importa: **unas corren solas en el CI y las
otras no pueden**.

| Carpeta | Qué son | ¿Corren en el CI? |
|---|---|---|
| `unit/` | Pruebas de funciones puras, sin base de datos ni red | **Sí**, en cada push |
| `billing-*.e2e.mjs` | Recorridos de punta a punta contra un backend vivo | No — necesitan Postgres |

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

Por qué estas y no otras: son las funciones que **se pueden** probar sin
levantar nada. Todo lo demás en `src/` toca Postgres en la primera línea, y
para eso están las suites de abajo.

El frontend tiene sus propias pruebas equivalentes en `frontend/tests/unit/`
(dinero, estado de partido, validación de formularios y presentación), y una
de ellas cruza a propósito con el backend: verifica que la lista de zonas
horarias que el backend acepta y la lista de etiquetas que el frontend sabe
mostrar no se separen.

## Las de punta a punta — cobranza

No son unitarias y no corren en el CI: son dos scripts que ejercitan los dos
libros contra un backend vivo, para lo único que de verdad no se puede revisar
leyendo el código — que el saldo cuadre después de cancelar, rechazar y retirar.

| Script | Qué cubre |
|---|---|
| `billing-player.e2e.mjs` | equipo → jugador: padrón sin liga, cuotas, estado de cuenta público, conciliación |
| `billing-league.e2e.mjs` | liga → equipo: cargos, reporte del equipo, confirmar/rechazar/retirar |

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
```

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
