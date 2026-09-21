# Changelog

Lo que se construyó y se cerró, con su fecha y su verificación. Es el histórico
del proyecto: sirve para entender **por qué** algo quedó como quedó, y varias
entradas traen el post-mortem del bug que las provocó.

- Lo que sigue **abierto** vive en "Pendientes abiertos" del [README](../README.md).
- El detalle **vigente** de cada dominio (cobranza, posiciones, roster, …) vive
  en la sección correspondiente del README, no aquí.
- Las reglas de trabajo están en [CLAUDE.md](../CLAUDE.md).

---

## Septiembre 2026

### Cambios

- **El bloque del día del partido ya está en producción (2026-09-20)** — los
  nueve commits de `dia-del-partido` pasaron a `origin/main` en fast-forward,
  `35b3616 → 868a31d`. Antes de empujar se confirmó contra el remoto que
  `origin/main` seguía donde decía el README y que no había nada en main fuera
  de la rama.

  **La ventana Vercel-antes-que-Render por fin se midió**, que es lo que este
  README venía describiendo sin números. Con reloj:

  | Momento | Qué se vio |
  |---|---|
  | `22:50:42` | push a `origin/main` |
  | `22:51:31` (+49s) | Vercel **ya servía** el build nuevo; Render seguía en `404` para `/api/plays/*` |
  | `22:52:02` (+80s) | Render vivo: `/api/plays/matches/1/capture` pasa de `404` a `401` |

  O sea: **el despliegue completo tardó 80 segundos** y la ventana duró entre
  31 y 80 (no se sabe el minuto exacto en que Vercel terminó, solo que a los
  49s ya estaba). "Una ventana de minutos" era pesimista, pero la ventana
  **existe** y el orden fue el previsto. Durante ella `/api/health` respondió
  `200` todo el tiempo: el backend viejo siguió sirviendo, que es justo el
  "degrada suave" que estaba escrito.

  **Verificado después**: `/api/plays/matches/:id/capture` responde `401`
  —existe y pide sesión—, la ruta pública de box score contesta
  `{"error":"Partido no encontrado"}` con `404` para un partido inexistente
  —está montada y corriendo—, y en Vercel el icono nuevo sale `200 image/png`
  con la etiqueta en el HTML y el manifest con sus dos iconos.

  **Lo que NO se comprobó desde fuera**: que `initSchema()` haya creado las
  tres tablas en la rama de producción de Neon. Que Render arrancara y
  `/api/health` conteste es evidencia —`initSchema()` corre al arrancar— pero
  no es prueba; eso se ve con una sesión con permiso `estadisticas`, o en el
  panel de Neon.

- **La app ya trae icono para instalarse en iPhone (2026-09-20)** — faltaba el
  `apple-touch-icon`, que es la única etiqueta que iOS mira: ignora los iconos
  del manifest, así que una app agregada a inicio salía con una miniatura de la
  página en vez de la marca. Android/Chrome nunca tuvo el problema.

  Va antes de desplegar por una dependencia, no por orden: la prueba pendiente
  del teléfono estrena la app instalada, y sin el icono esa prueba arranca con
  el defecto puesto.

  **El icono se rasterizó del `favicon.svg`**, no del banner `cfbamx.jpg`: el
  wordmark "CFBAMX" a 180 píxeles de ancho no se lee, y el favicon ya es la
  marca en cuadrado —balón amarillo sobre verde—. Dos decisiones que no son
  cosméticas y que conviene no deshacer:

  - **Sin las esquinas redondeadas del SVG.** El favicon trae `rx="12"`;
    copiarlo dejaría las cuatro esquinas transparentes, iOS las compone sobre
    **negro** y luego recorta su propia máscara encima. El PNG va a sangre y
    iOS redondea.
  - **Sin canal alfa** (`Format24bppRgb`), por lo mismo: cualquier
    transparencia que se cuele se vuelve negra en el teléfono.

  El balón queda con ~18% de margen, que aguanta el recorte de la máscara de
  iOS sin comerse las agujetas.

  **Verificado**: PNG de 180×180 sin alfa (3,052 bytes); `npm run build` lo
  copia a `dist/`; servido con `vite preview`, `/apple-touch-icon.png` responde
  `200 image/png` y `/manifest.webmanifest` responde `200
  application/manifest+json` con el JSON válido y las dos entradas de icono.
  **Lo que NO se verificó**: cómo lo pinta un iPhone de verdad. No se abrió en
  el navegador —la instancia de Playwright quedó bloqueada por permisos— y de
  todas formas Chromium en Windows no contesta esa pregunta. Queda como tercer
  punto de la prueba del teléfono en "Pendientes abiertos".

- **El visor ya captura jugada por jugada, en la cancha y sin señal
  (2026-09-20)** — la pantalla que faltaba, montada sobre el backend de la
  entrada de abajo. `/partidos/:matchId/estadisticas` es el tercer botón del
  partido y se comporta como los otros dos: cualquiera ve el box score, y quien
  tiene `estadisticas` ve encima el panel de captura.

  **Se diseñó para un pulgar y con el partido enfrente**, que es la única
  restricción que manda aquí: son ciento veinte capturas seguidas, y un toque
  de más por jugada son dos minutos perdidos con la vista en el celular en vez
  de en el campo. Se escoge **por número** y no por nombre —es lo que se ve en
  la espalda del jugador—, el down derivado va grande y arriba para leerse de
  reojo, el reloj y la posición se preguntan **una vez por serie**, y la
  defensa vive detrás de un desplegable y solo en nivel completo. El botón de
  guardar **dice qué falta** en vez de quedarse gris: sin señal no hay a quién
  preguntarle, y un botón mudo en la cancha es una captura perdida.

  **La cola aprendió a acumular.** Es la diferencia más importante y la más
  fácil de romper: un pase de lista es el estado completo de un equipo y dos
  capturas de lo mismo son la misma, pero dos capturas de jugadas son la jugada
  7 y la jugada 8. Reemplazar ahí convertiría un partido entero en su última
  jugada, en silencio. Ahora el lote se une por `client_play_id`, y corregir
  algo que todavía no sube es nada más volver a capturarlo. Corregir o borrar
  algo que **ya** subió va por su propio pendiente, porque el lote no pisa lo
  que está del otro lado.

  Que la segunda pantalla entrara poniendo **tres despachadores y nada más** es
  la prueba de que la capa sin señal quedó en el lugar correcto: la
  persistencia, el backoff, el contador y el aviso al salir ya funcionaban.

  **La derivación del down vive ahora en los dos lados**, y es a propósito: la
  pantalla tiene que poder decir "2º y 6" en una cancha sin internet, donde no
  hay a quién preguntarle. En vez de fingir que se comparte un módulo entre los
  dos paquetes, hay una prueba que **cruza** las dos copias y falla si se
  separan — el mismo trato que ya tenían `matchScope.js` y las zonas horarias.
  La acreditación de la NCAA **no** se copió: vive una sola vez, en el backend,
  porque el box score se lee de allá.

  **Verificado con el modo avión prendido** contra la compilación real (`vite
  preview`, no el servidor de desarrollo): preparar con señal, apagarla,
  capturar, **recargar**, capturar más, encenderla y comprobar que subió todo
  una sola vez — 0 duplicadas y 0 participantes huérfanos en la base. El down
  se derivó sin señal y recargar sin señal no devolvió la pantalla al estado
  preparado, que era el bug número 3 del pase de lista y aquí no se repitió.

  **Dos bugs que solo aparecieron capturando de verdad en el navegador:**

  1. **`Number(null)` es 0, y aquí eso miente.** El down, la distancia y la
     yarda son opcionales y llegan vacíos casi siempre; pasarlos por `Number()`
     sin filtrar convertía "no se capturó" en **yarda 0** —la línea de gol— y
     en "0 por ganar". La pantalla anunciaba **"1º y gol" con la jugada
     capturada en media cancha**. Es la misma familia que el `yards_gained NOT
     NULL` de la entrada de abajo: un hueco que se vuelve un número con cara de
     verdadero. Un cero que alguien sí capturó se sigue respetando — la yarda 0
     existe y "4º y 0" también.
  2. **"Down desconocido — algo no se capturó" en una serie recién abierta.**
     No saber el down todavía y haberlo perdido son cosas distintas: una serie
     vacía no sabe nada porque nadie ha capturado nada. Gritarle una falsa
     alarma en amarillo al visor que acaba de abrir la pantalla es justo el
     momento en que menos sirve. Ahora dice "Empieza la serie", y el aviso se
     guarda para cuando la cadena de verdad se rompe.

  Lo que **no** está verificado, dicho de frente: un teléfono de verdad, y un
  partido completo capturado por una persona. Ciento veinte jugadas seguidas,
  sin poder pedir repetición, es donde se va a ver si la jugada mínima es de
  verdad mínima — y eso no lo contesta una pantalla abierta en el escritorio.

- **Las estadísticas por jugada ya se guardan y se leen (2026-09-20)** — el
  backend. Es el primer pendiente del bloque del día del partido, y ya no lo
  bloqueaba nada de plataforma: la capa sin señal está debajo y el `PUT` del
  pase de lista dejó demostrado el patrón.

  **La jugada es el átomo y el box score se deriva de ahí.** No es la opción
  barata y se eligió a propósito: es lo único que responde "quién anotó", que
  es lo que la hoja de visoría necesita y lo que las 16 columnas de
  `player_match_stats` nunca van a poder contestar. Yardas, intentos,
  porcentajes y líderes no se guardan: se suman (regla 4).

  **Tres tablas.** `match_capture_sessions` reclama el partido y declara el
  nivel; `match_plays` es la jugada; `play_participants` es quién la hizo y con
  qué papel. Los tres niveles de captura —`scoring`, `offense`, `full`—
  escriben **las mismas filas**: una liga que arranca capturando solo
  anotaciones y en dos temporadas llega a captura completa no migra nada, sus
  jugadas viejas se quedan como están y las nuevas traen más participantes. Eso
  es lo que compra tener los participantes en tabla aparte.

  **El nivel no es una preferencia, es un dato del que depende cómo se lee ese
  partido.** Un partido capturado en `scoring` tiene jugadas —las ocho que
  anotaron— y derivar un box score de ahí diría que el equipo entero corrió 80
  yardas en todo el partido: un número falso con cara de verdadero, que es la
  peor clase. Por eso la cascada pregunta por el nivel y no solo por "¿hay
  jugadas?", y por eso `source` y `capture_level` viajan siempre en la
  respuesta.

  **Un partido tiene un box score, no dos.** Si hay una sesión buena con nivel
  que derive, sale de las jugadas; si no, sale de `player_match_stats`, que
  pasa a ser la captura por totales. Nunca se mezclan, nunca se suman entre sí
  y nadie copia lo derivado dentro de la otra tabla. Las dos ramas salen con
  los **mismos nombres** —los de SportsML— así que la pantalla las lee igual:
  la tabla de equivalencias de veinte líneas que se había dejado escrita "para
  el día que haga falta" es lo que hace eso posible, y no tocó una sola
  columna.

  **El down no se captura, se deriva.** Dentro de una serie, sabiendo dónde
  empezó y cuántas yardas ganó cada jugada, se sabe en qué down va. La pantalla
  mostrará el derivado y dejará corregirlo: el visor no captura el down, lo
  desmiente cuando se desvía. Cuando la cadena se rompe —una penalización o un
  cambio de posesión que nadie anotó— la jugada sale con el down en blanco y
  marcada, en vez de inventar un quinto down.

  **Las reglas de acreditación son las de la NCAA y están escritas.** ONEFA
  juega con reglas NCAA, así que no hay que inventarlas: una captura **no** es
  intento de pase —se le carga al pasador como acarreo con la pérdida, al revés
  que en la NFL— y se parte entre quienes la hicieron, media para cada uno; una
  conversión de dos puntos no entra en los totales individuales. Las tres
  tienen prueba propia, con el porqué escrito encima, porque son exactamente lo
  que alguien va a "arreglar" más adelante creyendo que encontró un bug.

  **Reenviar el mismo lote es gratis**, que es la promesa entera del modo sin
  señal: la identidad de una jugada es el `client_play_id` que nace en el
  celular, y el envío hace `ON CONFLICT DO NOTHING`. No `DO UPDATE`, y la
  diferencia importa: una jugada que la liga ya corrigió no puede volver a
  quedar como estaba porque el teléfono del visor recuperó la señal tres horas
  tarde. Corregir tiene su propio endpoint.

  **Nunca se descarta lo capturado.** Un segundo capturista recibe 409 y tiene
  que decir explícitamente que toma el control; hacerlo cierra la sesión
  anterior pero no borra sus jugadas. Y un lote que llega sin sesión —alguien
  capturó sin haber reclamado el partido— no se rechaza: se le abre una propia,
  que nace no autoritativa si ya había otra. Cuál de las dos es la buena lo
  decide una persona, no la plataforma (regla 10).

  Permiso nuevo, `estadisticas`, con el mismo reparto que `asistencia`: dueño,
  administrador y visor de la liga. Se mantiene aparte y no dentro de
  `asistencia` porque son dos trabajos de tamaños muy distintos —cuarenta
  marcas contra ciento veinte jugadas— y una liga va a querer poder dar el
  primero sin el segundo. El box score **sí es público**, a diferencia de la
  asistencia: es el resultado deportivo, que es justo lo que un torneo publica.

  **Verificado el 2026-09-20** contra una rama de Neon: 33 pruebas unitarias
  nuevas para la aritmética de la NCAA y 68 comprobaciones de punta a punta
  (`backend/tests/plays.e2e.mjs`) para lo que ninguna prueba unitaria alcanza
  —la idempotencia vive en un `ON CONFLICT` de Postgres, no en JavaScript.

  **Y un bug que solo apareció corriéndolo.** El `PUT` que corrige una jugada
  borraba sus participantes y los volvía a insertar en la **misma sentencia**.
  Los CTE de Postgres comparten un snapshot, así que el `INSERT` veía las filas
  viejas todavía presentes, su `ON CONFLICT` no insertaba nada, y después el
  `DELETE` se las llevaba: la jugada quedaba sin ningún participante. No
  fallaba, no avisaba, y el 200 se veía igual de bien. Se arregló con el patrón
  que el `PUT` del pase de lista ya tenía escrito y que aquí no se había
  seguido: los dos CTE que escriben tocan la misma tabla pero nunca la misma
  fila.

  Un cambio sobre lo que el README tenía escrito: `yards_gained` quedó
  `NOT NULL` en vez de nulable, por lo que la propia sección dice tres párrafos
  más abajo —*cero es un valor, no un hueco*—. Un NULL ahí se suma como cero al
  derivar, y entonces "no se capturó" y "no avanzó" dejan de distinguirse.

- **La app ya abre y captura sin señal (2026-09-20)**: la capa que "Capturar sin
  señal" pedía como requisito, no como mejora. Muchas canchas no tienen
  internet, y una captura que exige conexión no se usa: se vuelve al papel en el
  segundo partido. Su primer consumidor es el pase de lista; la captura por
  jugada, cuando llegue, monta encima sin tocar nada de esto.

  **Se prepara con señal y se captura sin ella.** Un botón —**Preparar
  partido**— baja el partido, el roster vigente a esa fecha y **la pantalla
  misma**. Es una descarga explícita y no un cache oportunista, y la diferencia
  es quién se entera del problema y cuándo: el cache oportunista falla
  exactamente cuando importa, porque el visor que nunca abrió esa pantalla con
  señal llega a la cancha sin nada y ahí ya no hay forma de avisarle. Una
  descarga que se pide se puede verificar en el estacionamiento.

  **El service worker no cachea `/api/`, y es una decisión.** Una respuesta de
  API servida desde el cache HTTP se ve idéntica a una recién traída. Los datos
  van a IndexedDB, donde la pantalla sabe **de cuándo son** y lo dice — que es la
  diferencia entre pasar lista contra un roster de hace tres semanas sin
  enterarse, y saber que eso es lo que estás haciendo.

  **La cola fusiona en vez de acumular.** Dos capturas del mismo pase de lista
  no son dos cosas que subir: son la misma, y gana la última. Es consecuencia
  directa de que el `PUT` reciba la lista completa — con un endpoint por jugador
  habría que subir cuarenta llamadas en orden y aguantar que la número 19 falle.
  **Nada se descarta nunca**: lo que falla se pospone con espera creciente, y lo
  que se rinde después de ocho intentos sigue en la cola, visible, con un botón
  de "Reintentar ahora". La regla 10 otra vez — la plataforma no tira un dato
  por su cuenta.

  **Lo que vive solo en el teléfono se dice en voz alta.** Mientras no suben,
  las capturas viven en un solo lugar: si alguien borra los datos del navegador
  o pierde el teléfono, se perdieron. Es el mismo riesgo que la hoja de papel
  que esto sustituye, no uno nuevo — pero la pantalla lo dice con un contador
  rojo y el navegador avisa al intentar salir. Lo que convierte esto en una
  pérdida no es que el dato viva en el teléfono, es que nadie se entere de que
  todavía vive ahí.

  **Tres bugs que solo se vieron corriéndolo**, los tres con el modo avión
  prendido y ninguno leyendo el código:

  1. **`Vary` hacía que el cache no encontrara lo que él mismo guardó.** Vite
     emite sus scripts con `crossorigin`, el navegador los pide con cabecera
     `Origin` y el servidor contesta `Vary: Origin`; el service worker los había
     guardado sin `Origin`, y `caches.match` respeta `Vary`. Resultado: la
     navegación salía del cache, el JavaScript no, y la app abría **en blanco**.
  2. **Los chunks de `lazy()` no están en el DOM.** La lista de lo que hay que
     guardar salía de `script[src]`, que no ve lo cargado con `import()` — y
     cada página de esta app es justo eso. El visor preparaba el partido,
     llegaba a la cancha y la app se moría pidiendo un chunk que nadie guardó.
     Ahora la lista sale de `performance.getEntriesByType('resource')`.
  3. **Recargar sin señal devolvía la pantalla al estado preparado.** La captura
     seguía a salvo en la cola, pero el visor la veía desaparecer y volvía a
     marcar sobre una base vieja. Lo que está en la cola manda sobre lo que
     trajo el servidor, hasta que suba.

  **Y un bug viejo que solo ahora tenía consecuencias: quedarse sin señal
  cerraba la sesión.** `AuthContext` borraba el token ante **cualquier** fallo de
  `/auth/me`, incluido "no llegué al servidor" — así que el visor abría la app en
  una cancha sin internet y la app lo sacaba, justo donde más falta le hacía
  estar dentro. Ahora `api/client.js` marca el error (`err.offline`) para
  distinguir "el servidor dijo que no" de "no llegué al servidor", y la sesión
  solo se cierra con lo primero. La última respuesta de `/auth/me` se guarda para
  abrir sin señal sabiendo quién eres; el token ya duraba 7 días.

  **Verificado contra la compilación real** (`vite preview`, no el servidor de
  desarrollo: en `dev` no existen los `/assets/` con hash, que es justo lo que el
  service worker sirve cache-first). La receta completa, de punta a punta:
  preparar con señal → modo avión → recargar (la app abre, 9 jugadores, **sesión
  viva**) → pasar lista → recargar otra vez (lo capturado sigue ahí) → marcar uno
  más → volver la señal → la cola se vacía sola y las 8 filas llegan a Postgres,
  **sin una sola duplicada**. El aviso al salir con capturas pendientes también
  se disparó, dos veces, sin que nadie lo pidiera.

  **Lo que este montaje NO prueba**, dicho de frente: un teléfono de verdad.
  Chromium con el modo offline de Playwright apaga la red, pero no mata la
  pestaña, no se queda sin batería y no tiene al administrador de memoria de
  Android cerrando la app a media captura. Eso es lo que `manifest.webmanifest`
  existe para mitigar, y no está verificado en hardware.

  De paso, `vite preview` quedó con su proxy a la API y el backend acepta el
  puerto 4173 en local. Faltaba, y el síntoma no se parecía a la causa: los GET
  pasaban —el navegador no manda `Origin` en una petición del mismo origen— y el
  `PUT` del pase de lista devolvía 500.

- **El pase de lista, encima de la misma lista (2026-09-20)**: la segunda mitad
  de "Roster público y pase de lista", y con ella el día del partido ya tiene
  sus dos primeras piezas corriendo. El visor estrena lo suyo: entraba al panel
  de la liga con casi todo apagado y ahora tiene una pantalla que es **su**
  trabajo.

  **No son dos pantallas ni dos botones.** Quien llega de fuera ve el roster;
  quien tiene el permiso `asistencia` ve la misma lista con el pase de lista al
  lado. Por eso la pantalla se mudó de la rama al **partido**
  (`/partidos/:matchId/equipos/:teamId/roster`): la asistencia es a un partido,
  y un roster suelto no tiene a qué marcarle nada. Del lado del backend eso es
  una sola consulta —`rosterDelPartidoSql`— que sirve a las dos superficies y
  solo cambia las columnas que deja salir. Dos consultas parecidas acabarían
  enseñando dos listas distintas el día que una se toque y la otra no.

  **Dos estados, y un tercero que no se guarda.** `present` y `absent` son los
  únicos valores de `match_attendance`; **sin pasar lista** es la ausencia de
  fila. Si el visor no llegó, nadie faltó — guardar solo dos estados obligaría a
  inventar uno para los partidos que nadie capturó, y la liga acabaría
  castigando a quien no debía. El acumulado reporta las tres cifras por
  separado, sin porcentaje y sin veredicto: la plataforma registra la actividad
  y el criterio de elegibilidad es de la liga (regla 10).

  **El `PUT` recibe la lista COMPLETA de un equipo**, no un jugador a la vez. Un
  pase de lista se hace de un jalón y con la cancha enfrente; cuarenta llamadas
  sueltas dejan la mitad capturada cuando se cae el internet del campo. Recibir
  la lista entera lo vuelve idempotente de nacimiento —lo que pide la cola de
  "Capturar sin señal"— y es además **cómo se desmarca a alguien**: quien no
  viene en la lista vuelve a "sin pasar lista". Va en **una sola sentencia** con
  CTEs, por la regla de que una transacción no se reparte entre varias llamadas:
  el `DELETE` se queda con quien no viene y el `INSERT … ON CONFLICT` con quien
  sí, y nunca tocan la misma fila.

  **Tolera que el roster haya cambiado entre la captura y el envío**, que es el
  caso real de una cola offline: un jugador que ya no está en el roster se
  ignora en silencio en vez de reventar la petición entera con un error de llave
  foránea. Eso mismo impide marcar a alguien del equipo rival.

  **Un hallazgo que cambió el modelo: `start_date` y `end_date` no significan lo
  mismo.** El plan decía "el roster vigente a la fecha del partido", que leído
  literal es filtrar por las dos fechas. Pero `end_date` es un **acto** —alguien
  dio de baja a esa persona ese día— y `start_date` es **cuándo se tecleó la
  fila**: nace con un `DEFAULT` y ninguna pantalla la pregunta nunca. Filtrar
  por ella sería tratar "el día que lo capturamos" como "el día que llegó al
  equipo", y aquí el roster se captura tarde: una liga que lo sube en noviembre
  vería la lista **vacía** en todos los partidos anteriores y no podría pasar
  lista en ninguno. Se filtra solo por `end_date`, y aparece siempre quien ya
  tenga fila de asistencia en ese partido — sin eso, dar de baja a alguien
  borraría de la pantalla una marca que sigue viva en la base.

  **`asistencia` es un permiso de liga y solo de liga.** Dueño, administrador y
  **visor** lo traen; el tesorero no. El equipo **lee lo suyo** —incluido el
  coach, que es quien necesita saber a quién le falta antes de que sea tarde— y
  eso cae en `ver`, la línea base, porque la asistencia es del dominio torneo
  como el roster. Nunca la del rival. Y no hace falta un "actuar como visor": el
  emprendedor que registró la liga ya trae el permiso en su rol de dueño.

  **La asistencia no es pública**, ni marcada ni sumada, encienda la categoría
  lo que encienda: son faltas de gente que en buena parte es menor de edad. La
  consulta compartida lo garantiza por construcción — las columnas de asistencia
  solo salen si se piden, y el default es el de la pantalla pública.

  **Verificado contra la rama de Neon y en el navegador**, con los tres papeles
  y sobre un roster real de ONEFA con sus casos feos:

  - El corte por fecha funciona: el jugador dado de baja el 10 de septiembre
    aparece en el partido del día 3 y desaparece del día 11 en adelante. Y la
    fecha se corta en hora de México — el partido guardado como
    `2026-09-04T00:00:00Z` **es del día 3**, no del 4.
  - Los cinco casos del `PUT`: marcar, reintentar el mismo envío (idempotente,
    cero escrituras de más), corregir, mandar un jugador del otro equipo (se
    ignora, `ignoradas: 1`) y mandar la lista vacía (borra lo que había).
  - Las cuatro fronteras: el coach ve **solo su equipo** y sin botones; marcar
    le da 403; el acumulado del rival, 403; un partido de otra liga, 403.
  - El acumulado cuenta bien a quien llegó o se fue a media temporada: el dado
    de baja sale con **1 convocable**, no con 9, así que no arrastra ocho faltas
    de partidos que no le tocaban.
  - En celular el renglón se parte en dos y los dos botones se van a una línea
    propia — que es donde esto se va a usar de verdad, con el partido enfrente.

  **Un tropiezo que vale anotar**: a media sesión resultó que había un backend
  viejo corriendo con `node --watch`, reiniciándose en cada edición y peleando
  por el 4000 con el que sí estaba sirviendo. Es exactamente la regla 2 de
  `CLAUDE.md`, y se nota como peticiones que dejan de responder sin causa
  aparente. Se mató y se levantó uno solo antes de dar nada por bueno.

- **El roster ya se publica, y la foto tiene dos llaves (2026-09-20)**: es la
  primera mitad de "Roster público y pase de lista", decidida ese mismo día, y
  con ella el proyecto estrena **la primera superficie pública donde se ve
  quién juega**. Hasta aquí las públicas eran liga, torneo, calendario, partido
  y la tarjeta del jugador: ninguna decía quién está en un roster.

  **La decisión se toma al crear la categoría**, que es cuando significa algo:
  una categoría *es* un corte de edad y de nivel, así que quien la está creando
  sabe en ese momento si está armando la Infantil o la Mayor. Dos columnas
  nuevas, las dos **apagadas por default** — `categories.roster_public` y
  `categories.roster_photos` —, y la pregunta viene con la recomendación de
  CFBAMX escrita en la pantalla: si la categoría es de menores, déjala privada.
  Va como recomendación y no como candado por la regla 10: la liga conoce su
  torneo y sus familias. Lo que sí hacemos es que el default sea el que no
  lastima a nadie si la pregunta se contesta a las prisas.

  **La foto necesita que las dos partes estén de acuerdo**, y la asimetría es
  el punto: `branch_teams.show_photos` deja que un equipo **apague** la suya
  aunque la categoría la permita, y **nunca** encenderla si la categoría la
  dejó apagada. Nace NULL —"sigue a la categoría"— para que un equipo que no
  tocó nada no bloquee a su liga. Así la liga puede publicar un programa de
  mano sin perseguir a veinte equipos, y el equipo conserva el veto sobre las
  caras de sus jugadores. `PUT /players/branches/:b/teams/:t/photos` es la
  **única guarda del proyecto que deja fuera a la liga a propósito**: si la
  liga pudiera tocar ese interruptor tendría las dos llaves y el veto no
  existiría.

  **Esto cierra la mitad del pendiente de la tarjeta del jugador.** La foto
  dejó de salir siempre: `GET /players/:id/card` la entrega solo si todos los
  rosters activos de esa persona la autorizan (`BOOL_AND`, no `BOOL_OR` — un
  veto que se puede saltar entrando por otra rama no es un veto). Se aplica en
  la **respuesta** y no al pintarla, que es lo que también la saca de la imagen
  que `playerShareCard.js` arma para redes: lo que el backend no manda no se
  puede compartir. Sin filas, `BOOL_AND` devuelve NULL, que no es `true`: falla
  cerrado. La trayectoria sigue saliendo y sigue pendiente — es otro cambio.

  **Lo que el plan decía y cómo quedó**, dos desvíos que vale anotar:

  1. El endpoint público iba a ser `/public/branches/…`. Quedó en
     `GET /leagues/branches/:branchId/teams/:teamId/roster`: esta app no tiene
     prefijo `/public` — su superficie pública son los endpoints de
     `routes/leagues.js` sin `authRequired`, y el vecino natural de este es
     `/branches/:branchId/standings`, que ya filtra por `l.is_public` igual.
  2. El roster público muestra quién está **hoy** (`end_date IS NULL`). La otra
     pregunta —quién estaba vigente **a la fecha del partido**— la necesita el
     pase de lista y llega con él.

  Responde **404 y no 403** a un roster privado, por la misma razón que la
  tarjeta del jugador: desde afuera no se debe poder distinguir "existe pero no
  te lo muestro" de "no existe". Un 403 confirmaría que esa categoría, ese
  equipo y esa rama existen.

  **La regla vive en un archivo puro**, `utils/rosterVisibility.js`, por la
  misma razón que el catálogo de roles: es la regla que decide si la cara de un
  menor sale en una página abierta, así que tiene que poder probarse sin
  Postgres — y eso es lo único que el CI alcanza. 10 pruebas nuevas (109 en el
  backend), y fijan las tres formas de romperla en silencio: que el default
  deje de estar apagado, que el equipo pueda subir el techo, y que NULL se
  confunda con FALSE.

  **Verificado contra la rama de Neon y en el navegador**, con un roster real
  de ONEFA sembrado a propósito con sus casos feos: nueve jugadores, uno **dado
  de baja a media temporada** (no sale), uno **sin número** (sale al final, con
  "—"), y los dos equipos del mismo partido en distinto estado — uno publicando
  fotos, el otro con el veto puesto.

  - El roster público del que veta **no trae la columna `photo_url` siquiera**,
    no es que llegue y no se pinte.
  - La tarjeta de un jugador del equipo que veta muestra iniciales; la del otro,
    su foto.
  - Prender el veto desde la pantalla del equipo apaga la foto en las **dos**
    superficies públicas al instante; apagarlo devuelve a NULL —"sigue a la
    categoría"— y no a `true`.
  - Editar el nombre de una categoría **no** le apaga el roster: los dos
    interruptores viajan juntos, mismo criterio que `auto_status_enabled` y sus
    horas en ese mismo handler.
  - La guarda contestó 403 al equipo ajeno, 400 a un valor que no es booleano
    ni null, y 401 sin sesión.
  - La consulta de la tarjeta se corrió contra los datos reales **dentro de una
    transacción con `ROLLBACK`** y `lock_timeout`, metiéndole al jugador una
    segunda membresía en el roster que veta: la foto se apagó, y después del
    ROLLBACK no se movió ni una fila.

- **Cada rol ya se nota en pantalla (2026-09-20)**: es el paso 5, el último de
  "Roles y fronteras de información", y con él el modelo completo corre de
  punta a punta. Se invita eligiendo rol, la lista de accesos dice con qué
  entró cada quien, y el panel esconde lo que ese rol no puede hacer.

  **El frontend no tiene la tabla de permisos, y ese es el punto.** `/auth/me`
  manda por cada liga y equipo `my_role`, `my_role_label` y `my_permissions`
  ya resueltos, y el frontend solo pregunta `puede(entidad, 'cuotas_club')`
  desde `utils/permisos.js`. La tabla vive en un solo lado (regla 6): un rol
  nuevo en el catálogo no obliga a tocar el frontend, y dos listas que podrían
  separarse simplemente no existen. Las etiquetas viajan resueltas por lo
  mismo — `treasurer` se lee "Tesorero de liga" en una liga y "Tesorero" en un
  equipo, y `editor` nunca se lee "editor" a secas.

  **Esconder no es proteger**, y está escrito en `utils/permisos.js` para que
  no se confunda después: quien decide es la guarda del backend, que vuelve a
  preguntar en cada petición. Un permiso de más enseña un botón que dará 403;
  uno de menos esconde algo que sí se podía. Ninguno de los dos abre nada, y
  `puede()` falla cerrado.

  **Se esconden acciones, no información.** Un coach conserva su pestaña de
  Perfil —la ve, no la edita— y su Resumen dice qué es lo suyo en vez de
  quedarse vacío: ese rol existe para mirar el equipo, así que esconderle el
  equipo lo dejaba sin nada. El editor de roster entra a la misma pestaña que
  el tesorero y ve **solo** los rosters de torneo; ni siquiera se le pide el
  padrón del club al backend, porque pedirlo sería pintar un 403 en rojo por
  algo que no es un error.

  **Dos defectos que este paso destapó**, los dos porque el selector hace
  posible por primera vez que haya más de un dueño:

  1. `POST /organizations/:id/transfer-owner` degradaba a **todos** los dueños
     para promover a uno — con dos dueños, ceder el puesto los tumbaba a los
     dos. Ahora solo se mueve quien cede, y ceder lo decide quien tiene el
     permiso `duenos`, no "el owner que la consulta devuelva primero".
  2. El botón "Quitar rep." de la liga pasó a contestar 409 siempre, desde que
     entregar es de una sola vía. Se reemplazó por lo que sí se puede:
     **entregar** mientras nadie lo haya reclamado, y **cancelar esa entrega**.
     Un equipo ya entregado se lee "👤 se administra solo" y no ofrece ninguna
     acción sobre su acceso.

  **Verificado en el navegador**, con los seis roles repartidos contra la rama
  de Neon: el coach ve Resumen y Perfil (sin botón de editar) y cero errores en
  consola; el editor de roster ve sus rosters de torneo y no el padrón; el
  tesorero del club ve los dos libros pero no "Administradores"; el visor de
  liga solo conserva "Ver mi página"; y a un administrador de liga el rol
  "Dueño" le aparece deshabilitado con su porqué. También se revisó el link de
  invitación **sin sesión** —dice "Te invitaron a … como Tesorero de liga"
  antes de pedir cuenta— y que el 409 de una entrega repetida se lea como
  explicación y no como error rojo.

  **Lo que no se construyó, a propósito**: el visor sigue entrando al panel de
  la liga con casi todo apagado. Su trabajo real el día del partido —pasar
  lista, capturar anotaciones, la hoja de visoría que firman los coaches y el
  árbitro— no está diseñado, y hacerle una pantalla antes de eso es hacer algo
  que habría que arrancar. Queda anotado en "Pendientes abiertos".

- **Administrarse solo y participar en una liga dejaron de ser la misma cosa
  (2026-09-20)**: es la corrección de fondo del modelo de roles, y la que hizo
  que las demás piezas cuadraran. Una liga se registra, **crea sus equipos para
  poder subir el calendario**, y después le entrega ese perfil a cada equipo.
  Al entregarlo **se sale de la administración de ese equipo**. Lo que no
  cambia es que el equipo sigue jugando su torneo: eso vive en `branch_teams` y
  no lo toca nadie al entregar.

  **"Revocado" era un mal nombre y una función equivocada, y ya no existe.** Era
  un solo botón contestando dos preguntas distintas —*¿el equipo se administra
  solo?* y *¿el equipo participa en esta liga?*— y por eso el ciclo de vida se
  contradecía a sí mismo: pedía que la liga no pudiera invitar a un equipo
  entregado *y* que pudiera volver a entregar uno revocado. Las dos no podían
  ser ciertas, y en esa grieta vivía la puerta trasera del modelo: revocar al
  representante, generar una invitación nueva, reclamarla uno mismo, y el padrón
  del club —CURP y fecha de nacimiento de menores, y el `share_token` que **es**
  la credencial del estado de cuenta de cada familia— quedaba del lado de la
  liga. No se arregló la contradicción: se quitó el concepto que la producía.

  Ahora la entrega es **de una sola vía**. `POST /invites/teams/:teamId` responde
  409 en cuanto el equipo tiene a alguien adentro, y lo que era "quitar
  representante" quedó reducido a cancelar un link que **todavía nadie reclamó**
  —una necesidad real, y que no le quita el acceso a nadie porque nadie lo
  tiene—. La pregunta "¿ya se administra solo?" se hace en un solo lugar
  (`orgTieneMiembros()`), porque dos redacciones de la misma pregunta abren
  justo el estado por el que se colaba esto.

  Lo que **queda abierto** y es cambio de modelo de datos: `teams.league_id`
  todavía significa dos cosas —"esta liga lo administra" y "sale en la lista de
  esta liga"—, así que una liga que ya entregó un equipo sigue editando su
  perfil y su roster. Lo que perdió es el padrón, las cuotas y el poder de
  repartir su acceso. El README tiene la sección con lo que falta y con lo que
  hay que decidir antes de escribirlo; el terreno está limpio (**0 equipos en
  más de una liga, 0 contradicciones** entre `league_id` y las inscripciones).

- **Los seis roles por fin hacen cosas distintas (2026-09-20)**: es el paso 3, y
  resultó más ancho que lo planeado. El plan decía "`allowedRoles` en
  `billing.js` y `playerBilling.js`", pero al construir el paso 4 primero salió
  que el agujero no estaba ahí: **`isOrgMember()` tenía `'editor'` en su lista
  por defecto**, así que un visor —que solo debe tocar marcadores— pasaba
  *todas* las guardas de `ownership.js`, los dos libros incluidos. Era inofensivo
  mientras no existiera forma de crear un `editor`, y dejó de serlo el día que la
  invitación empezó a llevar rol.

  El default bajó a `['owner', 'admin']` —el suelo— y las guardas se volvieron
  **fábricas por permiso**: una ruta ya no dice "aquí entran owner y admin", dice
  qué dominio toca (`guardaDeLiga('cobranza_liga')`, `guardaDePartido('marcadores')`,
  `guardaDeEquipo('estructura', 'ver')`) y el catálogo contesta quiénes son esos.
  Un partido pasó a guardarse con **dos** permisos distintos —`marcadores` para
  editarlo, `partidos` para borrarlo—, que es la única forma de que el visor
  exista sin poder desaparecer un resultado que no le gustó.

  **No movió el acceso de nadie**: al 2026-09-20 no había una sola fila con rol
  distinto de `owner` o `admin`, y esos dos tienen todos los permisos salvo
  `duenos`. Lo que cambió es a quién MÁS deja entrar cada ruta.

- **La invitación ya dice a qué invita, y entregar un equipo por fin lo entrega
  (2026-09-20)**: es el paso 4. Antes una invitación no llevaba rol —todo
  invitado entraba como `admin`, que puede absolutamente todo— y reclamar un
  equipo solo llenaba `teams.owner_user_id` sin dar de alta a nadie en la
  organización del equipo, que quedaba existiendo y vacía. Ahora `invites.role`
  viaja con el link, el claim lo escribe, y reclamar un equipo da de alta al
  representante como `owner` de su organización. Con eso se retiró el respaldo
  por `owner_user_id` de `teamClubRequired`, que es hoy la única guarda de
  `ownership.js` sin respaldo — a propósito: ahí un segundo camino no sería una
  red de seguridad, sería una segunda puerta al padrón.

  El rol se valida contra el **tipo** de organización y no contra el `CHECK`,
  que es la validación que el esquema no puede hacer: el `CHECK` acepta la unión
  de los seis porque el tipo vive en otra tabla, así que "un coach en una liga" o
  "un visor en un equipo" solo se pueden rechazar al invitar. Y nombrar a otro
  **dueño** exige el permiso `duenos`: un administrador que pudiera hacerlo se
  ascendería solo, y después podría quitar a quien lo invitó.

  `invites.role` nace NULL y lo ya generado se queda NULL, así que **no hay
  ventana de incompatibilidad al desplegar** ni backfill que correr: una
  invitación vieja entrega lo que entregaba. Esa regla vive en
  `utils/orgRoles.js` y no en la ruta, por lo mismo que el catálogo: un link
  repartido por WhatsApp hace tres días no se puede volver a probar a mano, y
  solo lo puro entra al CI. De paso, **"una invitación vigente a la vez" se
  volvió un error** en cuanto hubo roles —generar el link del tesorero mataba en
  silencio el del coach que se había mandado diez minutos antes— y ahora es una
  vigente **por rol**.

  **Verificado** (los tres cambios de arriba van juntos y se probaron juntos):
  5 pruebas unitarias nuevas (91 → 96); 22 comprobaciones de SQL contra la base
  real dentro de una transacción con `ROLLBACK`; las dos suites de cobranza en
  40/0 y 21/0, idénticas a las del paso 2; y una suite e2e nueva
  —`tests/invites-roles.e2e.mjs`, **59 comprobaciones**— porque ninguna de las
  dos de cobranza toca esto: las dos usan un equipo independiente cuyo dueño es
  el propio actor, así que nunca hay una liga entregando nada.

- **El link del estado de cuenta ya se puede copiar y revocar desde la app
  (2026-09-19)**: el endpoint (`POST /teams/:id/members/:memberId/rotate-token`)
  y el método del cliente (`api.rotateMemberShareToken`) existían desde hacía
  tiempo, pero **ningún componente los llamaba**: un `share_token` filtrado —se
  pegó en el grupo equivocado, la familia lo reenvió— solo se podía revocar
  entrando a la base. Junto con eso, "Copiar link" únicamente aparecía en la
  fila de quien **no** tenía teléfono, porque ahí ocupaba el lugar de
  "Recordar": un club que sí capturó los teléfonos no tenía forma de copiarlo
  nunca.

  Los dos viven ahora en la **ficha** del miembro, no en la fila. La fila no
  era el lugar: `.col-actions` va en `white-space: nowrap`, así que cada botón
  que se le agrega la ensancha —y el scroll horizontal de esa tabla ya es un
  pendiente abierto—. Copiar es ocasional y regenerar es raro y destructivo;
  ninguno de los dos amerita estar permanentemente en pantalla.

  Regenerar pide confirmación con el mismo `ConfirmDialog` que cancelar un
  movimiento, y el aviso dice lo que de verdad importa: **quien tenga el link
  viejo, incluida la familia, pierde el acceso**, así que después hay que
  mandarle el nuevo. No lleva casilla de "entiendo": el `checkboxLabel` de ese
  diálogo **no** es un acuse —es un selector de variante y no bloquea el
  confirmar—, así que usarlo aquí habría sido una casilla que no hace nada.

  **Verificado en el navegador**, con un equipo y un miembro **sintéticos**
  creados en la rama `desarrollo-local` (nombres y teléfono inventados). La
  fila reprodujo primero el problema tal cual: con teléfono capturado salían
  *Recordar · Ficha · + Pago · Movimientos* y **ningún** "Copiar link". Ya en
  la ficha, la sección nueva se ve bien y el diálogo de confirmación aparece
  **en lugar** de la ficha, no encima — que es la razón de cerrar el modal al
  abrirlo.

  La rotación se comprobó de punta a punta y no solo de vista: el
  `share_token` cambió, el link **viejo** pasó a responder **404** y el nuevo
  **200**. Y al mandar el recordatorio después, el mensaje de WhatsApp ya
  llevaba el token nuevo, así que el refresco posterior a rotar sí propaga.

- **El botón "Recordar" ya abre WhatsApp de verdad (2026-09-19)**: en
  `TeamFinancesSection.jsx` había dos `await` antes del `window.open`, y los
  navegadores solo dejan abrir una pestaña si la llamada cuelga **síncronamente**
  del clic. Safari la bloquea siempre y Firefox casi siempre, y la falla que eso
  producía era de las malas: la petición que marca `last_reminded_at` **sí**
  corría, así que la tabla decía "recordado hoy" y el mensaje nunca salía. El
  tesorero se queda tranquilo, la familia nunca se entera, y no hay forma de
  notarlo. Peor que si el botón no hubiera hecho nada.

  El orden estaba al revés **a propósito**, y el comentario lo decía: si se
  marca después, abrir WhatsApp cambia de pestaña —en celular, de app— y la
  petición se puede quedar a medias. El miedo era correcto; lo que no era
  correcto es que hubiera que elegir. Ahora el `window.open` va primero y
  síncrono (se puede, porque `whatsappReminderUrl()` es pura: arma el texto con
  lo que ya está en memoria y no consulta nada), y el registro va después con
  `keepalive`, que existe exactamente para las peticiones que tienen que
  sobrevivir a ese cambio. `request()` de `api/client.js` acepta ahora esa
  opción, y `markMemberReminded()` va aparte de `updateTeamMember()` para no
  cambiarle la firma a los otros dos lugares que la usan.

  **Verificado en el navegador, y vale la pena decir hasta dónde.** Lo que se
  midió es `navigator.userActivation.isActive` en el instante del
  `window.open`, que es la condición que los bloqueadores revisan: con una
  petición lenta (6 s, como la de un tesorero con datos móviles) el patrón
  viejo llega con `false` —la activación por gesto **expiró** durante el
  `await`— y el nuevo llega con `true`. Lo que **no** se pudo reproducir aquí
  es el bloqueo en sí: el único motor instalado es Chromium, que es el
  permisivo de esta historia, y además Playwright lo corre con el bloqueador de
  pop-ups desactivado. O sea, ahí se verificó la **causa** y no el síntoma.

  **El botón real sí se probó** (2026-09-19, más tarde): con un equipo y un
  miembro **sintéticos** —nombres y teléfono inventados— creados en la rama
  `desarrollo-local`, porque para entonces el padrón no tenía datos de nadie.
  El clic abrió WhatsApp en pestaña nueva con el mensaje y el link ya escritos,
  y `last_reminded_at` quedó grabado en la misma corrida: las dos mitades que
  antes se excluían ahora ocurren juntas, que era exactamente el punto.

- **El roster también se fecha en México, no en UTC (2026-09-19)**: la cobranza
  ya había cerrado este desfase; al roster le faltaban tres lugares. Los dos
  `UPDATE` que cierran una membresía en `routes/players.js` (mover a un jugador
  de equipo, y darlo de baja) usaban `CURRENT_DATE`, y la columna
  `player_team_memberships.start_date` tenía `DEFAULT CURRENT_DATE`. Con Neon
  corriendo en UTC, eso significa que **un alta o una baja capturada después de
  las 18:00 hora de México quedaba fechada al día siguiente**. No es dinero,
  pero es la trayectoria del jugador — y el día se cortaba mal igual.

  Los tres pasan a `HOY_MX` (`utils/sqlDates.js`), la misma expresión que ya
  usan los dos libros y el candado diario del cron. El `DEFAULT` se cambia con
  un `ALTER` nuevo al final de `db.js`, sin tocar el `CREATE TABLE` (regla 8), y
  las filas ya escritas se quedan como están: una fecha mal cortada del pasado
  no se distingue de una buena, y aquí se resuelve al leer, no se migra.

  `routes/admin.js` se queda con `CURRENT_DATE` a propósito: es una ventana de
  analítica de 30 días donde seis horas no cambian nada.

  **Verificado contra una rama de Neon** (copia de producción, creada y borrada
  para esto), todo dentro de transacciones con `lock_timeout` que terminan en
  `ROLLBACK`. Hoy la fecha UTC y la de México coinciden, así que una inserción
  normal no distingue una expresión de la otra y no habría probado nada: la
  prueba que sí prueba pone la **sesión de Postgres en UTC+14**, que reproduce
  exactamente la condición del bug — el servidor cree que ya es otro día. Ahí
  `CURRENT_DATE` daba `2026-09-20` y tanto el alta como la baja siguieron dando
  `2026-09-19`. Se comprobó además que ninguna otra fila se movió.

- **No poder escribir en producción desde local dejó de ser un párrafo y pasó a
  ser un candado (2026-09-19)**: la regla 1 de `CLAUDE.md` decía "nunca probar
  contra producción", pero nada lo impedía — la `DATABASE_URL` local apunta a la
  base real, así que cualquier clic en `localhost:5173` escribía filas de
  verdad. Ahora `npm run dev` **se niega a arrancar** en ese caso, con un
  mensaje que dice cómo crear la rama de Neon.

  Tres decisiones que no son obvias:

  1. **Solo actúa con evidencia POSITIVA de arranque local** —
     `npm_lifecycle_event === 'dev'` o `NODE_ENV=development` puesta a mano—,
     nunca por *ausencia* de `NODE_ENV`. Render corre `npm start` y en el
     repositorio no hay `render.yaml` que garantice que define `NODE_ENV`: un
     candado que se disparara "cuando no dice production" tumbaría la API de
     verdad el día que Render cambiara ese default. El costo de equivocarse no
     es simétrico.
  2. **La señal es de npm, no de node.** La lectura obvia era
     `process.execArgv.includes('--watch')`, y está **mal**: el modo watch de
     Node relanza el programa en un proceso hijo, y el hijo ve `execArgv`
     **vacío**. Se probó antes de escribirlo, no se supuso.
  3. **El host de producción no va en el código**, porque el repositorio es
     público: sale de `PROD_DATABASE_HOST`, que vive en el `.env` (que sí está
     en `.gitignore`). Sin esa variable el candado no puede actuar, y entonces
     lo **avisa en voz alta** en cada arranque en vez de callarse.

  La salida de emergencia es `ALLOW_PROD_DB` con la **fecha de hoy**
  (`$env:ALLOW_PROD_DB="2026-09-19"; npm run dev`), no un `1`. Un `1` olvidado
  en el `.env` deja el candado muerto para siempre sin que nadie se entere; una
  fecha deja de servir sola al día siguiente. Mismo criterio que el resto del
  proyecto: que la garantía sea un dato, no la memoria de alguien.

  De paso cierra el otro accidente de la regla 2 —levantar un segundo backend
  en el 4000 contra producción, que tumba las consultas del que sí está
  sirviendo—: el segundo ahora muere antes de correr `initSchema()`.

  **Lo que NO cubre, dicho de frente**: `npm start` en local y los scripts de
  `backend/scripts/` (que usan `pg` directo por la regla 3 y simulan por
  default). Cubre el accidente real, que es `npm run dev`.

  **Verificado** en los ocho escenarios, cada uno en su propio proceso porque el
  pool se memoiza: Render con `npm start` y sin `NODE_ENV` (no bloquea, que es
  el caso que no se podía romper), `npm run dev` contra producción (bloquea),
  con permiso de hoy (pasa), con permiso de ayer (bloquea), contra una rama de
  Neon (pasa) y sin `PROD_DATABASE_HOST` (avisa y pasa). Y de punta a punta: un
  `npm run dev` real se negó a arrancar sin abrir el pool. Los escenarios usan
  un host de producción **inventado**, para que un candado roto no tocara la
  base real ni en la prueba.

  **Y lo cubre el CI**, que es lo que hace que siga siendo cierto dentro de seis
  meses: la *decisión* se extrajo a `utils/prodGuard.js` como función pura —que
  es lo único que este proyecto puede probar sin Postgres— y `db.js` se quedó
  solo con el efecto. Son 13 pruebas nuevas (67 en el backend, 148 en total), y
  la que más importa es la que fija que **Render no se bloquea**: si alguien
  "mejora" el candado para disparar por ausencia de `NODE_ENV`, se pone roja en
  el CI en vez de caerse la API.

- **El cron dejó de ser una caja negra: vive en el repo y se ve en el panel
  (2026-09-19)**: era el pendiente más viejo de esta lista — `POST
  /api/notifications/trigger` lo llamaba un servicio externo cuya frecuencia no
  estaba escrita en ningún archivo, y la única forma de saber si seguía vivo era
  entrar al panel de un proveedor que nadie recordaba cuál era. Se atacó por los
  dos lados.

  **Se ve desde adentro.** La app registra ahora **cada** llamada: una fila por
  día en `cron_runs` con un contador (`calls`, `last_call_at`), no una fila por
  llamada — con el cron cada 15 minutos serían ~35 mil filas al año para
  responder lo mismo. Con eso, `GET /api/admin/cron` y una pestaña nueva **Cron**
  en el panel de administración contestan las dos preguntas: *¿sigue vivo?* y
  *¿cada cuánto corre?*

  La cadencia **no se configura, se mide**: 96 llamadas en un día completo son
  15 minutos entre una y otra. Por eso el umbral de "atrasado" tampoco es un
  número fijo — sale del ritmo observado (`max(2 × cadencia, 90 min)`), con un
  techo duro de 36 h para "sin señal". Así el panel sirve igual si el cron corre
  cada 15 minutos que si corre una vez al día, que era justo el dato que no se
  tenía. La bitácora se poda a 120 días desde el bloque diario.

  **Y deja de depender de un panel ajeno.** `.github/workflows/cron.yml` llama al
  endpoint cada 15 minutos, con `workflow_dispatch` (y un input `force`) para
  dispararlo a mano. Falla ruidosamente si el backend no responde, si el HTTP no
  es 200, o si `partidos_error` no es `null` — así GitHub manda correo en vez de
  que el fallo se quede en un log que nadie abre. La excepción son sus dos
  secretos (`CRON_TARGET_URL` y `CRON_SECRET`, que **faltan por crear**): si no
  están, avisa y se sale sin error. `schedule` se activa solo en cuanto el
  archivo llega a la rama default, así que fallar ahí serían correos de GitHub
  cada 15 minutos hasta configurarlo; que no esté configurado se ve en la
  pestaña Cron, en rojo, que es donde tiene que verse.

  GitHub no garantiza puntualidad en `schedule`, y se aguanta porque ninguna de
  las dos mitades depende de ella (ver "Cadencia del cron").

  El cron viejo se puede dejar corriendo mientras tanto — llamar de más es
  inofensivo por diseño — y apagarlo cuando la pestaña muestre las llamadas del
  nuevo.

  De paso, el endpoint acepta el secreto en **dos formatos**: `x-cron-secret`,
  el de siempre, y `Authorization: Bearer`. Es el mismo secreto; varios
  schedulers mandan solo el segundo (Vercel Cron entre ellos), y aceptar los dos
  es lo que deja cambiar de proveedor sin tocar el backend. Se agregó también la
  guarda de que `CRON_SECRET` exista: sin ella, con la variable sin definir los
  dos lados eran `undefined` y cualquiera podía disparar el cron.

  Verificado contra una rama de Neon (`pruebas-cron-salud`, ya borrada) y en el
  navegador. El contador sube 1→2→3 en llamadas sucesivas; `Authorization:
  Bearer` entra y un secreto malo da 401, igual que sin header. Los cinco
  estados del panel, uno por uno: con cadencia de 15 min, 89 minutos de silencio
  son `ok`, 91 son `atrasado` y 37 h son `sin_señal`; con cadencia diaria, 20 h
  y 35 h siguen siendo `ok` y 37 h no; la bitácora vacía es `sin_señal`. El
  script del workflow corrido tal cual contra el backend local: 200, `?force=1`,
  y salida 1 con anotación `::error::` cuando el secreto es malo. La pestaña
  revisada en el navegador en sus dos estados (🟢 Corriendo y 🟡 Atrasado). Las
  dos suites e2e **21 ok / 0 fallas** y **40 ok / 0 fallas**; 54 unitarias del
  backend y 81 del frontend en verde.

  **Dos defectos que salieron al probar en el navegador y se arreglaron**:
  `HOY_MX` devuelve un `DATE` que `pg` convierte a `Date` de JS, así que
  `String(d).slice(0,10)` daba `"Sat Sep 19"` y nunca casaba con el
  `to_char(…, 'YYYY-MM-DD')` de la otra consulta — el panel decía "0 llamadas
  hoy" con cuatro llamadas registradas, y estimaba la cadencia con el día en
  curso. Y la última columna de la tabla usaba `--ws-ink-dim` sobre el verde de
  la cancha, el mismo problema de contraste que el README ya tiene anotado para
  el pie del estado de cuenta público.

- **El libro liga→equipo llevaba seis horas al día dando cargos por vencidos
  (2026-09-19)**: `utils/sqlDates.js` existe desde que se descubrió que
  `CURRENT_DATE` se evalúa en la zona del servidor y Neon corre en UTC, seis
  horas adelante. Pero esa corrección se aplicó **solo al libro
  equipo→jugadores**: el de liga→equipo se quedó con `CURRENT_DATE` en cuatro
  lugares, así que los dos libros no estaban de acuerdo en qué día era.

  Efecto concreto, medido contra la base: un cargo que vence el 19 se contaba
  como **vencido desde las 18:00 hora de México del día 19**. Seis horas
  diarias, todos los días, en las que el equipo veía "vencido" en su estado de
  cuenta el mismo día que le tocaba pagar — y, si la liga tenía los
  recordatorios encendidos, recibía el aviso 🔴 "Cargo vencido" esa misma tarde.

  Los cuatro lugares: las dos consultas de `utils/billingReminders.js`
  (por vencer y vencido) y los dos KPI de `overdue_charges` de
  `routes/billing.js` — el del panel de cobranza de la liga y el del estado de
  cuenta del equipo. Los cuatro pasaron a `HOY_MX`. **El frontend no se tocó
  porque no calcula nada**: pinta el `overdue_amount` que le manda el backend,
  así que el valor se cambió en el único lado que lo produce.

  Para que no se vuelva a separar, las dos expresiones de fecha
  (`DUE_SOON_WINDOW` y `OVERDUE_WINDOW`) subieron al principio de
  `billingReminders.js` y ahora **las comparten los dos libros**, en vez de
  tener una copia cada uno — que es exactamente cómo se separaron. Es el mismo
  argumento que ya justificaba `sqlDates.js`, aplicado un nivel más arriba.

  Verificado contra una rama de Neon (`pruebas-tz-cobranza`, ya borrada). Las
  dos expresiones evaluadas en instantes fijos delimitan la ventana del bug:
  coinciden a las 17:59 hora de México y discrepan de las 18:00 a las 23:59.
  Con tres cargos sembrados en la frontera (venció ayer / vence hoy / vence
  mañana), el KPI suma **solo el de ayer**, y una corrida real del cron
  clasifica `{dueSoon: 2, overdue: 1}` y escribe los tres avisos correctos en
  la bandeja del equipo. Las dos suites e2e: **21 ok / 0 fallas** y **40 ok / 0
  fallas**. 54 pruebas unitarias en verde.

  **Queda fuera, a propósito**: `routes/players.js` cierra una membresía con
  `end_date = CURRENT_DATE` (dos lugares) y `player_team_memberships.start_date`
  tiene `DEFAULT CURRENT_DATE`. Es el mismo desfase, pero en el roster y no en
  el dinero: una baja registrada a las 7 pm queda fechada mañana. Anotado en
  "Pendientes abiertos".

- **El cron dejó de mezclar dos cadencias incompatibles (2026-09-19)**: `POST
  /api/notifications/trigger` hacía en la misma corrida dos trabajos que piden
  ritmos opuestos. Los avisos de partido leen una ventana de una hora
  (`match_date BETWEEN NOW() - 3h AND NOW() + 1h`), así que con un cron diario
  casi ningún partido cae dentro y el aviso **no se manda nunca**. La cobranza y
  la generación de mensualidades, al revés, con una corrida al día sobran: más
  que eso es barrer los dos libros completos decenas de veces sin nada nuevo que
  encontrar. Como el cron es externo al repositorio y **su frecuencia no se
  conoce** (sigue en "Pendientes abiertos"), una de las dos mitades llevaba
  tiempo mal servida y no había forma de saber cuál.

  Ahora el endpoint sigue siendo uno solo y sigue siendo seguro llamarlo con la
  frecuencia que sea: los avisos de partido corren en **cada** llamada y las tres
  fases de dinero corren **una vez al día**. La garantía es de la base y no del
  código, mismo criterio que `idx_club_ledger_auto_cycle`: la corrida diaria
  reclama el día insertando su fila en la tabla nueva `cron_runs`
  (`UNIQUE (phase, ran_on)` + `ON CONFLICT DO NOTHING`), y quien no gane la
  reclamación se salta esas fases. `ran_on` usa `HOY_MX` y no `CURRENT_DATE`,
  o el día se cortaría a las 18:00 hora local. Una corrida que reclamó y murió
  sin terminar (`finished_at IS NULL`, `started_at` de hace más de 15 min) la
  retoma la siguiente llamada, así que un reinicio a media corrida no bloquea el
  día hasta la medianoche. `?force=1`, detrás del mismo `CRON_SECRET`, vuelve a
  correr las fases diarias a mano.

  **Lo que de verdad estaba roto era otra cosa, y salió al separar**: la fase de
  partidos empezaba con `ensureVapid()`, que **lanza** si faltan las variables
  VAPID, y era la primera línea del handler. O sea que una configuración de push
  incompleta —o cualquier error en los avisos de partido— devolvía 500 y la
  cobranza y la generación de mensualidades **no corrían**, dos cosas que no
  tienen nada que ver con push. Comprobado contra la rama de Neon, no leyendo el
  código: con el código viejo y sin llaves VAPID, `POST /trigger` da **HTTP 500**
  y no factura nada; con el nuevo da 200, reporta `partidos_error` y la cobranza
  corre igual. La fase de partidos vive ahora en su propia función
  (`faseDePartidos()`) con su try/catch, y el error **sube a la respuesta** en
  vez de quedarse en un `console.error`: es el único rastro que este handler deja
  para un servicio de cron que no podemos inspeccionar. Por lo mismo, la
  respuesta ahora incluye los conteos de los dos libros de recordatorios, que
  antes se descartaban (`await runBillingReminders(db)` sin asignar).

  Esto **no** cierra el pendiente de la frecuencia del cron —sigue habiendo que
  entrar a ese panel— pero sí deja de ser la diferencia entre facturar y no
  facturar. La vía perezosa del panel sigue existiendo por la razón de siempre:
  el candado diario acota que el cron corra **de más**, no que se muera del todo.

  Verificado contra una rama de Neon (`pruebas-cron-cadencia`, ya borrada):
  primera llamada corre y la segunda se salta; `?force=1` vuelve a correr; **6
  llamadas en paralelo dejan exactamente una** con `corrio: true`; una corrida
  marcada como muerta hace 20 min se retoma y una de hace 2 min no; secreto
  equivocado sigue dando 401. Las dos suites e2e de cobranza después del cambio:
  **40 ok / 0 fallas** y **21 ok / 0 fallas**. 54 pruebas unitarias del backend
  en verde.

- **Los datos legales quedaron llenos y `/terminos` volvió a existir (2026-09-19)**: los
  cuatro campos de `frontend/src/config/legal.js` llevaban vacíos desde que se centralizaron el
  2026-09-16, y con `LEGAL_DATA_READY` en `false` la ruta `/terminos` no existía y su enlace no
  salía en el pie. Ya están llenos: **José Alfredo Reyes Silva** como persona física, domicilio en
  Cancún, Quintana Roo, `tacticalfootballmx@gmail.com` para derechos ARCO y Cancún, Quintana Roo
  como jurisdicción. **CFBAMX es nombre comercial, no una sociedad**, y no hizo falta constituir
  nada: el texto de las dos páginas ya estaba escrito para ese caso ("X, responsable de CFBAMX…").
  **El RFC no se publica en ningún lado** — `razonSocial` solo pide el nombre *tal como aparece*
  en el RFC, que es cosa distinta. De paso se corrigió un defecto que el campo vacío escondía: en
  `TermsOfService.jsx` la razón social salía pegada al paréntesis ("…Reyes Silva("nosotros")"),
  porque JSX se come el salto de línea entre `{expresión}` y el texto que sigue en vez de dejar un
  espacio; se arregló con un `{' '}` explícito. Verificado en el navegador, no solo leyendo el
  código: `/terminos` y `/privacidad` con los cuatro datos en su lugar y el pie mostrando los dos
  enlaces. 81/81 pruebas del frontend pasan.

- **Guardar un equipo respondía "Error interno del servidor" (2026-09-18)**: el
  formulario de equipo (logo, color, links predeterminados) fallaba con un 500
  en 91 de los 92 equipos, pero **el cambio sí se guardaba**. Los dos síntomas
  son la misma causa: `PUT /manage/teams/:id` escribe en dos pasos y no es
  atómico. Primero actualiza `teams` (por eso el logo quedaba guardado) y
  después toca `organizations`, donde viven país y descripción del equipo. El
  `<select>` de país manda `''` cuando no hay ninguno elegido, `toNull` solo
  traducía `undefined`, y `COALESCE('', country_id)` contra una columna
  `INTEGER` truena con `22P02 invalid input syntax for type integer: ""`. El
  equipo quedaba guardado y la persona veía un error.

  Con los links se veía peor que con el logo: lo último que corre en esa ruta
  es `syncTeamLinksToMatches()`, que copia los links predeterminados a los
  partidos sin jugar. Como el 500 pasaba antes, los links se guardaban en el
  equipo pero **nunca llegaban a los partidos** — el efecto visible de
  ponerlos.

  Se arregla en los dos lados, como pide la regla 6: un `toId()` junto a
  `toNull()` en `manage.js` y `leagues.js` (vacío = "no lo toques", igual que
  `undefined`), y los formularios mandan `country_id || null`, que ya era la
  convención de `RegisterLeague` y `RegisterOrganizationPage`. `TeamForm`
  además deja de mandar país y descripción cuando **no** es un equipo
  independiente: no los muestra, y mandarlos con el valor de arranque pisaba la
  descripción de la organización con `''`. `PUT /leagues/:id` tenía el mismo
  bug latente (hoy las 11 ligas tienen país, así que nadie lo había pegado) y
  de paso dejaba de guardar los estados de México cuando el país llegaba vacío.

  Verificado: las dos consultas contra producción dentro de una transacción con
  `ROLLBACK` (la vieja truena con 22P02, la nueva pasa) y el endpoint completo
  contra una rama de Neon — el payload del frontend viejo y el del nuevo
  responden 200, la descripción de la organización ya no se pisa y los links sí
  llegan a los partidos. Las 135 pruebas unitarias siguen pasando. **No** se
  revisó en el navegador: el cambio de UI es solo qué campos viaja el formulario.

  Queda abierto que la ruta no sea atómica: cualquier error después del primer
  `UPDATE` sigue dejando el equipo guardado y a la persona viendo un 500.

- **QA visual del cobro automático, la que faltaba (2026-09-18)**: se recorrió
  el panel en el navegador contra una rama de Neon, que era el último pendiente
  de la verificación. Lo que **sí** quedó bien: el bloque pasa de "Cobro
  automático apagado" a "activo" con su resumen correcto (`3 jugadores entran en
  el cobro` — excluyendo a la becada), el selector de fecha solo ofrece del 1 al
  28 igual que la restricción del backend, al activarlo se generaron los tres
  cargos al instante con su vencimiento, **a la becada no se le generó nada**, la
  pestaña ya dice "Padrón", y el estado de cuenta del papá muestra "Mensualidad
  de septiembre 2026 · SEP-2026" sin filtrar el teléfono del tutor. Los únicos
  errores de consola eran de Google Sign-In rechazando `localhost` como origen,
  que es artefacto de desarrollo local.

  Salieron **tres defectos que ninguna prueba automática podía ver**, porque las
  tres son texto o color:

  1. **La franja prometía cargos cinco días tarde.** Decía "próxima generación 18
     de octubre", pero ese valor es la **fecha de pago**: el cargo nace cinco
     días antes, el 13. La función que lo calculaba se llamaba
     `proximaGeneracion` y su propio comentario ya decía "la próxima fecha de
     pago" — el nombre y la etiqueta se habían separado del valor. Ahora dice
     "próximo pago" y la función se llama `proximaFechaDePago`.
  2. **El estado vacío seguía describiendo el botón que se eliminó.** Mandaba a
     un botón llamado "Generar cuotas" (no existe con ese nombre) y prometía que
     "a partir del mes que entra las vuelves a crear con un clic" — que es
     exactamente "Repetir el mes pasado", retirado ese mismo día. Ahora manda a
     prender el cobro automático y aclara que `Generar cargo` es para lo
     esporádico.
  3. **El pie del estado de cuenta no se ve** (1.16:1 de contraste). Queda
     abierto en el README: la solución es de diseño, no de copia.

- **La conexión a Postgres pedía no validar el certificado, y `pg` la estaba
  ignorando (2026-09-18)**: los once lugares que abren un pool —`config/db.js`,
  los ocho scripts de `scripts/` y las dos suites e2e— pasaban
  `ssl: { rejectUnauthorized: false }`. Ese parámetro **no tenía efecto**: `pg`
  hace `Object.assign({}, config, parse(connectionString))`, y como
  `DATABASE_URL` traía `?sslmode=require`, lo parseado devolvía `ssl = {}` y
  borraba el objeto de arriba. El resultado es que el código pedía *no* validar
  el certificado y `pg` validaba de todos modos, que es lo correcto pero por
  accidente. Se comprobó conectando a producción con `ssl: false`, que si el
  config explícito mandara significaría "sin TLS" y Neon rechazaría: conectó.

  Importaba arreglarlo por lo que venía después. `pg` 8.22 avisa en cada
  arranque que en la v9 los modos `require`, `prefer` y `verify-ca` adoptarán
  la semántica de libpq, donde `require` significa "cifra pero no valides". O
  sea: el día de un `npm update` la validación del certificado se habría
  apagado **sola**, sin que cambiara una línea del repo y sin ningún error. La
  cadena ahora dice `sslmode=verify-full` (hoy idéntico en comportamiento, pero
  explícito) y el objeto quedó en `rejectUnauthorized: true` en vez de borrarse:
  cuando la URL no trae `sslmode`, la clave `ssl` no aparece en lo parseado y
  entonces el objeto **sí** manda — borrarlo habría dejado ese caso conectando
  sin TLS. La variable `DATABASE_URL` de Render se cambió a mano el mismo día,
  así que el repo y el servicio quedaron consistentes.

  **Verificación**: el reporte de mensualidades corrió contra producción con la
  cadena nueva y el aviso de SSL desapareció; `npm test` dio 54/54; y las dos
  suites e2e corrieron contra una rama de Neon (`ssl-verify-full-test`) con
  **61 aserciones y 0 fallas**. La rama se borró al terminar.

- **La sección 10 del e2e de cuotas probaba al jugador equivocado (2026-09-18)**:
  la sección nueva de mensualidad automática afirmaba sobre Juan, que en la
  sección 3 ya había recibido una mensualidad **manual** con fecha escrita a
  mano (`2026-09-30`). Cuando el día de cobro calculado caía en ese mismo mes
  —o sea, casi todo septiembre— se disparaba la guarda blanda de
  `utils/monthlyCharges.js` ("el ciclo no cobra un mes que un humano ya cobró a
  mano"), no se generaba nada y las dos aserciones fallaban. **El motor estaba
  bien**: en la misma corrida, Guero sí recibió su cargo automático, y la única
  diferencia entre los dos es que su cargo manual estaba en `void`.

  Es decir, la suite era frágil por fecha: corriéndola el 29 de septiembre
  habría pasado sola. Ahora la sección crea sus propios miembros y calcula las
  fechas en vez de escribirlas, y se ganaron dos aserciones que no existían: que
  a quien ya le cobraron ese mes a mano **no** se le duplica, y que un cargo
  manual **cancelado** sí deja pasar al automático. De paso se arregló una
  aserción que no probaba nada —comparaba `0 === 0` sobre Juan, así que pasaba
  aunque la generación estuviera rota—. La suite pasó de 38 aserciones con 2
  fallas a **40 con 0**.

- **La mensualidad del club se cobra sola (2026-09-18)**: se retiró el botón
  "Repetir el mes pasado" (`POST /teams/:id/charges/repeat`,
  `RepeatPlayerChargeModal.jsx`) y en su lugar el club configura **una sola
  fecha** —el día en que se paga— y el cargo nace solo, cinco días antes, para
  cada miembro `activo` con cuota definida.

  No se quitó por sus bugs, aunque los tenía: **le volvía a cobrar a quien ya
  estaba dado de baja** (solo comprobaba que la fila siguiera existiendo en
  `club_members`, y una baja es justamente una fila que sigue existiendo) y
  repetía también los cargos que se habían cancelado en el lote original. Se
  quitó porque el modelo estaba mal de origen: si una cuota ya está configurada
  como mensual, que alguien tenga que acordarse de apretar un botón el día
  correcto de cada mes no es una función, es una tarea pendiente que la
  plataforma le deja al tesorero. El cargo esporádico —uniforme, viaje,
  arbitraje— se queda en **"Generar cargo"**, que ya no ofrece la categoría
  `mensualidad`.

  **La idempotencia es de la base, no del código**, porque la generación se
  dispara desde dos lados: el cron y la carga del panel. Lo segundo no es
  redundancia — el cron es **externo al repositorio** (no está en
  `.github/workflows/`, no hay `render.yaml`, no hay `node-cron`) y su
  frecuencia no está documentada en ningún archivo, así que si se cae el club
  dejaría de facturar en silencio. La garantía la da
  `idx_club_ledger_auto_cycle` sobre la columna nueva
  `club_ledger_entries.auto_cycle_key`, con `ON CONFLICT DO NOTHING`. Dos
  detalles del índice que no son detalle: su predicado es **inmutable** (no
  filtra por `status`), así que cancelar una mensualidad automática impide que
  se regenere; y la columna nace NULL en toda la tabla, así que el índice se
  crea sobre cero filas y **no puede fallar** por duplicados históricos — que
  importa porque `run()` de `initSchema()` se traga el error de una migración
  que falle. Por si acaso, el generador **se niega a insertar** si el índice no
  está, y `scripts/report-mensualidades-duplicadas.mjs` lo reporta.

  Detalle en el README, "Cuotas del club" → "La mensualidad se genera sola".

- **Cuatro correcciones del panel del club (2026-09-18)**, las tres primeras en
  producción:

  1. **El interruptor de recordatorios estaba muerto.** El frontend leía y
     escribía `member_billing_reminders_enabled` y el backend
     `player_billing_reminders_enabled`, así que la casilla siempre salía
     desmarcada y **cualquier clic la guardaba en `false`**
     (`Boolean(undefined)`): un club que los tuviera prendidos los perdía y no
     podía volver a prenderlos. Lo introdujo el renombre de la fase B (`dcf6ac7`)
     sobre una clave que el propio README marcaba como intocable — es la regla 6
     de CLAUDE.md rota: se cambió en un lado y en los otros dos no.
  2. **La situación se ignoraba al dar de alta.** `POST /teams/:id/members` no
     desestructuraba ni insertaba `status`, así que quien registrabas como
     **Becado** nacía **Activo** y al mes siguiente entraba en el cobro. Con la
     generación automática habría dejado de necesitar que alguien apretara un
     botón para cobrarle de más. La suite e2e creaba un becado y **nunca lo
     verificaba**; ahora sí.
  3. **La nota interna viajaba en el estado de cuenta público.**
     `GET /statement/:shareToken` devolvía `note` por movimiento. No se pintaba,
     pero estaba en el JSON y se leía con la pestaña de red — y el campo que la
     captura promete "solo la ves tú, no aparece en el estado de cuenta del papá".
  4. **`PATCH /teams/:id/settings` pisaba lo que no le mandabas.** Hacía
     `Boolean(req.body?.player_billing_reminders_enabled)` sin preguntar si la
     clave venía, así que en cuanto el panel mandó el interruptor del ciclo
     habría apagado los recordatorios en silencio. Ahora es parcial, como el
     `PATCH` de un miembro.

- **La fecha de hoy se calcula en México, no en UTC (2026-09-18)**: `CURRENT_DATE`
  se evalúa en la zona del servidor de Postgres y Neon corre en UTC, seis horas
  adelante. Consecuencia real: **un cargo que vencía hoy se marcaba vencido desde
  las 18:00 hora de México del mismo día**, y el papá que pagaba a las 7 pm veía
  "vencido" en su estado de cuenta. Se sacó a `utils/sqlDates.js` (`HOY_MX`), que
  pone la zona **en la expresión** y no en la sesión: con un pooler en modo
  transacción un `SET TIME ZONE` no es confiable, por el mismo motivo por el que
  `pg_advisory_lock()` se tuvo que cambiar por su versión de transacción. Se
  aplicó en `routes/playerBilling.js` y en `runPlayerBillingReminders`; el libro
  de la liga sigue con `CURRENT_DATE` (ver "Pendientes abiertos").

- **Un lote de cargos es atómico (2026-09-18)**: `POST /teams/:id/charges`
  insertaba fila por fila en un `for...await`. Si tronaba en el jugador 20 de 40
  quedaba **medio lote creado**, ya visible en los saldos de veinte familias, y no
  hay acción de "cancelar el lote": había que cancelar cargo por cargo, cada uno
  con su ajuste. Ahora es un solo `INSERT` multi-fila, que es una sola sentencia y
  por lo tanto atómica pase lo que pase con el pooler.

- **La pestaña "Jugadores" se llama "Padrón" (2026-09-18)**: el padrón del club no
  son solo jugadores — hay becados, gente que entrena sin estar en ninguna liga y,
  más adelante, staff. Es además la palabra que ya usaban el README, los
  comentarios del código y la propia pantalla. **La ruta sigue siendo
  `/panel/equipo/:id/jugadores`**: cambiarla rompería links guardados y abriría
  una ventana de incompatibilidad al desplegar, que es caro por una etiqueta.

  De paso, `recent_batches` dejó de contar los cargos **cancelados** (sumaba
  montos que ya no existían) y ahora distingue el lote del ciclo del capturado a
  mano (`is_auto`).
- **Las tarjetas que se abren sobre la cancha van en negro (2026-09-17)**: la
  tarjeta del partido en MatchPage y las fichas de equipo y de sede
  (`.team-profile-modal`, en modal o embebidas) pasaron del verde `--card` a un
  negro propio (`--card-open`). El verde sobre el fondo de cancha casi no se
  despegaba y el amarillo de los botones perdía fuerza; al abrir un partido, sus
  cuatro tarjetas —partido, local, visitante y sede— ahora se leen como una sola
  pantalla. **No cambian** las portadas sin imagen ni los logos sin imagen: ahí
  el degradado verde es el contenido, no el fondo. Tampoco cambian las tarjetas
  del calendario ni el grid de equipos/sedes, donde la tarjeta es un renglón de
  una lista y no la pantalla.

  La vista previa del editor (`.team-editor-preview`, en el formulario de equipo
  y de sede y en "Así se ve el perfil de tu equipo") va del mismo negro **a
  propósito**: promete "así se ve tu ficha", así que tiene que verse igual. Por
  lo mismo sus campos editables dejaron de ser verdes — públicamente ese valor
  es texto sobre negro, y lo que marca qué se puede escribir es el borde. Se
  salvan el selector de color del club (`type="color"`), donde el fondo es el
  dato, y todos los formularios fuera del preview, que siguen en verde.

  Dos detalles de cascada: la tarjeta de MatchPage heredaba el `:hover` verde de
  las del calendario aunque ahí es un `<div>` y no un `<Link>`, y el borde rojo
  de "en vivo" pesaba menos que el selector nuevo y se lo comía; los dos quedaron
  fijados explícitamente. El campo del hex del color del club, de paso, dejó de
  salir blanco del navegador: era el único campo del editor fuera de un
  `.field`, así que nunca heredó los estilos del formulario.

  **Verificación**: es un cambio de solo CSS, así que se probó con el
  `styles.css` real en el navegador sobre el marcado de MatchPage y del editor,
  **sin levantar el backend** para no tocar la base de producción. Comprobado por
  estilos calculados: las cuatro tarjetas en `rgb(16,18,17)`, el hover de la de
  MatchPage sin cambio de color, el borde rojo de "en vivo" intacto, la tarjeta
  del calendario todavía en verde `rgb(52,126,58)` y un `.field` fuera del
  preview también. 81 unitarias de frontend en verde. Falta verla contra datos
  reales al desplegar.

- **Fase B de la separación del padrón: un solo campo de nombre, y el padrón
  deja de llamarse "players" (2026-09-17)**: cierra lo que la fase A dejó a
  medias a propósito. El nombre de un miembro del club es ahora **un solo
  campo** (`display_name`) de punta a punta — el formulario pide "Nombre" y ya
  no exige apellido, así que un club puede registrar a "El Güero", o a "Chispa"
  a secas, que es lo que `players.last_name NOT NULL` hacía imposible. Se fue
  del backend la capa de compatibilidad (`nameCompatSql`, `splitDisplayName`,
  `memberAsPlayer`, y el `split_part` que partía el nombre por el primer
  espacio), y la superficie de la API pasó de `player`/`player_id` a
  `member`/`member_id`: `/teams/:id/players/:playerId/entries` →
  `/members/:memberId/entries`, `/accounts/:playerId` → `/members/:memberId`
  (editar y dar de baja quedaron en la misma URL, separadas por el método), y
  las claves `players`, `player_count`, `{ player, account }` y
  `{ player: {...} }` del estado de cuenta público. El detalle completo, con la
  tabla antes/ahora, está en "Cuotas del club → Fase B" del
  [README](../README.md).

  **Salieron dos bugs de la fase A que las suites no cubrían, los dos vivos en
  producción.** (1) El libro de un miembro hacía `SELECT ... FROM players` con
  un id de `club_members`: son padrones distintos y sus ids no se corresponden,
  así que el modal de movimientos salía con el nombre de **otra persona** o
  vacío. (2) **Repetir un lote de cargos estaba roto al 100%**: el código leía
  `r.player_id` de `club_ledger_entries`, cuya columna es `member_id`, así que
  el endpoint respondía *400 "Ningún jugador válido para repetir el cargo"*
  siempre, con lote válido y jugadores en plantel. El renombre arregló el
  segundo solo; el primero se corrigió apuntando la consulta a `club_members`.

  **Verificación**, en una rama de Neon (`fase-b-test`), nunca contra
  producción: las dos suites e2e antes y después — **46 y 0 de partida, 47 y 0
  al final** (la de más comprueba que un nombre de una sola palabra se guarda
  tal cual); 81 unitarias de frontend y 54 de backend; un **smoke test de
  contrato** de 18 comprobaciones que verifica que cada clave que lee el
  frontend existe en la respuesta — hizo falta porque el build de Vite compila
  igual un `data.players` que ya no existe, y cazó tres roturas del propio
  refactor; y **QA visual en el navegador** contra la rama: Resumen, Finanzas,
  Jugadores, el modal de movimientos, la ficha, el estado de cuenta público del
  papá, el alta de "Chispa" y repetir un lote. La rama se borró al terminar.

  **Ojo al desplegar**: es un cambio de contrato sin solapamiento, y el frontend
  (Vercel) y el backend (Render) no terminan de desplegarse al mismo tiempo, así
  que hay una ventana en la que un lado pide una ruta que el otro ya no sirve —
  y las pestañas ya abiertas siguen con el bundle viejo hasta recargar. Solo
  afecta a la cobranza del club, son 404 y no escrituras malas, y se arregla
  recargando. Las salidas están en "Fase B" del README.

  **Quedó fuera a propósito**: el prefijo `/api/player-billing` y el archivo
  `routes/playerBilling.js` (mueve los 18 endpoints del router de golpe en vez
  de los 5 de esta fase — misma clase de cambio, más grande),
  y `created_by_side = 'player'` más los tipos de notificación `player_*`, que
  son valores guardados y piden migración — vale la regla 6 de `CLAUDE.md`: los
  tres lados o ninguno, y se eligió ninguno. Está anotado en "Pendientes
  abiertos".
- **`CLAUDE.md`, el changelog aparte, y las funciones que nadie había
  documentado (2026-09-17)**: el README pasó de 1,629 líneas a un índice por
  dominio. Lo cronológico se movió a este archivo y las reglas de trabajo a
  [`CLAUDE.md`](../CLAUDE.md), que antes había que deducir leyendo todo. De paso
  se documentaron **siete módulos vivos en producción que no aparecían en el
  README** —941 líneas de backend—: predicciones y quinielas (la función con más
  uso real de la app, 36 participantes), transmisiones por medios, tiendas con
  bot de WhatsApp, "Mi cartelera" y el tracking de patrocinadores. Ninguno tenía
  sección propia; cuatro de ellos (`bot.js`, `broadcasts.js`, `pools.js`,
  `predictions.js`) no se mencionaban **ni una sola vez**.
- **Faltaba la tabla `bot_messages` (2026-09-17)**: `routes/bot.js` la lee y
  escribe en tres lugares y **nunca se creó en `db.js`** — no estaba en ninguna
  migración. No había reventado porque el bot todavía no está conectado (faltan
  el número de WhatsApp y la llave de Anthropic), así que ese código nunca se
  había ejecutado. El día que se conectara, el `SELECT` habría tronado con
  *relation "bot_messages" does not exist*; como el webhook no alcanza a
  responder 200, Meta habría reintentado el mismo mensaje en ciclo y el cliente
  nunca habría recibido respuesta — con 500 repetidos en Sentry sin relación
  obvia con la causa. Se agregó siguiendo el patrón de `notifications`, con
  `CHECK (role IN ('user','assistant'))` (los dos valores que acepta la API de
  Claude) y el índice `(organization_id, wa_from, created_at DESC)`, que es
  exactamente la consulta de los últimos 10 turnos. **Sin verificar contra un
  Postgres real**: no hay uno local y no se corrió contra producción. Ojo con
  esto al arrancar — `run()` en `db.js` se traga los errores de migración en
  silencio, así que si el SQL tuviera algo mal la tabla simplemente no existiría
  y nada lo diría en los logs.

- **El candado de migración se filtraba con el pooler de Neon (2026-09-16)**: `initSchema()` usaba `pg_advisory_lock()`, que vive en la **sesión**, y la app se conecta al endpoint **pooler** (PgBouncer en modo transacción), donde una "sesión" no es una conexión propia. Se encontró en la base una conexión **ociosa y atendiendo consultas normales con el candado puesto**: la siguiente migración se habría quedado esperando para siempre, colgando el arranque del servidor sin ningún error que lo explicara. Ahora es `pg_advisory_xact_lock()`, que se suelta solo al cerrar la transacción pase lo que pase, con un `SAVEPOINT` por migración para no perder la tolerancia a fallos de antes. Verificado contra la base: dos corridas seguidas, cero candados colgados, y el arranque sigue tardando lo mismo (9s). Ver "El candado de migración" en la sección de posiciones.

- **Tabla de posiciones y modelo de competencia (2026-09-16)**: la app ya sabía qué partidos se juegan, pero no **cómo se compite** — no había forma de decir que una liga corona campeón por conferencia y otra tiene un solo campeón general. Se agregaron tres piezas: **`phases`** (qué se está jugando, que es lo que permite que la tabla cuente la temporada regular y deje fuera playoffs y amistosos), **`titles`** (a qué nivel se corona campeón) y la configuración de la tabla por rama (niveles publicados + reglamento de desempates). Con `scope` + `decided_by` caben sin casos especiales la NFL (campeón de división, de conferencia y Super Bowl), ONEFA (dos campeones de conferencia y **ningún** campeón general — esa ausencia es justo cómo se representa que no hay juegos interconferencia) y LFA (un solo campeón). La jerarquía quedó alineada con el modelo estándar de la industria (Sportradar/SportMonks/IPTC SportsML), que ya era casi la que había. Ver la sección **"Tabla de posiciones y modelo de competencia"**.
  La fase y el campeón se resuelven **al leer**, no se migra nada: un partido sin `phase_id` deduce su fase de `week_label` como siempre, y el campeón sale de la tabla o del partido decisivo (`title_overrides` guarda solo la excepción). Los desempates son **configurables por rama** porque no existe un orden universal — **ni siquiera dentro de un mismo deporte**: ONEFA ordena por juegos ganados y la NFL por porcentaje, ambas de americano. Cada criterio es un par (métrica, universo), y lo que separa a un reglamento de otro es en qué posición va el "entre sí" y qué se hace cuando empatan tres o más. Por lo mismo, ni los sistemas de competencia ni los preconfigurados de desempate se nombran por un deporte: un sistema de competencia (todos contra todos, eliminación directa, sistema suizo) no le pertenece a ninguno.
  **Verificado contra la base real** con LFA 2025 y leyendo ONEFA 2026 (ver "Verificado contra la base real" en esa sección). De ahí salieron dos bugs que las pruebas unitarias no podían encontrar: el estado de un partido terminado es `'finished'`, no `'final'` —la tabla habría salido toda en ceros— y crear una fase no servía de nada si había que reasignarle los partidos a mano. También se unificó `utils/scoring.js`: los puntos de la quiniela ahora salen de la fase resuelta y no de la etiqueta de jornada, con el ranking del concurso en curso comprobado renglón por renglón (36 participantes, 433 puntos, cero diferencias).

- **La conferencia se dice una vez por equipo, no una vez por partido (2026-09-16)**: hasta ahora, al capturar cada juego había que elegirle rama, conferencia y grupo en el formulario. Eso era dato **derivado capturado como dato primario**: el hecho estable es "este equipo juega en esta conferencia", y a qué conferencia pertenece un partido es consecuencia de qué equipos lo juegan. En ONEFA eran ~130 selecciones de dropdown que no tenían por qué existir. Ahora la conferencia/grupo se registra en **`branch_teams`** (la tabla que ya decía qué equipos están inscritos en cada rama) y el partido la hereda. Queda separado por temporada **sin trabajo extra**: una rama cuelga de categoría → torneo, y el torneo tiene año, así que mover un equipo de conferencia el año que entra no reescribe a qué conferencia perteneció el pasado.
  La resolución vive en **un solo lugar**, `backend/src/utils/matchScope.js`, que exporta el fragmento de SQL que usan las tres consultas públicas más el árbol del panel. El orden es: override explícito del partido → la conferencia de los equipos → la del grupo asignado a mano → `matches.conference_id`. Ese último es lo que se capturó a mano antes de este cambio: **se conserva íntegro en la base** y pasa a ser el respaldo para el partido que no tenga de dónde derivar. Como la derivación resuelve **al leer** y no reescribe filas, un partido mal capturado se corrige solo.
  Tres decisiones que no son obvias y que conviene no revertir sin pensarlas. (1) **Se deriva solo cuando los DOS equipos tienen conferencia.** Con uno bastaría para que un amistoso contra un invitado de fuera (que no está en ninguna conferencia) se colara al calendario de la conferencia del rival como si fuera juego oficial — es exactamente el caso del scrimmage contra Whittier College, y por eso ese partido aparece sin conferencia, a propósito. (2) **Un partido entre conferencias distintas pertenece a las dos** (`conference_id` + `conference_id_2`) y sale al filtrar por cualquiera, mismo patrón que ya tenían los grupos con `group_id_2`; nadie lo marca a mano, se detecta solo. (3) El override por partido es **columna nueva** (`matches.conference_override_id`), no la vieja reutilizada, justo para no pisar el respaldo.
  En el panel, los equipos de cada rama ahora salen **agrupados bajo su conferencia**, con los que no tienen ninguna hasta abajo y visibles — son justo los que hay que asignar. El formulario de partido dejó de pedir la conferencia: la enseña ya heredada ("14 GRANDES — heredada de los equipos"), marca el cruce cuando lo hay, y si a algún equipo le falta el dato **lo nombra** en vez de adivinarle una conferencia. Cambiarla se hace en la rama, una vez, y todos sus partidos se reacomodan solos. En una rama sin conferencias (LFA, que juega todos contra todos) no aparece nada de esto.
  De paso se cerró una brecha real: **el importador de Excel no guardaba `home_team_id`/`away_team_id`**, solo el nombre en texto, así que todo calendario cargado por Excel —el camino por el que entran los calendarios grandes— habría quedado fuera de la derivación. Ahora sí las guarda.
  **La página del partido nunca había mostrado la conferencia**, ni antes ni después del cambio de modelo: no era que no llegara el dato, es que esa fila (`match-card-meta`) solo pintaba jornada, sede y temporada. Ya la muestra. La etiqueta la arma `matchScopeLabel()` en `frontend/src/utils/matchScope.js`, y la usan **las tres pantallas** —panel, calendario y página de partido—; antes el panel tenía su propia copia, y con dos copias tarde o temprano una dice "NACIONAL — NORTE" y la otra "NORTE" para el mismo partido.
  Para arrancar con lo que ya existe está **`backend/scripts/backfill-team-conferences.mjs`**: lee la conferencia que cada equipo ya tiene repetida en sus partidos, decide por mayoría (un partido suelto mal capturado no arrastra al equipo entero), reporta los empates en vez de inventarlos, y escribe **únicamente** en `branch_teams` — nunca en `matches`, `predictions` ni `pools`. Simula por defecto; escribe solo con `--apply`.
  **Estado real de los datos**: ONEFA ya quedó asignada a mano desde el panel, y de paso se aprovechó para partir `NACIONAL` en tres grupos (`BAJÍO`, `CENTRO`, `NORTE`) — 32 equipos con conferencia, 18 de ellos también con grupo, y **132 de 133 partidos derivan su conferencia de los equipos** (el 133 es el scrimmage). Los 9 inscritos sin conferencia son los 8 de LFA, que no usa conferencias, más el invitado. Verificado antes de aplicar nada: la migración, el relleno y las tres consultas públicas se corrieron contra los datos reales dentro de una transacción con `ROLLBACK`, con `lock_timeout`, para comprobar que el partido J3 marcado `NACIONAL` con los dos equipos de `14 GRANDES` se corregía solo, que los dos sin conferencia se llenaban, que LFA no se movía y que ni una fila de `matches` ni de `predictions` se tocaba.
- **Primeras pruebas automáticas que corren solas, y el CI ya las corre (2026-09-16)**: 93 pruebas unitarias con el runner que ya trae Node (`node --test`) — **sin Jest, Vitest ni ninguna dependencia nueva**. 30 en `backend/tests/unit/` y 63 en `frontend/tests/unit/`, con `npm test` en ambos lados y un paso nuevo en cada job del CI. Cubren lo que **se puede** probar sin base de datos ni navegador: la conversión de zonas horarias, los validadores de las dos puntas, el formato de dinero de cobranza, el cálculo del estado de un partido y el texto al compartir. Esto era la Fase 3 del roadmap de negocio, que estaba prácticamente en cero: las dos suites de punta a punta de cobranza son valiosas pero se corren **a mano** contra una rama de Neon, así que hasta hoy ningún cambio se verificaba solo. La elección de qué probar no fue al azar — se priorizó `utils/timezones.js` porque un error de zona horaria **no truena**: no hay excepción ni nada en Sentry, solo un partido anunciado a la hora equivocada. Tres cosas que las pruebas fijan y que no estaban escritas en ningún lado: que Tijuana **sí** tiene horario de verano mientras el resto de México **no** (coinciden en julio y no en diciembre), que `zonedTimeToUtcISO` resuelve hacia adelante una hora que no existe por el salto de horario, y que un marcador de **0-0** sí se anuncia al compartir (`0` es falsy y una revisión ingenua lo desaparecería). Hay una prueba que cruza las dos puntas a propósito: `frontend/tests/unit/matchDisplay.test.mjs` importa la lista de zonas del backend y verifica que toda zona que el backend acepta tenga etiqueta en el frontend — hoy están sincronizadas, y sin esa prueba separarlas no rompe nada, solo hace que el calendario muestre "America/Bogota" en crudo. `npm test` **no** corre las suites de cobranza: el patrón es `tests/unit/*.test.mjs`, así que nunca va a intentar hablarle a una base de datos por accidente.
- **Los datos legales viven en un solo archivo, y los Términos se ocultaron mientras tanto (2026-09-16)**: los placeholders (`[Razón social...]`, `[domicilio...]`, `[correo...]`, `[ciudad/estado]`) estaban escritos a mano dentro de `TermsOfService.jsx` y `PrivacyPolicy.jsx`, **visibles en producción** a cualquiera que abriera `/terminos`. Ahora los cuatro datos viven en `frontend/src/config/legal.js` y las páginas los leen de ahí. Mientras estén vacíos, `LEGAL_DATA_READY` es `false` y **los Términos de Servicio no se publican**: la ruta `/terminos` no existe (cae en "Página no encontrada") y el enlace desaparece del pie de página — unos Términos sin saber quién los emite ni ante qué tribunales se reclaman no obligan a nada. El **Aviso de Privacidad sí se queda publicado**, y es a propósito: el inicio de sesión con Google exige que ese link funcione, y un 404 ahí pone en riesgo el login de toda la app. Lo que hace mientras tanto es **omitir** las frases que dependen de los datos faltantes en vez de enseñar corchetes ("El responsable de CFBAMX… trata tus datos", sin `mailto:` vacío). Para publicar todo: llenar los cuatro campos de `legal.js` y ya — nada de rutas, pie de página ni variables de entorno en Vercel. Verificado en el navegador en los dos estados, vacío y lleno.

- **Pasada de limpieza de deuda técnica (2026-09-15)**: cuatro cosas chicas que estaban anotadas como pendientes y no dependían de nada externo. (1) **Pool de Postgres con valores explícitos** y, lo importante, el manejador `pool.on('error')` que faltaba — sin él un error en una conexión **ociosa** (exactamente lo que pasa cuando Neon se duerme y corta del otro lado) se emitía sin escucha y **tiraba el proceso entero de Node**; ver "Pendientes conocidos" en el README. (2) **Código muerto de vuelos borrado** de `matchServices.js` (`buildFlightSearchUrl`, `ORIGIN_CITY_OPTIONS`): nada los importaba desde que el widget embebido reemplazó el approach de link directo. (3) **Reindentado** del contenido dentro del `.dashboard-panel` de `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx` — cosmético del fuente, el render no cambió; **la QA visual de esas dos pantallas seguía pendiente** (se hizo el 2026-09-17 para `LeagueStructurePanel`; `TournamentMatchesPanel` sigue sin verificarse — ver "Pendientes abiertos" en el README). (4) **`backend/scripts/diagnose-failed-leagues.mjs`**, para el pendiente de las ligas que no se pudieron registrar: escrito, **sin correr todavía**. Se corrigieron además dos cosas del propio README que ya no eran ciertas: el bullet que decía que "Registrar Organización" solo ofrecía Liga (los cuatro tipos se registran desde hace tiempo, `routes/organizations.js`) y el que decía que el código muerto de vuelos se había dejado a propósito.
- **Badge "✓ Verificado" en la ficha pública del equipo**: antes solo se veía en el panel del propio equipo. Lo que faltaba era del lado del backend — `is_verified` vive en `organizations`, no en `teams`, y **ninguno** de los cuatro endpoints públicos que alimentan `TeamCard`/`TeamInfoPanel` lo traía: `/leagues/all-teams` (Home), `/leagues/:slug/teams` (página de liga), `/leagues/tournaments/:id/public` (torneo) y los `home_team_details`/`away_team_details` de `/leagues/matches/:id` (página de partido). A los cuatro se les agregó el `LEFT JOIN organizations` con el mismo patrón que ya usaban `manage.js` y `auth.js`. En el frontend: palomita sola en la tarjeta (es chica y va en cuadrícula, con el texto en `title`/`aria-label`) y la pastilla completa `.pill is-ok` en la ficha, la misma que ya usaba `TeamWorkspace`. Si el equipo no está verificado no se dice nada — a diferencia de la página pública de liga, aquí no hay un "espacio no administrado oficialmente" que aclarar.
- **El CI ya cubre `scripts/` y `tests/`, y los `.mjs`**: el paso de sintaxis del backend corría `find src -name "*.js"`, así que los dos recorridos de punta a punta y los scripts de diagnóstico (todos `.mjs`) quedaban fuera del chequeo. Ahora son 38 archivos en vez de 36. Sigue sin *correr* los tests — eso necesita un backend vivo y una rama de Neon.
- **Cerrada una fuga de datos en la tarjeta pública de jugador, y arrancada la separación de las dos poblaciones.** `GET /api/players/:id/card` es público y hacía `SELECT * FROM players` sin exigir nada más: servía **cualquier** fila de `players`, incluidos los clientes del padrón de un club —nombre, fecha de nacimiento, CURP y foto, en buena parte menores de edad— a cualquiera que adivinara un id. Ahora exige **al menos una membresía de torneo** (un cliente del padrón responde 404, no 403: desde afuera no se debe distinguir "existe pero no te lo muestro" de "no existe") y devuelve solo los cinco campos que la tarjeta pinta — el CURP es identificación oficial y tampoco tenía por qué salir para los jugadores reales. La causa de raíz era compartir tabla, y de ahí sale el cambio de fondo: **`club_members` + `club_ledger_entries`** (ver "Dos poblaciones distintas" del README). El esquema ya está; **el código de cobranza todavía no se ha movido a las tablas nuevas.**
- **Dos poblaciones distintas: el cliente del club dejó de ser un `players` (fase A).** Antes, dar de alta a alguien en el padrón de cobranza creaba una fila en `players`, la misma tabla del roster de torneo. En cuanto a filas ya eran independientes (importar del roster copiaba, no enlazaba), pero compartir tabla traía tres problemas reales: nada distinguía a un cliente de un atleta, la tarjeta pública servía **cualquier** fila de `players` (ver la fuga de arriba), y `first_name`/`last_name NOT NULL` obligaba al club a inventarle un apellido a quien solo conoce por su apodo. Ahora el padrón vive en **`club_members`** —con **un solo `display_name`**, así que "El Güero" es un nombre válido— y su libro en **`club_ledger_entries`**, colgado del miembro y no del jugador. `players` se queda para lo único que es: quién puede jugar en qué rama de qué torneo.
  Se hizo en dos fases a propósito. Esta, la A, **cambia dónde viven los datos sin tocar el contrato de la API**: sigue respondiendo `player_id`, `first_name` y `last_name` (derivados del `display_name`), así que el frontend no se movió ni una línea. Eso permitió usar las suites de punta a punta como juez: **46 aserciones, 0 fallas antes y 46, 0 después**, con el único cambio en las pruebas siendo una consulta que lee la tabla directo. Si se hubieran renombrado las URLs al mismo tiempo, habría habido que editar las pruebas, y una prueba editada ya no demuestra que nada se rompió. La fase B —renombrar la superficie y poner un solo campo de nombre en el formulario— queda pendiente y no toca saldos.
  Efecto colateral bueno: el borrado de un jugador del roster (`DELETE .../roster/:playerId?hard=true`) ya **no** tiene que revisar si esa persona tiene cuenta en algún padrón o movimientos de cuotas. No puede tenerlos. Esa comprobación existía solo porque las dos poblaciones compartían tabla.
  **Las tablas viejas ya no se crean.** Sus `CREATE TABLE` se quitaron de `db.js`: mientras estuvieran, cada arranque del servidor las volvía a crear vacías después de borrarlas y nunca se acababa de limpiar. Una base nueva ya no las tiene. En una que ya existía siguen ahí con sus datos hasta que se corra `scripts/cleanup-legacy-club-padron.mjs`, que **simula por defecto**, enseña fila por fila con el dueño de cada equipo, y solo dropea con `--confirm` — una tabla de dinero no se borra como efecto secundario de reiniciar un servidor. Probado en la rama: dropeadas, servidor reiniciado, **no se recrearon**, y las 46 aserciones siguieron pasando.
- **Quitar un jugador del roster, y rechazar una solicitud de publicación**: los dos huecos que quedaban pendientes y que no dependían de nada externo. Detalle del roster en "Roster de jugadores"; el rechazo es `PUT /api/admin/leagues/:id/decline-publish`, con botón "Rechazar solicitud" en `/admin` que **solo aparece si hay una solicitud pendiente** (`!is_public && publish_requested`) y pide un **motivo obligatorio**, porque el punto de rechazar en vez de ignorar es que el dueño sepa qué arreglar. No toca `is_public` ni borra nada: apaga `publish_requested`, le manda el motivo a la bandeja del dueño (tipo nuevo `league_publish_declined`, distinto de `league_unapproved`, que es ocultar una liga que ya era pública) y así el dueño puede volver a solicitarlo cuando corrija — el ciclo se cierra sin que nadie mande un WhatsApp. `ConfirmDialog` ganó una casilla opcional (`checkboxLabel`) para la acción con dos variantes; los cuatro llamadores que ya tenía no la pasan y no cambian en nada.
- **Borrado el roster "por equipo sin rama", que no era código muerto sino una trampa.** El panel de la liga tenía un botón "Roster" por equipo (del modelo de antes de la corrección "roster por rama") que daba de alta al jugador con `player_team_memberships.branch_id = NULL` — invisible después para **todas** las consultas del modelo actual, mientras el `GET` obsoleto sí lo mostraba. Se borró el botón en vez de repuntarlo porque el camino correcto ya existía en la misma pantalla: el chip "roster" del árbol Torneo → Categoría → Rama, que abre `BranchRosterModal` de esa rama. Se fueron con él `TeamRosterModal.jsx`, los tres endpoints obsoletos de `players.js` y sus tres funciones en `api/client.js` (81 líneas de backend). Detalle completo en "Roster de jugadores → Fuera de esta versión / pendiente". Las membresías huérfanas que ya existan siguen en la base: `backend/scripts/find-orphan-roster-players.mjs` las encuentra, **falta correrlo**.

- **Panel de trabajo del equipo (workspace) + cuotas del club a sus jugadores**: `/panel/equipo/:id` dejó de ser un editor de perfil y pasó a ser un espacio de trabajo con seis secciones (Resumen, Finanzas, Jugadores, Con la liga, Perfil, Administradores), con el logo y el **color del club** (`teams.brand_color`) como acento. Lo nuevo de fondo es **Finanzas**: el libro de cuotas **equipo → jugador** (`player_ledger_entries`) y el **flujo de conciliación** que faltaba — el papá abre un **estado de cuenta público sin cuenta** (`/cuenta/:token`), sube su comprobante, y el club lo confirma con un clic. Pieza clave: el **padrón del club** (`team_player_accounts`) es **independiente de los rosters de torneo** — un equipo sin liga, o al que su liga todavía no inscribe en ninguna rama, da de alta a su gente y le cobra igual. Detalle completo en la sección "Cuotas del club" del README. **Nota**: las tablas que este bullet nombra (`player_ledger_entries`, `team_player_accounts`) se reemplazaron después por `club_ledger_entries` y `club_members` — ver "Dos poblaciones distintas" en la misma sección.
- **Monitoreo de errores (Sentry)**: integrado en frontend (`frontend/src/main.jsx` + `ErrorBoundary.jsx`, variable `VITE_SENTRY_DSN`) y backend (`backend/src/instrument.js`, importado antes que nada más en `server.js`; `Sentry.setupExpressErrorHandler(app)` justo antes del manejador de errores propio; variable `SENTRY_DSN`). Verificado en producción (Render + Vercel) forzando un error real y confirmando que llegó a Sentry.
- **Páginas legales**: Términos de Servicio (`/terminos`) y Aviso de Privacidad (`/privacidad`) — `frontend/src/pages/TermsOfService.jsx` y `PrivacyPolicy.jsx`. **Actualizado (2026-09-16)**: los datos de quien opera el Servicio ya no están escritos a mano en cada página, viven en `frontend/src/config/legal.js`; mientras estén vacíos, los Términos no se publican y el Aviso omite las frases que dependen de ellos. Ver el bullet correspondiente al inicio de esta sección.
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre las pruebas unitarias de las dos puntas (`npm test`), el build del frontend (`npm run build`) y un chequeo de sintaxis de `backend/src`, `scripts/` y `tests/` (`node --check`, 47 archivos). Las pruebas van **antes** del build a propósito: tardan medio segundo y el build casi un minuto. No bloquea el deploy de Render/Vercel si falla — son procesos independientes, esto solo te avisa.
- **Bug corregido: registrar una liga daba 500.** `POST /leagues` (`routes/leagues.js`) tenía **19 placeholders para 18 columnas** en su `INSERT`, así que Postgres la rechazaba con "INSERT has more expressions than target columns" y ninguna liga nueva se podía crear. Preexistente y sin relación con la cobranza — se topó de frente al intentar crear una liga de prueba para el recorrido de punta a punta. **Revisar si alguien intentó registrar una liga y no pudo.**
- **Verificación de la sesión**: las dos suites de punta a punta corrieron contra una rama de Neon con **46 aserciones y 0 fallas**, y encima se hizo la **QA visual en navegador** — se revisó el panel del equipo, se confirmó que la tarjeta del estado de cuenta público se ve bien, y se mandó un **WhatsApp real** desde el panel (ese link se arma en el cliente y no pasa por el backend, así que ninguna prueba automática lo cubre). La rama de prueba se borró al terminar.
- **Dos suites de punta a punta** (`backend/tests/`, ver su README): ejercitan los dos libros contra un backend vivo apuntado a una rama de Neon, nunca a producción. No corren en el CI. Cubren lo único que no se puede revisar leyendo el código — que el saldo cuadre después de cancelar, rechazar y retirar. Fueron las que cazaron los dos bugs de arriba.
- **Conciliación en los dos libros**: quien paga ahora puede reportar su pago con comprobante y quien cobra lo confirma con un clic — el equipo hacia su liga (`POST /billing/teams/:id/report-payment`) y el jugador hacia su club. El pago nace `pending` y **no mueve el saldo** hasta que lo confirman; rechazarlo no genera ajuste (nunca entró al saldo) y quien lo reportó lo puede retirar si se equivocó. Esto era lo que quedaba "Fuera de la V1" de Cobranza.
- **Pasada de estilo al panel de cobranza de la liga**: `BillingLeaguePanel` adoptó las piezas que nacieron para el panel del equipo (`.data-table`, `ConfirmDialog`, `LedgerEntryList`, `utils/money.js`) y borró su copia de cada una — incluido el `window.confirm` del navegador para cancelar un movimiento contable y la clase `billing-table`, que no existía en ninguna hoja de estilo. Se le agregó la tira de KPIs (por cobrar, vencido, % al corriente) derivada de datos que el overview ya devolvía.
- **Cobranza liga → equipos ("estado de cuenta") — V1**: la liga registra desde `/panel/liga/:id/cobranza` lo que cobra cada semana a sus equipos (renta de campo, arbitraje, transmisión, inscripción, multas), lleva un **libro append-only** por equipo y ve el panorama de adeudos. El monto es **por equipo** (tabla con casilla por equipo + botón que lo calcula como cuota × # de partidos de ese equipo en la jornada). El representante del equipo ve su estado de cuenta **de solo lectura** en `/panel/equipo/:id/estado-de-cuenta` y recibe recordatorios (cargo nuevo / por vencer / vencido / pago registrado) en su bandeja. En esta V1 **solo la liga escribe** — no hay flujo de "el equipo reporta un pago". Detalle completo en la sección "Cobranza" del README.
- **Roster por plantilla de Excel**: además del alta manual jugador por jugador que ya existía, ahora se puede descargar (desde el modal de roster de un equipo dentro de una rama) una plantilla `.xlsx` con el logo de la liga, el logo del equipo y el contexto (Liga/Torneo/Categoría/Rama/Equipo) ya incrustados, llenarla y volver a subirla — solo agrega a los jugadores que todavía no estén en esa rama, nunca borra a nadie. Se agregó CURP a `players` y un botón de foto por jugador (Cloudinary). Detalle completo en la sección "Roster de jugadores" del README.
- **Equipos independientes (sin liga)**: un equipo ya se puede registrar directo desde `/registrar-equipo` sin pertenecer a ninguna liga de la plataforma (`teams.league_id` ahora es opcional). Usa el mismo mecanismo de verificación de identidad que cualquier otra organización (`organizations.is_verified`, admin desde `/admin`) — antes esa pestaña excluía a todos los equipos. Aparecer en el home es decisión propia del equipo (`show_on_platform`, interruptor sin aprobación de nadie, se prende/apaga desde su panel) y no limita ninguna otra función; un equipo de liga sigue apareciendo exactamente igual que antes, sin cambios. Detalle completo en la sección "Equipos independientes" del README.
- **Footer ya no se pinta negro por default**: `.footer` en `styles.css` tenía `background: #000` fijo, así que se veía como una barra negra sólida en cualquier página, sin importar si esa sección tenía o no un panel negro real detrás (ej. el Home, que no usa panel negro en ningún lado). Se cambió a `background: transparent` para que herede el fondo verde de cancha del `body`, igual que el resto del sitio.
- **Travelpayouts Drive removido de `frontend/index.html`**: ese script reescribía automáticamente los links salientes a marcas de viaje y podía insertar ofertas/contenido propio en la página — se quitó a petición explícita (no se quieren anuncios ni contenido que "salte" en el sitio), y porque Brave Shields (y listas de bloqueo tipo EasyPrivacy) lo bloqueaban de cualquier forma. **Efecto directo: el botón 🏨 Hotel en `MatchPage` dejó de generar comisión** — era el único mecanismo que agregaba el marcador de afiliado al link de Booking.com. El botón ✈️ Vuelo (widget de Aviasales) no se afectó — trae su propio marcador embebido, independiente de Drive. Detalle y alternativa sin Drive en "Monetización" del README.
- **Diagnóstico de pantalla en blanco en `localhost` (solo en dev, no afecta producción)**: `PrivacyPolicy.jsx` se importaba de forma estática en `App.jsx`. En dev, Vite sirve cada componente como su propio archivo (`/src/pages/PrivacyPolicy.jsx`), y Brave Shields bloquea por heurística cualquier URL que contenga la palabra "privacy" — al bloquearse ese import estático se rompía la carga de **toda** la app (pantalla en blanco). En producción no pasaba porque Vite empaqueta todo en un solo bundle sin nombres de archivo reconocibles, pero el riesgo estaba ahí para cualquier página que en el futuro se cargara distinto.
- **Code-splitting por ruta** (`App.jsx` + `vite.config.js`): todas las páginas excepto `Home` ahora se cargan con `React.lazy()` dentro de un `<Suspense fallback={<Loading />}>`, y los chunks resultantes se nombran con hash genérico (`chunkFileNames: 'assets/chunk-[hash].js'` en `vite.config.js`) en vez del nombre real de cada página — así ningún bloqueador puede tumbar una página por su nombre. Efecto medido con `npm run build`: el bundle principal bajó de 946 KB a ~300 KB; el resto se reparte en ~40 chunks pequeños que se descargan solo al entrar a esa página. Bonus: si algún chunk llega a fallar (bloqueado, red lenta), el `ErrorBoundary`/`Suspense` ya existentes lo contienen a esa sola página — TopBar, SponsorBar y footer siguen funcionando.
- **Panel negro (`dashboard-panel`) ahora envuelve el contenido de `Dashboard.jsx`, `LeagueStructurePanel.jsx` y `TournamentMatchesPanel.jsx`** — antes solo lo tenía `Dashboard.jsx` en parte de su contenido. **Verificado en navegador el 2026-09-17 para `Dashboard.jsx` y `LeagueStructurePanel.jsx`** (el panel se ve bien y el contenido no se desborda); `TournamentMatchesPanel.jsx` sigue sin verificarse, porque llegar a esa pantalla pide categoría, rama y partidos — ver "Pendientes abiertos" en el README (en los dos últimos archivos el `<div>` nuevo no reindentó el contenido interno — cosmético en el código fuente, no afecta el render).
- **Varios administradores por liga o equipo ("Invitar administrador")**: una liga o un equipo ya puede tener más de una persona con acceso simultáneo a su panel, no solo un dueño único — mismo mecanismo que ya existía para "entregar" un equipo a su representante, pero sin reemplazar a nadie. Nuevo tipo de invitación `org_admin` (`routes/invites.js`, columna `invites.organization_id`) que, al reclamarse, agrega a esa persona como fila nueva en `organization_members` en vez de sustituir al dueño actual. Nuevas rutas `GET/DELETE /organizations/:id/members` para listar y quitar administradores (no deja quitar al último — evita dejar la organización sin nadie). Botón "+ Invitar administrador" y la lista correspondiente viven en el componente nuevo `OrgAdminsPanel.jsx`, presente en el panel de equipo (`Dashboard.jsx`) y en el panel de liga (`LeagueStructurePanel.jsx`). Por ahora todos los administradores tienen el mismo permiso — no hay jerarquía de roles todavía (`owner`/`admin`/`editor` no se distinguen, ver `isOrgMember`).
- **Dos huecos corregidos para que lo anterior funcione de punta a punta**: (1) `GET /auth/me` calculaba `leagues`/`teams` solo por `owner_user_id` — alguien invitado como administrador nunca veía esa liga/equipo en "Mi panel" aunque el backend ya le diera permiso de editarla; ahora también cuenta la membresía activa en `organization_members`. (2) `POST /leagues` no creaba la fila en `organizations` ni el `organization_members` del dueño al momento de crear la liga (a diferencia de un equipo, que sí lo hacía desde siempre) — se quedaba así hasta el siguiente reinicio del servidor, que es cuando corre el backfill que lo completa; ahora una liga nueva nace con su organización y su dueño registrado de inmediato.
- **Pantalla vieja de liga retirada (`/panel/liga/:id`, modelo plano sin torneos)**: todo lo que hacía ya vivía en `LeagueStructurePanel.jsx` (`/panel/liga/:id/estructura`), la pantalla que de verdad se usa desde hace tiempo — se confirmó contra la base de datos que ninguna liga tenía ya partidos en el modelo viejo antes de quitarla. `Dashboard.jsx` bajó de ~800 a ~250 líneas (ahora solo sirve "Mi panel" y el panel de equipo). La ruta vieja redirige automáticamente a `/estructura` (`RedirectToLeagueStructure` en `App.jsx`) para no romper links guardados; el aviso "Abrir pantalla clásica" que apuntaba ahí también se quitó de `LeagueStructurePanel.jsx`.

### Cerrado y verificado

- **Los dos scripts de limpieza ya se corrieron contra la base real
  (2026-09-17)**, con el dueño de los datos confirmando que las dos filas eran
  suyas y de prueba:

  - `delete-orphan-roster-players.mjs`: borró la única membresía sin rama que
    quedaba (ZHAMIS TOLEDO, equipo BULLDOGS) y su fila en `players`, porque no
    estaba referenciado en ningún otro lado.
  - `cleanup-legacy-club-padron.mjs`: tiró `team_player_accounts` y
    `player_ledger_entries`, que tenían una cuenta y un cargo de prueba de $500
    en GRIZZLIES.

  Antes de confirmar se revisaron las llaves foráneas hacia `players`: son cuatro
  tablas, y ZHAMIS TOLEDO no aparecía en ninguna salvo su membresía rota, así que
  no se perdió nada en cascada. **El detalle que salió de esa revisión**: al
  momento de correrlos, `club_members` y `club_ledger_entries` (las tablas nuevas)
  estaban **vacías** — ese cargo de $500 nunca se migró, era el único dato de
  cuotas de club en toda la base. Por eso el borrado necesitaba una confirmación
  humana y no se hizo de corrido; el script avisa de esto a propósito.

  Reverificación después de correrlos, toda en verde: cero membresías sin rama,
  cero filas de ZHAMIS TOLEDO, las dos tablas viejas ya no existen, y
  `club_members`/`club_ledger_entries` siguen en su lugar. Quedaron dos filas en
  `players` sin ninguna membresía de roster (FERCHO BULLDOG y alfredo reyes): no
  las tocó ningún script porque no son membresías huérfanas sino jugadores sin
  membresía, no se ven en ninguna pantalla y no estorban.

- **QA visual del panel negro en `LeagueStructurePanel`** — **hecha en navegador
  (2026-09-17)**: el `.dashboard-panel` renderiza bien, el árbol crece dentro del
  panel sin desbordarlo y los modales (nuevo torneo, quitar administrador) se ven
  correctos. `TournamentMatchesPanel` sigue sin verificarse — llegar a esa
  pantalla pide categoría, rama y partidos, y la QA no llegó tan hondo (ver
  "Pendientes abiertos" en el README).

- **QA visual de "Invitar administrador"** — **hecha de punta a punta en
  navegador (2026-09-17)**, con dos cuentas de prueba y una liga desechable que
  se borró al terminar. Funciona: generar el link, reclamarlo con una segunda
  cuenta creada desde el propio link, verla aparecer en su "Mi panel" con acceso
  real, quitar a un administrador, y el candado del último administrador — que
  **no es solo visual**: el botón queda deshabilitado con su explicación en el
  tooltip, y el backend además responde 400 si se le pega directo. El link es de
  un solo uso y al reabrirlo dice "Esta invitación ya fue utilizada".

  **Dos cosas del mecanismo de invitaciones que salieron de paso** (ninguna es
  un bug abierto, pero conviene tenerlas escritas):
  - **El link se genera al ABRIR el modal, no al enviarlo** (`InviteAdminModal.jsx`
    lo pide en un `useEffect`). Abrir y cerrar sin mandar nada deja una
    invitación válida en la base. No se acumulan, porque `routes/invites.js`
    borra las no usadas de esa organización antes de crear la siguiente — la
    consecuencia real es que **generar un link nuevo invalida el anterior**, que
    es lo correcto pero no es obvio desde la pantalla. En desarrollo se ven DOS
    filas por cada apertura: `React.StrictMode` corre el efecto dos veces y las
    dos peticiones se pisan (ambas borran antes de que la otra inserte). Es
    ruido de desarrollo — en el build de producción StrictMode no duplica
    efectos — pero explica por qué en la QA apareció una invitación huérfana.
  - **Las invitaciones no caducan**: el esquema de `invites` no tiene
    `expires_at` y el único freno es `used_at`. Un link que nunca se usó sigue
    sirviendo indefinidamente, hasta que alguien genere otro para esa misma
    organización. Trade-off aceptable hoy (el link se manda por WhatsApp y se
    usa en el momento), pero si algún día se reenvía un chat viejo, ese link
    todavía funciona.
  **Pero salió un hueco de fondo, ver abajo.**
- **Quitar a quien registró la organización NO le quita el acceso** —
  **arreglado (2026-09-17)**. El problema: `middleware/ownership.js` autoriza con
  `isMember || owner_user_id === req.user.id`, y ese segundo término es un
  respaldo deliberado de la migración a `organization_members`. Consecuencia que
  el comentario no contemplaba: a quien **creó** la liga o el equipo no se le
  podía revocar el acceso — la pantalla lo quitaba de la lista y el diálogo decía
  "puedes volver a invitarla más adelante", pero su token seguía dando **200** en
  `GET /leagues/:id/tree` y en `GET /billing/leagues/:id/overview`, o sea también
  la cobranza.

  **Cómo se arregló, y por qué así.** Se revisó primero la base real: **cero**
  ligas y **cero** equipos dependen hoy del respaldo (todos los que tienen
  `owner_user_id` ya tienen su fila en `organization_members`), así que se podía
  quitar de los 18 puntos donde aparece. **No se hizo eso.** En vez de tocar 18
  sitios de autorización, se mantiene `owner_user_id` **sincronizado** con el
  administrador principal: el respaldo deja de ser puerta trasera porque siempre
  apunta a alguien que de todas formas tiene acceso, y la red de seguridad de la
  migración se queda intacta. Retirar el respaldo sigue siendo posible más
  adelante, pero ya como limpieza aparte y no como parte de un arreglo urgente.

  **Lo que se construyó** (`routes/organizations.js`, `OrgAdminsPanel.jsx`):
  - **`POST /organizations/:id/transfer-owner`** — cede el puesto de principal a
    otro administrador ya existente. Mueve el `role` de organization_members y el
    `owner_user_id` de la liga/equipo **en una sola sentencia con CTEs**: no en
    varias seguidas, porque `db.prepare` toma una conexión del pool por consulta
    y del otro lado hay un pooler en modo transacción, así que un BEGIN/COMMIT
    repartido no tiene garantizada la misma conexión. Solo lo puede hacer quien
    tiene el puesto — si no, un invitado podría nombrarse principal y después
    quitar a quien lo invitó.
  - **Al principal ya no se le ofrece "Quitar"**, en vez de ofrecerlo
    deshabilitado: un botón muerto no explica nada, y antes prometía algo que el
    backend no cumplía. El backend además responde `409` si se le pega directo.
  - **"Retirarme"** — quitarse a uno mismo siempre estuvo permitido por el
    endpoint; lo que faltaba era que surtiera efecto. Es el caso de quien registra
    el equipo donde trabaja (un coach) y **no quiere** acceso a las cuentas de
    dinero: cede el puesto al tesorero y se retira. El diálogo lo dice sin
    rodeos — se pierde el acceso al panel y a la cobranza.

  **Verificado de punta a punta** contra la base real, con dos cuentas de prueba
  y una liga desechable que se borró al terminar: roles iniciales correctos, el
  principal no se puede quitar ni quitarse (409 en ambos), un invitado no puede
  auto-nombrarse principal (403), el traspaso mueve rol **y** `owner_user_id`
  juntos, y después de retirarse la cuenta saliente recibe **403** en el panel y
  en la cobranza — donde antes recibía 200. Las 135 pruebas unitarias siguen en
  verde.
- **El registro de liga promete algo que no pasa** — **arreglado
  (2026-09-17)**. `RegisterLeague.jsx` decía "Tu liga aparecerá de inmediato en
  la página de inicio", y era falso: `leagues.is_public` nace en `FALSE`
  (`db.js`), el `INSERT` de `routes/leagues.js` no lo toca y la portada filtra
  `WHERE is_public = TRUE`. Comprobado creando una liga real: quedó
  `is_public=false` y no apareció en el listado público. Ahora el formulario dice
  lo que de verdad ocurre — que la liga empieza privada, que se puede cargar todo
  sin que nadie la vea, y que se publica cuando se pide desde el panel y el admin
  aprueba. El panel de la liga ya lo decía bien; el que prometía de más era este
  formulario.
- **Al aceptar una invitación no se sube el scroll** — **arreglado
  (2026-09-17)**, junto con el contraste de esa misma pantalla. La pantalla de
  éxito se pinta arriba, pero el navegador conservaba el scroll del formulario
  que acababa de desaparecer: lo primero que se veía era cancha vacía y parecía
  que el clic no había hecho nada (pasó en la propia QA). Ahora `InviteClaim.jsx`
  sube el scroll al llegar a éxito o a error. Y las **tres** pantallas de esa
  ruta (invitación, éxito y "ya fue utilizada") van dentro de `.dashboard-panel`
  como el resto del área con sesión — antes iban sueltas sobre el fondo de
  cancha, con el texto secundario en verde claro sobre verde. Verificado en
  navegador: `scrollY` pasa de 609 a 0 al aceptar.
- Revisar si alguien no pudo registrar su liga — **cerrado**. El bug de
  `POST /leagues` (19 placeholders para 18 columnas) está corregido.
  `scripts/diagnose-failed-leagues.mjs` quedó, pero **no sirve para contar
  intentos fallidos**: su primera versión listaba a los usuarios sin
  organización como sospechosos, y eso es ruido — en esta app la mayoría de las
  cuentas son de aficionados que entran por el calendario o la quiniela, y no
  tienen por qué administrar nada. El script ya no los lista.
- Configurar método de pago (payout) en Travelpayouts — **hecho**: ya está configurado el payout a PayPal.
- Botón de "Rechazar" una liga pendiente — **hecho (septiembre 2026)**, ver "Cambios recientes".

## Agosto 2026

- **Monetización de afiliados de viaje activada**: la plataforma ya genera comisión real sobre los botones de Hotel y Vuelo en `MatchPage`. Ver la sección "Monetización" del README para el detalle completo de cómo funciona y qué falta.
- **Travelpayouts Drive instalado** (`frontend/index.html`, `<script>` al inicio del `<head>`): convierte automáticamente los links salientes a marcas de viaje soportadas (ej. Booking.com) en links de afiliado, sin tocar el código de React que genera esos links.
- **Función de Vuelos construida** (antes solo era un comentario de "a futuro" en el código): nuevo componente `frontend/src/components/FlightSearchWidget.jsx` y utilidades nuevas en `matchServices.js` (`IATA_BY_CITY`, `iataForCity`). Al hacer clic en "✈️ Vuelo" en la tarjeta de un partido, se despliega un formulario de búsqueda de Aviasales embebido (vía Travelpayouts), con el destino ya puesto según la ciudad de la sede — el origen lo detecta Aviasales por la IP del usuario, y las fechas las ajusta el usuario a mano (el widget no acepta fecha por default; se le muestra la fecha del partido como referencia).
- El botón de Hotel (`buildHotelSearchUrl`) no cambió de código — sigue generando un link limpio a `booking.com/searchresults.html`; ahora es Drive quien le agrega el marcador de afiliado en el navegador del usuario.
- `buildFlightSearchUrl` y `ORIGIN_CITY_OPTIONS` en `matchServices.js` quedaron sin uso (eran de un primer approach con link directo + selector de ciudad de origen, reemplazado por el widget embebido). **Borrados en septiembre 2026** — nada los importaba. Lo que sí sigue vivo de ese archivo para vuelos es `IATA_BY_CITY` e `iataForCity()`, que es lo que `FlightSearchWidget` usa para resolver el destino.


## Julio 2026

- **Nuevo modelo de "Mi panel" — varias organizaciones por cuenta**: al crear una cuenta o iniciar sesión, ya no se entra directo al panel de una liga. `/panel` ahora muestra los logos de todas las ligas y equipos que administras (sin abrir ninguno automáticamente), cada uno con su propia URL (`/panel/liga/:id`, `/panel/equipo/:id`). Un clic abre su panel de trabajo; un segundo clic sobre el mismo logo lo cierra. Esto sienta la base para agregar más tipos de organización (empresa, medio) sin rediseñar de nuevo la navegación.
- **Pantalla "Registrar Organización"**: nuevo botón en el TopBar y nueva ruta (`/panel/registrar-organizacion`) desde donde se registran organizaciones nuevas. Por ahora solo tiene la opción "Registrar liga"; los demás tipos se agregan aquí más adelante.
- **Botón de notificaciones en el TopBar**: ícono nuevo (balón amarillo), con su propia página `/notificaciones` — todavía sin contenido conectado, es solo el punto de entrada.
- **Ligas nuevas quedan pendientes de aprobación**: al registrarse, una liga queda con `status = 'pending'` y no aparece en el sitio público hasta que un admin la aprueba desde `/admin` (pestaña "Ligas", botón "Aprobar"). El dueño puede seguir configurando su liga con normalidad mientras está pendiente.
- **Rediseño de la página pública de liga**: portada, logo, nombre, descripción, botones de "Compartir"/"Notificarme", pestañas (Categorías/Equipos/Sedes) y su contenido ahora viven dentro de un solo panel negro continuo. La foto de portada se muestra completa (sin recortar), en vez de forzarla a una altura fija.
- Arreglada la deformación de logos en las tarjetas de equipo cuando el nombre es largo (ya no se fuerza una altura fija a la tarjeta).
- `node_modules/` se sacó del control de versiones de Git.
- Endurecimiento de seguridad: CORS con whitelist, `JWT_SECRET` obligatorio (sin valor por defecto), rate limiting en login/registro, y reemplazo de la dependencia `xlsx` vulnerable (backend **y** frontend). Detalle completo en la sección "Seguridad" del README.
- Las migraciones de `db.js` usan un candado (advisory lock) para no chocar si algún día corren varias instancias del servidor a la vez.
- Se agregó `backend/.env.example` con los nombres de todas las variables de entorno necesarias (sin valores reales).
