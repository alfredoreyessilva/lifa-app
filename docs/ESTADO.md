# Estado del proyecto

Una foto de qué productos hay y a qué nivel está cada uno, para no tener que
reconstruirla leyendo el README. Lo que falta vive en
[`PENDIENTES.md`](PENDIENTES.md), con ID y prioridad; aquí solo se nombra.

**Actualizado: 2026-09-23.** Cuando un producto cambia de nivel, su renglón se
mueve en el mismo commit que lo movió.

## Los niveles

Hasta el 2026-09-22 esta foto era un porcentaje "del alcance declarado", puesto
a ojo. El problema es que medía cuánto se construyó, no si sirve: la cobranza
salía con 88% sin que nadie la hubiera usado nunca. Cada nivel de esta escala se
comprueba con algo concreto:

| Nivel | Nombre | Cómo se comprueba |
|-|-|-|
| **1** | Definido | El modelo está escrito en el README. No hay código |
| **2** | Construido | Está en `main` y sus reglas puras tienen pruebas unitarias |
| **3** | Verificado | Corrió de punta a punta contra una rama de Neon: suite e2e o recorrido en el navegador |
| **4** | En producción | Desplegado y respondiendo en la URL pública |
| **5** | En uso | Alguien que no es Alfredo lo usa, y hay datos reales que lo prueban |

Un nivel incluye los anteriores. "Sin medir" quiere decir que no se ha contado
el uso en producción, no que sea cero.

## La lectura en una línea

**Hay mucho más construido que usado.** Tres productos tienen uso real
comprobado; los dos más grandes (cobranza y cuotas del club) están en
producción con cero uso; y lo más nuevo (el día del partido) está en producción
sin haberse probado donde se usa. Lo que falla no es el código sino la
operación: un servidor que se duerme y un cron que pasa cada 4 horas. Los
respaldos se resolvieron el 2026-09-23.

## Productos

### Para la afición

| Producto | Nivel | Evidencia | Qué lo detiene |
|-|-|-|-|
| Calendario, resultados y páginas públicas | **5** | 4 ligas públicas, 92 equipos, 168 partidos | PD-03 |
| Predicciones y quinielas | **5** | 1,663 predicciones en el concurso de ONEFA (2026-09-23) | — |
| Tabla de posiciones | 4 | Verificada contra datos reales (2026-09-16) | PD-14 |
| Transmisiones | 4 | Sin medir | — |
| Avisos push de partido | 4, **sin audiencia** | Funcionan de punta a punta (verificado 2026-09-23), pero hay **0 dispositivos** con push; el cron atrapa casi ninguna ventana | PD-02 |
| Afiliados de viaje | Vuelo 4 · Hotel 2 | Hotel no genera comisión | Siguiente alcance |

### Para ligas y equipos

| Producto | Nivel | Evidencia | Qué lo detiene |
|-|-|-|-|
| Estructura y panel de liga (torneo → categoría → rama → partido, importador de Excel) | 4 | Las ligas públicas las captura Alfredo | PD-26 |
| Equipos independientes | **5** | Un caso: GRIZZLIES | PD-13 |
| Roles, invitaciones y entrega de equipos | **5** | Un caso: GRIZZLIES tiene un administrador invitado | PD-07, PD-32 |
| Cobranza liga → equipo (varias ligas) | 4 | **0 movimientos** en producción | PD-06; cobro en línea |
| Cuotas del club y estado de cuenta del papá | 4 | **0 filas de padrón** en producción | PD-16, PD-17, PD-27 |
| Roster (Excel, foto, altas y bajas) | 4 | Sin medir | PD-05 |
| Roster público y pase de lista | 4 | Sin medir | PD-25 |
| Estadísticas por jugada y captura sin señal | 4, **sin validar en cancha** | Solo Chromium con red apagada | PD-09, PD-10 |
| Tienda y bot de WhatsApp | 2 | Código completo, sin conectar | Siguiente alcance |

## Plataforma y operación

| Parte | Cómo está | Qué falta |
|-|-|-|
| Respaldos | ✅ Ramas semanales en Neon (se conservan 4) y archivo cada 4 semanas, restaurado de prueba. Las dos capas corrieron de verdad el 2026-09-23 | — |
| Disponibilidad | ⚠️ Render gratuito: **41.5 s** en frío (medido 2026-09-23) | PD-03 |
| Cron | ⚠️ Una llamada cada ~4 h (GitHub). El externo de antes ya no llama. Alcanza para la cobranza, no para los avisos de partido | PD-02 (P2) |
| Monitoreo | Sentry en frontend y backend ✅ · caída del servicio ❌ | PD-12 |
| Pruebas | **305 unitarias** (177 backend + 128 frontend) en el CI ✅ · **5 suites e2e** que se corren a mano | PD-11, PD-25 |
| Despliegue | Push a `main` = producción, sin protección ni espera al CI | PD-11 |
| Seguridad | JWT obligatorio, límite de intentos en login y en el estado de cuenta público, CORS con lista, SQL parametrizado, candado contra producción, invitaciones que caducan a los 7 días ✅ | PD-04, PD-20, PD-21 |
| Páginas legales | ✅ Completas desde el 2026-09-19 | — |

## Qué hay en juego en producción

Censo de solo lectura del 2026-09-22: **11 ligas** (4 públicas: ONEFA, LFA,
AFC, OFASE), **92 equipos** y **168 partidos**. Lo que no se puede perder son
las **1,648 predicciones** del concurso de ONEFA, que cuelgan de `matches`. Los
dos libros de dinero tienen **0 movimientos** y el padrón del club **0 filas**:
los candados de la regla 5 protegen algo que todavía está vacío, y eso deja de
ser cierto el día que una liga cobre el primer peso.

## Roadmap de negocio

El detalle de cada fase está en "Roadmap de negocio" del README.

| Fase | Cómo va | Qué la mueve |
|-|-|-|
| 0 — Cerrar lo que estaba a medias | Casi hecha | ID de afiliado de Booking.com |
| 1 — Fundación de confiabilidad | En curso | PD-03, PD-21 (el respaldo se cerró el 2026-09-23) |
| 2 — Automatizar el cobro | **Sin empezar** | Una pasarela. Es el punto de no retorno: una liga que cobra por la plataforma no se va |
| 3 — Red de seguridad técnica | En curso | PD-11, PD-12, y las e2e dentro del CI |
| 4 — Ciclo de vida del cliente | Sin empezar | Correos de onboarding; Resend ya está configurado |
| 5 — Crecimiento | Sin empezar | Página de precios, analítica de conversión, SEO |
