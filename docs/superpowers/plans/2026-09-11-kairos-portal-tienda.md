# Kairos · Pieza 2 (Portal de tienda) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web nueva (`kairos-portal`, Apps Script) para que el personal de
Marbella y Mijas cree peticiones (pedido cliente / cesión / refill) y vea su
estado, incluido el estado real en HODOS — sin tocar la pieza 1 salvo un
pequeño cambio de esquema ya decidido en la spec.

**Architecture:** Cliente HTML de una sola página (`Portal.html`, mismo patrón
que `Preparacion.html` del sistema viejo: router por estado, puente
`google.script.run` con `JSON.stringify`/`JSON.parse`). Servidor Apps Script
habla con Supabase por REST usando la `service_role` key (legacy JWT — ver
gotcha en memoria del proyecto), sin Supabase Auth: el control de acceso vive
en el código del servidor. Login = número de empleado, sin contraseña.

**Tech Stack:** Google Apps Script + clasp, HtmlService, Supabase REST
(PostgREST) contra el proyecto de HODOS (`dbxlrnupiwemnarlxmcv`, esquemas
`preparacion` y `public`).

**Antes de empezar:** este plan usa un endpoint de depuración temporal
(`?debug=test&fn=...&args=...`) en `doGet` para poder verificar cada función del
servidor SIN pasar por el navegador del usuario — se añade en la Task 1 y se
retira en la Task 14. Mismo patrón ya usado y probado en `PreparacionPedidosPC`
esta sesión.

---

## File Structure

```
kairos-portal/
  appsscript.json     Manifiesto: scope external_request, deploy DOMAIN/USER_DEPLOYING
  Config.js           Constantes: URL Supabase, esquemas, mapa de tiendas
  Utils.js            _json_() (workaround Date de google.script.run)
  Supabase.js         Helpers REST genéricos: select/insert/insertMany/update/delete
  Acceso.js           entrar, registrarUsuario, _tiendaDe_
  Admin.js            _verificarAdmin_, listarPendientesAprobacion, aprobarUsuario, rechazarUsuario
  Catalogo.js         buscarArticulos
  Peticiones.js       crearPeticion, listarMisPeticiones, obtenerDetallePeticion, TRADUCCION_ESTADO
  Codigo.js           doGet (endpoint debug temporal + servir Portal.html)
  Portal.html         Cliente: CSS + gas() + router + las 7 pantallas
```

---

## Task 1: Scaffold `kairos-portal` + arnés de pruebas

**Files:**
- Create: `kairos-portal/appsscript.json`
- Create: `kairos-portal/Config.js`
- Create: `kairos-portal/Codigo.js`

- [ ] **Step 1: Crear el proyecto con clasp**

```bash
mkdir -p /c/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal
cd /c/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal
clasp create --type webapp --title "Kairos Portal"
```

Esperado: `Created new web app script:` + un scriptId en `.clasp.json`. Anotar
ese scriptId (se guardará en `supabase/README.md` en la Task 14).

- [ ] **Step 2: Escribir `kairos-portal/appsscript.json`**

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "access": "DOMAIN", "executeAs": "USER_DEPLOYING" },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

- [ ] **Step 3: Escribir `kairos-portal/Config.js`**

```js
/** Configuración de Kairos Portal. Secretos en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SCHEMA_PREP: 'preparacion',
  SCHEMA_HODOS: 'public',
  // SUPABASE_SERVICE_KEY y ADMIN_PASSWORD -> Propiedades del script (no se versionan)
  TIENDAS: { '014': 'Marbella', '279': 'Mijas', '036': 'Málaga' },
};
```

- [ ] **Step 4: Escribir `kairos-portal/Codigo.js` (solo el arnés de pruebas por ahora)**

```js
/** Funciones del servidor que el arnés de pruebas puede invocar por nombre.
 *  Se amplía en tasks siguientes según se van escribiendo. */
const FUNCIONES_DEBUG_PERMITIDAS = [];

function doGet(e) {
  if (e && e.parameter && e.parameter.debug === 'test') {
    return _responderDebug_(e);
  }
  return HtmlService.createHtmlOutput('Portal.html pendiente (Task 9).');
}

function _responderDebug_(e) {
  const fn = e.parameter.fn;
  const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
  var salida;
  if (FUNCIONES_DEBUG_PERMITIDAS.indexOf(fn) === -1) {
    salida = JSON.stringify({ error: 'Función no permitida en el arnés: ' + fn });
  } else {
    try {
      salida = globalThis[fn].apply(null, args);
    } catch (err) {
      salida = JSON.stringify({ error: err.message });
    }
  }
  return ContentService.createTextOutput(salida).setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 5: Push y verificar que sube sin error**

```bash
clasp push -f
```

Esperado: `Pushed 3 files.` (appsscript.json, Config.js, Codigo.js).

- [ ] **Step 6: Desplegar como web app**

```bash
clasp deploy -d "Task 1: scaffold + arnes de pruebas"
```

Esperado: crea la primera versión + deployment. Anotar el deployment ID que
devuelve (`AKfycb...`) — es el que se reutiliza en todos los despliegues
siguientes con `clasp deploy -i <id>`.

- [ ] **Step 7: Meter la service key (paso manual, documentado)**

Editor del proyecto (`clasp open`) → ⚙️ Configuración del proyecto →
Propiedades del script → añadir `SUPABASE_SERVICE_KEY` con la key **legacy
JWT** de `service_role` de Supabase (Project Settings → API → "Legacy API
keys" → `service_role` → Reveal). **No la `sb_secret_...` nueva** — bloquea
`UrlFetchApp` (ver memoria `gotcha-supabase-secret-key-bloquea-urlfetchapp`).

- [ ] **Step 8: Commit**

```bash
cd C:/Users/30081048/Desktop/Proyectos/Kairos
git add kairos-portal/appsscript.json kairos-portal/Config.js kairos-portal/Codigo.js
git commit -m "Task 1: scaffold kairos-portal + arnes de pruebas debug"
```

---

## Task 2: `Utils.js` + `Supabase.js` (helpers REST genéricos)

**Files:**
- Create: `kairos-portal/Utils.js`
- Create: `kairos-portal/Supabase.js`
- Modify: `kairos-portal/Codigo.js:2` (añadir `test_supaSmoke` a `FUNCIONES_DEBUG_PERMITIDAS`)

- [ ] **Step 1: Escribir `kairos-portal/Utils.js`**

```js
/** google.script.run devuelve null en silencio si el objeto lleva un Date
 *  embebido. Workaround: el servidor siempre stringify, el cliente parsea. */
function _json_(obj) {
  return JSON.stringify(obj);
}
```

- [ ] **Step 2: Escribir `kairos-portal/Supabase.js`**

```js
/** Cliente REST mínimo de Supabase (PostgREST), multi-esquema
 *  (preparacion / public) con la service_role key. */

function _supaKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeaders_(metodo, schema) {
  const h = { apikey: _supaKey_(), Authorization: 'Bearer ' + _supaKey_() };
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
  const headers = _supaHeaders_(metodo === 'GET' ? 'GET' : metodo, schema);
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
  return _supaFetch_('POST', tabla, '', fila, schema)[0];
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

/** Prueba de humo: lee las 3 tiendas sembradas en la pieza 1. */
function test_supaSmoke() {
  const filas = supaSelect_('tiendas', 'select=codigo,nombre&order=codigo.asc');
  return _json_({ ok: filas.length === 3, filas: filas });
}
```

- [ ] **Step 3: Añadir `test_supaSmoke` al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke'];
```

- [ ] **Step 4: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id-de-la-task-1> -d "Task 2: helpers Supabase"
```

- [ ] **Step 5: Verificar en el navegador**

Navegar a `<url-del-deploy>?debug=test&fn=test_supaSmoke`.

Esperado (JSON en la página):
```json
{"ok":true,"filas":[{"codigo":"014","nombre":"Marbella"},{"codigo":"036","nombre":"Málaga"},{"codigo":"279","nombre":"Mijas"}]}
```

- [ ] **Step 6: Commit**

```bash
git add kairos-portal/Utils.js kairos-portal/Supabase.js kairos-portal/Codigo.js
git commit -m "Task 2: helpers REST de Supabase (multi-esquema) + smoke test"
```

---

## Task 3: Migración 011 — `usuarios_tienda` sin Supabase Auth

**Files:**
- Create: `supabase/migrations/011_usuarios_tienda_sin_auth.sql`

Decisión de la spec pieza 2 §3: como el login es solo por LDAP (sin
contraseña, sin sesión de Supabase Auth), `usuarios_tienda.id` deja de
depender de `auth.users`.

- [ ] **Step 1: Verificar el estado actual (test) — la tabla sigue vacía y con la FK vieja**

`execute_sql` (`project_id: dbxlrnupiwemnarlxmcv`):

```sql
select count(*) as filas from preparacion.usuarios_tienda;
select conname from pg_constraint
where conrelid = 'preparacion.usuarios_tienda'::regclass and contype = 'f';
```

Esperado: `filas = 0`, y aparece `usuarios_tienda_id_fkey` (o el nombre que
Postgres le haya puesto automáticamente).

- [ ] **Step 2: Escribir `supabase/migrations/011_usuarios_tienda_sin_auth.sql`**

```sql
-- 011 · usuarios_tienda ya no depende de Supabase Auth (pieza 2: login solo
-- por LDAP, sin contraseña, filtrado en el servidor). Tabla vacia, sin riesgo.

alter table preparacion.usuarios_tienda drop constraint if exists usuarios_tienda_id_fkey;
alter table preparacion.usuarios_tienda alter column id set default gen_random_uuid();
```

- [ ] **Step 3: Aplicar con `apply_migration`** (`project_id: dbxlrnupiwemnarlxmcv`,
      `name: 011_usuarios_tienda_sin_auth`).

- [ ] **Step 4: Verificar (test) — FK fuera, default puesto, e insertar/leer una fila sin auth.users**

`execute_sql`:

```sql
select count(*) as num_fks from pg_constraint
where conrelid = 'preparacion.usuarios_tienda'::regclass and contype = 'f';

insert into preparacion.usuarios_tienda (ldap, tienda) values ('99999999', '014');
select id, ldap, tienda, aprobado from preparacion.usuarios_tienda where ldap = '99999999';
delete from preparacion.usuarios_tienda where ldap = '99999999';
select count(*) as tras_borrar from preparacion.usuarios_tienda;
```

Esperado: `num_fks = 0` (solo queda la FK a `tiendas`, no a `auth.users` —
comprobar con `select conname from pg_constraint where conrelid=... and
contype='f'` si hace falta más detalle: debe listar solo la de `tiendas`), la
inserción funciona sin necesitar una fila en `auth.users`, `id` se genera solo,
`tras_borrar = 0`.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/30081048/Desktop/Proyectos/Kairos
git add supabase/migrations/011_usuarios_tienda_sin_auth.sql
git commit -m "Migracion 011: usuarios_tienda sin dependencia de Supabase Auth"
```

---

## Task 4: `Acceso.js` — entrar / registrarUsuario

**Files:**
- Create: `kairos-portal/Acceso.js`
- Modify: `kairos-portal/Codigo.js:2`

- [ ] **Step 1: Escribir `kairos-portal/Acceso.js`**

```js
/** Login sin contraseña: solo número de empleado (LDAP). El servidor decide
 *  quién eres y a qué tienda perteneces — el cliente nunca manda la tienda. */

function entrar(ldap) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');

  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=id,ldap,tienda,aprobado');
  if (!filas.length) return _json_({ estado: 'no_existe', ldap: ldap });

  const u = filas[0];
  if (!u.aprobado) return _json_({ estado: 'pendiente', ldap: ldap });

  return _json_({
    estado: 'ok',
    ldap: ldap,
    tienda: u.tienda,
    tiendaNombre: CFG.TIENDAS[u.tienda] || u.tienda,
  });
}

function registrarUsuario(ldap, tienda) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');
  if (!CFG.TIENDAS[tienda]) throw new Error('Tienda no válida.');

  const existentes = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap));
  if (existentes.length) throw new Error('Ese número de empleado ya está registrado.');

  supaInsert_('usuarios_tienda', { ldap: ldap, tienda: tienda, aprobado: false });
  return _json_({ ok: true });
}

/** Resuelve la tienda de un LDAP aprobado, o lanza si no está autorizado.
 *  La usan Catalogo.js y Peticiones.js para no confiar nunca en una tienda
 *  que mande el cliente. */
function _tiendaDe_(ldap) {
  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=tienda,aprobado');
  if (!filas.length || !filas[0].aprobado) throw new Error('Usuario no autorizado.');
  return filas[0].tienda;
}
```

- [ ] **Step 2: Añadir al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario'];
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 4: entrar/registrarUsuario"
```

- [ ] **Step 4: Verificar — LDAP que no existe**

Navegar a `<url>?debug=test&fn=entrar&args=["88880001"]`.

Esperado: `{"estado":"no_existe","ldap":"88880001"}`.

- [ ] **Step 5: Verificar — registro + pendiente + no duplicado**

Navegar en orden:
1. `<url>?debug=test&fn=registrarUsuario&args=["88880001","014"]` → `{"ok":true}`.
2. `<url>?debug=test&fn=entrar&args=["88880001"]` → `{"estado":"pendiente","ldap":"88880001"}`.
3. `<url>?debug=test&fn=registrarUsuario&args=["88880001","014"]` de nuevo →
   `{"error":"Ese número de empleado ya está registrado."}`.

- [ ] **Step 6: Verificar — aprobado a mano en Supabase y vuelve a entrar**

`execute_sql`:

```sql
update preparacion.usuarios_tienda set aprobado = true where ldap = '88880001';
```

Navegar a `<url>?debug=test&fn=entrar&args=["88880001"]`.

Esperado: `{"estado":"ok","ldap":"88880001","tienda":"014","tiendaNombre":"Marbella"}`.

- [ ] **Step 7: Limpiar el usuario de prueba**

`execute_sql`:

```sql
delete from preparacion.usuarios_tienda where ldap = '88880001';
select count(*) from preparacion.usuarios_tienda;
```

Esperado: `0`.

- [ ] **Step 8: Commit**

```bash
git add kairos-portal/Acceso.js kairos-portal/Codigo.js
git commit -m "Task 4: login sin contrasena (entrar/registrarUsuario)"
```

---

## Task 5: `Admin.js` — aprobar registros

**Files:**
- Create: `kairos-portal/Admin.js`
- Modify: `kairos-portal/Codigo.js:2`

- [ ] **Step 1: Escribir `kairos-portal/Admin.js`**

```js
/** Acceso de administración: una contraseña fija en Propiedades del script,
 *  sin usuario ni tabla propia (un solo admin). */

function _verificarAdmin_(passwordAdmin) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('Falta ADMIN_PASSWORD en Propiedades del script.');
  if (String(passwordAdmin || '') !== real) throw new Error('Contraseña de administrador incorrecta.');
}

function listarPendientesAprobacion(passwordAdmin) {
  _verificarAdmin_(passwordAdmin);
  const filas = supaSelect_('usuarios_tienda', 'aprobado=eq.false&select=id,ldap,tienda,creado_en&order=creado_en.asc');
  filas.forEach(function (f) { f.tiendaNombre = CFG.TIENDAS[f.tienda] || f.tienda; });
  return _json_(filas);
}

function aprobarUsuario(passwordAdmin, id) {
  _verificarAdmin_(passwordAdmin);
  supaUpdate_('usuarios_tienda', 'id=eq.' + encodeURIComponent(id), {
    aprobado: true,
    aprobado_en: new Date().toISOString(),
  });
  return _json_({ ok: true });
}

function rechazarUsuario(passwordAdmin, id) {
  _verificarAdmin_(passwordAdmin);
  supaDelete_('usuarios_tienda', 'id=eq.' + encodeURIComponent(id));
  return _json_({ ok: true });
}
```

- [ ] **Step 2: Meter `ADMIN_PASSWORD` (paso manual)**

Editor → Propiedades del script → añadir `ADMIN_PASSWORD` con una contraseña
a elegir por el usuario (se la comunico yo para que la guarde).

- [ ] **Step 3: Añadir al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario', 'listarPendientesAprobacion', 'aprobarUsuario', 'rechazarUsuario'];
```

- [ ] **Step 4: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 5: admin aprobar/rechazar"
```

- [ ] **Step 5: Verificar contraseña incorrecta**

Navegar a `<url>?debug=test&fn=listarPendientesAprobacion&args=["mal"]`.

Esperado: `{"error":"Contraseña de administrador incorrecta."}`.

- [ ] **Step 6: Verificar flujo completo (registrar, listar, aprobar, comprobar, rechazar otro)**

Con la `ADMIN_PASSWORD` real puesta en `<PASS>`:

1. `<url>?debug=test&fn=registrarUsuario&args=["88880002","279"]` → `{"ok":true}`.
2. `<url>?debug=test&fn=registrarUsuario&args=["88880003","279"]` → `{"ok":true}`.
3. `<url>?debug=test&fn=listarPendientesAprobacion&args=["<PASS>"]` → array con
   `88880002` y `88880003` (guardar el `id` de `88880002`).
4. `<url>?debug=test&fn=aprobarUsuario&args=["<PASS>","<id-de-88880002>"]` →
   `{"ok":true}`.
5. `<url>?debug=test&fn=entrar&args=["88880002"]` → `estado":"ok"`.
6. `<url>?debug=test&fn=listarPendientesAprobacion&args=["<PASS>"]` → ya solo
   sale `88880003`.

- [ ] **Step 7: Limpiar**

`execute_sql`:

```sql
delete from preparacion.usuarios_tienda where ldap in ('88880002','88880003');
select count(*) from preparacion.usuarios_tienda;
```

Esperado: `0`.

- [ ] **Step 8: Commit**

```bash
git add kairos-portal/Admin.js kairos-portal/Codigo.js
git commit -m "Task 5: admin aprobar/rechazar registros"
```

---

## Task 6: `Catalogo.js` — buscador de artículos

**Files:**
- Create: `kairos-portal/Catalogo.js`
- Modify: `kairos-portal/Codigo.js:2`

- [ ] **Step 1: Escribir `kairos-portal/Catalogo.js`**

```js
/** Autocompletar artículo por código LM o por designación, contra el
 *  catálogo derivado del Excel de inventario (pieza 1). */
function buscarArticulos(texto) {
  texto = String(texto || '').trim();
  if (texto.length < 2) return _json_([]);

  const esCodigo = /^\d+$/.test(texto);
  const filtro = esCodigo
    ? 'codigo_lm=ilike.*' + encodeURIComponent(texto) + '*'
    : 'designacion=ilike.*' + encodeURIComponent(texto) + '*';

  const filas = supaSelect_('catalogo', filtro + '&select=codigo_lm,ean,designacion,seccion,foto_url&limit=15');
  return _json_(filas);
}
```

- [ ] **Step 2: Añadir al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario', 'listarPendientesAprobacion', 'aprobarUsuario', 'rechazarUsuario', 'buscarArticulos'];
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 6: buscador de articulos"
```

- [ ] **Step 4: Verificar por código y por designación**

Navegar a `<url>?debug=test&fn=buscarArticulos&args=["92738606"]`.

Esperado: incluye la fila `codigo_lm":"92738606"`, `designacion` con "RIEL
MANUAL MURTRA...", `seccion":"12 - DECORACION"`.

Navegar a `<url>?debug=test&fn=buscarArticulos&args=["riel manual"]`.

Esperado: incluye la misma referencia (búsqueda por designación).

- [ ] **Step 5: Commit**

```bash
git add kairos-portal/Catalogo.js kairos-portal/Codigo.js
git commit -m "Task 6: buscador de articulos (autocompletar LM)"
```

---

## Task 7: `Peticiones.js` — crear y listar

**Files:**
- Create: `kairos-portal/Peticiones.js`
- Modify: `kairos-portal/Codigo.js:2`

- [ ] **Step 1: Escribir `kairos-portal/Peticiones.js` (primera mitad)**

```js
const TRADUCCION_ESTADO = {
  pendiente: 'Recibida',
  en_preparacion: 'En preparación',
  a_ubicar: 'Preparada, pendiente de consolidar',
  cerrada: 'Completada',
};

function crearPeticion(ldap, tipo, datos, lineas) {
  const tienda = _tiendaDe_(ldap);
  if (['pedido_cliente', 'cesion', 'refill'].indexOf(tipo) === -1) {
    throw new Error('Tipo de petición no válido.');
  }
  if (!lineas || !lineas.length) throw new Error('Añade al menos una línea.');

  const cabecera = {
    tipo: tipo,
    tienda_origen: tienda,
    solicitante_ldap: ldap,
    comentario: (datos && datos.comentario) || null,
  };

  if (tipo === 'pedido_cliente') {
    if (!datos.numPedido) throw new Error('Falta el número de pedido.');
    if (typeof datos.transporte !== 'boolean') throw new Error('Falta indicar transporte.');
    cabecera.num_pedido = String(datos.numPedido).trim();
    cabecera.transporte = datos.transporte;
  } else if (tipo === 'cesion') {
    if (!datos.tiendaDestino) throw new Error('Falta la tienda destino.');
    cabecera.tienda_destino = datos.tiendaDestino;
  } else {
    if (!datos.motivo) throw new Error('Falta el motivo del refill.');
    cabecera.motivo = String(datos.motivo).trim();
  }

  const peticion = supaInsert_('peticiones', cabecera);

  const unidadMedida = tipo === 'refill' ? 'palet' : 'ud';
  const lineasPayload = lineas.map(function (l) {
    if (!l.codigoLm || !l.cantidad) throw new Error('Línea incompleta.');
    return {
      peticion_id: peticion.id,
      codigo_lm: String(l.codigoLm).trim(),
      cantidad: Number(l.cantidad),
      unidad_medida: unidadMedida,
      ean: l.ean || null,
      designacion: l.designacion || null,
      seccion: l.seccion || null,
    };
  });
  supaInsertMany_('lineas', lineasPayload);

  return _json_({ ok: true, id: peticion.id });
}

function listarMisPeticiones(ldap) {
  const tienda = _tiendaDe_(ldap);
  const filas = supaSelect_(
    'peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) +
      '&select=id,tipo,num_pedido,tienda_destino,estado,creada_en,solicitante_ldap' +
      '&order=creada_en.desc&limit=200'
  );
  filas.forEach(function (p) { p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado; });
  return _json_(filas);
}
```

- [ ] **Step 2: Añadir al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario', 'listarPendientesAprobacion', 'aprobarUsuario', 'rechazarUsuario', 'buscarArticulos', 'crearPeticion', 'listarMisPeticiones'];
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 7: crear y listar peticiones"
```

- [ ] **Step 4: Verificar — crear los 3 tipos y listarlos**

Preparar un usuario de prueba aprobado (`execute_sql`):

```sql
insert into preparacion.usuarios_tienda (ldap, tienda, aprobado) values ('88880009','014',true);
```

Navegar (URL-encodear las comillas de los JSON):

1. `<url>?debug=test&fn=crearPeticion&args=["88880009","pedido_cliente",{"numPedido":"PC900","transporte":false},[{"codigoLm":"92738606","cantidad":2}]]`
   → `{"ok":true,"id":"..."}`.
2. `<url>?debug=test&fn=crearPeticion&args=["88880009","cesion",{"tiendaDestino":"279"},[{"codigoLm":"92738606","cantidad":1}]]`
   → `{"ok":true,"id":"..."}`.
3. `<url>?debug=test&fn=crearPeticion&args=["88880009","refill",{"motivo":"reponer lineal"},[{"codigoLm":"92738606","cantidad":2}]]`
   → `{"ok":true,"id":"..."}`.
4. `<url>?debug=test&fn=listarMisPeticiones&args=["88880009"]` → array de 3,
   `tipo` pedido_cliente/cesion/refill, todas con `estadoTexto":"Recibida"`.

- [ ] **Step 5: Verificar en Supabase que las líneas se crearon**

`execute_sql`:

```sql
select p.tipo, count(l.id) as num_lineas
from preparacion.peticiones p join preparacion.lineas l on l.peticion_id = p.id
where p.solicitante_ldap = '88880009'
group by p.tipo order by p.tipo;
```

Esperado: 3 filas, `num_lineas = 1` cada una.

- [ ] **Step 6: Limpiar**

```sql
delete from preparacion.peticiones where solicitante_ldap = '88880009'; -- cascada borra las lineas
delete from preparacion.usuarios_tienda where ldap = '88880009';
select (select count(*) from preparacion.peticiones where solicitante_ldap='88880009') as p,
       (select count(*) from preparacion.usuarios_tienda where ldap='88880009') as u;
```

Esperado: `p = 0`, `u = 0`.

- [ ] **Step 7: Commit**

```bash
git add kairos-portal/Peticiones.js kairos-portal/Codigo.js
git commit -m "Task 7: crear y listar peticiones (3 tipos)"
```

---

## Task 8: `Peticiones.js` — detalle + estado cruzado con HODOS

**Files:**
- Modify: `kairos-portal/Peticiones.js` (añadir al final)
- Modify: `kairos-portal/Codigo.js:2`

- [ ] **Step 1: Añadir a `kairos-portal/Peticiones.js`**

```js
function obtenerDetallePeticion(ldap, peticionId) {
  const tienda = _tiendaDe_(ldap);

  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(tienda));
  if (!cab.length) throw new Error('Petición no encontrada.');
  const peticion = cab[0];
  peticion.estadoTexto = TRADUCCION_ESTADO[peticion.estado] || peticion.estado;

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  var hodosTexto = null;
  const generaEtiqueta = (peticion.tipo === 'pedido_cliente' && !peticion.transporte) || peticion.tipo === 'cesion';
  if (generaEtiqueta) {
    const conHodosId = lineas.filter(function (l) { return l.hodos_id; });
    if (!conHodosId.length) {
      hodosTexto = 'Generando etiqueta…';
    } else {
      const idUnico = conHodosId[0].hodos_id;
      const etiquetas = supaSelect_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico) + '&select=pendiente_impresion_incpc', CFG.SCHEMA_HODOS);
      if (etiquetas.length) {
        hodosTexto = etiquetas[0].pendiente_impresion_incpc ? 'Etiqueta pendiente de imprimir' : 'Etiqueta impresa';
      }
    }
  }

  return _json_({ peticion: peticion, lineas: lineas, hodosTexto: hodosTexto });
}
```

- [ ] **Step 2: Añadir al arnés en `Codigo.js`**

```js
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario', 'listarPendientesAprobacion', 'aprobarUsuario', 'rechazarUsuario', 'buscarArticulos', 'crearPeticion', 'listarMisPeticiones', 'obtenerDetallePeticion'];
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 8: detalle de peticion + estado HODOS"
```

- [ ] **Step 4: Verificar sin etiqueta (recién creada)**

```sql
insert into preparacion.usuarios_tienda (ldap, tienda, aprobado) values ('88880010','014',true);
```

`<url>?debug=test&fn=crearPeticion&args=["88880010","pedido_cliente",{"numPedido":"PC901","transporte":false},[{"codigoLm":"92738606","cantidad":1}]]`
→ guardar el `id` devuelto.

`<url>?debug=test&fn=obtenerDetallePeticion&args=["88880010","<id>"]`

Esperado: `hodosTexto":"Generando etiqueta…"` (aún no se ha preparado, no hay
`hodos_id`), `lineas` con 1 elemento.

- [ ] **Step 5: Verificar con etiqueta real (simulando que ya se generó)**

`execute_sql` — coger un `id_unico` real y reciente de HODOS y asignarlo a la
línea de prueba (no crea nada nuevo en HODOS, solo referencia una fila
existente para probar el cruce):

```sql
select id_unico, pendiente_impresion_incpc from public.etiquetas order by fecha_creacion desc limit 1;
```

Con ese `id_unico` (`<idu>`):

```sql
update preparacion.lineas set hodos_id = '<idu>'
where peticion_id = (select id from preparacion.peticiones where solicitante_ldap='88880010' limit 1);
```

`<url>?debug=test&fn=obtenerDetallePeticion&args=["88880010","<id>"]`

Esperado: `hodosTexto` es `"Etiqueta pendiente de imprimir"` o `"Etiqueta
impresa"` según el valor real de `pendiente_impresion_incpc` de esa etiqueta
(coincide con lo consultado en el paso anterior).

- [ ] **Step 6: Verificar caso cesión y caso sin etiqueta (con transporte)**

`<url>?debug=test&fn=crearPeticion&args=["88880010","pedido_cliente",{"numPedido":"PC902","transporte":true},[{"codigoLm":"92738606","cantidad":1}]]`
→ guardar `id`.

`<url>?debug=test&fn=obtenerDetallePeticion&args=["88880010","<id-transporte>"]`

Esperado: `hodosTexto` es `null` (con transporte no genera etiqueta).

- [ ] **Step 7: Limpiar**

```sql
delete from preparacion.peticiones where solicitante_ldap = '88880010';
delete from preparacion.usuarios_tienda where ldap = '88880010';
```

- [ ] **Step 8: Commit**

```bash
git add kairos-portal/Peticiones.js kairos-portal/Codigo.js
git commit -m "Task 8: detalle de peticion con estado cruzado de HODOS"
```

---

## Task 9: `Portal.html` — esqueleto (CSS + puente + router)

**Files:**
- Create: `kairos-portal/Portal.html`
- Modify: `kairos-portal/Codigo.js` (servir el HTML de verdad)

- [ ] **Step 1: Escribir `kairos-portal/Portal.html`**

```html
<title>Kairos · Portal de tienda</title>
<style>
  :root { --bg:#0b0f14; --card:#131a22; --line:#232d38; --text:#e7edf3; --muted:#93a1b0;
          --marbella:#3b82f6; --mijas:#8b5cf6; --ok:#22c55e; --warn:#f59e0b; --danger:#ef4444; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:720px; margin:0 auto; padding:16px; }
  .top { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-weight:700; font-size:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
  .btn { width:100%; padding:12px; border-radius:8px; border:none; font-weight:700; font-size:14px; cursor:pointer; margin-top:8px; }
  .btn-primary { background:var(--ok); color:#04150a; }
  .btn-ghost { background:transparent; color:var(--text); border:1px solid var(--line); }
  .btn-danger { background:var(--danger); color:#fff; }
  .entrada { width:100%; padding:10px; border-radius:8px; border:1px solid var(--line); background:#0f1620; color:var(--text); margin-bottom:8px; }
  .fila { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); cursor:pointer; }
  .fila:last-child { border-bottom:none; }
  .estado { font-size:12px; padding:3px 8px; border-radius:6px; background:#1c2733; color:var(--muted); }
  .error { color:var(--danger); font-size:13px; margin-top:6px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .articulo { display:flex; gap:8px; align-items:center; padding:6px; border-radius:8px; cursor:pointer; }
  .articulo:hover { background:#0f1620; }
  .articulo img { width:36px; height:36px; object-fit:cover; border-radius:4px; background:#000; }
  .linea-chip { display:flex; justify-content:space-between; background:#0f1620; border-radius:8px; padding:8px; margin-top:6px; font-size:13px; }
</style>
<div id="app"></div>
<script>
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  }); }
  function gas(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(function (texto) {
          const obj = JSON.parse(texto);
          if (obj && obj.error) { reject(new Error(obj.error)); return; }
          resolve(obj);
        })
        .withFailureHandler(function (err) { reject(err); })[fn].apply(null, args);
    });
  }

  var LDAP = localStorage.getItem('kairos_ldap') || '';
  var TIENDA = localStorage.getItem('kairos_tienda') || '';
  var TIENDA_NOMBRE = localStorage.getItem('kairos_tienda_nombre') || '';

  function salir() {
    localStorage.removeItem('kairos_ldap');
    localStorage.removeItem('kairos_tienda');
    localStorage.removeItem('kairos_tienda_nombre');
    LDAP = ''; TIENDA = ''; TIENDA_NOMBRE = '';
    render();
  }

  function app() { return document.getElementById('app'); }

  function render() {
    app().innerHTML = '';
    if (!LDAP) { renderEntrar(); return; }
    renderCola();
  }

  render();
</script>
```

- [ ] **Step 2: Modificar `kairos-portal/Codigo.js` para servir el HTML real**

```js
function doGet(e) {
  if (e && e.parameter && e.parameter.debug === 'test') {
    return _responderDebug_(e);
  }
  return HtmlService.createHtmlOutputFromFile('Portal')
    .setTitle('Kairos · Portal de tienda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 9: esqueleto Portal.html"
```

- [ ] **Step 4: Verificar que carga sin errores de consola**

Abrir `<url>` (sin `?debug=`) con Claude-in-Chrome: `navigate` a la URL,
`read_console_messages` con `onlyErrors: true`.

Esperado: sin errores (`renderEntrar` aún no existe, así que la pantalla
saldrá en blanco o con un error de "renderEntrar no definido" — **eso es
correcto en este punto**, se resuelve en la Task 10). Confirmar que el error
es exactamente ese y no otro (typo de sintaxis, CSS roto, etc.).

- [ ] **Step 5: Commit**

```bash
git add kairos-portal/Portal.html kairos-portal/Codigo.js
git commit -m "Task 9: esqueleto Portal.html (CSS, puente gas(), router base)"
```

---

## Task 10: Pantallas Entrar / Alta / Pendiente

**Files:**
- Modify: `kairos-portal/Portal.html` (añadir antes de `render();` al final del `<script>`)

- [ ] **Step 1: Añadir las 3 funciones de pantalla**

```html
<script>
  function renderEntrar() {
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<h2>Kairos</h2>' +
        '<p style="color:var(--muted)">Escribe tu número de empleado para entrar.</p>' +
        '<input class="entrada" id="inLdap" placeholder="Número de empleado" inputmode="numeric">' +
        '<div class="error" id="errEntrar" style="display:none;"></div>' +
        '<button class="btn btn-primary" id="btnEntrar">Entrar</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    const input = c.querySelector('#inLdap');
    const err = c.querySelector('#errEntrar');
    const boton = c.querySelector('#btnEntrar');
    function intentar() {
      const ldap = input.value.trim();
      err.style.display = 'none';
      boton.disabled = true; boton.textContent = 'Comprobando…';
      gas('entrar', ldap).then(function (r) {
        if (r.estado === 'no_existe') { renderAlta(ldap); return; }
        if (r.estado === 'pendiente') { renderPendiente(); return; }
        LDAP = r.ldap; TIENDA = r.tienda; TIENDA_NOMBRE = r.tiendaNombre;
        localStorage.setItem('kairos_ldap', LDAP);
        localStorage.setItem('kairos_tienda', TIENDA);
        localStorage.setItem('kairos_tienda_nombre', TIENDA_NOMBRE);
        renderCola();
      }).catch(function (e) {
        err.textContent = e.message; err.style.display = 'block';
        boton.disabled = false; boton.textContent = 'Entrar';
      });
    }
    boton.onclick = intentar;
    input.onkeydown = function (e) { if (e.key === 'Enter') intentar(); };
  }

  function renderAlta(ldap) {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<h2>Primera vez</h2>' +
        '<p style="color:var(--muted)">No encontramos el número ' + escHtml(ldap) + '. Regístrate:</p>' +
        '<select class="entrada" id="selTienda">' +
          '<option value="014">Marbella</option>' +
          '<option value="279">Mijas</option>' +
        '</select>' +
        '<div class="error" id="errAlta" style="display:none;"></div>' +
        '<button class="btn btn-primary" id="btnAlta">Solicitar acceso</button>' +
        '<button class="btn btn-ghost" id="btnVolver">‹ Volver</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnVolver').onclick = renderEntrar;
    c.querySelector('#btnAlta').onclick = function () {
      const err = c.querySelector('#errAlta');
      const tienda = c.querySelector('#selTienda').value;
      gas('registrarUsuario', ldap, tienda).then(function () {
        renderPendiente();
      }).catch(function (e) {
        err.textContent = e.message; err.style.display = 'block';
      });
    };
  }

  function renderPendiente() {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<h2>Pendiente de aprobación</h2>' +
        '<p style="color:var(--muted)">Ya está registrado. En cuanto se apruebe podrás entrar.</p>' +
        '<button class="btn btn-primary" id="btnComprobar">Comprobar de nuevo</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnComprobar').onclick = renderEntrar;
  }
</script>
```

- [ ] **Step 2: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 10: pantallas entrar/alta/pendiente"
```

- [ ] **Step 3: Verificar con Claude-in-Chrome (navegador real)**

`navigate` a `<url>`. `read_page` para confirmar que aparece el input
"Número de empleado" y el botón "Entrar". Escribir un LDAP nuevo (p. ej.
`77770001`) con `computer` (`type`) y pulsar Entrar. Confirmar que aparece la
pantalla de alta con el selector de tienda. Elegir Marbella, pulsar "Solicitar
acceso". Confirmar que aparece "Pendiente de aprobación".

`execute_sql` para limpiar tras la prueba:
```sql
delete from preparacion.usuarios_tienda where ldap = '77770001';
```

- [ ] **Step 4: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "Task 10: pantallas Entrar / Alta / Pendiente"
```

---

## Task 11: Pantallas Mis peticiones + Nueva petición

**Files:**
- Modify: `kairos-portal/Portal.html`

- [ ] **Step 1: Añadir `renderCola()`**

```html
<script>
  const ETIQUETA_TIPO = { pedido_cliente: 'Pedido cliente', cesion: 'Cesión', refill: 'Refill' };

  function renderCola() {
    app().innerHTML = '';
    const top = el(
      '<div class="top">' +
        '<div><b>' + escHtml(TIENDA_NOMBRE) + '</b> <span style="color:var(--muted)">· ' + escHtml(LDAP) + '</span></div>' +
        '<button class="btn-ghost" style="width:auto;padding:6px 10px;" id="btnSalir">Salir</button>' +
      '</div>'
    );
    app().appendChild(top);
    top.querySelector('#btnSalir').onclick = salir;

    const wrap = el('<div class="wrap"></div>');
    app().appendChild(wrap);
    wrap.appendChild(el('<button class="btn btn-primary" id="btnNueva">+ Nueva petición</button>'));
    const lista = el('<div class="card" id="lista"><p style="color:var(--muted)">Cargando…</p></div>');
    wrap.appendChild(lista);
    wrap.querySelector('#btnNueva').onclick = renderNueva;

    gas('listarMisPeticiones', LDAP).then(function (filas) {
      lista.innerHTML = '';
      if (!filas.length) { lista.appendChild(el('<p style="color:var(--muted)">No hay peticiones todavía.</p>')); return; }
      filas.forEach(function (p) {
        const fila = el(
          '<div class="fila">' +
            '<div><b>' + escHtml(ETIQUETA_TIPO[p.tipo] || p.tipo) + '</b>' +
              (p.num_pedido ? ' · ' + escHtml(p.num_pedido) : '') +
              '<div style="color:var(--muted);font-size:12px;">' + new Date(p.creada_en).toLocaleString('es-ES') + '</div>' +
            '</div>' +
            '<span class="estado">' + escHtml(p.estadoTexto) + '</span>' +
          '</div>'
        );
        fila.onclick = function () { renderDetalle(p.id); };
        lista.appendChild(fila);
      });
    }).catch(function (e) {
      lista.innerHTML = '<p class="error">' + escHtml(e.message) + '</p>';
    });
  }
</script>
```

- [ ] **Step 2: Añadir `renderNueva()` y los 3 formularios (mismo `<script>`)**

```html
<script>
  function renderNueva() {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<button class="btn btn-ghost" id="btnVolver">‹ Volver</button>' +
        '<h2>Nueva petición</h2>' +
        '<button class="btn btn-primary" id="btnPC">Pedido cliente</button>' +
        '<button class="btn btn-primary" id="btnCesion">Cesión</button>' +
        '<button class="btn btn-primary" id="btnRefill">Refill</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnVolver').onclick = renderCola;
    c.querySelector('#btnPC').onclick = function () { renderFormulario('pedido_cliente'); };
    c.querySelector('#btnCesion').onclick = function () { renderFormulario('cesion'); };
    c.querySelector('#btnRefill').onclick = function () { renderFormulario('refill'); };
  }

  function renderFormulario(tipo) {
    app().innerHTML = '';
    var camposTipo = '';
    if (tipo === 'pedido_cliente') {
      camposTipo =
        '<input class="entrada" id="inNumPedido" placeholder="Nº de pedido">' +
        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<input type="checkbox" id="inTransporte"> Con transporte (se consolida en plataforma)' +
        '</label>';
    } else if (tipo === 'cesion') {
      camposTipo =
        '<select class="entrada" id="inDestino">' +
          '<option value="014">Marbella</option>' +
          '<option value="279">Mijas</option>' +
          '<option value="036">Málaga</option>' +
        '</select>';
    } else {
      camposTipo = '<input class="entrada" id="inMotivo" placeholder="Motivo del refill">';
    }

    const unidadLabel = tipo === 'refill' ? 'nº de palets' : 'unidades';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<button class="btn btn-ghost" id="btnVolver">‹ Volver</button>' +
        '<h2>' + escHtml(ETIQUETA_TIPO[tipo]) + '</h2>' +
        camposTipo +
        '<hr style="border-color:var(--line);margin:12px 0;">' +
        '<b>Artículos</b>' +
        '<input class="entrada" id="inBuscar" placeholder="Código LM o nombre del artículo" autocomplete="off">' +
        '<div id="resultadosBusqueda"></div>' +
        '<div id="lineasAnadidas"></div>' +
        '<input class="entrada" id="inComentario" placeholder="Comentario (opcional)">' +
        '<div class="error" id="errForm" style="display:none;"></div>' +
        '<button class="btn btn-primary" id="btnEnviar">Enviar petición</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnVolver').onclick = renderCola;

    var lineas = []; // { codigoLm, designacion, ean, seccion, cantidad }
    var articuloElegido = null;

    function pintarLineas() {
      const cont = c.querySelector('#lineasAnadidas');
      cont.innerHTML = '';
      lineas.forEach(function (l, idx) {
        const chip = el(
          '<div class="linea-chip"><span>' + escHtml(l.codigoLm) + ' · ' + escHtml(l.designacion || '—') +
            ' · ' + l.cantidad + ' ' + unidadLabel + '</span>' +
            '<button class="btn-ghost" style="width:auto;padding:2px 8px;" data-idx="' + idx + '">Quitar</button></div>'
        );
        chip.querySelector('button').onclick = function () { lineas.splice(idx, 1); pintarLineas(); };
        cont.appendChild(chip);
      });
    }

    const inputBuscar = c.querySelector('#inBuscar');
    const resultados = c.querySelector('#resultadosBusqueda');
    var timerBuscar = null;
    inputBuscar.oninput = function () {
      articuloElegido = null;
      clearTimeout(timerBuscar);
      const texto = inputBuscar.value;
      timerBuscar = setTimeout(function () {
        if (texto.trim().length < 2) { resultados.innerHTML = ''; return; }
        gas('buscarArticulos', texto).then(function (filas) {
          resultados.innerHTML = '';
          filas.forEach(function (a) {
            const fila = el(
              '<div class="articulo">' +
                (a.foto_url ? '<img src="' + escHtml(a.foto_url) + '">' : '') +
                '<div><div><b>' + escHtml(a.codigo_lm) + '</b> · ' + escHtml(a.designacion || '') + '</div>' +
                '<div style="color:var(--muted);font-size:12px;">' + escHtml(a.seccion || '') + '</div></div>' +
              '</div>'
            );
            fila.onclick = function () {
              articuloElegido = a;
              inputBuscar.value = a.codigo_lm + ' · ' + (a.designacion || '');
              resultados.innerHTML = '';
              pedirCantidad();
            };
            resultados.appendChild(fila);
          });
        });
      }, 300);
    };

    function pedirCantidad() {
      const cantidadTexto = prompt('¿Cuántas ' + unidadLabel + ' de ' + articuloElegido.codigo_lm + '?');
      const cantidad = Number(cantidadTexto);
      if (!cantidad || cantidad <= 0) return;
      lineas.push({
        codigoLm: articuloElegido.codigo_lm, designacion: articuloElegido.designacion,
        ean: articuloElegido.ean, seccion: articuloElegido.seccion, cantidad: cantidad,
      });
      inputBuscar.value = ''; articuloElegido = null;
      pintarLineas();
    }

    c.querySelector('#btnEnviar').onclick = function () {
      const err = c.querySelector('#errForm');
      err.style.display = 'none';
      if (!lineas.length) { err.textContent = 'Añade al menos un artículo.'; err.style.display = 'block'; return; }
      var datos = { comentario: c.querySelector('#inComentario').value.trim() || null };
      if (tipo === 'pedido_cliente') {
        datos.numPedido = c.querySelector('#inNumPedido').value.trim();
        datos.transporte = c.querySelector('#inTransporte').checked;
        if (!datos.numPedido) { err.textContent = 'Falta el número de pedido.'; err.style.display = 'block'; return; }
      } else if (tipo === 'cesion') {
        datos.tiendaDestino = c.querySelector('#inDestino').value;
      } else {
        datos.motivo = c.querySelector('#inMotivo').value.trim();
        if (!datos.motivo) { err.textContent = 'Falta el motivo.'; err.style.display = 'block'; return; }
      }
      gas('crearPeticion', LDAP, tipo, datos, lineas).then(function () {
        renderCola();
      }).catch(function (e) {
        err.textContent = e.message; err.style.display = 'block';
      });
    };
  }
</script>
```

- [ ] **Step 3: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 11: mis peticiones + nueva peticion"
```

- [ ] **Step 4: Verificar con Claude-in-Chrome (flujo completo de un pedido cliente real)**

Preparar un usuario aprobado de prueba (`execute_sql`):
```sql
insert into preparacion.usuarios_tienda (ldap, tienda, aprobado) values ('77770010','014',true);
```

`navigate` a `<url>`, entrar con `77770010`. Confirmar "Mis peticiones" vacío.
Pulsar "+ Nueva petición" → "Pedido cliente". Rellenar Nº pedido `PC950`,
dejar transporte sin marcar. Escribir `92738606` en el buscador, esperar a que
aparezca el resultado (`read_page` o `zoom`), pulsar el resultado, en el
`prompt()` de cantidad escribir `3` (aceptar el diálogo nativo del navegador
con `computer` `key "Return"` si hace falta). Confirmar que aparece el chip de
línea. Pulsar "Enviar petición". Confirmar que vuelve a "Mis peticiones" y
aparece la fila con estado "Recibida".

`execute_sql` para limpiar:
```sql
delete from preparacion.peticiones where solicitante_ldap = '77770010';
delete from preparacion.usuarios_tienda where ldap = '77770010';
```

- [ ] **Step 5: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "Task 11: pantallas Mis peticiones + Nueva peticion (3 tipos)"
```

---

## Task 12: Pantalla Detalle

**Files:**
- Modify: `kairos-portal/Portal.html`

- [ ] **Step 1: Añadir `renderDetalle()`**

```html
<script>
  function renderDetalle(id) {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card" id="detalle">' +
        '<button class="btn btn-ghost" id="btnVolver">‹ Volver</button>' +
        '<p style="color:var(--muted)">Cargando…</p>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnVolver').onclick = renderCola;

    gas('obtenerDetallePeticion', LDAP, id).then(function (r) {
      const p = r.peticion;
      var camposTipo = '';
      if (p.tipo === 'pedido_cliente') {
        camposTipo = '<div><b>Nº pedido</b> ' + escHtml(p.num_pedido) + '</div>' +
          '<div><b>Transporte</b> ' + (p.transporte ? 'Sí (consolida en plataforma)' : 'No') + '</div>';
      } else if (p.tipo === 'cesion') {
        camposTipo = '<div><b>Destino</b> ' + escHtml(ETIQUETA_TIPO[p.tienda_destino] || p.tienda_destino) + '</div>';
      } else {
        camposTipo = '<div><b>Motivo</b> ' + escHtml(p.motivo) + '</div>';
      }
      const filasLineas = r.lineas.map(function (l) {
        return '<div class="linea-chip"><span>' + escHtml(l.codigo_lm) + ' · ' + escHtml(l.designacion || '—') +
          ' · ' + l.cantidad + ' ' + escHtml(l.unidad_medida) + '</span>' +
          '<span class="estado">' + escHtml(l.estado_preparacion) + '</span></div>';
      }).join('');
      const hodosLinea = r.hodosTexto ? '<div style="margin-top:8px;"><b>HODOS</b> ' + escHtml(r.hodosTexto) + '</div>' : '';

      const cont = app().querySelector('#detalle');
      cont.innerHTML =
        '<button class="btn btn-ghost" id="btnVolver2">‹ Volver</button>' +
        '<h2>' + escHtml(ETIQUETA_TIPO[p.tipo]) + '</h2>' +
        '<span class="estado">' + escHtml(p.estadoTexto) + '</span>' +
        '<div style="margin-top:8px;">' + camposTipo + '</div>' +
        hodosLinea +
        (p.comentario ? '<div style="margin-top:8px;"><b>Comentario</b> ' + escHtml(p.comentario) + '</div>' : '') +
        '<hr style="border-color:var(--line);margin:12px 0;">' +
        filasLineas;
      cont.querySelector('#btnVolver2').onclick = renderCola;
    }).catch(function (e) {
      app().querySelector('#detalle').innerHTML = '<p class="error">' + escHtml(e.message) + '</p>';
    });
  }
</script>
```

- [ ] **Step 2: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 12: pantalla Detalle"
```

- [ ] **Step 3: Verificar con Claude-in-Chrome**

Repetir la creación de una petición de prueba (como en la Task 11), esta vez
pulsar sobre la fila en "Mis peticiones" en vez de solo comprobar la lista.
Confirmar que el detalle muestra Nº de pedido, estado, y la línea con su
cantidad. Limpiar en Supabase igual que en la Task 11.

- [ ] **Step 4: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "Task 12: pantalla Detalle de peticion"
```

---

## Task 13: Pantalla Admin

**Files:**
- Modify: `kairos-portal/Portal.html`

- [ ] **Step 1: Añadir el acceso admin (por URL) y `renderAdmin()`**

```html
<script>
  if (new URLSearchParams(window.location.search).get('admin') === '1') {
    render = renderAdminLogin; // sustituye el router normal en esta pestaña
  }

  function renderAdminLogin() {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<h2>Kairos · Admin</h2>' +
        '<input class="entrada" id="inPass" type="password" placeholder="Contraseña de administrador">' +
        '<div class="error" id="errAdmin" style="display:none;"></div>' +
        '<button class="btn btn-primary" id="btnAdminEntrar">Entrar</button>' +
      '</div></div>'
    );
    app().appendChild(c);
    c.querySelector('#btnAdminEntrar').onclick = function () {
      const pass = c.querySelector('#inPass').value;
      renderAdmin(pass);
    };
  }

  function renderAdmin(passwordAdmin) {
    app().innerHTML = '';
    const c = el(
      '<div class="wrap"><div class="card">' +
        '<h2>Pendientes de aprobar</h2>' +
        '<div id="listaAdmin"><p style="color:var(--muted)">Cargando…</p></div>' +
      '</div></div>'
    );
    app().appendChild(c);
    const lista = c.querySelector('#listaAdmin');

    function cargar() {
      gas('listarPendientesAprobacion', passwordAdmin).then(function (filas) {
        lista.innerHTML = '';
        if (!filas.length) { lista.appendChild(el('<p style="color:var(--muted)">No hay nadie pendiente.</p>')); return; }
        filas.forEach(function (u) {
          const fila = el(
            '<div class="fila" style="cursor:default;">' +
              '<div><b>' + escHtml(u.ldap) + '</b> · ' + escHtml(u.tiendaNombre) + '</div>' +
              '<div>' +
                '<button class="btn-ghost" style="width:auto;padding:6px 10px;" data-a="ap">Aprobar</button> ' +
                '<button class="btn-ghost" style="width:auto;padding:6px 10px;color:var(--danger);" data-a="re">Rechazar</button>' +
              '</div>' +
            '</div>'
          );
          fila.querySelector('[data-a="ap"]').onclick = function () {
            gas('aprobarUsuario', passwordAdmin, u.id).then(cargar);
          };
          fila.querySelector('[data-a="re"]').onclick = function () {
            if (!confirm('¿Rechazar a ' + u.ldap + '?')) return;
            gas('rechazarUsuario', passwordAdmin, u.id).then(cargar);
          };
          lista.appendChild(fila);
        });
      }).catch(function (e) {
        lista.innerHTML = '<p class="error">' + escHtml(e.message) + '</p>';
      });
    }
    cargar();
  }
</script>
```

- [ ] **Step 2: Push y desplegar**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Task 13: pantalla Admin"
```

- [ ] **Step 3: Verificar con Claude-in-Chrome**

```sql
insert into preparacion.usuarios_tienda (ldap, tienda, aprobado) values ('77770020','279',false);
```

`navigate` a `<url>?admin=1`. Meter la `ADMIN_PASSWORD` real. Confirmar que
sale `77770020 · Mijas`. Pulsar "Aprobar". Confirmar que desaparece de la
lista.

`execute_sql`:
```sql
select ldap, aprobado from preparacion.usuarios_tienda where ldap = '77770020';
delete from preparacion.usuarios_tienda where ldap = '77770020';
```

Esperado antes de borrar: `aprobado = true`.

- [ ] **Step 4: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "Task 13: pantalla Admin (aprobar/rechazar por URL ?admin=1)"
```

---

## Task 14: Cierre — quitar el arnés de depuración y desplegar estable

**Files:**
- Modify: `kairos-portal/Codigo.js` (quitar la rama `debug`)
- Modify: `supabase/README.md` (anotar el scriptId de kairos-portal)
- Modify: `README.md` (estado de la pieza 2)

- [ ] **Step 1: Simplificar `kairos-portal/Codigo.js`**

```js
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Portal')
    .setTitle('Kairos · Portal de tienda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
```

(Se elimina `_responderDebug_`, `FUNCIONES_DEBUG_PERMITIDAS` y la rama
`?debug=test` — ya no hace falta, todas las funciones están probadas.)

- [ ] **Step 2: Push y desplegar la versión final**

```bash
clasp push -f
clasp deploy -i <deployment-id> -d "Pieza 2 completa: portal de tienda"
```

- [ ] **Step 3: Verificar que `?debug=test` ya no responde**

Navegar a `<url>?debug=test&fn=test_supaSmoke`.

Esperado: se sirve `Portal.html` normal (ignora el parámetro `debug`), no el
JSON de antes.

- [ ] **Step 4: Prueba de extremo a extremo con un usuario de prueba real, de principio a fin**

Con Claude-in-Chrome:
1. Registrar un LDAP nuevo desde la pantalla normal.
2. Aprobarlo desde `?admin=1`.
3. Volver a entrar con ese LDAP.
4. Crear una petición de cada tipo (pedido cliente, cesión, refill).
5. Abrir el detalle de cada una y comprobar que se ve bien.
6. `execute_sql` para limpiar todo lo creado en esta prueba.

- [ ] **Step 5: Actualizar `supabase/README.md`**

Añadir bajo la sección de `kairos-sync`:

```markdown
## Proyecto `kairos-portal` (Apps Script)

scriptId: `<el anotado en la Task 1>`
Portal de tienda (pieza 2): login sin contraseña (solo LDAP), crear
peticiones, ver estado + estado HODOS. `ADMIN_PASSWORD` y
`SUPABASE_SERVICE_KEY` en Propiedades del script.
```

- [ ] **Step 6: Actualizar `README.md`**

```markdown
| 2 | Portal de tienda — crear peticiones + ver estado | ✅ completa |
```

- [ ] **Step 7: Commit final**

```bash
git add kairos-portal/Codigo.js supabase/README.md README.md
git commit -m "Pieza 2 (Portal de tienda) COMPLETA: arnes de depuracion retirado"
```

---

## Self-Review

**Cobertura de la spec (pieza 2):**

| Sección spec | Tarea(s) |
|---|---|
| §2 Login solo LDAP, sin Supabase Auth, filtrado en servidor | Tasks 3, 4 |
| §3 Cambio de esquema `usuarios_tienda` | Task 3 |
| §4 Pantallas (las 7) | Tasks 9–13 |
| §5 Formulario por tipo + buscador LM con foto | Tasks 6, 11 |
| §6 Traducción de estados + estado HODOS por cruce sin puente nuevo | Task 8, 12 |
| §7 Fuera de alcance (Carta de Portes SIE, detalle de palets refill) | No hay tarea — correcto, es explícitamente lo que NO se construye |

**Sin placeholders:** todo el código (SQL, `.js`, `.html`) está completo, sin
"TBD" ni "añadir validación" sin mostrar cómo.

**Consistencia de tipos:** `entrar()`/`registrarUsuario()`/`_tiendaDe_()` en
Acceso.js (Task 4) se reutilizan igual en Peticiones.js (Tasks 7-8) y Admin.js
no las toca. `TRADUCCION_ESTADO` se define una vez (Task 7) y la usa también
Task 8. `supaSelect_/supaInsert_/supaInsertMany_/supaUpdate_/supaDelete_`
(Task 2) son la única vía de acceso a Supabase en todos los `.js` posteriores
— ningún archivo llama a `UrlFetchApp` directamente salvo `Supabase.js`. El
esquema por defecto de todos los helpers es `preparacion`; solo la consulta a
`etiquetas` en Task 8 pasa `CFG.SCHEMA_HODOS` explícito.

**Fuera de alcance (correcto, otras piezas):** preparación real de las líneas
(pieza 3), disparo de myISO para refill (pieza 3/4), lectura de estado HODOS
más allá del cruce simple ya cubierto (pieza 4 puede enriquecerlo, no hace
falta aquí).
