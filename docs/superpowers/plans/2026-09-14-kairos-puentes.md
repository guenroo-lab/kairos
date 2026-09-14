# Pieza 4 · Puentes myISO — Plan de implementación

> **Para ejecución agéntica:** sin framework de test en este ecosistema (ya
> confirmado en Piezas 1-3). Los pasos "test" se sustituyen por
> **verificación en vivo** (`execute_sql`, `clasp push`, prueba manual del
> deploy real). Ejecutar con **superpowers:executing-plans** en esta misma
> sesión, tarea por tarea, **sin subagentes** (instrucción explícita del
> usuario, en vigor desde Pieza 2). El deep-link `http-shortcuts://` real
> solo se puede probar de punta a punta en el dispositivo Android físico del
> operario — donde no sea posible, se verifica que la URL se arma
> correctamente (log/alert) sin disparar la navegación real.

**Goal:** conectar Kairos con myISO Gestión de Stock replicando el mecanismo
real ya en producción (`PreparacionPedidosPC`): asignación automática de
SSCC contra un snapshot diario de inventario, TRANSFERS (consumo de stock)
para pedido_cliente/cesión, move-to-address (destino fijo XP1) para refill.

**Architecture:** nueva tabla `preparacion.stock_fisico` sincronizada a
diario por `kairos-sync` desde el mismo Excel de Drive ya usado para el
catálogo. `kairos-operario` asigna SSCC al **abrir** el detalle de una
petición (no al marcar la línea — el deep-link tiene que dispararse
síncronamente en el gesto de clic, así que el SSCC debe estar ya calculado
de antemano). El cliente arma los deep-links usando los datos ya en memoria.

**Tech Stack:** igual que piezas anteriores — Apps Script V8, HtmlService,
Supabase PostgREST, `clasp`. Nuevo: esquema de deep-link `http-shortcuts://`
(app Android, sin SDK ni librería — solo `window.location.href`).

---

## Estructura de ficheros

```
supabase/migrations/012_stock_fisico.sql        — tabla nueva + columna lineas.sscc_asignado_en

kairos-sync/Config.js                            — modificar: columnas del inventario para stock físico
kairos-sync/StockFisicoLoader.js                 — nuevo: sync completo diario

kairos-operario/StockAsignacion.js               — nuevo: algoritmo de asignación (replica buscarYAsignarSSCC_)
kairos-operario/Peticion.js                      — modificar: obtenerPeticion asigna SSCC al abrir
kairos-operario/Index.html                       — modificar: deep-links síncronos en el clic
```

---

## Task 0: Rama de trabajo

- [ ] **Paso 1: Crear rama**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos"
git checkout -b pieza-4-puentes-myiso
```

---

## Task 1: Migración Supabase

**Files:**
- Create: `supabase/migrations/012_stock_fisico.sql`

- [ ] **Paso 1: Escribir migración**

```sql
-- 012 · Stock físico por ubicación (edificio 05), snapshot diario desde el
-- mismo Excel de inventario que ya usa kairos-sync para preparacion.catalogo.
-- No deduplica por LM — una fila por ubicación/SSCC real. Se reemplaza
-- por completo en cada sync (no es upsert incremental).

create table if not exists preparacion.stock_fisico (
  id              uuid primary key default gen_random_uuid(),
  tienda          text not null references preparacion.tiendas(codigo),
  codigo_lm       text not null,
  sscc            text not null,
  ubicacion       text not null,
  cantidad        numeric not null,
  sincronizado_en timestamptz not null
);

create index if not exists stock_fisico_tienda_lm_idx
  on preparacion.stock_fisico (tienda, codigo_lm);

-- Marca cuándo se asignó el SSCC a una línea — el algoritmo de reparto solo
-- cuenta como "ya comprometido" lo asignado desde el último sync de
-- stock_fisico de esa tienda (ver kairos-operario/StockAsignacion.js).
alter table preparacion.lineas
  add column if not exists sscc_asignado_en timestamptz;
```

- [ ] **Paso 2: Aplicar migración**

Vía MCP `apply_migration`, `project_id`: `dbxlrnupiwemnarlxmcv`, `name`:
`012_stock_fisico`, `query`: el contenido íntegro de arriba.

- [ ] **Paso 3: Verificar en vivo**

```sql
select column_name, data_type from information_schema.columns
where table_schema='preparacion' and table_name='stock_fisico'
order by ordinal_position;
```

Confirmar las 6 columnas. Confirmar también
`select column_name from information_schema.columns where table_schema='preparacion' and table_name='lineas' and column_name='sscc_asignado_en';`
devuelve una fila.

- [ ] **Paso 4: Commit**

```bash
git add supabase/migrations/012_stock_fisico.sql
git commit -m "feat(supabase): tabla stock_fisico + lineas.sscc_asignado_en"
```

---

## Task 2: Sync de stock físico (kairos-sync)

**Files:**
- Modify: `kairos-sync/Config.js`
- Create: `kairos-sync/StockFisicoLoader.js`

- [ ] **Paso 1: Añadir configuración**

Añadir a `kairos-sync/Config.js` (dentro del objeto `CFG`, junto a `COL`):

```js
  PREFIJO_EDIFICIO_STOCK: '05',
  COL_STOCK: { direccion: 1, sscc: 4, producto: 5, cantidad: 14 }, // A, D, E, N — mismo Excel
```

Fichero completo tras el cambio:

```js
/** Configuración de Kairos Sync. Los secretos van en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SUPABASE_SCHEMA: 'preparacion',
  // SUPABASE_SERVICE_KEY -> Propiedades del script (service_role, NO se versiona)

  DRIVE_FOLDER_ID: '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg', // carpeta InventarioSIE
  INVENTARIOS: ['014.xlsx', '279.xlsx'],

  // Columnas del Excel de inventario (1-indexed)
  COL: { lm: 5, ean: 6, foto: 7, designacion: 8, seccion: 9 },

  // Stock físico por ubicación — mismo Excel, solo edificio 05
  PREFIJO_EDIFICIO_STOCK: '05',
  COL_STOCK: { direccion: 1, sscc: 4, producto: 5, cantidad: 14 }, // A, D, E, N

  LOTE_UPSERT: 500,
};
```

- [ ] **Paso 2: Implementar StockFisicoLoader.js**

`kairos-sync/StockFisicoLoader.js`:

```js
/** Carga/reemplaza preparacion.stock_fisico desde los mismos Excel de
 *  inventario que usa CatalogoLoader.js — pero sin deduplicar (una fila por
 *  ubicación/SSCC real) y solo edificio 05 (mismo filtro que el sistema
 *  viejo, PreparacionPedidosPC/config.js PREFIJO_EDIFICIO). El nombre del
 *  fichero (014.xlsx / 279.xlsx) indica la tienda de cada fila — mapeo
 *  directo al código de tienda (014→Marbella, 279→Mijas). */

const MAPA_ARCHIVO_TIENDA_ = { '014.xlsx': '014', '279.xlsx': '279' };

function _leerStockFisicoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const filas = [];
  const ahora = new Date().toISOString();

  CFG.INVENTARIOS.forEach(function (nombre) {
    const tienda = MAPA_ARCHIVO_TIENDA_[nombre];
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre); return; }
    const file = it.next();
    const tmp = Drive.Files.create(
      { name: '__tmp_stock_' + nombre, mimeType: MimeType.GOOGLE_SHEETS },
      file.getBlob()
    );
    try {
      const sh = SpreadsheetApp.openById(tmp.id).getSheets()[0];
      const vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) { // fila 0 = cabecera
        const row = vals[i];
        const direccion = String(row[CFG.COL_STOCK.direccion - 1] || '').trim();
        if (direccion.slice(0, 2) !== CFG.PREFIJO_EDIFICIO_STOCK) continue;

        const sscc = String(row[CFG.COL_STOCK.sscc - 1] || '').trim();
        const codigoLm = String(row[CFG.COL_STOCK.producto - 1] || '').trim();
        const cantidad = Number(row[CFG.COL_STOCK.cantidad - 1]) || 0;
        if (!sscc || !codigoLm) continue;

        filas.push({
          tienda: tienda,
          codigo_lm: codigoLm,
          sscc: sscc,
          ubicacion: direccion,
          cantidad: cantidad,
          sincronizado_en: ahora,
        });
      }
    } finally {
      try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
    }
  });
  return filas;
}

/** Reemplazo completo (snapshot) — nunca upsert incremental: una fila que
 *  desapareció del Excel (palet ya no existe en esa ubicación) tiene que
 *  desaparecer también de Supabase. */
function cargarStockFisico() {
  const filas = _leerStockFisicoDeExcels_();

  supaDelete_('stock_fisico', 'id=not.is.null'); // borra todo antes de recargar

  var subidas = 0;
  for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
    const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
    supaInsertMany_('stock_fisico', lote);
    subidas += lote.length;
  }
  Logger.log('Stock físico: ' + subidas + ' ubicaciones subidas a Supabase.');
  return subidas;
}

/** Ejecutar UNA vez desde el editor para programar el refresco diario
 *  (11:00, mismo horario que cargarCatalogo — triggers independientes). */
function instalarTriggerStockFisico() {
  const YA = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'cargarStockFisico';
  });
  if (YA) { Logger.log('El trigger de cargarStockFisico ya está instalado.'); return; }
  ScriptApp.newTrigger('cargarStockFisico').timeBased().everyDays(1).atHour(11).create();
  Logger.log('Trigger diario de cargarStockFisico instalado (11:00 Europe/Madrid).');
}
```

- [ ] **Paso 3: Deploy y ejecución manual**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-sync"
clasp push --force
```

Desde el editor Apps Script, ejecutar `cargarStockFisico` manualmente una
vez (Ejecutar función → ver registro). Confirmar en el log el número de
filas subidas (esperar varios miles, coherente con `~2200-3000` filas de
edificio 05 vistas en la inspección manual del Excel).

- [ ] **Paso 4: Verificar en vivo**

```sql
select tienda, count(*), sum(cantidad) from preparacion.stock_fisico group by tienda;
select * from preparacion.stock_fisico limit 5;
```

Confirmar que hay filas para `014` y `279`, y que `ubicacion` siempre
empieza por `05`.

- [ ] **Paso 5: Instalar trigger diario**

Ejecutar `instalarTriggerStockFisico` una vez desde el editor.

- [ ] **Paso 6: Commit**

```bash
git add kairos-sync/Config.js kairos-sync/StockFisicoLoader.js
git commit -m "feat(sync): cargarStockFisico — snapshot diario edificio 05"
```

---

## Task 3: Algoritmo de asignación de SSCC (kairos-operario)

**Files:**
- Create: `kairos-operario/StockAsignacion.js`

- [ ] **Paso 1: Implementar**

```js
/** Asignación automática de SSCC — replica el algoritmo de
 *  PreparacionPedidosPC/SSCC y Ubicacion.js (buscarYAsignarSSCC_) contra
 *  preparacion.stock_fisico (ya sincronizado) en vez de leer el Excel en
 *  vivo. El operario nunca elige el palet a mano — se calcula solo. */

function _candidatosStock_(tienda, codigoLm) {
  return supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
}

function _ultimoSyncStockFisico_(tienda) {
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&select=sincronizado_en&order=sincronizado_en.desc&limit=1');
  return filas.length ? filas[0].sincronizado_en : null;
}

/** Espejo de _parseCeldaSsccMulti_ (sistema viejo): "sscc1 (Xud) + sscc2 (Yud)"
 *  o un SSCC suelto (se lleva toda la cantidad de la línea). */
function _parseSsccMulti_(valorSscc, cantidadFila) {
  const raw = String(valorSscc || '').trim();
  if (!raw) return [];
  const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
  return partes.map(function (parte) {
    const m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
    if (m) return { sscc: m[1].trim(), cantidad: Number(m[2].replace(',', '.')) || 0 };
    return { sscc: parte.trim(), cantidad: partes.length === 1 ? (Number(cantidadFila) || 0) : 0 };
  });
}

/** Unidades ya comprometidas por SSCC en OTRAS líneas de esa tienda con el
 *  mismo código, asignadas desde el último sync (antes de eso, el snapshot
 *  actual ya refleja el consumo real). */
function _usoComprometidoPorSscc_(tienda, codigoLm, lineaIdExcluir, desde) {
  var q = 'codigo_lm=eq.' + encodeURIComponent(codigoLm) +
    '&sscc=not.is.null&select=id,sscc,cantidad,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  if (desde) q += '&sscc_asignado_en=gte.' + encodeURIComponent(desde);
  const filas = supaSelect_('lineas', q);
  const uso = {};
  filas.forEach(function (l) {
    if (l.id === lineaIdExcluir) return;
    _parseSsccMulti_(l.sscc, l.cantidad).forEach(function (p) {
      if (!p.sscc) return;
      uso[p.sscc] = (uso[p.sscc] || 0) + p.cantidad;
    });
  });
  return uso;
}

/** SSCC ya usados en OTRAS líneas de la MISMA petición (prioridad 1 del
 *  reparto: reutilizar soporte ya abierto para este pedido). */
function _ssccUsadosEnPeticion_(peticionId, lineaIdExcluir) {
  const filas = supaSelect_('lineas',
    'peticion_id=eq.' + encodeURIComponent(peticionId) + '&sscc=not.is.null&select=id,sscc');
  const set = [];
  filas.forEach(function (l) {
    if (l.id === lineaIdExcluir) return;
    _parseSsccMulti_(l.sscc, 0).forEach(function (p) {
      if (p.sscc && set.indexOf(p.sscc) === -1) set.push(p.sscc);
    });
  });
  return set;
}

function _repartirEntreCandidatos_(tienda, linea, candidatos) {
  const desde = _ultimoSyncStockFisico_(tienda);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, desde);
  function remanente(c) { return c.cantidad - (uso[c.sscc] || 0); }
  const necesarias = Number(linea.cantidad);

  const usadosEnPeticion = _ssccUsadosEnPeticion_(linea.peticion_id, linea.id);
  for (var i = 0; i < candidatos.length; i++) {
    if (usadosEnPeticion.indexOf(candidatos[i].sscc) === -1) continue;
    if (remanente(candidatos[i]) >= necesarias) {
      return { sscc: candidatos[i].sscc, ubicacion: candidatos[i].ubicacion };
    }
  }
  for (var j = 0; j < candidatos.length; j++) {
    if (remanente(candidatos[j]) >= necesarias) {
      return { sscc: candidatos[j].sscc, ubicacion: candidatos[j].ubicacion };
    }
  }

  const disponibles = candidatos
    .map(function (c) { return { sscc: c.sscc, ubicacion: c.ubicacion, remanente: remanente(c) }; })
    .filter(function (c) { return c.remanente > 0; })
    .sort(function (a, b) { return b.remanente - a.remanente; });

  var restante = necesarias;
  const reparto = [];
  for (var k = 0; k < disponibles.length && restante > 0; k++) {
    const tomar = Math.min(disponibles[k].remanente, restante);
    reparto.push({ sscc: disponibles[k].sscc, ubicacion: disponibles[k].ubicacion, cantidad: tomar });
    restante -= tomar;
  }
  if (restante > 0) {
    throw new Error('Ni repartiendo entre todos los palets del edificio 05 hay ' +
      necesarias + ' uds del código ' + linea.codigo_lm + ' (faltan ' + restante + ').');
  }
  return {
    sscc: reparto.map(function (r) { return r.sscc + ' (' + r.cantidad + 'ud)'; }).join(' + '),
    ubicacion: reparto.map(function (r) { return r.ubicacion; }).join(' + '),
  };
}

/** Punto de entrada. Si la línea ya tiene sscc, no hace nada (devuelve
 *  null). Si no hay stock suficiente, lanza Error (el caller decide si
 *  bloquear o solo avisar). */
function asignarSsccSiFalta_(linea, peticion) {
  if (linea.sscc) return null;

  const tienda = peticion.tienda_origen;
  const candidatos = _candidatosStock_(tienda, linea.codigo_lm);
  if (!candidatos.length) {
    throw new Error('Sin ubicación en edificio 05 para el código ' + linea.codigo_lm + '.');
  }

  var resultado;
  if (peticion.tipo === 'refill') {
    const c = candidatos.filter(function (x) { return x.cantidad > 0; })[0];
    if (!c) throw new Error('Sin palet disponible para el código ' + linea.codigo_lm + '.');
    resultado = { sscc: c.sscc, ubicacion: c.ubicacion };
  } else {
    resultado = _repartirEntreCandidatos_(tienda, linea, candidatos);
  }

  supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(linea.id), {
    sscc: resultado.sscc,
    ubicacion: resultado.ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  return resultado;
}
```

- [ ] **Paso 2: Deploy**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
```

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/StockAsignacion.js
git commit -m "feat(operario): algoritmo de asignacion automatica de SSCC"
```

(Verificación en vivo de este algoritmo se hace en Task 5, integrada con
`obtenerPeticion`.)

---

## Task 4: Asignar SSCC al abrir el detalle

**Files:**
- Modify: `kairos-operario/Peticion.js`

- [ ] **Paso 1: Modificar `obtenerPeticion`**

Reemplazar la función completa:

```js
function obtenerPeticion(peticionId) {
  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId));
  if (!cab.length) throw new Error('Petición no encontrada.');
  const peticion = cab[0];
  peticion.tiendaNombre = CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen;
  peticion.tiendaDestinoNombre = peticion.tienda_destino ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino) : null;

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  lineas.forEach(function (l) {
    if (l.sscc || l.estado_preparacion === 'preparado') return;
    try {
      const asignado = asignarSsccSiFalta_(l, peticion);
      if (asignado) { l.sscc = asignado.sscc; l.ubicacion = asignado.ubicacion; }
    } catch (err) {
      l.avisoStock = err.message;
    }
  });

  return _json_({ peticion: peticion, lineas: lineas });
}
```

`marcarLineaPreparada` y `guardarUbicacionConsolidacion` **no cambian** —
ya no hacen falta tocar, el trabajo de SSCC ya pasó al abrir el detalle.

- [ ] **Paso 2: Deploy y verificar en vivo**

```bash
clasp push --force
```

Con una petición de prueba (Task 6 crea varias), ejecutar
`obtenerPeticion('<id>')` desde el editor y confirmar que las líneas
vuelven con `sscc`/`ubicacion` rellenos (o `avisoStock` si no hay stock de
prueba para ese código).

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Peticion.js
git commit -m "feat(operario): asignar SSCC al abrir detalle de peticion"
```

---

## Task 5: Deep-links síncronos en el cliente

**Files:**
- Modify: `kairos-operario/Index.html`

- [ ] **Paso 1: Añadir constantes de shortcuts**

Añadir junto a `CFG_TIENDA_COLOR` (dentro del `<script>`):

```js
    var CFG_SHORTCUTS = {
      // TRANSFERS — reutiliza el shortcut YA configurado en el dispositivo
      // Android del operario para PreparacionPedidosPC (misma operación).
      STOCK_SHORTCUT_ID: 'b02c92a5-ca50-418f-93e9-4a7e8770cdfb',
      // move-to-address a 05-XP1-A-1-10-A — shortcut NUEVO, pendiente de
      // crear con Pedro (ver Task 7). Rellenar el ID real tras crearlo.
      SHORTCUT_ID_REFILL: 'PENDIENTE-crear-con-Pedro',
    };
```

- [ ] **Paso 2: Guardar el detalle en memoria al renderizar**

En `renderDetalle`, cambiar la línea final:

```js
      google.script.run.withSuccessHandler(pintarDetalle).obtenerPeticion(VISTA.peticionId);
```

Por (sin cambio de comportamiento, solo asegurar que `pintarDetalle` guarda
el dato — ya lo hace `ultimoDetalle`, ver paso 3).

- [ ] **Paso 3: Modificar `pintarDetalle`**

Reemplazar función completa:

```js
    var ultimoDetalle = null; // {peticion, lineas} con sscc ya asignado — usado por el clic de marcar

    function pintarDetalle(json) {
      const data = JSON.parse(json);
      ultimoDetalle = data;
      const p = data.peticion;
      var titulo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? ('Cesión → ' + p.tiendaDestinoNombre) : ('Refill: ' + (p.motivo || '')));

      var html = '<h1>' + titulo + '</h1><p class="meta">' + p.tiendaNombre + '</p>';
      html += data.lineas.map(function (l) {
        const preparada = l.estado_preparacion === 'preparado';
        const bloqueada = !preparada && !l.sscc; // sin stock asignado, no se puede preparar
        var extra = '';
        if (l.avisoStock) extra = '<div class="meta" style="color:#c62828;">⚠️ ' + l.avisoStock + '</div>';
        else if (l.ubicacion) extra = '<div class="meta">📍 ' + l.ubicacion + '</div>';
        return '<div class="linea' + (preparada ? ' preparada' : '') + '">' +
          '<label><input type="checkbox" ' + (preparada ? 'checked disabled' : (bloqueada ? 'disabled' : '')) + ' onchange="marcarLinea(\'' + l.id + '\', this)"> ' +
          l.codigo_lm + ' — ' + (l.designacion || '') + ' (' + l.cantidad + ' ' + l.unidad_medida + ')' + extra + '</label>' +
          '</div>';
      }).join('');

      if (p.estado === 'a_ubicar') {
        html += '<h3>A ubicar</h3><input type="text" id="ubicacion" placeholder="Ubicación de consolidación"> <button onclick="guardarUbicacion(\'' + p.id + '\')">Guardar</button>';
      } else if (p.estado === 'cerrada') {
        html += '<p><strong>Petición completada.</strong></p>';
      }

      document.getElementById('detalleBody').innerHTML = html;
    }
```

- [ ] **Paso 4: Modificar `marcarLinea` — disparo síncrono del puente**

Reemplazar función completa y añadir las nuevas funciones auxiliares justo
debajo:

```js
    function marcarLinea(lineaId, checkbox) {
      checkbox.disabled = true;
      dispararPuenteMyIsoSiProcede_(lineaId);
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); checkbox.disabled = false; checkbox.checked = false; })
        .marcarLineaPreparada(lineaId, OPERARIO);
    }

    // Debe llamarse SÍNCRONAMENTE dentro del onclick — si se dispara tras la
    // respuesta de google.script.run (async), el navegador bloquea el salto
    // a http-shortcuts:// en silencio. Por eso usa ultimoDetalle (ya en
    // memoria desde que se abrió el detalle) y no espera nada del servidor.
    function dispararPuenteMyIsoSiProcede_(lineaIdMarcada) {
      if (!ultimoDetalle) return;
      const p = ultimoDetalle.peticion;
      const lineas = ultimoDetalle.lineas;

      if (p.tipo === 'refill') {
        const l = lineas.filter(function (x) { return x.id === lineaIdMarcada; })[0];
        if (!l || !l.sscc) return;
        dispararMoveToAddress_([limpiarSscc(l.sscc)], p.tienda_origen);
        return;
      }

      if (p.tipo === 'pedido_cliente' || p.tipo === 'cesion') {
        const quedanPendientes = lineas.some(function (x) {
          return x.id !== lineaIdMarcada && x.estado_preparacion !== 'preparado';
        });
        if (quedanPendientes) return;

        const transfers = [];
        lineas.forEach(function (l) {
          parsearSsccMulti(l.sscc, l.cantidad).forEach(function (parte) {
            if (!parte.sscc || !parte.cantidad) return;
            transfers.push({
              source: limpiarSscc(parte.sscc), sourceType: 'CONTAINER',
              stock: { productId: l.codigo_lm, quantity: parte.cantidad, measureUnit: 'EA', lotId: null, expirationDate: null, blocking: null },
            });
          });
        });
        dispararTransfers_(transfers, p.tienda_origen);
      }
    }

    function limpiarSscc(sscc) { return String(sscc || '').replace(/^0+/, ''); }

    // Espejo de _parseSsccMulti_ (StockAsignacion.js) — "sscc1 (Xud) + sscc2 (Yud)".
    function parsearSsccMulti(valorSscc, cantidadFila) {
      var raw = String(valorSscc || '').trim();
      if (!raw) return [];
      var partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
      return partes.map(function (parte) {
        var m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
        if (m) return { sscc: m[1].trim(), cantidad: Number(m[2].replace(',', '.')) || 0 };
        return { sscc: parte.trim(), cantidad: partes.length === 1 ? (Number(cantidadFila) || 0) : 0 };
      });
    }

    function dispararTransfers_(transfers, tienda) {
      if (!transfers.length) return;
      var url = 'http-shortcuts://' + CFG_SHORTCUTS.STOCK_SHORTCUT_ID +
        '?TRANSFERS=' + encodeURIComponent(JSON.stringify(transfers)) +
        '&TIENDA=' + encodeURIComponent(tienda);
      window.location.href = url;
    }

    function dispararMoveToAddress_(ssccList, tienda) {
      if (!CFG_SHORTCUTS.SHORTCUT_ID_REFILL || CFG_SHORTCUTS.SHORTCUT_ID_REFILL.indexOf('PENDIENTE') === 0) return;
      var url = 'http-shortcuts://' + CFG_SHORTCUTS.SHORTCUT_ID_REFILL +
        '?SSCC_LIST=' + encodeURIComponent(JSON.stringify(ssccList)) +
        '&TIENDA=' + encodeURIComponent(tienda);
      window.location.href = url;
    }
```

- [ ] **Paso 5: Deploy**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A
```

- [ ] **Paso 6: Commit**

```bash
git add kairos-operario/Index.html
git commit -m "feat(operario): deep-links TRANSFERS/move-to-address sincronos"
```

---

## Task 6: Verificación E2E en vivo

Sin framework de test. Verificación contra Supabase real y el deploy real,
protocolo de capturas ya establecido (nunca variar `scale`, usar `zoom` con
región fija).

- [ ] **Paso 1: Datos de prueba en `stock_fisico`**

```sql
insert into preparacion.stock_fisico (tienda, codigo_lm, sscc, ubicacion, cantidad, sincronizado_en) values
  ('014', 'E2E-STOCK-1', '00184000201400900001', '05-LS-A-1-10-A', 3, now()),
  ('014', 'E2E-STOCK-1', '00184000201400900002', '05-LS-A-2-10-A', 10, now()),
  ('279', 'E2E-STOCK-2', '00184000201400900003', '05-LS-B-1-10-A', 1, now());
```

(`E2E-STOCK-1` en Marbella con 2 ubicaciones — para probar reparto entre
varios palets; `E2E-STOCK-2` en Mijas con 1 sola ubicación de 1 unidad —
para refill.)

- [ ] **Paso 2: Caso pedido_cliente con reparto**

Crear petición `pedido_cliente` (Marbella, transporte=false) con 1 línea
`codigo_lm='E2E-STOCK-1'`, `cantidad=8` (no cabe en el primer palet de 3,
sí repartiendo con el segundo de 10). Abrir el detalle en el navegador
(`obtenerPeticion`) y confirmar por `execute_sql`:

```sql
select sscc, ubicacion, cantidad from preparacion.lineas where codigo_lm='E2E-STOCK-1';
```

Esperado: `sscc = '00184000201400900001 (3ud) + 00184000201400900002 (5ud)'`
(el de menor remanente entre los dos que llegan solos... en este caso solo
el segundo llega solo, así que reparte con el primero para tocar menos
soportes — verificar contra la lógica exacta, no asumir).

Marcar la línea preparada en el navegador. Confirmar `estado_preparacion`
y `hodos_id` (dispara HODOS porque `transporte=false`, ya de Pieza 3).

- [ ] **Paso 3: Caso refill**

Crear petición `refill` (Mijas, motivo cualquiera) con 1 línea
`codigo_lm='E2E-STOCK-2'`, `cantidad=1`, `unidad_medida='palet'`. Abrir
detalle, confirmar `sscc='00184000201400900003'`,
`ubicacion='05-LS-B-1-10-A'` sin reparto. Marcar preparada.

- [ ] **Paso 4: Caso sin stock**

Crear petición `pedido_cliente` con línea de un `codigo_lm` que no existe en
`stock_fisico`. Abrir detalle, confirmar que la línea vuelve con
`avisoStock` relleno y el checkbox aparece deshabilitado en la UI
(zoom/captura para confirmar visualmente).

- [ ] **Paso 5: Confirmar deep-link se arma bien (sin dispositivo Android)**

Sin dispositivo físico a mano, no se puede confirmar que HTTP Shortcuts
reciba la llamada — pero sí se puede confirmar que `window.location.href` se
llama con la URL correcta. Añadir temporalmente
`javascript_tool`/`read_console_messages` o un `console.log(url)` antes de
cada `window.location.href` en `dispararTransfers_`/
`dispararMoveToAddress_`, repetir Pasos 2-3, leer la consola del navegador y
verificar el JSON de `TRANSFERS`/`SSCC_LIST` y el código de tienda. Quitar
el `console.log` temporal después (no commitear).

- [ ] **Paso 6: Limpiar datos de prueba**

```sql
delete from preparacion.peticiones where tienda_origen in ('014','279') and (
  exists (select 1 from preparacion.lineas l where l.peticion_id = preparacion.peticiones.id and l.codigo_lm like 'E2E-STOCK-%')
);
delete from preparacion.stock_fisico where codigo_lm like 'E2E-STOCK-%';
```

---

## Task 7: Shortcut Android nuevo (move-to-address a XP1)

**No es código** — tarea manual de configuración, mismo procedimiento ya
documentado para el shortcut de RC1
(`CartadePortesSIE/docs/superpowers/specs/2026-07-22-actualizacion-ubicaciones-rc1-design.md`).

- [ ] **Paso 1:** Con Pedro, crear un shortcut nuevo en HTTP Shortcuts
  (tipo scripting) que reciba `SSCC_LIST` (JSON array) y `TIENDA`, y llame
  `POST .../containers/{SSCC}/move-to-address` con destino fijo
  `05-XP1-A-1-10-A` para cada SSCC de la lista, headers
  `x-performed-by`/`x-store-code` igual que el shortcut de RC1.

- [ ] **Paso 2:** Probar con 1-2 SSCC reales antes de darlo por bueno.

- [ ] **Paso 3:** Rellenar `SHORTCUT_ID_REFILL` en
  `kairos-operario/Index.html` con el ID real, `clasp push --force`,
  `clasp deploy -i <id>`, commit:

```bash
git add kairos-operario/Index.html
git commit -m "feat(operario): ID real del shortcut move-to-address XP1"
```

- [ ] **Paso 4:** Exportar/compartir el shortcut para que el resto de
  dispositivos lo importen con el mismo ID (igual que RC1).

---

## Task 8: Documentación y memoria

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\Kairos\README.md`
- Modify: `C:\Users\30081048\Desktop\Proyectos\Kairos\supabase\README.md`

- [ ] **Paso 1: Actualizar README raíz**

Marcar Pieza 4 completa en la tabla de piezas (o "código completo, shortcut
XP1 pendiente de configurar con Pedro" si Task 7 no se hizo aún).

- [ ] **Paso 2: Actualizar supabase/README.md**

Añadir nota de `preparacion.stock_fisico` (qué es, quién la sincroniza,
cuándo) y de los dos shortcuts (`STOCK_SHORTCUT_ID` reutilizado,
`SHORTCUT_ID_REFILL` nuevo).

- [ ] **Paso 3: Commit**

```bash
git add README.md supabase/README.md
git commit -m "docs: Pieza 4 completa"
```

- [ ] **Paso 4: Memoria** (fuera de git) — actualizar
  `kairos-plataforma-pedidos-taisa.md` y `MEMORY.md` marcando Pieza 4
  completa, con resumen del mecanismo TRANSFERS/move-to-address.

---

## Task 9: Cierre de rama

Usar **superpowers:finishing-a-development-branch** tras Task 6 verificado
sin fallos (Task 7, configuración manual del shortcut, puede quedar
pendiente sin bloquear el cierre — el código ya deja el hueco listo,
`dispararMoveToAddress_` no hace nada mientras `SHORTCUT_ID_REFILL` siga en
`'PENDIENTE-crear-con-Pedro'`).
