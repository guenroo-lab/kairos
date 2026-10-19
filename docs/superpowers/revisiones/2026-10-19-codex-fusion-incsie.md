<!-- Informe de Codex (solo lectura) del 19/10/2026 sobre cómo fusionar INCSIE en Kairos. Lo lanzó Claude con el encargo Kairos/…/prompt de la sesión; no se ha editado. Tres cosas a tener en cuenta al leerlo: (1) dice que el mensual puede mandar «cifras cero engañosas» si falla la hoja de operaciones: en el código, con 0 SIE recibidas el informe enseña «N/D» y no calcula ratio, así que no engaña; (2) lo del Hub y los despliegues no se ha comprobado; (3) la recomendación por fases coincide con la de Claude. -->

# Integrar Incidencias SIE en Kairos

**Recomendación: un camino por fases.** Kairos debería convertirse en la pantalla habitual para registrar y consultar incidencias SIE, mientras INCSIE conserva inicialmente el Sheet, las fotos en Drive y los informes. Es la forma de reunir la operativa sin cortar los correos ni el histórico. Este análisis procede del código local; no he comprobado los despliegues, permisos ni datos vivos.

## A. Arquitectura

| Opción | Coste y riesgo | Consecuencia |
|---|---|---|
| **1. INCSIE como motor permanente** | Menor trabajo inicial; mantiene dos proyectos | Conserva las hojas, fotos e informes. Habría que añadir una vía para que Kairos registre y consulte incidencias: hoy INCSIE solo sirve su propia pantalla y recibe llamadas de ella mediante `google.script.run` ([Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:85), [index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:468)). |
| **2. Migrar ya a Supabase y kairos-sync** | Mayor coste y riesgo | Exige trasladar histórico, rehacer informes y adaptar Argos. Guardar fotos en Supabase agravaría el consumo de tráfico; Drive seguiría siendo necesario. |
| **3. Por fases — recomendada** | Cambio controlable | Kairos usa primero el registro existente; solo se retira INCSIE cuando datos, correos y consumidores externos tengan sustituto probado. |

Argos **lee directamente** las pestañas «Registros Marbella» y «Registros Mijas», sus cuatro primeras columnas y los nombres de tienda; además calcula actividad por operario ([Con_IncSie.gs](/C:/Users/30081048/Desktop/Proyectos/Argos/src/Con_IncSie.gs:47)). Por eso mantendría esas pestañas y columnas durante la transición. Conservaría también las aproximadamente 300 filas y sus enlaces a fotos, sin mover archivos de Drive. El enlace del Hub puede apuntar a Kairos cuando la captura funcione, dejando la URL antigua disponible durante el cambio.

## B. Qué gana la operativa

Al escanear un SSCC, Kairos puede **proponer** tienda, ubicación y artículos desde `preparacion.stock_fisico`: su carga contiene tienda, SSCC, ubicación y código LM del edificio 05 ([StockFisicoLoader.js](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-sync/StockFisicoLoader.js:107)). Debe mostrar la fecha del dato y pedir confirmación: es una fotografía periódica del inventario, no una prueba de qué ha llegado en ese instante. La lista «SIE por ubicar» ya aporta ubicación RC2 y artículos desde CSV ([Sie.js](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario/Sie.js:1)).

Sería útil abrir desde la incidencia una revisión del **mismo SSCC**, o consultar el palé y su carga en HODOS cuando exista coincidencia. HODOS enlaza palés con cargas mediante `batea_id` ([EstructuraPaletes.gs](/C:/Users/30081048/Desktop/Proyectos/hodos/EstructuraPaletes.gs:99)). No asumiría que toda incidencia de recepción corresponde a una carga de HODOS. Tampoco mezclaría sin más estas incidencias con la pestaña «Incidencias» del portal: aquella trata problemas de **preparación de pedidos** ([kairos-portal/Incidencias.js](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal/Incidencias.js:1)). Una vista específica para tienda tendría sentido si las tiendas van a responder o consultar evidencias; requiere acordar qué pueden ver.

## C. Pantallas

Tras elegir tienda, añadiría **«SIE»** como una entrada del menú de operario, con dos acciones principales: **«Registrar incidencia»** y **«Pendientes por ubicar»**. Mantendría «Ocupación SIE» en la pantalla anterior: registra ambas tiendas a la vez y hoy se abre sin elegir ninguna ([Index.html](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario/Index.html:709)). Para el jefe, agruparía las pestañas actuales «SIE por ubicar» y «Ocupación SIE» con **«Incidencias de recepción»** bajo una sección SIE; la vista inicial mostraría pendientes e incidencias recientes por tienda. «Ubicar» debe significar aquí **consultar el pendiente**: el listado desaparece cuando cambia el CSV de MyISO, y el código de Kairos no registra una ubicación nueva ([Index.html](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario/Index.html:1710)).

## D. Escáner y fotos

Se puede trasladar la lectura por **foto del código** con `BarcodeDetector` y respaldo ZXing; el CDN debe probarse en los móviles y red de la nave, manteniendo entrada manual ([index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:326)). En el iframe de Apps Script usaría `input type="file" capture="environment"`, no vídeo continuo. Kairos ya comprime y sube fotos de revisiones a Drive, con validación de tipo y tamaño en servidor ([Revisiones.js](/C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario/Revisiones.js:78)). Adaptaría ese patrón a la carpeta SIE, comprobando el permiso de la cuenta que publica Kairos. La foto debe enviarse reducida y con un límite medido para el argumento de `google.script.run`; no conviene prometer un tamaño máximo sin probar dispositivos reales.

## E. Riesgos concretos del código

- **Fechas e informes:** el móvil envía una fecha localizada como texto; el diario la compara por igualdad con otra fecha localizada, y el mensual intenta convertir ese texto con `new Date`, que puede interpretar mal `dd/MM/yyyy` ([index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:459), [Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:250), [Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:503)). Usaría el timestamp ISO y una zona horaria fija para seleccionar días y meses, tras comprobar cómo están tipadas las filas históricas. El lunes solo busca el viernes: una incidencia del fin de semana quedaría fuera del diario ([Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:242)).
- **Integridad:** el servidor acepta tienda, operario, tipo y SSCC sin validarlos; una tienda desconocida puede crear otra pestaña. Sube la foto **antes** de añadir la fila, de modo que un fallo deja una foto huérfana; no hay identificador de registro ni protección ante reintentos o creación concurrente de carpetas ([Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:124), [Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:157)). Añadiría validación, identificador único y control de reintentos.
- **Pruebas y cuotas:** `testReporteAhora()` y `testInformeMensualAhora()` llaman a los envíos **reales**; en este código no hay `MODO_PRUEBA` operativo ([Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:447), [Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:857)). Revisaría destinatarios y cuota de correo antes de cambiar disparadores. El mensual transforma fallos de lectura de operaciones en `{}` y podría mandar cifras cero engañosas ([Codigo.gs](/C:/Users/30081048/Desktop/Proyectos/INCSIE/Codigo.gs:455)). La compresión real es **600 px y calidad 0,4**, pese a la llamada con 1024 px ([index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:414)). Sus `confirm()` y `prompt()` nativos deben sustituirse por controles de Kairos ([index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:379)).

## F. Orden y vuelta atrás

1. **Fijar la referencia:** inventariar hojas, enlaces, carpetas, destinatarios, permisos y disparadores; comparar una muestra de filas con Argos. Preparar copias y una vía de pruebas que no envíe correo.
2. **Incorporar captura en Kairos:** probar escáner, foto, validación y reintentos con registros de prueba separados. Generar los informes como vista previa o enviarlos únicamente a Pedro desde una copia; no ejecutar las funciones `test*` actuales.
3. **Cambiar la entrada habitual:** escribir en las mismas hojas y carpetas mediante un único motor; comprobar registros de ambos móviles, informe diario y mensual, y lectura de Argos. Si falla, volver a enlazar la pantalla antigua; conservar **un solo proceso de informes**.
4. **Añadir consultas y enlaces por SSCC; decidir retirada:** cambiar el Hub tras formar a los usuarios. Retirar INCSIE solo cuando otra pieza asuma también los informes y Argos esté adaptado. Hasta entonces, mantener su motor aunque la pantalla antigua deje de anunciarse.

## G. Algo fácil de olvidar

El historial visible en la pantalla INCSIE está en `localStorage`: **no es el histórico compartido del Sheet** ([index.html](/C:/Users/30081048/Desktop/Proyectos/INCSIE/index.html:516)). Hay que preservar comentarios, ceros iniciales del SSCC, acceso de tiendas y mandos a las fotos, listas de tipos y personas, y el permiso del propietario de Drive y de los disparadores. Elegir un nombre en Kairos identifica la operación, pero **no autentica** a la persona; las acciones sensibles de jefe necesitarían una comprobación propia.

### Decisiones que debe tomar Pedro

1. ¿Deben registrarse también las incidencias del sábado y domingo en el correo del lunes?
2. ¿Qué personas de cada tienda deben poder ver incidencias y fotos desde Kairos?
3. ¿Debe ser obligatoria la foto para algún tipo de incidencia?
4. ¿Quién mantendrá la lista de destinatarios, tipos y responsables del SIE?
5. ¿Qué significa «ubicar» en esta primera integración: ver el pendiente o registrar el cambio de ubicación?
