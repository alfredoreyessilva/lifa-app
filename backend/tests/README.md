# Pruebas de punta a punta de cobranza

No son tests unitarios ni corren en el CI: son dos scripts que ejercitan los dos
libros contra un backend vivo, para lo único que de verdad no se puede revisar
leyendo el código — que el saldo cuadre después de cancelar, rechazar y retirar.

| Script | Qué cubre |
|---|---|
| `billing-player.e2e.mjs` | equipo → jugador: padrón sin liga, cuotas, estado de cuenta público, conciliación |
| `billing-league.e2e.mjs` | liga → equipo: cargos, reporte del equipo, confirmar/rechazar/retirar |

## Cómo correrlos

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

## Si ves un 429

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
