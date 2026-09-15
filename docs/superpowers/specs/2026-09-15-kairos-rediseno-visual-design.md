# Pieza 7: Rediseño visual (kairos-operario + kairos-portal) — Design

## Contexto

Petición original del usuario (sesión anterior): "quiero que mejores todas
las interfaces de esta app... super moderno y visual". Se exploró con un
Artifact comparador ("Temas Kairos") que ya define, funcionando de verdad,
el sistema completo: 4 acentos de color, modo claro/oscuro, componentes
reales (cola de peticiones, detalle con incidencias, mis peticiones) y el
JS de cambio+persistencia. Esta pieza lleva ese prototipo al código real de
las dos apps.

Ninguna pantalla de `kairos-operario` ni `kairos-portal` usa hoy este
sistema: `kairos-operario` sigue con el estilo plano original (Arial,
fondo gris, botones azul sólido); `kairos-portal` ya tiene un tema oscuro
propio pero distinto del elegido (no tiene acentos ni modo claro).

## Objetivo

Aplicar el sistema de diseño del Artifact "Temas Kairos" a **todas** las
pantallas reales de las dos apps, con selector de tema funcional
(persistente por dispositivo), sin cambiar ninguna lógica de negocio.

## Arquitectura

**Mismo patrón que el resto del ecosistema Kairos: todo inline, sin
librería compartida.** Cada app (`kairos-operario/Index.html`,
`kairos-portal/Portal.html`) es ya un único `HtmlService` autocontenido;
seguimos esa convención en vez de crear una Apps Script Library
compartida (fricción de despliegue/versionado no justificada para 2 apps).

**Tokens** (copiados literalmente del Artifact "Temas Kairos", sin
modificar valores):
- Superficie: `--ink-950/900/850/800/700/600`, `--text-100/300/500/600`
  — redefinidos bajo `[data-kmode="light"]` con la misma paleta clara ya
  probada.
- Semántico: `--ok`, `--warn-bg/fg/line`, `--danger-bg/fg/line`.
- Tienda: `--chip-marbella/mijas/malaga-bg/fg`, `--tienda-marbella/mijas/malaga`.
- Acento (4 temas vía `[data-ktheme="..."]`): `indigo` y `amber` solo
  oscuro; `lmgreen` y `taisared` (por defecto, "elegido") en ambos modos.
  Cada uno define `--accent`, `--accent-ink`, `--accent-dim`, `--accent-line`.
- `--radius-card/btn/chip`, `--shadow-card`.

**Componentes** (clases ya definidas y probadas en el Artifact — se
reutilizan tal cual, no se rediseñan): `.card`, `.chip` (+ variantes
`-marbella/-mijas/-malaga/-accent/-muted/-ok`), `.btn` (+ variantes
`-accent/-ghost/-warn/-danger`, tamaño `-sm`), `.linea` (+ `.done`),
`.pbar`, `.opbar`, `.row`, `.stack`, `.tabs` (adaptado de las pestañas
que ya tiene `kairos-operario`).

**Selector de tema:** el bloque `.pickers` del Artifact (modo + acento),
colapsado en un botón/icono en la cabecera de cada app que lo despliega
(no ocupa espacio permanente en pantallas pequeñas de tablet). Mismo JS
de `setMode`/`setAccent` + `localStorage` (`kairos_mode_pick`,
`kairos_theme_pick`) — persistencia por dispositivo/navegador, no por
usuario: ni el operario (sin login personal) ni la tienda (login LDAP
simple) tienen un perfil donde tenga sentido guardar esto en Supabase.

**Logos:** cabecera con badge Taisa + "×" + badge Leroy Merlin, igual que
el Artifact. Taisa: `_brand/taisa_logo_dark-bg_96h.png.b64.txt` /
`taisa_logo_light-bg_96h.png.b64.txt` (ya generados, elegir según modo
activo). Leroy Merlin: reutilizar el base64 ya incrustado en
`PreparacionPedidosPC/Logos.js` (mismo logo que usa el resto del
ecosistema, evita pedir la imagen de nuevo). Se sirven como
`data:image/png;base64,...` inline — no hay Drive ni fetch en runtime.

## Alcance por app

### kairos-operario (`Index.html`)

Reescribir CSS y clases de cada `render*()` al nuevo sistema, sin tocar
la lógica (`google.script.run`, `VISTA`, etc.):
- `renderElegirOperario` (selector de operario)
- `renderCola` (secciones Normal/Individual — Pieza 6)
- `renderDetalle`/`renderDetalleBody_`/`renderLineaHtml_` (líneas,
  incidencias, botones Sin Palet/Sin Mercancía/Otras Incidencias/Deshacer,
  vista "a ubicar")
- `renderStock`, `renderEstado` (3 caminos — Pieza 6), `renderPanel`
  (todas las peticiones, etiquetas HODOS, toggle individual — Pieza 5+6),
  `renderVolumenes` (tabla + gráfico — Pieza 6)
- `renderTabsBar_` (barra de pestañas: Peticiones/Stock/Estado/Panel/Volúmenes)

### kairos-portal (`Portal.html`)

- `renderEntrar`, `renderAlta`, `renderPendiente` (acceso)
- `renderCola` (mis peticiones)
- `renderNueva`/`renderFormulario` (alta de petición, buscador LM)
- `renderDetalle` (detalle + cruce HODOS)
- `renderTrazabilidad` (3 caminos — Pieza 6)
- `renderAdminLogin`/`renderAdmin` (aprobación de usuarios)

## Fuera de alcance

- Ninguna lógica de negocio, validación, llamada a `google.script.run` ni
  query a Supabase cambia.
- No se añade tema nuevo más allá de los 4 ya definidos en el Artifact.
- No se guarda la preferencia de tema en Supabase (solo `localStorage`).
- No se toca `PreparacionPedidosPC` ni ninguna otra app del ecosistema
  (salvo leer, no modificar, el logo LM de `Logos.js`).

## Archivos afectados

- `kairos-operario/Index.html` — CSS completo sustituido, clases de cada
  `render*()` actualizadas, botón/picker de tema añadido a la cabecera.
- `kairos-portal/Portal.html` — mismo tratamiento.
- Ningún archivo `.js` (servidor) cambia en ninguna de las dos apps.

## Riesgos / decisiones

- **Orden de ejecución:** `kairos-operario` primero (más pantallas, más
  reciente en memoria — Pieza 5/6 recién tocadas), `kairos-portal`
  después. Cada app se comitea y despliega (`clasp push` + `clasp deploy -i`
  a su URL estable) por separado, para poder verificar una sin bloquear
  la otra.
- **Verificación:** visual, igual que Pieza 5/6 — bloqueada por el mismo
  problema de acceso de dominio ya conocido salvo que se resuelva antes.
  Verificación mínima aceptable sin eso: revisar en el editor de Apps
  Script que el HTML generado no tiene errores de JS en consola
  (`javascript_tool`/`read_console_messages` si se logra abrir la webapp),
  y revisión manual del HTML/CSS por mi parte antes de desplegar.
- **Tamaño de la pieza:** toca cada pantalla de las dos apps — el plan
  debe ir tarea por tarea, pantalla por pantalla, no como un solo cambio
  monolítico, para poder verificar/revertir con granularidad.
