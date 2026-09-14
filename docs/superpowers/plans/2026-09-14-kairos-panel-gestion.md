# Kairos · Pieza 5 — Panel de gestión + puente Carta de Portes — Plan de implementación

> **Para ejecución agéntica:** sin framework de test en este ecosistema.
> Verificación en vivo (`execute_sql`, `clasp push`, prueba manual del
> deploy real). Ejecutar con **superpowers:executing-plans**, tarea por
> tarea, **sin subagentes**.

**Goal:** pestaña Stock, rol `jefe_equipo`, pestaña Estado (cruce HODOS +
Carta de Portes por SSCC) y Panel jefe de equipo (todas las peticiones,
etiquetas HODOS creadas, reintento de envío) en `kairos-operario`; puente
aditivo en `PreparacionPedidosPC` que registra el cierre de cada Carta de
Porte en Supabase.

**Architecture:** 3 archivos nuevos en `kairos-operario` (`Stock.js`,
`Estado.js`, `Panel.js`), cambios en `Operarios.js`/`Index.html` para el
routing de pestañas, y 2 archivos nuevos en `PreparacionPedidosPC`
(`PuenteSupabase.js`, cambio aditivo en `Cerrar Carta de Porte.js`).

**Tech Stack:** igual que piezas anteriores (Google Apps Script + Supabase
Postgres vía PostgREST, sin build step).

---

## Task 0: Rama de trabajo

- [ ] **Paso 1:**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos"
git checkout -b panel-gestion-carta-portes
```

---

## Task 1: Migración SQL — rol + estado_porte

**Files:**
- Create: `supabase/migrations/013_panel_gestion.sql`

- [ ] **Paso 1: Crear la migración**

```sql
-- 013 · Pieza 5: rol jefe_equipo + estado_porte (puente Carta de Portes).
-- Sin tocar nada existente.

alter table preparacion.operarios
  add column rol text not null default 'operario'
  check (rol in ('operario', 'jefe_equipo'));

create table preparacion.estado_porte (
  id uuid primary key default gen_random_uuid(),
  sscc text not null,
  estado_carga text,
  estado_recepcion text,
  carta_nombre text,
  cerrado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  unique (sscc)
);
create index estado_porte_sscc_idx on preparacion.estado_porte (sscc);

notify pgrst, 'reload schema';
```

- [ ] **Paso 2: Aplicar con `apply_migration`** (`project_id`
      `dbxlrnupiwemnarlxmcv`, `name` `panel_gestion`, contenido del Paso 1).

- [ ] **Paso 3: Verificar**

```sql
select column_name from information_schema.columns where table_schema='preparacion' and table_name='operarios' and column_name='rol';
select count(*) from preparacion.estado_porte;
```
Esperado: la columna existe; la tabla está vacía (`0`).

- [ ] **Paso 4: Commit**

```bash
git add supabase/migrations/013_panel_gestion.sql
git commit -m "feat(db): rol jefe_equipo + tabla estado_porte"
```

---

## Task 2: kairos-operario — rol en operarios + routing de pestañas

**Files:**
- Modify: `kairos-operario/Operarios.js`
- Modify: `kairos-operario/Index.html`

- [ ] **Paso 1: `listarOperarios` devuelve `rol`**

Reemplazar todo `Operarios.js`:

```js
function listarOperarios() {
  const filas = supaSelect_('operarios', 'activo=eq.true&select=nombre,color,rol&order=nombre.asc');
  return _json_(filas);
}
```

- [ ] **Paso 2: `Index.html` — nuevos globales y CSS de pestañas**

Junto a `var CFG_TIENDA_COLOR = { ... };` (línea 31), añadir:

```js
    var ROL = localStorage.getItem('kairos_rol') || 'operario';
    var CFG_TIENDA_NOMBRE = { '036': 'Málaga', '014': 'Marbella', '279': 'Mijas' };
```

Junto a `#app { max-width: 480px; margin: 0 auto; }` en el `<style>`, añadir:

```css
    .tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .tabs a { padding: 6px 12px; border-radius: 6px; text-decoration: none; color: #333; background: #e0e0e0; font-size: 14px; }
    .tabs a.activa { background: #1565c0; color: #fff; }
```

- [ ] **Paso 3: `renderElegirOperario` guarda el rol**

Reemplazar `renderElegirOperario`:

```js
    function renderElegirOperario() {
      document.getElementById('app').innerHTML = '<h1>Kairos · Operario</h1><p>¿Quién eres?</p><select id="selOperario"><option value="">Cargando…</option></select>';
      google.script.run.withSuccessHandler(function (json) {
        const operarios = JSON.parse(json);
        const sel = document.getElementById('selOperario');
        sel.innerHTML = '<option value="">-- elige --</option>' +
          operarios.map(function (o) { return '<option value="' + o.nombre + '" data-rol="' + o.rol + '">' + o.nombre + '</option>'; }).join('');
        sel.onchange = function () {
          if (!sel.value) return;
          OPERARIO = sel.value;
          ROL = sel.options[sel.selectedIndex].getAttribute('data-rol') || 'operario';
          localStorage.setItem('kairos_operario', OPERARIO);
          localStorage.setItem('kairos_rol', ROL);
          render();
        };
      }).listarOperarios();
    }
```

- [ ] **Paso 4: `cambiarOperario` limpia también el rol**

En `renderCola`, dentro de `document.getElementById('cambiarOperario').onclick`,
reemplazar el cuerpo por:

```js
      document.getElementById('cambiarOperario').onclick = function (e) {
        e.preventDefault();
        OPERARIO = ''; ROL = 'operario';
        localStorage.removeItem('kairos_operario');
        localStorage.removeItem('kairos_rol');
        render();
      };
```

- [ ] **Paso 5: `render()` despacha a las vistas nuevas**

Reemplazar `render()`:

```js
    function render() {
      if (!OPERARIO) return renderElegirOperario();
      if (VISTA.nombre === 'cola') return renderCola();
      if (VISTA.nombre === 'detalle') return renderDetalle();
      if (VISTA.nombre === 'stock') return renderStock();
      if (VISTA.nombre === 'estado') return renderEstado();
      if (VISTA.nombre === 'panel') return renderPanel();
    }

    function renderTabsBar_() {
      if (ROL !== 'jefe_equipo') return '';
      var tabs = [
        { nombre: 'cola', label: 'Peticiones' },
        { nombre: 'stock', label: 'Stock' },
        { nombre: 'estado', label: 'Estado' },
        { nombre: 'panel', label: 'Panel' },
      ];
      return '<div class="tabs">' + tabs.map(function (t) {
        return '<a href="#" class="' + (VISTA.nombre === t.nombre ? 'activa' : '') +
          '" onclick="event.preventDefault(); VISTA={nombre:\'' + t.nombre + '\',peticionId:null}; render();">' + t.label + '</a>';
      }).join('') + '</div>';
    }
```

- [ ] **Paso 6: `renderCola` incluye la barra de pestañas**

En `renderCola`, el primer `<h1>` de `document.getElementById('app').innerHTML =`
pasa a llevar `renderTabsBar_() +` delante:

```js
      document.getElementById('app').innerHTML =
        renderTabsBar_() +
        '<h1>Kairos · Operario</h1>' +
```

(el resto de `renderCola` no cambia).

- [ ] **Paso 7: Deploy + commit**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
git add Operarios.js Index.html
git commit -m "feat(operario): rol jefe_equipo + barra de pestañas"
```

(Verificación en vivo en Task 8, junto con el resto.)

---

## Task 3: kairos-operario — pestaña Stock

**Files:**
- Create: `kairos-operario/Stock.js`
- Modify: `kairos-operario/Index.html`

- [ ] **Paso 1: Servidor**

```js
/** Buscador de solo lectura sobre preparacion.stock_fisico (Pieza 5). */
function buscarStock(codigoLm) {
  codigoLm = String(codigoLm || '').trim();
  if (!codigoLm) return _json_([]);
  const filas = supaSelect_('stock_fisico',
    'codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=tienda,sscc,ubicacion,cantidad&order=tienda.asc');
  return _json_(filas);
}
```

- [ ] **Paso 2: Cliente — `renderStock` y `buscarStockUI`**

Añadir junto a `renderPanel` (Task 5 la crea; por ahora, añadir estas dos
funciones en cualquier punto del segundo `<script>` de `Index.html`):

```js
    function renderStock() {
      document.getElementById('app').innerHTML = renderTabsBar_() +
        '<h1>Stock</h1>' +
        '<input type="text" id="inBuscarStock" placeholder="Código LM"> ' +
        '<button onclick="buscarStockUI()">Buscar</button>' +
        '<div id="resultadoStock"></div>';
      document.getElementById('inBuscarStock').onkeydown = function (e) { if (e.key === 'Enter') buscarStockUI(); };
      document.getElementById('inBuscarStock').focus();
    }

    function buscarStockUI() {
      const codigo = document.getElementById('inBuscarStock').value.trim();
      const cont = document.getElementById('resultadoStock');
      if (!codigo) { cont.innerHTML = ''; return; }
      cont.innerHTML = '<p class="meta">Buscando…</p>';
      google.script.run
        .withSuccessHandler(function (json) {
          const filas = JSON.parse(json);
          if (!filas.length) { cont.innerHTML = '<p>Sin stock para ese código.</p>'; return; }
          const total = filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
          cont.innerHTML = '<p><strong>Total: ' + total + ' ud</strong></p>' +
            filas.map(function (f) {
              return '<div class="linea"><div>' + (CFG_TIENDA_NOMBRE[f.tienda] || f.tienda) + ' — ' + f.cantidad + ' ud</div>' +
                '<div class="meta">' + f.sscc + ' · ' + f.ubicacion + '</div></div>';
            }).join('');
        })
        .withFailureHandler(function (err) { cont.innerHTML = '<p style="color:#c62828;">' + err.message + '</p>'; })
        .buscarStock(codigo);
    }
```

- [ ] **Paso 3: Deploy + commit**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
git add Stock.js Index.html
git commit -m "feat(operario): pestaña Stock (buscador stock_fisico)"
```

---

## Task 4: kairos-operario — pestaña Estado (cruce HODOS + Carta de Portes)

**Files:**
- Create: `kairos-operario/Estado.js`
- Modify: `kairos-operario/Index.html`

**Nota de diseño** (dentro del margen ya aprobado, solo de presentación):
la spec definía el cruce solo dentro del detalle de una petición. Aquí se
añade también como **pestaña de listado** (todas las peticiones con su
estado HODOS/Carta de Portes de un vistazo) porque encaja mejor con lo
pedido ("pestaña para el estado de las peticiones") — el detalle individual
sigue mostrando lo mismo para esa petición en concreto, mismo dato, misma
consulta reutilizada.

- [ ] **Paso 1: Servidor — reutiliza `_parseSsccMulti_` ya existente en
      `StockAsignacion.js`**

```js
/** Cruce de solo lectura: HODOS (lineas.hodos_id) + Carta de Portes
 *  (preparacion.estado_porte, por SSCC — ver spec Pieza 5). */

function _todosSsccDeLinea_(sscc) {
  return _parseSsccMulti_(sscc, 0).map(function (p) { return p.sscc; }).filter(Boolean);
}

function listarEstadoPeticiones() {
  var q = 'estado=in.(en_preparacion,a_ubicar,cerrada)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,creada_en&order=creada_en.desc&limit=100';
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,hodos_id');

  const todosSscc = [];
  lineas.forEach(function (l) {
    _todosSsccDeLinea_(l.sscc).forEach(function (s) { if (todosSscc.indexOf(s) === -1) todosSscc.push(s); });
  });
  const porte = todosSscc.length
    ? supaSelect_('estado_porte', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')')
    : [];

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.hodosOk = propias.some(function (l) { return l.hodos_id; });

    var ssccPeticion = [];
    propias.forEach(function (l) { _todosSsccDeLinea_(l.sscc).forEach(function (s) { if (ssccPeticion.indexOf(s) === -1) ssccPeticion.push(s); }); });
    const filasPorte = porte.filter(function (e) { return ssccPeticion.indexOf(e.sscc) !== -1; });

    p.porteEstado = !filasPorte.length ? null :
      filasPorte.every(function (e) { return e.estado_recepcion === 'Recepcionado'; }) ? 'Recepcionado' :
      filasPorte.some(function (e) { return e.estado_carga === 'Cargado'; }) ? 'Cargado' : 'Pendiente';
  });
  return _json_(peticiones);
}
```

- [ ] **Paso 2: Cliente — `renderEstado`**

```js
    function renderEstado() {
      document.getElementById('app').innerHTML = renderTabsBar_() +
        '<h1>Estado (HODOS + Carta de Portes)</h1><div id="listaEstado">Cargando…</div>';
      google.script.run.withSuccessHandler(function (json) {
        const peticiones = JSON.parse(json);
        const cont = document.getElementById('listaEstado');
        if (!peticiones.length) { cont.innerHTML = '<p>No hay peticiones.</p>'; return; }
        cont.innerHTML = peticiones.map(function (p) {
          const etiquetaTipo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? 'Cesión → ' + (CFG_TIENDA_NOMBRE[p.tienda_destino] || p.tienda_destino) : 'Refill');
          return '<div class="fila" onclick="abrirDetalle(\'' + p.id + '\')">' +
            '<div class="tipo">' + etiquetaTipo + '</div>' +
            '<div class="meta">' + p.tiendaNombre + ' · HODOS: ' + (p.hodosOk ? '✓' : '—') +
            ' · Porte: ' + (p.porteEstado || '—') + '</div></div>';
        }).join('');
      }).listarEstadoPeticiones();
    }
```

- [ ] **Paso 3: Sección Estado dentro del detalle de una petición**

En `renderDetalleBody_` (`Index.html`), justo antes del bloque
`if (p.estado === 'a_ubicar') { ... } else if (p.estado === 'cerrada') { ... }`,
insertar (solo para `pedido_cliente`/`cesion`, que son los tipos con HODOS):

```js
      if (p.tipo === 'pedido_cliente' || p.tipo === 'cesion') {
        html += '<h3>Estado</h3><div id="estadoDetalle" class="meta">Cargando…</div>';
      }
```

Y al final de `renderDetalleBody_` (tras `document.getElementById('detalleBody').innerHTML = html;`),
si existe ese contenedor, rellenarlo reutilizando el mismo listado (filtrando por `p.id`):

```js
      const contEstado = document.getElementById('estadoDetalle');
      if (contEstado) {
        google.script.run.withSuccessHandler(function (json) {
          const fila = JSON.parse(json).filter(function (x) { return x.id === p.id; })[0];
          contEstado.textContent = fila
            ? ('HODOS: ' + (fila.hodosOk ? 'etiqueta creada' : 'sin etiqueta') + ' · Carta de Portes: ' + (fila.porteEstado || 'sin carta todavía'))
            : 'Sin datos.';
        }).listarEstadoPeticiones();
      }
```

- [ ] **Paso 4: Deploy + commit**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
git add Estado.js Index.html
git commit -m "feat(operario): pestaña Estado (cruce HODOS + Carta de Portes)"
```

---

## Task 5: kairos-operario — Panel jefe de equipo

**Files:**
- Create: `kairos-operario/Panel.js`
- Modify: `kairos-operario/Index.html`

- [ ] **Paso 1: Servidor**

```js
/** Panel jefe de equipo: todas las peticiones, etiquetas HODOS ya creadas
 *  por Kairos, y reintento del envío para las que fallaron. */

function listarTodasPeticiones() {
  const peticiones = supaSelect_('peticiones',
    'select=id,tipo,tienda_origen,tienda_destino,num_pedido,transporte,estado,creada_en&order=creada_en.desc&limit=300');
  if (!peticiones.length) return _json_([]);

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,estado_preparacion,hodos_id');

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.necesitaHodos = (p.tipo === 'cesion') || (p.tipo === 'pedido_cliente' && !p.transporte);
    p.tieneHodos = propias.some(function (l) { return l.hodos_id; });
  });
  return _json_(peticiones);
}

function listarEtiquetasHodos() {
  const lineas = supaSelect_('lineas', 'hodos_id=not.is.null&select=hodos_id&order=hodos_id.desc&limit=500');
  const ids = [];
  lineas.forEach(function (l) { if (ids.indexOf(l.hodos_id) === -1) ids.push(l.hodos_id); });
  if (!ids.length) return _json_([]);
  const etiquetas = supaSelect_('etiquetas',
    'id_unico=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id_unico,destino,numero_pedido,estado,fecha_creacion&order=fecha_creacion.desc',
    'public');
  return _json_(etiquetas);
}

function reintentarHodos(peticionId) {
  _dispararEtiquetaSiProcede_(peticionId);
  return _json_({ ok: true });
}
```

- [ ] **Paso 2: Cliente — `renderPanel`**

```js
    function renderPanel() {
      document.getElementById('app').innerHTML = renderTabsBar_() +
        '<h1>Panel</h1>' +
        '<h3>Todas las peticiones</h3><div id="listaTodas">Cargando…</div>' +
        '<h3>Etiquetas HODOS creadas</h3><div id="listaEtiquetas">Cargando…</div>';
      cargarTodasPeticiones_();
      cargarEtiquetasHodos_();
    }

    function cargarTodasPeticiones_() {
      google.script.run.withSuccessHandler(function (json) {
        const peticiones = JSON.parse(json);
        const cont = document.getElementById('listaTodas');
        if (!peticiones.length) { cont.innerHTML = '<p>No hay peticiones.</p>'; return; }
        cont.innerHTML = peticiones.map(function (p) {
          const etiquetaTipo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? 'Cesión → ' + (CFG_TIENDA_NOMBRE[p.tienda_destino] || p.tienda_destino) : 'Refill');
          var botonReintentar = '';
          if (p.necesitaHodos && !p.tieneHodos && p.estado === 'cerrada') {
            botonReintentar = ' <button class="secundario" onclick="event.stopPropagation(); reintentarHodosUI(\'' + p.id + '\', this)">Reintentar HODOS</button>';
          }
          return '<div class="fila" onclick="abrirDetalle(\'' + p.id + '\')">' +
            '<div class="tipo">' + etiquetaTipo + '</div>' +
            '<div class="meta">' + p.tiendaNombre + ' · ' + p.lineasPreparadas + '/' + p.totalLineas + ' líneas · ' + p.estado + botonReintentar + '</div></div>';
        }).join('');
      }).listarTodasPeticiones();
    }

    function cargarEtiquetasHodos_() {
      google.script.run.withSuccessHandler(function (json) {
        const etiquetas = JSON.parse(json);
        const cont = document.getElementById('listaEtiquetas');
        if (!etiquetas.length) { cont.innerHTML = '<p>Sin etiquetas todavía.</p>'; return; }
        cont.innerHTML = etiquetas.map(function (e) {
          return '<div class="linea"><div>' + (e.numero_pedido || '(sin nº)') + ' → ' + e.destino + '</div>' +
            '<div class="meta">' + e.id_unico + ' · ' + e.estado + ' · ' + new Date(e.fecha_creacion).toLocaleString('es-ES') + '</div></div>';
        }).join('');
      }).listarEtiquetasHodos();
    }

    function reintentarHodosUI(peticionId, boton) {
      boton.disabled = true; boton.textContent = 'Enviando…';
      google.script.run
        .withSuccessHandler(function () { cargarTodasPeticiones_(); cargarEtiquetasHodos_(); })
        .withFailureHandler(function (err) { alert(err.message); boton.disabled = false; boton.textContent = 'Reintentar HODOS'; })
        .reintentarHodos(peticionId);
    }
```

- [ ] **Paso 3: Deploy + commit**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A
git add Panel.js Index.html
git commit -m "feat(operario): panel jefe de equipo (todas, etiquetas HODOS, reintento)"
```

---

## Task 6: PreparacionPedidosPC — puente Supabase (aditivo)

**Files:**
- Modify: `PreparacionPedidosPC/config.js`
- Create: `PreparacionPedidosPC/PuenteSupabase.js`
- Modify: `PreparacionPedidosPC/Cerrar Carta de Porte.js`

**Riesgo — leer antes de tocar:** este proyecto está en producción activa
(se usa a diario para cerrar Cartas de Porte reales). El cambio es
estrictamente aditivo: todo lo nuevo va en `try/catch`, y si Supabase falla
por cualquier motivo, el cierre del Sheet **sigue funcionando exactamente
igual que hoy** — se verifica esto explícitamente en Task 8.

- [ ] **Paso 1: Config — añadir bloque `SUPABASE` sin tocar nada más**

En `config.js`, dentro de `const CONFIG = { ... }`, junto a `IDS: { ... },`
(línea 14), añadir:

```js
  SUPABASE: {
    URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
    SCHEMA: 'preparacion',
  },
```

- [ ] **Paso 2: Cliente Supabase mínimo (mismo patrón que `kairos-sync`)**

```js
/** Cliente mínimo de la API REST de Supabase (PostgREST) — puente Kairos.
 *  Mismo patrón que kairos-sync/Supabase.js. Usa CONFIG.SUPABASE. */

function _supaKeyPuente_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeadersPuente_(metodo) {
  const key = _supaKeyPuente_();
  const h = { apikey: key, Authorization: 'Bearer ' + key };
  if (metodo === 'GET') h['Accept-Profile'] = CONFIG.SUPABASE.SCHEMA;
  else { h['Content-Profile'] = CONFIG.SUPABASE.SCHEMA; h['Content-Type'] = 'application/json'; }
  return h;
}

function supaUpsertPuente_(tabla, filas, onConflict) {
  if (!filas.length) return;
  const url = CONFIG.SUPABASE.URL + '/rest/v1/' + tabla + '?on_conflict=' + encodeURIComponent(onConflict);
  const headers = _supaHeadersPuente_('POST');
  headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', headers: headers, payload: JSON.stringify(filas), muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase upsert ' + code + ': ' + resp.getContentText());
}

function limpiarSsccPuente_(valor) {
  return String(valor || '').trim().replace(/^0+/, '');
}

/** Una fila por palet a preparacion.estado_porte. Nunca lanza — quien
 *  llama decide si el error es fatal o no (aquí: no lo es, ver Paso 3). */
function upsertEstadoPortePuente_(filas, nombreCarta) {
  if (!filas.length) return;
  const ahora = new Date().toISOString();
  const payload = filas.map(function (f) {
    return {
      sscc: limpiarSsccPuente_(f.numPalet),
      estado_carga: f.estadoCarga,
      estado_recepcion: f.estadoRecepcion,
      carta_nombre: nombreCarta,
      cerrado_en: ahora,
    };
  }).filter(function (f) { return f.sscc; });
  supaUpsertPuente_('estado_porte', payload, 'sscc');
}
```

- [ ] **Paso 3: `cerrarCartaDePorte()` — añadir el upsert aditivo**

En `Cerrar Carta de Porte.js`, el bucle existente (líneas 48-63 del archivo
actual) ya lee `numPalet`/`estadoCarga`/`estadoRecepcion` por fila. Se
acumulan esos mismos valores en un array nuevo, y tras el bucle (antes de
`ss.deleteSheet(hojaActual);`) se manda a Supabase envuelto en `try/catch`.
Sustituir la función completa por:

```js
function cerrarCartaDePorte() {
  const ss = SS();
  const hojaActual = ss.getActiveSheet();
  const nombreHoja = hojaActual.getName();

  const idLibroObjetivo = CONFIG.IDS.LIBRO_OBJETIVO_CIERRE;
  let libroObjetivo;
  try {
    libroObjetivo = SpreadsheetApp.openById(idLibroObjetivo);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Error: Este Usuario NO está autorizado a cerrar Cartas de Porte');
    return;
  }

  const hojaInc = libroObjetivo.getSheetByName(CONFIG.SHEETS.INCIDENCIAS_PORTES);
  const hojaHis = libroObjetivo.getSheetByName(CONFIG.SHEETS.HISTORICO_PORTES);

  if (!hojaInc || !hojaHis) {
    SpreadsheetApp.getUi().alert(
      `Las hojas '${CONFIG.SHEETS.INCIDENCIAS_PORTES}' o '${CONFIG.SHEETS.HISTORICO_PORTES}' no existen en el libro objetivo.`
    );
    return;
  }

  const fechaCierre = new Date();
  const fechaCierreStr = formatDateDMY(fechaCierre);

  const dataFija = [
    '',
    nombreHoja,
    fechaCierreStr,
    hojaActual.getRange('C2').getValue(),
    hojaActual.getRange('C3').getValue(),
    '', '', '',
    hojaActual.getRange('A7').getValue(),
    hojaActual.getRange('B7').getValue(),
    hojaActual.getRange('C5').getValue(),
    hojaActual.getRange('D5').getValue(),
    hojaActual.getRange('D7').getValue(),
    hojaActual.getRange('A42').getValue(),
    hojaActual.getRange('C42').getValue()
  ];

  const filasPorte = [];

  for (let i = 9; i <= 40; i++) {
    const numPalet       = hojaActual.getRange(i, 1).getValue();
    const estadoCarga    = hojaActual.getRange(i, 3).getValue();
    const estadoRecepcion= hojaActual.getRange(i, 4).getValue();
    if (!numPalet || !estadoCarga || !estadoRecepcion) continue;

    filasPorte.push({ numPalet: numPalet, estadoCarga: estadoCarga, estadoRecepcion: estadoRecepcion });

    const destino = (estadoCarga === 'Cargado' && estadoRecepcion === 'Recepcionado') ? hojaHis : hojaInc;
    const ultima = destino.getLastRow() + 1;

    const fila = dataFija.slice();
    fila[5] = numPalet;
    fila[6] = estadoCarga;
    fila[7] = estadoRecepcion;

    destino.getRange(ultima, 1, 1, fila.length).setValues([fila]);
  }

  // Puente Kairos (Pieza 5) — aditivo. Si falla, el cierre real (arriba)
  // ya se hizo y no se deshace; solo se pierde el cruce de estado en
  // Kairos, reintentable a mano si hiciera falta.
  try {
    upsertEstadoPortePuente_(filasPorte, nombreHoja);
  } catch (errPuente) {
    console.error('Puente Kairos (estado_porte) falló, cierre de la carta ya hecho: ' + errPuente.message);
  }

  ss.deleteSheet(hojaActual);
}
```

- [ ] **Paso 4: Añadir `SUPABASE_SERVICE_KEY` en Propiedades del script**

Acción manual del usuario (no del agente — es un secreto): en el editor de
Apps Script de `PreparacionPedidosPC`, Configuración del proyecto →
Propiedades del script → añadir `SUPABASE_SERVICE_KEY` con la misma key de
`service_role` que ya usan `kairos-operario`/`kairos-sync`.

- [ ] **Paso 5: Deploy + commit**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\PreparacionPedidosPC"
clasp push --force
git add config.js "PuenteSupabase.js" "Cerrar Carta de Porte.js"
git commit -m "feat: puente aditivo a Supabase al cerrar Carta de Porte (Kairos Pieza 5)"
```

(Si este proyecto no tiene `git init`, usar `git status` primero para
confirmarlo y avisar antes de decidir — no asumir.)

---

## Task 7: Verificación E2E

- [ ] **Paso 1: Rol jefe de equipo**

```sql
update preparacion.operarios set rol = 'jefe_equipo' where nombre = 'Edson';
```
Abrir `kairos-operario`, elegir "Edson", confirmar que aparecen las 4
pestañas (Peticiones/Stock/Estado/Panel); elegir cualquier otro operario y
confirmar que solo ve "Peticiones" (sin pestañas).

- [ ] **Paso 2: Stock**

Buscar un código LM real (por ejemplo `82691471`, ya usado en pruebas
anteriores) y confirmar que aparece cantidad + SSCC/ubicación coincidiendo
con:
```sql
select tienda, sscc, ubicacion, cantidad from preparacion.stock_fisico where codigo_lm='82691471';
```

- [ ] **Paso 3: Puente Carta de Portes — no rompe el flujo real**

Con `SUPABASE_SERVICE_KEY` **temporalmente mal puesta** (o sin poner) en
`PreparacionPedidosPC`, cerrar una Carta de Porte de prueba (palets de
prueba, no reales) y confirmar que el Sheet se mueve igual a
Incidencias/Histórico (falla solo el puente, en silencio, con
`console.error`). Luego, con la key correcta puesta, repetir con otra Carta
de prueba y confirmar la fila:
```sql
select * from preparacion.estado_porte order by creado_en desc limit 5;
```

- [ ] **Paso 4: Cruce de estado**

Sobre una petición real de Kairos cuya línea tenga un `sscc` que coincida
(limpio de ceros) con un `estado_porte.sscc` recién insertado, abrir su
detalle y confirmar que la sección "Estado" muestra "Cargado" o
"Recepcionado" según corresponda; confirmar también la pestaña "Estado"
(listado) para esa misma petición.

- [ ] **Paso 5: Panel — todas las peticiones + etiquetas + reintento**

Como jefe de equipo, abrir "Panel": confirmar que aparecen peticiones
cerradas (no solo las pendientes de la cola normal). Confirmar que
"Etiquetas HODOS creadas" lista al menos una etiqueta real ya creada en
piezas anteriores. Sobre una petición cerrada `pedido_cliente`/`cesion` sin
`hodos_id` (si el bug `HODOS_WEBAPP_URL` sigue activo, cualquiera de las de
prueba sirve), pulsar "Reintentar HODOS" y confirmar en el log de
ejecuciones de Apps Script que se intentó (aunque siga fallando por el bug
externo, confirma que el mecanismo de reintento se dispara correctamente).

- [ ] **Paso 6: Limpiar datos de prueba**

```sql
delete from preparacion.estado_porte where carta_nombre like '%prueba%';
update preparacion.operarios set rol = 'operario' where nombre = 'Edson';
```
(Solo revertir el rol si Edson no debía quedar como jefe de equipo de
verdad — confirmar con el usuario antes de este paso, no asumir.)

---

## Task 8: Documentación

**Files:**
- Modify: `README.md`

- [ ] **Paso 1:** Añadir fila a la tabla de piezas:

```
| 5 | Panel de gestión + puente Carta de Portes | ✅ completa (jefe de equipo, stock, cruce HODOS/Carta de Portes) |
```

- [ ] **Paso 2: Commit**

```bash
git add README.md
git commit -m "docs: Pieza 5 (panel gestion + puente carta de portes) completa"
```

- [ ] **Paso 3: Memoria** (fuera de git) — actualizar
  `kairos-plataforma-pedidos-taisa.md` con el resumen de Pieza 5, y
  `preparacionpedidospc-app.md` con la nota del puente aditivo nuevo.

---

## Task 9: Cierre de rama

**superpowers:finishing-a-development-branch** tras Task 7 verificado sin
fallos. Recordar que `PreparacionPedidosPC` es un repo aparte (Task 6) —
si tiene git propio, cerrar esa rama por separado del cierre de la rama de
Kairos.
