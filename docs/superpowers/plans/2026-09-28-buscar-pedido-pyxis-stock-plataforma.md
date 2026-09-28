# Pieza 13: Buscar por pedido + stock en plataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el límite conocido del cálculo de remanente de stock en
refill, y añadir a `kairos-portal` una búsqueda por número de pedido
cliente que añade en bloque los artículos que hay en plataforma.

**Architecture:** Fix puntual en `kairos-operario/StockAsignacion.js`
(mismo formato de sscc que ya usa el reparto normal). Nueva tabla
`preparacion.pedidos_pyxis`, cargada a diario por `kairos-sync` desde el
Excel de Pyxis (`014.xlsx`/`279.xlsx`, conversión xlsx→Sheets vía Drive
Advanced Service). `kairos-portal` añade dos archivos de servidor nuevos
(cálculo de stock disponible + búsqueda) y un bloque de UI nuevo en
`Portal.html`, todo sobre el carrito de líneas que ya existe.

**Tech Stack:** Google Apps Script (V8), Supabase Postgres (esquema
`preparacion`), `clasp`.

**Spec:** `docs/superpowers/specs/2026-09-28-buscar-pedido-pyxis-stock-plataforma-design.md`

**Nota de proceso:** este proyecto no tiene framework de tests unitarios
para el código Apps Script — la verificación establecida es (a)
comprobación de sintaxis de cada bloque `<script>`/archivo `.js` con
Node (`new Function(codigo)`, ver memoria
`tecnica-verificar-js-gas-con-node-antes-de-push`) antes de cada push, y
(b) verificación manual E2E contra datos reales tras desplegar. Los
pasos de este plan siguen ese patrón en vez de un test runner que no
existe aquí. Se trabaja directo sobre `main` (mismo flujo que el resto
de la sesión en este proyecto — sin worktree/rama nueva).

---

### Task 1: Migración Supabase — tabla `preparacion.pedidos_pyxis`

**Files:**
- Create: `Kairos/supabase/migrations/029_pedidos_pyxis.sql`

- [ ] **Step 1: Escribir la migración**

```sql
create table preparacion.pedidos_pyxis (
  id uuid primary key default gen_random_uuid(),
  tienda text not null,
  num_pedido text not null,
  direccion text not null,
  seccion text,
  ref_lm text not null,
  ean text,
  designacion text not null,
  cantidad numeric not null,
  fecha_entrega text,
  sincronizado_en timestamptz not null default now()
);

create index pedidos_pyxis_busqueda_idx
  on preparacion.pedidos_pyxis (tienda, num_pedido);

create index pedidos_pyxis_ref_idx
  on preparacion.pedidos_pyxis (tienda, ref_lm);
```

- [ ] **Step 2: Aplicar la migración**

Usar la herramienta MCP de Supabase (`apply_migration`, proyecto
`dbxlrnupiwemnarlxmcv`) con el nombre `pedidos_pyxis` y el SQL de arriba.
Alternativa si el MCP no está disponible: pegar el SQL en el SQL Editor
del proyecto Supabase y ejecutar a mano.

- [ ] **Step 3: Verificar**

Confirmar que la tabla existe (`list_tables` o `select 1 from
preparacion.pedidos_pyxis limit 1` — debe devolver 0 filas, no error).

- [ ] **Step 4: Commit**

```bash
git add "Kairos/supabase/migrations/029_pedidos_pyxis.sql"
git commit -m "feat(supabase): tabla pedidos_pyxis para busqueda por pedido cliente"
```

---

### Task 2: Cerrar el límite del refill — `StockAsignacion.js`

**Files:**
- Modify: `kairos-operario/StockAsignacion.js:143-171` (`_asignarSsccSiFalta_`)
- Modify: `kairos-operario/StockAsignacion.js:207-224` (`cambiarPaletLinea`)

- [ ] **Step 1: Fix en `_asignarSsccSiFalta_`**

Cambiar el branch de refill (dentro de `_asignarSsccSiFalta_`) de:

```js
  if (peticion.tipo === 'refill') {
    const c = candidatos.filter(function (x) { return x.cantidad > 0; })[0];
    if (!c) throw new Error('Sin palet disponible para el código ' + linea.codigo_lm + '.');
    resultado = { sscc: c.sscc, ubicacion: c.ubicacion };
  } else {
```

a:

```js
  if (peticion.tipo === 'refill') {
    const c = candidatos.filter(function (x) { return x.cantidad > 0; })[0];
    if (!c) throw new Error('Sin palet disponible para el código ' + linea.codigo_lm + '.');
    // Refill se lleva el palet ENTERO: se guarda la cantidad real en el
    // propio string del sscc (mismo formato "sscc (Xud)" que ya usa el
    // reparto normal) para que el remanente de otras líneas del mismo
    // código se calcule bien — límite conocido, ver README.md:106.
    resultado = { sscc: c.sscc + ' (' + c.cantidad + 'ud)', ubicacion: c.ubicacion };
  } else {
```

- [ ] **Step 2: Fix en `cambiarPaletLinea`**

Sustituir la función completa por:

```js
function cambiarPaletLinea(lineaId, sscc, ubicacion) {
  sscc = String(sscc || '').trim();
  ubicacion = String(ubicacion || '').trim();
  if (!sscc || !ubicacion) throw new Error('Falta el SSCC o la ubicación del palet elegido.');

  const lineaFilas = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=id,codigo_lm,peticion_id');
  if (!lineaFilas.length) throw new Error('Línea no encontrada.');
  const linea = lineaFilas[0];

  const peticionFilas = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(linea.peticion_id) + '&select=tipo,tienda_origen');
  if (!peticionFilas.length) throw new Error('Petición no encontrada.');
  const peticion = peticionFilas[0];

  var ssccGuardar = sscc;
  if (peticion.tipo === 'refill') {
    // Mismo motivo que en _asignarSsccSiFalta_: refill se lleva el palet
    // entero, hay que guardar su cantidad real en el string del sscc.
    const candidato = supaSelect_('stock_fisico',
      'tienda=eq.' + encodeURIComponent(peticion.tienda_origen) +
      '&codigo_lm=eq.' + encodeURIComponent(linea.codigo_lm) +
      '&sscc=eq.' + encodeURIComponent(sscc));
    if (!candidato.length) throw new Error('No se pudo verificar la cantidad de ese palet, prueba de nuevo.');
    ssccGuardar = sscc + ' (' + candidato[0].cantidad + 'ud)';
  }

  // sscc_asignado_en también se actualiza aquí (bug real, revisión con Codex
  // CLI 2026-09-22): si no, un palet elegido a mano después del último sync
  // quedaba con la marca de tiempo vieja y _usoComprometidoPorSscc_ (filtro
  // sscc_asignado_en >= último sync) lo trataba como si no estuviera
  // comprometido — podía volver a asignarse a otra línea.
  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    sscc: ssccGuardar,
    ubicacion: ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
```

- [ ] **Step 3: Verificar sintaxis con Node**

```bash
node -e "new Function(require('fs').readFileSync('kairos-operario/StockAsignacion.js','utf8')); console.log('OK sintaxis')"
```

Esperado: `OK sintaxis`, sin excepción.

- [ ] **Step 4: Push y deploy**

```bash
cd kairos-operario
clasp push --force
clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A -d "fix: remanente correcto tras refill de palet completo"
```

- [ ] **Step 5: Verificación manual E2E**

1. Hacer un refill de un palet con >1 unidad del mismo código (tienda
   014 o 279). Comprobar en Supabase que `lineas.sscc` de esa línea
   terminó en `" (Xud)"` con X = cantidad real del palet.
2. El mismo día, crear un pedido_cliente con una línea de ese mismo
   código. Confirmar que el candidato de ese palet ya NO aparece con
   remanente completo (debe reflejar que el refill ya se lo llevó).
3. Repetir el punto 1 usando "🔄 Cambiar palet" en vez de la asignación
   automática — mismo resultado esperado.
4. Caso sin regresión: pedido_cliente con cantidad que necesita repartir
   entre 2 palets — confirmar que el remanente sigue saliendo bien
   (no debería haber cambiado, es la rama que no se tocó).

- [ ] **Step 6: Commit**

```bash
git add kairos-operario/StockAsignacion.js
git commit -m "fix(operario): remanente de stock correcto tras refill de palet completo"
```

---

### Task 3: `kairos-sync` — cargar `pedidos_pyxis` desde Pyxis

**Files:**
- Modify: `kairos-sync/Config.js`
- Create: `kairos-sync/PedidosPyxisLoader.js`

- [ ] **Step 1: Añadir config nueva**

En `kairos-sync/Config.js`, añadir dentro del objeto `CFG` (después de
`LOTE_UPSERT`):

```js
  PEDIDOS_FOLDER_ID: '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG', // Inventarios_Plataforma (Pyxis)
  PEDIDOS_ARCHIVOS: { '014.xlsx': '014', '279.xlsx': '279' },
  COL_PEDIDO: {
    direccion: ['dirección', 'direccion'],
    numPedido: ['nº ped', 'n ped', 'num ped', 'numero ped'],
    seccion: ['sección', 'seccion'],
    ref: ['ref.', 'ref', 'referencia'],
    ean: ['código ean', 'codigo ean', 'ean'],
    designacion: ['designación', 'designacion'],
    cantidad: ['ctd recep.', 'ctd recep', 'ctd', 'cantidad'],
    fechaEntrega: ['fecha entre.', 'fecha entre', 'fecha entrega'],
  },
```

- [ ] **Step 2: Escribir el loader**

Crear `kairos-sync/PedidosPyxisLoader.js`:

```js
/** Carga/reemplaza preparacion.pedidos_pyxis desde el Excel de Pyxis
 *  ("Listado Inventario Pedido Cliente", 014.xlsx / 279.xlsx, carpeta
 *  Inventarios_Plataforma). A diferencia de CatalogoLoader/StockFisicoLoader
 *  (CSV de texto plano), este es un .xlsx real — hay que convertirlo a
 *  Google Sheets primero (Drive Advanced Service v3, ya habilitado en el
 *  manifest de este proyecto) para poder leer sus celdas. getValues()
 *  sobre un Sheets real devuelve TIPOS NATIVOS (número, Date), no texto
 *  — a diferencia del resto de loaders de este archivo, aquí NO hay que
 *  hacer Number()/replace(',','.') a mano sobre strings. */

function _leerXlsxComoFilas_(archivo) {
  const blob = archivo.getBlob();
  const recurso = { name: 'temp_pedidos_pyxis_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS };
  const temporal = Drive.Files.create(recurso, blob); // v3: create()+name, NO insert()+title (eso es v2)
  try {
    return SpreadsheetApp.openById(temporal.id).getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(temporal.id);
  }
}

function _indiceColumnas_(cabecera, mapa) {
  const normalizada = cabecera.map(function (c) { return String(c).trim().toLowerCase(); });
  const idx = {};
  Object.keys(mapa).forEach(function (clave) {
    idx[clave] = -1;
    for (var i = 0; i < normalizada.length; i++) {
      if (mapa[clave].indexOf(normalizada[i]) !== -1) { idx[clave] = i; break; }
    }
  });
  return idx;
}

/** Regla real (visto en el propio Pyxis, reutilizada de
 *  lm_produccion/ImportarPyxis.gs:deduplicarLineasPyxis_): colapsar solo
 *  cuando pedido+referencia+dirección+cantidad coinciden EXACTOS. Nunca
 *  sumar. Dos líneas con la misma referencia pero designación/dirección
 *  distinta (p.ej. una barra "sobre pedido" cortada a otra longitud) NO
 *  son duplicados y se quedan las dos. */
function _dedupPedidosPyxis_(filas) {
  const vistos = {};
  const resultado = [];
  filas.forEach(function (f) {
    const clave = f.num_pedido + '|' + f.ref_lm + '|' + f.direccion + '|' + f.cantidad;
    if (vistos[clave]) return;
    vistos[clave] = true;
    resultado.push(f);
  });
  return resultado;
}

function _formatearFecha_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, CFG_TZ_ || 'Europe/Madrid', 'dd/MM/yyyy');
  return valor ? String(valor).trim() : null;
}

function _leerPedidosPyxisDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.PEDIDOS_FOLDER_ID);
  const porTienda = {};
  const ahora = new Date().toISOString();

  Object.keys(CFG.PEDIDOS_ARCHIVOS).forEach(function (nombre) {
    const tienda = CFG.PEDIDOS_ARCHIVOS[nombre];
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre + ' — no se toca pedidos_pyxis de la tienda ' + tienda); porTienda[tienda] = null; return; }

    const valores = _leerXlsxComoFilas_(it.next());
    if (valores.length < 2) { porTienda[tienda] = []; return; }

    const idx = _indiceColumnas_(valores[0], CFG.COL_PEDIDO);
    if (idx.numPedido === -1 || idx.ref === -1 || idx.direccion === -1) {
      throw new Error('Cabecera inesperada en ' + nombre + ' — no se encuentran Nº Ped / Ref. / Dirección.');
    }

    const filas = [];
    for (var i = 1; i < valores.length; i++) {
      const fila = valores[i];
      const numPedido = String(fila[idx.numPedido] || '').trim();
      const refLm = String(fila[idx.ref] || '').trim();
      if (!numPedido || !refLm) continue;

      filas.push({
        tienda: tienda,
        num_pedido: numPedido,
        direccion: String(fila[idx.direccion] || '').trim(),
        seccion: idx.seccion !== -1 ? String(fila[idx.seccion] || '').trim() || null : null,
        ref_lm: refLm,
        ean: idx.ean !== -1 ? (String(fila[idx.ean] || '').trim() || null) : null,
        designacion: idx.designacion !== -1 ? String(fila[idx.designacion] || '').trim() : '',
        cantidad: Number(fila[idx.cantidad]) || 0,
        fecha_entrega: idx.fechaEntrega !== -1 ? _formatearFecha_(fila[idx.fechaEntrega]) : null,
        sincronizado_en: ahora,
      });
    }
    porTienda[tienda] = _dedupPedidosPyxis_(filas);
  });
  return porTienda;
}

/** Mismo patrón que _cargarStockFisico_: reemplazo completo por tienda,
 *  nunca se borra si el archivo falta o si da 0 filas habiendo datos
 *  antes (posible archivo corrupto — se avisa y se deja como estaba). */
function cargarPedidosPyxis() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) {
    Logger.log('cargarPedidosPyxis: ya hay una ejecución en curso, se aborta esta.');
    return 0;
  }
  try {
    return _cargarPedidosPyxis_(_leerPedidosPyxisDeExcels_());
  } finally {
    lock.releaseLock();
  }
}

function _cargarPedidosPyxis_(porTienda) {
  var subidas = 0;
  Object.keys(porTienda).forEach(function (tienda) {
    const filas = porTienda[tienda];
    if (filas === null) return;

    if (!filas.length) {
      const habia = supaSelect_('pedidos_pyxis', 'tienda=eq.' + encodeURIComponent(tienda) + '&select=id&limit=1');
      if (habia.length) {
        Logger.log('AVISO: el Excel de pedidos de la tienda ' + tienda + ' dio 0 filas pero había datos antes — NO se reemplaza.');
        return;
      }
    }

    supaDelete_('pedidos_pyxis', 'tienda=eq.' + encodeURIComponent(tienda));
    for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
      const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
      supaInsertMany_('pedidos_pyxis', lote);
      subidas += lote.length;
    }
  });
  Logger.log('Pedidos Pyxis: ' + subidas + ' líneas subidas a Supabase.');
  return subidas;
}

/** Ejecutar desde el editor una vez para programar el refresco diario
 *  (08:00 — después de que Pyxis regenera el Excel, visto en real
 *  ~07:16). Reejecutar es seguro: borra el trigger anterior primero. */
function instalarTriggerPedidosPyxis() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cargarPedidosPyxis') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cargarPedidosPyxis').timeBased().atHour(8).everyDays(1).create();
  Logger.log('Trigger de cargarPedidosPyxis instalado (diario, 08:00).');
}
```

- [ ] **Step 3: Comprobar `CFG_TZ_`**

`_formatearFecha_` usa `CFG_TZ_ || 'Europe/Madrid'` — antes de dar el
paso por bueno, comprobar con `grep -rn "CFG_TZ_" kairos-sync/` si esa
variable ya existe en el proyecto (usada en otro loader) o si hay que
usar directamente el literal `'Europe/Madrid'` sin la variable. Ajustar
la línea según lo que exista.

- [ ] **Step 4: Verificar sintaxis con Node**

```bash
node -e "new Function(require('fs').readFileSync('kairos-sync/PedidosPyxisLoader.js','utf8')); new Function(require('fs').readFileSync('kairos-sync/Config.js','utf8')); console.log('OK sintaxis')"
```

- [ ] **Step 5: Push**

```bash
cd kairos-sync
clasp push --force
```

- [ ] **Step 6: Ejecutar una vez desde el editor de Apps Script**

Abrir el proyecto (`clasp open`), ejecutar `cargarPedidosPyxis` a mano
una vez. Debe autorizar el scope de Drive la primera vez (ya está en el
manifest, pero la autorización de OAuth es por ejecución humana). Mirar
el log: debe reportar líneas subidas > 0 para 014 y 279 (o el aviso de
archivo no encontrado si algún Excel no está ese día).

- [ ] **Step 7: Instalar el trigger diario**

Ejecutar `instalarTriggerPedidosPyxis` una vez desde el editor.

- [ ] **Step 8: Verificar en Supabase**

`select tienda, count(*) from preparacion.pedidos_pyxis group by
tienda;` — debe haber filas para 014 y 279 (o las que tuvieran Excel ese
día).

- [ ] **Step 9: Commit**

```bash
git add kairos-sync/Config.js kairos-sync/PedidosPyxisLoader.js
git commit -m "feat(sync): cargar pedidos_pyxis desde el Excel de Pyxis (014/279)"
```

---

### Task 4: `kairos-portal` — stock disponible + búsqueda por pedido (servidor)

**Files:**
- Create: `kairos-portal/StockDisponible.js`
- Create: `kairos-portal/PedidoPyxis.js`

- [ ] **Step 1: Confirmar el nombre real del helper de tienda**

`grep -n "_tiendaDe_" kairos-portal/Acceso.js` — confirmar que existe
con esa firma (`_tiendaDe_(ldap)`) antes de usarlo en el Step 3. Si el
nombre o la firma difieren, ajustar `PedidoPyxis.js` al nombre real.

- [ ] **Step 2: Escribir `StockDisponible.js`**

```js
/** Cálculo de stock disponible por código+tienda, solo lectura — versión
 *  simplificada del reparto de kairos-operario/StockAsignacion.js para el
 *  portal (aquí no hace falta elegir SSCC concretos, solo un total).
 *
 *  Duplicación deliberada del criterio de parseo del sscc: si cambia el
 *  formato en StockAsignacion.js (sscc + " (Xud)"), hay que actualizar
 *  esta función a la vez, si no una línea de refill se cuenta mal aquí
 *  (mismo bug que se cerró en la Parte A de la spec). */
function _totalComprometido_(tienda, codigoLm, desde) {
  var q = 'codigo_lm=eq.' + encodeURIComponent(codigoLm) +
    '&sscc=not.is.null&select=sscc,cantidad,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  if (desde) q += '&sscc_asignado_en=gte.' + encodeURIComponent(desde);
  const filas = supaSelect_('lineas', q);
  var total = 0;
  filas.forEach(function (l) {
    const raw = String(l.sscc || '');
    const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
    partes.forEach(function (p) {
      const m = p.trim().match(/\((\d+(?:[.,]\d+)?)\s*ud\)$/);
      total += m ? Number(m[1].replace(',', '.')) : (partes.length === 1 ? Number(l.cantidad) || 0 : 0);
    });
  });
  return total;
}

function stockDisponible(tienda, codigoLm) {
  const filas = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
  const totalFisico = filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
  const ultimoSync = filas.length ? filas.reduce(function (max, f) { return f.sincronizado_en > max ? f.sincronizado_en : max; }, '') : null;
  return totalFisico - _totalComprometido_(tienda, codigoLm, ultimoSync);
}
```

- [ ] **Step 3: Escribir `PedidoPyxis.js`**

```js
function buscarPedidoPyxis(ldap, numPedido) {
  const tienda = _tiendaDe_(ldap);
  const lineas = supaSelect_('pedidos_pyxis',
    'tienda=eq.' + encodeURIComponent(tienda) + '&num_pedido=eq.' + encodeURIComponent(String(numPedido).trim()));
  if (!lineas.length) return _json_({ lineas: [] });

  // Varias líneas del pedido pueden compartir código (p.ej. una barra
  // "sobre pedido" cortada a longitudes distintas): el remanente de ese
  // código es un pozo compartido — hay que descontarlo en secuencia
  // dentro de esta misma búsqueda, si no dos líneas del mismo código
  // podrían salir ambas "ok" aunque juntas no quepan en el stock real.
  const disponibleRestante = {};
  return _json_({
    lineas: lineas.map(function (l) {
      if (!(l.ref_lm in disponibleRestante)) disponibleRestante[l.ref_lm] = stockDisponible(tienda, l.ref_lm);
      const disponibleAntes = disponibleRestante[l.ref_lm];
      const tomado = Math.min(Math.max(disponibleAntes, 0), l.cantidad);
      disponibleRestante[l.ref_lm] -= tomado;
      return {
        refLm: l.ref_lm, ean: l.ean, designacion: l.designacion, seccion: l.seccion, cantidad: l.cantidad,
        disponibleEnPlataforma: Math.max(disponibleAntes, 0),
        stock: tomado >= l.cantidad ? 'ok' : (tomado > 0 ? 'parcial' : 'sin'),
      };
    }),
  });
}
```

- [ ] **Step 4: Verificar sintaxis con Node**

```bash
node -e "['kairos-portal/StockDisponible.js','kairos-portal/PedidoPyxis.js'].forEach(f => { new Function(require('fs').readFileSync(f,'utf8')); }); console.log('OK sintaxis')"
```

- [ ] **Step 5: Commit**

```bash
git add kairos-portal/StockDisponible.js kairos-portal/PedidoPyxis.js
git commit -m "feat(portal): buscarPedidoPyxis y calculo de stock disponible"
```

---

### Task 5: `kairos-portal` — UI de búsqueda por pedido

**Files:**
- Modify: `kairos-portal/Portal.html` (formulario de creación de pedido cliente/cesión, función `renderFormulario`)

- [ ] **Step 1: Localizar el punto de inserción**

`grep -n "inNumPedido\|inNumCesion" kairos-portal/Portal.html` — el botón
nuevo va justo después del campo `#inNumPedido` (o `#inNumCesion` para
cesión), antes del bloque de búsqueda manual por EAN. Leer
`renderFormulario(tipo)` completo antes de tocarlo para no romper el
cierre de las plantillas de string existentes.

- [ ] **Step 2: Añadir el HTML del botón + panel de resultados**

Dentro del HTML de `renderFormulario`, inmediatamente después del campo
de número de pedido/cesión, y solo cuando `tipo !== 'refill'`:

```js
(tipo !== 'refill' ?
  '<button type="button" class="btn btn-buscar-pedido" id="btnBuscarPedidoPyxis">🔎 Buscar artículos de este pedido</button>' +
  '<div id="panelPedidoPyxis" style="display:none;"></div>' +
  '<div class="divisor-oa">o añade manualmente</div>'
: '')
```

(Ajustar la clase/marcado exacto al patrón real de `.btn`/`.card` que ya
usa el archivo — revisar el CSS existente antes de inventar clases
nuevas; `.btn-buscar-pedido`/`.divisor-oa` son nombres de ejemplo, si el
archivo ya tiene una convención de nombres de clase para variantes de
botón, seguirla en vez de crear una paralela.)

- [ ] **Step 3: Wiring del botón de búsqueda**

Dentro de la misma función, después de enganchar los demás listeners del
formulario:

```js
const btnBuscarPedido = c.querySelector('#btnBuscarPedidoPyxis');
if (btnBuscarPedido) {
  btnBuscarPedido.onclick = function () {
    const campoNum = tipo === 'pedido_cliente' ? c.querySelector('#inNumPedido') : c.querySelector('#inNumCesion');
    const num = campoNum.value.trim();
    if (!num) { kAlerta('Escribe primero el número de pedido.'); return; }
    btnBuscarPedido.disabled = true; btnBuscarPedido.textContent = 'Buscando…';
    google.script.run
      .withSuccessHandler(function (json) {
        btnBuscarPedido.disabled = false; btnBuscarPedido.textContent = '🔎 Buscar artículos de este pedido';
        pintarResultadosPedidoPyxis_(JSON.parse(json).lineas, num, tipo, c, lineas, pintarLineas);
      })
      .withFailureHandler(function (err) {
        btnBuscarPedido.disabled = false; btnBuscarPedido.textContent = '🔎 Buscar artículos de este pedido';
        kAlerta(err.message);
      })
      .buscarPedidoPyxis(LDAP, num);
  };
}
```

- [ ] **Step 4: Función de pintado + añadido en bloque**

Añadir como función de nivel de módulo (junto a las demás funciones
`render*`/`pintar*` de `Portal.html`):

```js
function pintarResultadosPedidoPyxis_(lineasPyxis, numBuscado, tipo, c, lineas, pintarLineas) {
  const panel = c.querySelector('#panelPedidoPyxis');
  if (!lineasPyxis.length) {
    panel.style.display = 'block';
    panel.innerHTML = '<p class="sub">No se encontró el pedido ' + escHtml(numBuscado) + ' en Pyxis para esta tienda.</p>';
    return;
  }

  const bloquea = tipo === 'pedido_cliente'; // cesión avisa, no bloquea — mismo criterio que la búsqueda manual
  panel.style.display = 'block';
  panel.innerHTML = '<div class="panel-pyxis">' +
    lineasPyxis.map(function (l, i) {
      const chipClase = l.stock === 'ok' ? 'ok' : (l.stock === 'parcial' ? 'parcial' : 'sin');
      const chipTexto = l.stock === 'sin' ? '✕ Sin stock en plataforma' :
        (l.stock === 'parcial' ? '◐ ' + l.disponibleEnPlataforma + ' de ' + l.cantidad + ' uds' : '✓ ' + l.disponibleEnPlataforma + ' uds en plataforma');
      const deshabilitado = bloquea && l.stock === 'sin';
      return '<label class="linea-pyxis' + (deshabilitado ? ' deshabilitada' : '') + '">' +
        '<input type="checkbox" data-idx="' + i + '"' + (l.stock !== 'sin' ? ' checked' : '') + (deshabilitado ? ' disabled' : '') + '>' +
        '<span>' + escHtml(l.designacion) + '<br><span class="meta">Ref. ' + escHtml(l.refLm) + (l.ean ? ' · EAN ' + escHtml(l.ean) : '') + ' · ' + l.cantidad + ' uds</span>' +
        '<span class="chip-stock ' + chipClase + '">' + chipTexto + '</span></span></label>';
    }).join('') +
    '<button type="button" class="btn btn-primary" id="btnAnadirPyxis">➕ Añadir seleccionados</button>' +
    '</div>';

  panel.querySelector('#btnAnadirPyxis').onclick = function () {
    const checks = panel.querySelectorAll('input[type=checkbox]:checked');
    checks.forEach(function (chk) {
      const l = lineasPyxis[Number(chk.dataset.idx)];
      lineas.push({ codigoLm: l.refLm, designacion: l.designacion, ean: l.ean, seccion: l.seccion, cantidad: l.cantidad });
    });
    if (tipo === 'pedido_cliente') {
      const campoNum = c.querySelector('#inNumPedido');
      if (!campoNum.value.trim()) campoNum.value = numBuscado;
    }
    panel.style.display = 'none';
    panel.innerHTML = '';
    pintarLineas();
  };
}
```

(Shape de cada línea — `{codigoLm, designacion, ean, seccion, cantidad}`
— igual al que ya usa la búsqueda manual en `Portal.html:1747-1750`, así
que `crearPeticion`/`Peticiones.js` la reciben sin cambios.)

- [ ] **Step 5: CSS del panel/chips**

Añadir en el bloque `<style>` de `Portal.html`, reutilizando los tokens
ya existentes (`--ink-800`, `--accent`, `--ok`, `--warn-fg`,
`--danger-fg` — NO inventar colores nuevos, mockup de referencia:
Artifact `kairos-buscar-pedido-mockup`):

```css
.panel-pyxis{margin-top:10px;border:1px solid var(--ink-800);border-radius:var(--radius-card);padding:10px;}
.linea-pyxis{display:flex;gap:10px;align-items:flex-start;padding:8px 2px;border-bottom:1px solid var(--ink-800);}
.linea-pyxis:last-of-type{border-bottom:none;}
.linea-pyxis.deshabilitada{opacity:.5;}
.linea-pyxis .meta{font-size:11.5px;color:var(--text-500);}
.chip-stock{display:inline-block;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;margin-top:4px;}
.chip-stock.ok{background:var(--ok-ink);color:var(--ok);}
.chip-stock.parcial{background:var(--warn-bg);color:var(--warn-fg);}
.chip-stock.sin{background:var(--danger-bg);color:var(--danger-fg);}
```

- [ ] **Step 6: Verificar sintaxis con Node (todos los bloques `<script>`)**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('kairos-portal/Portal.html','utf8');
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
bloques.forEach((m,i) => { new Function(m[1]); });
console.log(bloques.length + ' bloques, sin errores de sintaxis.');
"
```

- [ ] **Step 7: Verificación visual (harness local)**

Reusar la técnica ya usada en esta sesión: copia estática de
`Portal.html` con el stub de `google.script.run`, servida con
`python3 serve_utf8.py` vía una entrada temporal en `.claude/launch.json`,
abierta en el navegador integrado con `resize_window({preset:'mobile'})`.
Simular `buscarPedidoPyxis` en el stub devolviendo un resultado con las 4
líneas del mockup (2 ok, 1 parcial, 1 sin stock) y confirmar visualmente
contra el Artifact `kairos-buscar-pedido-mockup` — posición del botón,
chips, bloqueo del checkbox en pedido_cliente. Repetir con `tipo='cesion'`
y confirmar que el checkbox de "sin stock" NO sale deshabilitado.
Eliminar la entrada temporal de `launch.json` al terminar.

- [ ] **Step 8: Push y deploy**

```bash
cd kairos-portal
clasp push --force
clasp deploy -i AKfycbx-OUWwyJijJJLFmpSnVDDDCPjgj6YG2SkbGhKny2rlebGUgoiTBohgcgbwVKhfAJyN -d "feat: buscar por pedido cliente (Pyxis) + stock en plataforma"
```

- [ ] **Step 9: Verificación E2E en real**

Con un pedido real ya en `pedidos_pyxis` (tras el Task 3): buscar por su
número en pedido_cliente, confirmar chips correctos, pulsar "Añadir
seleccionados", confirmar que las líneas caen en el carrito con la
cantidad correcta, y que el nº de pedido se autorrellena si estaba
vacío. Repetir en cesión y confirmar que el bloqueo NO aplica ahí.

- [ ] **Step 10: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "feat(portal): UI de busqueda por pedido cliente (Pyxis) con stock en plataforma"
```

---

### Task 6: Cierre

- [ ] **Step 1: Actualizar `Kairos/supabase/README.md`**

Quitar o marcar como resuelta la limitación documentada en las líneas
106-113 (refill + remanente), enlazando a este plan/spec.

- [ ] **Step 2: Actualizar memoria del proyecto**

Añadir a la memoria `kairos-plataforma-pedidos-taisa` que la Pieza 13
(pendiente listada ahí) queda completa, con fecha y referencia a este
plan.

- [ ] **Step 3: Usar `superpowers:finishing-a-development-branch`**

Repo normal (sin worktree para este trabajo) — verificar que no queda
nada roto (Node syntax check ya pasado en cada task) y decidir con el
usuario si esto queda tal cual en `main` (ya se ha ido commiteando
directo) o si prefiere abrir PR — dado que el resto de la sesión ha
trabajado directo sobre `main` sin rama, lo natural es seguir igual,
pero preguntar antes de asumirlo.
