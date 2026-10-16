# Ocupación SIE dentro de Kairos y Centinela — diseño

Fecha: 2026-10-16 · Pedido por Pedro Gil · Estado: **desplegado el 16/10: motor @27, Kairos operario v83 y Centinela v81; falta la prueba real**

## Qué se quiere

1. El **operario** (Kairos) registra la ocupación del almacén SIE de Mijas y Marbella y, al guardar, salen los
   informes (los 3 correos de siempre).
2. El **jefe de equipo** ve los volúmenes de almacenamiento desde su pantalla de Kairos y desde Centinela.

## Decisión de diseño

No se reescribe nada. La app **Ocupación Tiendas SIE** (`Desktop\Proyectos\OcupacionTiendas`, en producción desde el
01/09, deployment `AKfycbw1ssfs…` @26) sigue siendo el **motor**: su Sheet (`Registro Semanal`, `Configuración`), el
trigger de 5 min, los umbrales 70/90 y los 3 correos con TO/CC ya están probados. Kairos y Centinela son pantallas
nuevas que le hablan por HTTP, igual que Centinela ya habla con HODOS (`Bearer ScriptApp.getOAuthToken()`).

```
Operario Kairos ──POST registrar/corregir──┐
Jefe Kairos ─────GET  ?accion=ocupacion────┼─► Ocupación Tiendas (motor) ─► Sheet ─► trigger 5 min ─► 3 correos
Jefe Centinela ──GET  ?accion=ocupacion────┘
Tu app antigua (Index.html) ─ sigue igual ─► mismo Sheet
```

Por qué así: reutiliza el envío ya verificado con correo real, no hay migración de datos, no se toca Supabase
(egress del plan Free) y la app antigua sigue valiendo (escribe en el mismo Sheet, no hay doble envío).

Comprobado el 16/10: `Código.js`, `WebApp.js` e `Index.html` locales == versión @26 desplegada == HEAD.

## Motor (OcupacionTiendas) — fichero nuevo `Api.js` + 4 líneas en `doGet`

Solo se **añade**. `soloGuardarDatos`, `procesarEnvioPendiente` y `enviarCorreos` no se tocan (la app antigua usa el
mismo camino de siempre).

- `doGet(e)`: si `e.parameter.accion === 'ocupacion'` devuelve JSON (`leerOcupacion_()`); si no, el HTML de siempre.
- `doPost(e)` (JSON): `accion` = `registrar` | `corregir`.
- **leer** → `{ok, ahora, modoTest, config:{totalMijas,totalMarbella}, historial:[…últimas 52 filas…]}`. Cada fila:
  `fila, semana, fecha, hora, libresMijas, libresMarbella, ocupadosMijas/Marbella, pctMijas/Marbella, nivelMijas/Marbella`
  (`bajo <40`, `normal <70`, `alto <90`, `critico ≥90`, sobre el % redondeado, igual que los correos), `estado`
  (PENDIENTE/ENVIADO/ERROR/CADUCADO), `registradoPor`, `origen`. Las filas de teclado raro (no numéricas) se saltan.
- **registrar** `{idRegistro, libresMijas, libresMarbella, registradoPor, origen}`:
  valida enteros ≥ 0 y ≤ capacidad (y capacidad ≥ 50, la misma guarda que el envío); es **idempotente** por
  `idRegistro` (CacheService 6 h: un doble toque o un reintento NO duplica fila ni correos); escribe la fila A–G
  exactamente como `soloGuardarDatos` (PENDIENTE, fecha real) y añade `H = Registrado por`, `I = Origen`
  (cabeceras creadas la primera vez). Todo bajo el mismo `LockService` que usa el trigger.
- **corregir** `{idRegistro, libresMijas, libresMarbella}`: solo si esa fila sigue `PENDIENTE` (el trigger la envía en
  ≤ 5 min); si ya salió devuelve `{ok:false, motivo:'ya_enviado'}` y no toca nada.
- Sin token compartido: el web app ya es solo del dominio y la app antigua guarda sin más control que ese. El
  anotar quién registra cada fila (columna H) deja rastro.

## Kairos — operario

- 4.º botón del menú «📊 Ocupación SIE» (con «Último registro: dd/MM»; en ámbar si pasan ≥ 4 días).
- Pantalla `ocupacion` (operario): dos números (libres Mijas / libres Marbella) con la capacidad y el último dato como
  ayuda → **«Revisar»** → pantalla de confirmación dentro de la propia página (sin `confirm()`): % y nivel resultantes,
  aviso «se enviarán 3 informes a los responsables…», aviso rojo si ya hay un registro **de hoy** → **«Guardar y
  enviar informes»** → «Registrado, los informes salen en unos minutos» con **«Corregir»** mientras siga en cola.
- Banner «MODO PRUEBAS» si el motor está en TEST (los informes solo llegan a Pedro).
- Servidor (`Ocupacion.js`): `obtenerOcupacionSie`, `registrarOcupacionSie`, `corregirOcupacionSie`. URL del motor en
  la constante `OCUPACION_URL_POR_DEFECTO_` (se puede sustituir con la propiedad `OCUPACION_WEBAPP_URL`). Lectura con
  caché de 60 s, que se invalida al registrar/corregir.

## Kairos — jefe de equipo (`?modo=jefe`)

Pestaña nueva «Ocupación SIE» (tras «SIE por ubicar»), solo lectura: una tarjeta por tienda (% grande, nivel, barra,
ocupados/libres de capacidad, variación y tendencia), gráfico de evolución con las líneas del 70 % y 90 %, tabla de los
últimos registros (quién, cuándo, estado del envío). Se refresca con «Actualizar» y cada 5 min.

## Centinela — jefe de equipo

Pestaña «Ocupación SIE» de solo lectura con el mismo contenido (`OcupacionSie.gs` + `OcupacionSieUI.html`), usando
`CONFIG.OCUPACION_SIE_URL`. Si a la cuenta del jefe le falta el permiso, se le da el enlace de autorización como en
la pestaña de HODOS.

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Correos reales a los mandos de LM | No se toca el envío. Confirmación con % antes de guardar, idempotencia, «Corregir» antes de los 5 min. Primera prueba real en modo PRUEBAS. |
| Kairos no tiene login | Se anota quién registra (H) y desde dónde (I). Misma exposición que la app antigua (dominio). |
| Un dato absurdo | Rango 0…capacidad en cliente **y** servidor. |
| Registro doble el mismo día (martes/viernes) | Aviso rojo en la confirmación si ya hay uno de hoy. |
| La URL del motor cambia | Constante + propiedad que la sustituye. |
| `salvador.gonzalez22@` (B6) sin confirmar | Fuera de alcance; sigue pendiente con Pedro. |

## Despliegue (NADA hecho; cada paso pide el OK de Pedro)

Orden: 1) motor → 2) Kairos operario → 3) Centinela. Antes de cada `clasp push`: `clasp pull --versionNumber <viva>` a
una carpeta aparte y diff contra el local. Vuelta atrás: motor `clasp deploy -i AKfycbw1ssf…VdPcTRZ1g -V 26`; Kairos
operario `-V 82`; Centinela `-V 80`. El motor no necesita permisos nuevos (CacheService/ContentService no los piden).
Prueba real: con el Sheet en modo PRUEBAS (`Configuración!B14`), registrar desde Kairos y comprobar que el correo solo
llega a Pedro; después, volver a PRODUCCION.

## Verificación hecha (16/10/2026, sin desplegar)

Motor 31 pruebas / 24 mutaciones; Kairos 35 / 36; Centinela 15 / 24 (todas detectadas). Pantallas vistas en Chrome con el
`Index.html` real y un motor simulado (móvil de 390 px, escritorio, claro y oscuro). **No probado**: la llamada real con
Bearer al web app del motor (URL `/macros/s/<id>/exec`, la misma forma que ya funciona con HODOS), el envío de correos
desde una fila creada por la API (el trigger real solo se ha probado contra el simulador) y el aspecto dentro del
cascarón real de Centinela. Plan y orden de despliegue: `docs/superpowers/plans/2026-10-16-ocupacion-sie.md`.

## Fuera de alcance

Desglose por zona o pasillo, contar una sola tienda por registro (las dos a la vez, como hoy), recordatorio por correo,
migrar el histórico a Supabase, retirar la app antigua.
