# Pieza 3 · App de operario — Plan de implementación

> **Para ejecución agéntica:** este proyecto NO tiene framework de test (ya
> confirmado en Piezas 1 y 2 — Apps Script + Supabase, sin runner). Los pasos
> "test" de la plantilla estándar se sustituyen por **verificación en vivo**:
> `execute_sql` contra Supabase real y prueba manual del deploy real. Ejecutar
> con **superpowers:executing-plans** en esta misma sesión, tarea por tarea,
> **sin subagentes** (instrucción explícita del usuario, en vigor desde Pieza 2).

**Goal:** app Apps Script `kairos-operario` — cola de peticiones pendientes,
detalle con checkbox "preparada" por línea, pantalla "a ubicar" para
consolidación, y disparo automático de etiqueta HODOS para pedido_cliente sin
transporte y para cesión.

**Architecture:** mismo patrón que `kairos-portal` (Pieza 2): HtmlService +
cliente REST Supabase propio (`service_role` key), sin login LDAP —
identificación por desplegable de operario. Sin scriptlets `<?= ?>` (no hace
falta parámetro admin) — usar `createHtmlOutputFromFile` plano, evita el
[[gotcha-gas-htmltemplate-scriptlet-booleano-como-string]] de raíz.

**Tech Stack:** Google Apps Script (V8), HtmlService, `clasp`, Supabase
PostgREST (esquema `preparacion` + lectura de `public.etiquetas` no hace
falta aquí — solo escritura vía webapp HODOS).

---

## Estructura de ficheros

```
kairos-operario/
  appsscript.json     — manifest (sin oauthScopes explícito, igual que PreparacionPedidosPC)
  Config.js            — CFG: URL Supabase, esquemas, mapa tiendas + colores
  Supabase.js           — cliente REST (copia literal de kairos-portal/Supabase.js)
  Utils.js               — _json_ (copia literal de kairos-portal/Utils.js)
  Operarios.js            — listarOperarios()
  Cola.js                  — listarCola(filtroTienda, filtroTipo)
  Peticion.js               — obtenerPeticion, marcarLineaPreparada, guardarUbicacionConsolidacion
  Hodos.js                   — _dispararEtiquetaSiProcede_, _enviarEtiquetaHodos_
  Codigo.js                   — doGet
  Index.html                   — UI completa (router cola/detalle), un solo fichero
```

---

## Task 0: Rama de trabajo

- [ ] **Paso 1: Crear rama**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos"
git checkout -b pieza-3-app-operario
```

---

## Task 1: Scaffold del proyecto Apps Script

**Files:**
- Create: `kairos-operario/appsscript.json`
- Create: `kairos-operario/Config.js`

- [ ] **Paso 1: Crear carpeta y manifest**

```bash
mkdir "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
```

`kairos-operario/appsscript.json`:

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "access": "DOMAIN", "executeAs": "USER_DEPLOYING" }
}
```

Sin `oauthScopes` explícito (a diferencia de `kairos-portal`): esta app llama
`UrlFetchApp` a Supabase **y** a HODOS con `ScriptApp.getOAuthToken()` (Task 5)
— mismo patrón que `PreparacionPedidosPC/appsscript.json`, que ya funciona en
producción con ambos usos. Dejar el manifest sin la clave para que Apps
Script calcule los scopes automáticamente.

- [ ] **Paso 2: Config.js**

`kairos-operario/Config.js`:

```js
/** Configuración de Kairos Operario. Secretos en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SCHEMA_PREP: 'preparacion',
  // SUPABASE_SERVICE_KEY, HODOS_WEBAPP_URL, INCPC_SHARED_TOKEN -> Propiedades del script (no se versionan)
  TIENDAS: { '014': 'Marbella', '279': 'Mijas', '036': 'Málaga' },
  TIENDA_COLOR: { '036': '#2e7d32', '014': '#1565c0', '279': '#6a1b9a' },
};
```

Colores por [[lm-malaga-colores-por-tienda]] (Málaga verde, Marbella azul,
Mijas morado).

- [ ] **Paso 3: Crear proyecto Apps Script con clasp**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp create --type webapp --title "Kairos Operario" --rootDir .
```

Anotar el `scriptId` generado (queda en `.clasp.json`) para el README.

- [ ] **Paso 4: Commit**

```bash
git add kairos-operario/appsscript.json kairos-operario/Config.js kairos-operario/.clasp.json
git commit -m "feat(operario): scaffold proyecto Apps Script kairos-operario"
```

---

## Task 2: Copiar helpers comunes de kairos-portal

**Files:**
- Create: `kairos-operario/Supabase.js` (copia de `kairos-portal/Supabase.js`)
- Create: `kairos-operario/Utils.js` (copia de `kairos-portal/Utils.js`)

- [ ] **Paso 1: Copiar Supabase.js literal**

```bash
cp "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-portal\Supabase.js" "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario\Supabase.js"
```

Contenido esperado (verificar que coincide, sin modificar):

```js
/** Cliente REST mínimo de Supabase (PostgREST), multi-esquema
 *  (preparacion / public) con la service_role key. */

function _supaKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeaders_(metodo, schema) {
  const key = _supaKey_();
  const h = { apikey: key, Authorization: 'Bearer ' + key };
  if (metodo === 'GET') {
    h['Accept-Profile'] = schema;
  } else {
    h['Content-Profile'] = schema;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

function _supaFetch_(metodo, tabla, queryString, payload, schema) {
  schema = schema || CFG.SCHEMA_PREP;
  var url = CFG.SUPABASE_URL + '/rest/v1/' + tabla;
  if (queryString) url += '?' + queryString;
  const headers = _supaHeaders_(metodo, schema);
  if (payload !== undefined) headers['Prefer'] = 'return=representation';
  const opciones = { method: metodo.toLowerCase(), headers: headers, muteHttpExceptions: true };
  if (payload !== undefined) opciones.payload = JSON.stringify(payload);
  const resp = UrlFetchApp.fetch(url, opciones);
  if (resp.getResponseCode() >= 300) {
    throw new Error('Supabase ' + metodo + ' ' + tabla + ' ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  const texto = resp.getContentText();
  return texto ? JSON.parse(texto) : null;
}

function supaSelect_(tabla, queryString, schema) {
  return _supaFetch_('GET', tabla, queryString, undefined, schema);
}
function supaInsert_(tabla, fila, schema) {
  const filas = _supaFetch_('POST', tabla, '', fila, schema);
  if (!filas || !filas.length) throw new Error('Supabase insert en "' + tabla + '" no devolvió ninguna fila.');
  return filas[0];
}
function supaInsertMany_(tabla, filas, schema) {
  return _supaFetch_('POST', tabla, '', filas, schema);
}
function supaUpdate_(tabla, queryString, cambios, schema) {
  return _supaFetch_('PATCH', tabla, queryString, cambios, schema);
}
function supaDelete_(tabla, queryString, schema) {
  return _supaFetch_('DELETE', tabla, queryString, {}, schema);
}
```

(Se omite `test_supaSmoke` del portal — no hace falta duplicar.)

- [ ] **Paso 2: Copiar Utils.js literal**

`kairos-operario/Utils.js`:

```js
/** google.script.run devuelve null en silencio si el objeto lleva un Date
 *  embebido. Workaround: el servidor siempre stringify, el cliente parsea. */
function _json_(obj) {
  return JSON.stringify(obj);
}
```

- [ ] **Paso 3: Deploy de prueba y smoke test**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push
```

En Propiedades del script (editor de Apps Script), añadir
`SUPABASE_SERVICE_KEY` (mismo valor legacy JWT `service_role` que usa
`kairos-portal` y `kairos-sync` — ver [[gotcha-supabase-secret-key-bloquea-urlfetchapp]]).

Ejecutar desde el editor una función temporal `function _smoke() { Logger.log(supaSelect_('tiendas', 'select=codigo&limit=1')); }`
para confirmar que el fetch a Supabase funciona antes de seguir. Borrarla
después (no se commitea).

- [ ] **Paso 4: Commit**

```bash
git add kairos-operario/Supabase.js kairos-operario/Utils.js
git commit -m "feat(operario): helpers Supabase/Utils (copiados de kairos-portal)"
```

---

## Task 3: Listado de operarios

**Files:**
- Create: `kairos-operario/Operarios.js`

- [ ] **Paso 1: Implementar**

```js
function listarOperarios() {
  const filas = supaSelect_('operarios', 'activo=eq.true&select=nombre,color&order=nombre.asc');
  return _json_(filas);
}
```

- [ ] **Paso 2: Verificar en vivo**

```bash
clasp push
```

Ejecutar `listarOperarios` desde el editor Apps Script (Ejecutar función →
ver registro). Confirmar que devuelve los operarios sembrados en Pieza 1
(`execute_sql` sobre `preparacion.operarios` si hace falta comparar).

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Operarios.js
git commit -m "feat(operario): listarOperarios"
```

---

## Task 4: Cola de peticiones

**Files:**
- Create: `kairos-operario/Cola.js`

- [ ] **Paso 1: Implementar**

```js
function listarCola(filtroTienda, filtroTipo) {
  var q = 'estado=in.(pendiente,en_preparacion)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,transporte,motivo,creada_en' +
    '&order=creada_en.asc&limit=200';
  if (filtroTienda) q += '&tienda_origen=eq.' + encodeURIComponent(filtroTienda);
  if (filtroTipo) q += '&tipo=eq.' + encodeURIComponent(filtroTipo);

  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,estado_preparacion');

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.tiendaDestinoNombre = p.tienda_destino ? (CFG.TIENDAS[p.tienda_destino] || p.tienda_destino) : null;
  });

  return _json_(peticiones);
}
```

- [ ] **Paso 2: Verificar en vivo**

```bash
clasp push
```

Crear una petición de prueba directamente vía `execute_sql` (o desde el
portal ya desplegado) y confirmar que `listarCola()` la devuelve con
`totalLineas`/`lineasPreparadas` correctos.

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Cola.js
git commit -m "feat(operario): listarCola con filtros tienda/tipo"
```

---

## Task 5: Disparo de etiqueta HODOS

**Files:**
- Create: `kairos-operario/Hodos.js`

- [ ] **Paso 1: Implementar**

```js
/** ===================== INTEGRACIÓN HODOS =====================
 * Mismo patrón que PreparacionPedidosPC/PreparacionBackend.js
 * (_intentarCrearEtiquetaHodos_): pedido_cliente SIN transporte, y toda
 * cesión, necesitan una etiqueta HODOS "Petición Reserva" para llegar a la
 * tienda — se crea UNA sola etiqueta por petición completa en cuanto se
 * cierra su última línea. Aquí el idUnico se guarda en lineas.hodos_id
 * (mismo campo en todas las líneas de la petición), ya existente desde
 * Pieza 1 — no hace falta columna nueva.
 */

const SUBTIPO_HODOS_PREPARACION_ = 'Petición Reserva';

function _dispararEtiquetaSiProcede_(peticionId) {
  try {
    const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId));
    if (!cab.length) return;
    const peticion = cab[0];
    if (peticion.estado !== 'cerrada') return; // pedido aún no completo

    const generaEtiqueta = (peticion.tipo === 'pedido_cliente' && !peticion.transporte) || peticion.tipo === 'cesion';
    if (!generaEtiqueta) return;

    const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId));
    if (!lineas.length) return;
    if (lineas.some(function (l) { return l.hodos_id; })) return; // ya se creó (reintentos/carreras)

    const destino = peticion.tipo === 'cesion'
      ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino)
      : (CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen);

    const idUnico = _enviarEtiquetaHodos_({
      destino: destino,
      pedido: peticion.num_pedido || null,
      tipo: SUBTIPO_HODOS_PREPARACION_,
      origenIntegracion: 'preparacion',
      operario: (lineas[0].operario || ''),
      items: lineas.map(function (l) { return { referencia: String(l.codigo_lm), cantidad: Number(l.cantidad) }; }),
    });

    supaUpdate_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId), { hodos_id: idUnico });
  } catch (err) {
    // No debe romper el marcado de línea (ya guardado) — solo se pierde la
    // etiqueta HODOS; reintentable (hodos_id queda vacío, sin bloqueo).
    console.error('_dispararEtiquetaSiProcede_ (' + peticionId + '): ' + err.message);
  }
}

function _enviarEtiquetaHodos_(payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('HODOS_WEBAPP_URL');
  const token = props.getProperty('INCPC_SHARED_TOKEN');
  if (!url || !token) throw new Error('Faltan HODOS_WEBAPP_URL o INCPC_SHARED_TOKEN en Propiedades del script.');

  payload.token = token;

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  const texto = resp.getContentText();
  let json;
  try {
    json = JSON.parse(texto);
  } catch (eParse) {
    throw new Error('Respuesta no válida de HODOS (¿problema de autenticación?): ' + texto.substring(0, 200));
  }
  if (!json.ok) throw new Error('HODOS rechazó la etiqueta: ' + json.error);
  return json.idUnico;
}
```

- [ ] **Paso 2: Propiedades del script**

Añadir en Propiedades del script (editor Apps Script): `HODOS_WEBAPP_URL` e
`INCPC_SHARED_TOKEN` — mismos valores que ya usa `PreparacionPedidosPC` (ver
sus Propiedades del script en el editor, o `INCPC` — copiar tal cual, son
compartidos entre las apps del ecosistema).

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Hodos.js
git commit -m "feat(operario): disparo etiqueta HODOS para pedido_cliente sin transporte y cesion"
```

(Verificación end-to-end de este disparo se hace en Task 8, integrada con
`marcarLineaPreparada`.)

---

## Task 6: Detalle de petición y acciones de operario

**Files:**
- Create: `kairos-operario/Peticion.js`

- [ ] **Paso 1: Implementar**

```js
function obtenerPeticion(peticionId) {
  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId));
  if (!cab.length) throw new Error('Petición no encontrada.');
  const peticion = cab[0];
  peticion.tiendaNombre = CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen;
  peticion.tiendaDestinoNombre = peticion.tienda_destino ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino) : null;

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  return _json_({ peticion: peticion, lineas: lineas });
}

function marcarLineaPreparada(lineaId, operarioNombre) {
  operarioNombre = String(operarioNombre || '').trim();
  if (!operarioNombre) throw new Error('Selecciona tu nombre antes de preparar líneas.');

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    estado_preparacion: 'preparado',
    estado_negocio: 'Preparado',
    operario: operarioNombre,
    preparada_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');

  _dispararEtiquetaSiProcede_(filas[0].peticion_id);

  return _json_({ ok: true });
}

function guardarUbicacionConsolidacion(peticionId, ubicacion) {
  ubicacion = String(ubicacion || '').trim();
  if (!ubicacion) throw new Error('Falta la ubicación de consolidación.');

  const filas = supaUpdate_('peticiones', 'id=eq.' + encodeURIComponent(peticionId), {
    ubicacion_consolidacion: ubicacion,
  });
  if (!filas.length) throw new Error('Petición no encontrada.');
  return _json_({ ok: true });
}
```

- [ ] **Paso 2: Verificar en vivo**

```bash
clasp push
```

Desde el editor, ejecutar `obtenerPeticion('<id-de-prueba>')` sobre la
petición creada en Task 4. Confirmar estructura `{peticion, lineas}`.

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Peticion.js
git commit -m "feat(operario): obtenerPeticion, marcarLineaPreparada, guardarUbicacionConsolidacion"
```

---

## Task 7: doGet

**Files:**
- Create: `kairos-operario/Codigo.js`

- [ ] **Paso 1: Implementar**

```js
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Kairos · Operario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
```

Sin `createTemplateFromFile`/scriptlets — no hay flag admin que inyectar, así
que no hace falta plantilla (evita de raíz el gotcha de Pieza 2).

- [ ] **Paso 2: Commit**

```bash
git add kairos-operario/Codigo.js
git commit -m "feat(operario): doGet"
```

---

## Task 8: UI — Index.html

**Files:**
- Create: `kairos-operario/Index.html`

- [ ] **Paso 1: Implementar**

`kairos-operario/Index.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; background: #f5f5f5; }
    h1 { font-size: 20px; margin: 0 0 16px; }
    select, input, button { font-size: 16px; padding: 8px; margin: 4px 0; }
    button { cursor: pointer; background: #1565c0; color: white; border: none; border-radius: 4px; padding: 10px 16px; }
    button.secundario { background: #757575; }
    .fila { background: white; border-radius: 6px; padding: 12px; margin-bottom: 8px; cursor: pointer; border-left: 6px solid #ccc; }
    .fila .tipo { font-weight: bold; }
    .fila .meta { color: #666; font-size: 13px; }
    .linea { background: white; border-radius: 6px; padding: 10px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
    .linea.preparada { opacity: 0.5; }
    .linea label { flex: 1; }
    .filtros { margin-bottom: 12px; }
    .volver { margin-bottom: 12px; display: inline-block; }
    #operarioBar { background: #fff3e0; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
    #app { max-width: 480px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="app">Cargando…</div>

  <script>
    var OPERARIO = localStorage.getItem('kairos_operario') || '';
    var VISTA = { nombre: 'cola', peticionId: null };

    function render() {
      if (!OPERARIO) return renderElegirOperario();
      if (VISTA.nombre === 'cola') return renderCola();
      if (VISTA.nombre === 'detalle') return renderDetalle();
    }

    function renderElegirOperario() {
      document.getElementById('app').innerHTML = '<h1>Kairos · Operario</h1><p>¿Quién eres?</p><select id="selOperario"><option value="">Cargando…</option></select>';
      google.script.run.withSuccessHandler(function (json) {
        const operarios = JSON.parse(json);
        const sel = document.getElementById('selOperario');
        sel.innerHTML = '<option value="">-- elige --</option>' +
          operarios.map(function (o) { return '<option value="' + o.nombre + '">' + o.nombre + '</option>'; }).join('');
        sel.onchange = function () {
          if (!sel.value) return;
          OPERARIO = sel.value;
          localStorage.setItem('kairos_operario', OPERARIO);
          render();
        };
      }).listarOperarios();
    }

    function renderCola() {
      document.getElementById('app').innerHTML =
        '<h1>Kairos · Operario</h1>' +
        '<div id="operarioBar">' + OPERARIO + ' — <a href="#" id="cambiarOperario">cambiar</a></div>' +
        '<div class="filtros">' +
        '<select id="filtroTienda"><option value="">Todas las tiendas</option><option value="014">Marbella</option><option value="279">Mijas</option><option value="036">Málaga</option></select> ' +
        '<select id="filtroTipo"><option value="">Todos los tipos</option><option value="pedido_cliente">Pedido cliente</option><option value="cesion">Cesión</option><option value="refill">Refill</option></select>' +
        '</div>' +
        '<div id="listaCola">Cargando…</div>';

      document.getElementById('cambiarOperario').onclick = function (e) {
        e.preventDefault();
        OPERARIO = '';
        localStorage.removeItem('kairos_operario');
        render();
      };
      document.getElementById('filtroTienda').onchange = cargarCola;
      document.getElementById('filtroTipo').onchange = cargarCola;
      cargarCola();
    }

    function cargarCola() {
      const tienda = document.getElementById('filtroTienda').value;
      const tipo = document.getElementById('filtroTipo').value;
      google.script.run.withSuccessHandler(function (json) {
        const peticiones = JSON.parse(json);
        const cont = document.getElementById('listaCola');
        if (!peticiones.length) { cont.innerHTML = '<p>No hay peticiones pendientes.</p>'; return; }
        cont.innerHTML = peticiones.map(function (p) {
          const etiquetaTipo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? 'Cesión → ' + p.tiendaDestinoNombre : 'Refill');
          return '<div class="fila" style="border-left-color:' + (CFG_TIENDA_COLOR[p.tienda_origen] || '#ccc') + '" onclick="abrirDetalle(\'' + p.id + '\')">' +
            '<div class="tipo">' + etiquetaTipo + '</div>' +
            '<div class="meta">' + p.tiendaNombre + ' · ' + p.lineasPreparadas + '/' + p.totalLineas + ' líneas</div>' +
            '</div>';
        }).join('');
      }).listarCola(tienda || null, tipo || null);
    }

    function abrirDetalle(id) {
      VISTA = { nombre: 'detalle', peticionId: id };
      render();
    }

    function renderDetalle() {
      document.getElementById('app').innerHTML = '<div class="volver"><a href="#" id="volverCola">← Cola</a></div><div id="detalleBody">Cargando…</div>';
      document.getElementById('volverCola').onclick = function (e) { e.preventDefault(); VISTA = { nombre: 'cola', peticionId: null }; render(); };
      google.script.run.withSuccessHandler(pintarDetalle).obtenerPeticion(VISTA.peticionId);
    }

    function pintarDetalle(json) {
      const data = JSON.parse(json);
      const p = data.peticion;
      var titulo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? ('Cesión → ' + p.tiendaDestinoNombre) : ('Refill: ' + (p.motivo || '')));

      var html = '<h1>' + titulo + '</h1><p class="meta">' + p.tiendaNombre + '</p>';
      html += data.lineas.map(function (l) {
        const preparada = l.estado_preparacion === 'preparado';
        return '<div class="linea' + (preparada ? ' preparada' : '') + '">' +
          '<label><input type="checkbox" ' + (preparada ? 'checked disabled' : '') + ' onchange="marcarLinea(\'' + l.id + '\', this)"> ' +
          l.codigo_lm + ' — ' + (l.designacion || '') + ' (' + l.cantidad + ' ' + l.unidad_medida + ')</label>' +
          '</div>';
      }).join('');

      if (p.estado === 'a_ubicar') {
        html += '<h3>A ubicar</h3><input type="text" id="ubicacion" placeholder="Ubicación de consolidación"> <button onclick="guardarUbicacion(\'' + p.id + '\')">Guardar</button>';
      } else if (p.estado === 'cerrada') {
        html += '<p><strong>Petición completada.</strong></p>';
      }

      document.getElementById('detalleBody').innerHTML = html;
    }

    function marcarLinea(lineaId, checkbox) {
      checkbox.disabled = true;
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); checkbox.disabled = false; checkbox.checked = false; })
        .marcarLineaPreparada(lineaId, OPERARIO);
    }

    function guardarUbicacion(peticionId) {
      const ubicacion = document.getElementById('ubicacion').value;
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); })
        .guardarUbicacionConsolidacion(peticionId, ubicacion);
    }

    var CFG_TIENDA_COLOR = { '036': '#2e7d32', '014': '#1565c0', '279': '#6a1b9a' };

    document.addEventListener('DOMContentLoaded', function () { render(); });
  </script>
</body>
</html>
```

Router protegido con `DOMContentLoaded` desde el principio — evita el bug de
orden de scripts ya encontrado en Pieza 2
([[gotcha-gas-htmltemplate-scriptlet-booleano-como-string]] describe el
hermano de este bug; aquí no hay scriptlets pero el mismo patrón de carga
tardía aplica).

- [ ] **Paso 2: Deploy**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push
clasp deploy
```

Anotar el `deploymentId` para reutilizar en despliegues futuros
(`clasp deploy -i <id>`).

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Index.html
git commit -m "feat(operario): UI cola + detalle + a ubicar"
```

---

## Task 9: Verificación E2E en vivo

Sin framework de test — verificación manual contra Supabase real y el
deploy real, igual que Piezas 1 y 2. Usar Claude-in-Chrome, protocolo de
capturas ya establecido (**nunca variar `scale` entre capturas** — usar
`zoom` con región fija; ver gotcha de automatización de Pieza 2).

- [ ] **Paso 1: Preparar datos de prueba**

Vía `execute_sql` en el proyecto `dbxlrnupiwemnarlxmcv`, crear 4 peticiones de
prueba (una por combinación relevante), cada una con 1-2 líneas:
1. `pedido_cliente`, `transporte=false` → debe disparar HODOS al completar.
2. `pedido_cliente`, `transporte=true` → debe pasar a `a_ubicar` al completar.
3. `cesion` (con `tienda_destino` distinto de `tienda_origen`) → debe disparar
   HODOS al completar.
4. `refill` (una línea, `unidad_medida='palet'`) → debe cerrar sin llamar a
   HODOS ni a myISO.

- [ ] **Paso 2: Recorrer flujo completo en el navegador**

Abrir el deployment (`https://script.google.com/a/macros/<dominio>/s/<deploymentId>/exec`),
elegir operario, para cada petición de prueba: abrir detalle, marcar todas
las líneas, confirmar:
- Caso 1 y 3: tras la última línea, `lineas.hodos_id` queda relleno
  (`execute_sql` sobre `preparacion.lineas`) y existe fila nueva en
  `public.etiquetas` del proyecto HODOS.
- Caso 2: petición pasa a "A ubicar", introducir ubicación, guardar, confirmar
  `estado='cerrada'` y `ubicacion_consolidacion` relleno.
- Caso 4: petición pasa directa a `cerrada` sin ninguna llamada HODOS
  (`lineas.hodos_id` sigue null).

- [ ] **Paso 3: Limpiar datos de prueba**

Borrar las 4 peticiones de prueba (y sus líneas, `on delete cascade`) vía
`execute_sql` una vez verificado.

---

## Task 10: Documentación y memoria

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\Kairos\README.md`
- Modify: `C:\Users\30081048\Desktop\Proyectos\Kairos\supabase\README.md`

- [ ] **Paso 1: Actualizar README raíz**

Marcar Pieza 3 como completa en la tabla de piezas.

- [ ] **Paso 2: Actualizar supabase/README.md**

Añadir sección "Proyecto `kairos-operario` (Apps Script)" con scriptId,
deploymentId, y nota de qué Propiedades necesita (`SUPABASE_SERVICE_KEY`,
`HODOS_WEBAPP_URL`, `INCPC_SHARED_TOKEN`).

- [ ] **Paso 3: Commit**

```bash
git add README.md supabase/README.md
git commit -m "docs: Pieza 3 completa"
```

- [ ] **Paso 4: Memoria (fuera de git)**

Actualizar `kairos-plataforma-pedidos-taisa.md` (marcar Pieza 3 completa,
resumen) y `MEMORY.md`. Esto lo hace la sesión directamente, no vía commit.

---

## Task 11: Cierre de rama

Usar **superpowers:finishing-a-development-branch** — presentar las 4
opciones estándar (merge local / PR / mantener / descartar) una vez Task 9
verificado en vivo sin fallos.
