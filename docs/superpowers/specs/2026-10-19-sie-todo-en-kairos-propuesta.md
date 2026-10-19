# «Todo el SIE desde Kairos» — propuesta de fusión de Incidencias SIE (INCSIE)

Fecha: 2026-10-19 · Pedido por Pedro Gil · Estado: **propuesta, sin código ni despliegues**
Revisado con Codex (solo lectura): `docs/superpowers/revisiones/2026-10-19-codex-fusion-incsie.md`. Coincidimos en lo esencial; abajo
se marca lo que he comprobado yo en el código y lo que corrijo.

## Qué hay hoy del SIE (cada cosa en un sitio)

| Pieza | Dónde vive | Para qué |
|---|---|---|
| **Incidencias SIE (INCSIE)** | App Apps Script aparte (`Desktop\Proyectos\INCSIE`, 27 versiones, ~22 deployments, en uso desde el 11/05) | El operario registra una incidencia de **recepción** de un palet que viene de tienda: tienda, operario, tipo (7), SSCC (escaneado o tecleado), foto, comentario. Guarda en el Sheet «Incidencias_SIE» (pestañas «Registros Marbella» / «Registros Mijas») y la foto en Drive. Correo diario a las 8:00 (L-V) a cada tienda y mensual (día 1) con el ratio incidencias / SIE recibidas. ~300 filas. |
| **Ocupación SIE** | Kairos (botón amarillo en la pantalla principal, v85) + motor «Ocupación Tiendas SIE» | Huecos libres de Mijas y Marbella + 3 informes. Pestaña de jefe en Kairos y en Centinela. |
| **SIE por ubicar** | Kairos, pestaña de jefe | Palets de tienda parados en RC2, leídos del CSV del robot. Solo consulta. |
| **Revisión de stock por SSCC** | Kairos (la pide la tienda, la hace el operario con fotos) | Comprobar un palet concreto. |
| **Etiquetas de SIE** | Centinela, «Petición de consumibles» | Correo urgente a los mandos de la tienda. |
| **Palets / cargas SIE** | HODOS (`public.palets`, `public.cargas`) | Carta de portes y cierre de camión. |
| **Argos** | Conector `Con_IncSie.gs` | Lee las pestañas «Registros Marbella/Mijas» (columnas A–D) y vigila que no lleguen vacías. |
| **Hub** | Enlace «Incidencias SIE» (botón «Registrar INC») | Entrada que usan hoy los operarios. |

No confundir con la pestaña «Incidencias» de Kairos: esa es de **preparación de pedidos**, no de recepción SIE.

## Recomendación: por fases, con INCSIE como «motor» al principio

**Por qué no migrar todo de golpe a Supabase:** haría falta trasladar el histórico, rehacer los correos diario y mensual, cambiar
el conector de Argos y el enlace del Hub, y las fotos tendrían que seguir en Drive (Supabase Free ya va por la mitad de su
tráfico). Se arriesgaría un servicio que hoy funciona para ganar poco al principio. Lo que sí queremos desde ya es que **el
operario lo haga todo desde Kairos**. Es el mismo camino que hemos seguido con la Ocupación.

### Fase 1 — Kairos como pantalla, INCSIE como motor (lo que se ve)

**Operario** (pantalla principal, sin elegir tienda; la tienda de origen es un dato de la incidencia):
- Opción A (recomendada): el botón amarillo pasa a llamarse **«SIE»** y abre una pantalla con tres botones grandes:
  **Registrar incidencia · Ocupación · Pendientes por ubicar**. La pantalla principal no se llena de botones.
- Opción B: dos botones amarillos sueltos («Incidencia SIE» y «Ocupación SIE»), como está ahora la ocupación.
- **Registrar incidencia** (mismos pasos que INCSIE, con las reglas de Kairos): tienda de origen → tipo → SSCC (foto del código
  con el lector que ya tiene el portal de Kairos —BarcodeDetector y ZXing—, o a mano) → foto → comentario → resumen →
  guardar. Sin `confirm()`/`prompt()` (INCSIE los usa para «introducir SSCC a mano»). El nombre del operario es el de Kairos.
- Al leer un SSCC, Kairos **propone** tienda, ubicación y artículos desde `preparacion.stock_fisico` (o del CSV de RC2), con la
  fecha del dato y pidiendo confirmación: es una foto del inventario, no una prueba de lo que llegó. Si no lo encuentra
  (típico de «SSCC erróneo» o «palet suprimido»), se registra igual.
- Historial de hoy **desde el servidor** (el de INCSIE vive en el móvil y se pierde al cambiar de teléfono).

**Jefe de equipo** (`?modo=jefe`): las pestañas «SIE por ubicar» y «Ocupación SIE» se agrupan en una sola, **«SIE»**, con
«Incidencias» como tercera sección: lista de los últimos 30 días, filtros por tienda, tipo y operario, foto dentro de Kairos
(el id sale de la hoja, nunca del navegador, como en las revisiones) y contador de incidencias de hoy.

**Debajo** (lo que no se ve): INCSIE gana un `Api.js` (leer lista de tipos y operarios, registrar con foto, listar, servir foto)
igual que hicimos con Ocupación. El Sheet, las pestañas, las columnas A–I, las carpetas de Drive, los correos, Argos y el
enlace del Hub **no cambian**. Se añade una columna J con un identificador de registro (evita duplicados por reintento).
Kairos no necesita permisos nuevos (llama por HTTP con el token, ya probado con HODOS y Ocupación).

### Fase 2 — Endurecer lo que ya hace INCSIE (sin cambiar lo que ve el usuario)
- Elegir días y meses por la **marca de tiempo ISO** (columna H) y no por el texto de la fecha: hoy el diario compara textos
  y el mensual convierte `dd/MM/yyyy` con `new Date`, que puede leer mes y día al revés (el mismo problema que ya nos mordió
  en Centinela).
- Foto: INCSIE la reduce de verdad a **600 px y calidad 0,4** (el código dice 1024 y 0,6 pero fuerza 600/0,4): poca calidad
  para una evidencia de «mercancía rota». En Kairos, ~1280 px / 0,7 como las revisiones.
- **Modo pruebas** real (hoy las funciones `testReporteAhora()` y `testInformeMensualAhora()` mandan correos REALES a los
  mandos de las tiendas): destino único = Pedro hasta pasar a producción, como en Ocupación.
- Validar tienda, tipo y SSCC en el servidor (hoy una tienda desconocida crearía otra pestaña) y subir la foto **después** de
  guardar la fila (hoy un fallo deja fotos huérfanas).
- SSCC como texto (ceros iniciales): comprobar en el Sheet real que no se están perdiendo.
- Informe del lunes: hoy solo cubre el viernes; lo del sábado y domingo no sale en ningún diario (ver decisión 2).

### Fase 3 — Opcional y más adelante: que las tiendas lo vean en Kairos y retirar INCSIE
Solo tiene sentido si las tiendas van a **consultar o responder** incidencias dentro del portal. Entonces: tabla en Supabase,
histórico migrado, correos movidos a `kairos-sync`, conector nuevo en Argos (ya tiene el de Kairos), enlace del Hub cambiado y
INCSIE apagado. Fotos en Drive siempre. No empezar sin cerrar la decisión 4.

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Correos reales a los mandos de las tiendas durante las pruebas | Modo pruebas antes de tocar nada; no ejecutar los `test*` actuales; pruebas con registros marcados y borrados. |
| Romper a Argos | No se tocan pestañas ni columnas A–D; antes de cada despliegue, mirar su conector. |
| Dos puertas de entrada a la vez | Kairos y la app antigua escriben en el mismo Sheet; se retira el enlace antiguo del Hub solo cuando los operarios ya usen Kairos. Un solo proceso de informes. |
| Lector de códigos desde un CDN en la red de la nave | Entrada manual siempre disponible; probar con los móviles reales antes de anunciarlo. |
| Fotos grandes en `google.script.run` | Reducir en el móvil, límite medido, un solo envío por foto. |
| Quién es quién | Elegir un nombre identifica, no autentica (igual que en todo Kairos). |

## Decisiones de Pedro (máximo 5)
1. ¿Un botón **«SIE»** con tres opciones dentro (recomendado) o botones amarillos sueltos?
2. ¿Se trabaja **sábado y domingo**? Si sí, el correo del lunes debería cubrir también esos días.
3. ¿Hay tipos de incidencia en los que la **foto sea obligatoria** (por ejemplo, mercancía rota o embalaje)?
4. ¿Las **tiendas** deben ver las incidencias y las fotos dentro de Kairos (y poder responder)? Hoy solo les llega el correo, y
   el enlace «Ver foto» solo lo abre quien tenga acceso a la carpeta de Drive: conviene confirmar si los mandos de tienda lo
   abren.
5. «Pendientes por ubicar»: ¿solo **consultar** (lo único posible hoy: desaparece cuando MyISO cambia la ubicación) o también
   registrar la ubicación?

## Pendiente de comprobar antes de construir
- Qué deployment de INCSIE es el que usa el Hub (hay ~22; hay que redesplegar ese y no otro).
- Que el `appsscript.json` de INCSIE (ya tiene `drive`, `spreadsheets` y `script.external_request`) deje a Kairos llamarlo con el
  token, igual que el motor de Ocupación.
- Estado real del Sheet (SSCC con ceros, tipos de fecha de las filas antiguas) y quién mantiene las listas de operarios,
  tipos y destinatarios (las de INCSIE están escritas en el código).
