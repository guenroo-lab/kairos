# Cesión de palet entero

Fecha: 2026-10-07. Estado: implementado en local y probado; **sin desplegar** (a la espera del visto bueno del usuario).

## Qué se pidió

Las tiendas avisaron de que, al pedir una cesión y meter un LM, el portal no les deja elegir un palet (SSCC), como sí pasa en refill. Desde el 16/09 (commit fc883d2) la cesión y el pedido cliente solo piden unidades y el almacén asigna el palet al preparar; era una decisión consciente, no un fallo.

Decisión del usuario (2026-10-06): la cesión debe poder elegir **palets enteros, como el refill**, y solo para cesión (el pedido cliente no cambia).

## Cómo funciona

En el formulario de cesión, al elegir un artículo se abre el selector de palets de refill (SSCC, ubicación, unidades y todo lo que lleva cada palet). La tienda marca uno o varios palets y se ceden **enteros, con todo lo que llevan**, también las referencias que no pidió. El mismo selector tiene un botón, «Prefiero pedir unidades sueltas, sin elegir palet», que lleva a la pregunta de unidades de siempre: la cesión por unidades sigue disponible (la única cesión real hasta ahora, Marbella → Mijas, era de 1 unidad). Si el artículo no tiene ningún palet entero libre, se avisa y se pasa directamente a pedir unidades. También está «Buscar por SSCC en vez de LM», que enseña el contenido del palet y pide confirmarlo.

## Decisión de diseño: una línea de unidades por cada referencia del palet

El refill se lleva el palet entero con una sola línea y el operario lo mueve con `move-to-address`. La cesión no funciona así: al preparar la última línea, el operario dispara un traspaso de stock en myISO **por SSCC + código + cantidad** (`dispararTransfers_` en `kairos-operario/Index.html`). Una línea de «palet entero» con `unidad_medida = 'palet'` habría traspasado solo las unidades del LM pedido y dejado el resto del palet sin mover.

Por eso el servidor, al crear la cesión, convierte cada palet elegido en **una línea de unidades por cada referencia que lleva, con todas sus unidades y el palet ya fijado** (`sscc = "SSCC (Xud)"`, `ubicacion` del palet, `unidad_medida = 'ud'`). Para el resto del sistema son líneas de cesión normales:

- los traspasos de myISO mueven justo el contenido completo del palet;
- las reservas ven cada referencia comprometida al 100 % en ese palet (`_lineasComprometidasDe_`, `_paletsOcupados_`): nadie más puede cogerlo, ni otra cesión, ni un refill, y deja de ofrecerse en el selector;
- la app del operario, HODOS, Trazabilidad, Productividad y Edición no cambian. No hay migración de base de datos.

El operario ve varias líneas con el mismo SSCC y la misma ubicación (una por referencia del palet), cada una con sus unidades.

## Qué hace el servidor (`kairos-portal/Peticiones.js`)

- El formulario manda una línea por LM con `paletCompleto: true`, los palets en `sscc`/`ubicacion` (mismo formato que refill) y un `resumen` solo para pintar el chip. El servidor **no se fía de esas cifras**: vuelve a leer el contenido de los palets de `stock_fisico` en el momento de crear.
- `_resolverPaletsEnterosCesion_` comprueba con `_exigirPaletsLibres_` (el mismo control que refill; ahora con el nombre «la cesión» en los mensajes) que los palets existen, no están repetidos, no tienen nada reservado por otra petición y que llevárselos no deja sin stock a pedidos ya aceptados sin palet. Después los expande, en el orden del formulario: primero el artículo que buscó la tienda y luego el resto de más a menos unidades. Referencias repetidas en el mismo palet se suman y las filas a cero se ignoran. EAN, designación y sección salen del catálogo.
- `crearPeticion` coge el cerrojo de script también para la cesión con palets enteros (reserva palets como el refill). La cesión por unidades sueltas sigue sin cerrojo.
- La marca `paletCompleto` solo vale en cesión; en refill o pedido cliente no hace nada.

## Riesgos y límites

- Si el stock cambia entre que la tienda elige el palet y que el operario lo prepara (nueva carga de stock), pasa lo mismo que con cualquier línea con palet asignado: el operario puede usar «Cambiar palet» o registrar incidencia.
- Si Logística edita la cantidad de una de las líneas de una cesión así creada, esa línea pierde el palet asignado y el almacén la reasigna sola (comportamiento ya existente de `Edicion.js` para cesión); si quita una línea, el palet deja de salir entero. Es una edición deliberada de quien tiene el permiso.
- El operario marca varias líneas por palet en vez de una. Si resulta incómodo en la práctica, el siguiente paso sería agruparlas visualmente en la app del operario (no hace falta para que sea correcto).
- Las cesiones antiguas (por unidades) no se tocan.

## Verificación

- `test/cesionPaletEntero.test.js` (20 pruebas, `node --test` desde la raíz): carga el código real del portal con una base de datos en memoria que interpreta las consultas reales (filtros, `in.()`, paginación, cruces con `peticiones`, proyección de columnas). Cubre la expansión, varios palets, cifras falsas del formulario, catálogo incompleto, reservas por pedido cliente/refill/anulada, palet inexistente/ajeno/repetido/vacío, el control de stock de otros pedidos, el palet reservado después de crear (otra cesión, refill, selector, stock comprometido), el cerrojo y que refill y la cesión por unidades no cambian. 16 mutaciones del servidor, todas detectadas.
- Formulario real (`Portal.html`) en Chrome headless con `google.script.run` simulado, 11 escenarios (selector, unidades sueltas, sin palets libres, SSCC, no repetir palets, cancelar, quitar, error al enviar, aviso de duplicado, refill y pedido cliente sin cambios). 10 mutaciones del formulario, todas detectadas. Capturas a 390 px: el selector y el chip se ven completos.
- Guardián de HtmlService (sin `/*` dentro de cadenas, 8 scripts parseables).
- Pendiente tras desplegar: una cesión real de prueba con un palet de una tienda (ver que las líneas salen bien en la app del operario y en Trazabilidad) y anularla.

## Despliegue (no hecho)

Solo `kairos-portal` (archivos `Peticiones.js` y `Portal.html`). Método seguro del proyecto: `clasp pull --versionNumber <la de producción>` a una carpeta aparte, copiar encima solo estos dos archivos, `clasp push --force`, `clasp version` y `clasp deploy -i <deployment de producción> -V <n>`, y verificar con otro pull que solo cambian esos dos archivos. Vuelta atrás: volver a desplegar la versión anterior del portal (`deploy -i … -V <anterior>`). `kairos-operario` y Supabase no se tocan.
