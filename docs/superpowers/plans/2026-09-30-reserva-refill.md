# Reserva de refill para fecha de entrega — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La tienda reserva un refill para una fecha de entrega; operarios y jefe no lo ven hasta el último día laborable anterior.

**Architecture:** Dos columnas nuevas en `preparacion.peticiones` (`fecha_entrega`, `visible_desde`). La visibilidad se decide al consultar (`visible_desde <= hoy Madrid`), sin cron ni estado nuevo. El portal calcula `visible_desde` en el servidor; `kairos-operario` filtra cuatro consultas.

**Tech Stack:** Google Apps Script (clasp), Supabase/PostgREST (schema `preparacion`), Node solo para verificar sintaxis y lógica pura.

Spec: `docs/superpowers/specs/2026-09-30-reserva-refill-design.md`.

Convenciones del repo: todo despliegue con `clasp push --force` y `clasp deploy -i <id>`; antes de cada despliegue, comprobar sintaxis de los `<script>` con Node. Commits con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Trabajar sobre el repo `C:\Users\30081048\Desktop\Proyectos\Kairos`.

---

### Task 1: Migración 030 (columnas + restricción)

**Files:**
- Create: `supabase/migrations/030_reserva_refill.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 030 · Reserva de refill para fecha de entrega.
-- fecha_entrega: solo refill. visible_desde: día a partir del cual la
-- petición sale en las colas de operarios/jefe (peticiones normales: el día
-- de creación; reservas: último día laborable anterior a fecha_entrega).
alter table preparacion.peticiones
  add column fecha_entrega date,
  add column visible_desde date not null default current_date;

alter table preparacion.peticiones
  add constraint solo_refill_tiene_fecha_entrega
  check (fecha_entrega is null or tipo = 'refill');

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar con el MCP de Supabase**

Usar `mcp__149af093-a1c0-4d42-a426-fe769018596e__apply_migration` con `project_id = dbxlrnupiwemnarlxmcv`, `name = reserva_refill` y el SQL anterior.
Esperado: éxito sin error.

- [ ] **Step 3: Verificar columnas y restricción**

Ejecutar con `execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'preparacion' and table_name = 'peticiones'
  and column_name in ('fecha_entrega', 'visible_desde');
```
Esperado: `fecha_entrega` date nullable sin default; `visible_desde` date not null con default `CURRENT_DATE`.

Probar la restricción (debe fallar) y limpiar:

```sql
insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, num_pedido, transporte, fecha_entrega)
values ('pedido_cliente', '014', '30081048', 'TESTRESERVA', false, '2026-10-05');
```
Esperado: error `solo_refill_tiene_fecha_entrega` (o `violates check constraint`). Si por error se creara la fila, borrarla: `delete from preparacion.peticiones where num_pedido = 'TESTRESERVA';`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/030_reserva_refill.sql
git commit -m "feat(db): columnas fecha_entrega y visible_desde para reservas de refill

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Funciones de fechas del portal (con prueba en Node)

**Files:**
- Create: `kairos-portal/Reservas.js`

- [ ] **Step 1: Escribir `Reservas.js`**

```js
/** Reserva de refill para fecha de entrega (ver docs/superpowers/specs/
 *  2026-09-30-reserva-refill-design.md). visible_desde = último día
 *  laborable (L-V) estrictamente anterior a fecha_entrega; los festivos no
 *  se detectan. */

function _hoyMadridIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}

function _ultimoLaborableAnterior_(fechaIso) {
  const p = String(fechaIso).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Devuelve la fecha normalizada "YYYY-MM-DD" o lanza si no es válida o no
 *  es posterior a hoy. */
function _validarFechaEntrega_(fechaIso, hoyIso) {
  const f = String(fechaIso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Fecha de entrega no válida.');
  const p = f.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.toISOString().slice(0, 10) !== f) throw new Error('Fecha de entrega no válida.');
  if (f <= hoyIso) throw new Error('La fecha de entrega debe ser posterior a hoy. Para hoy usa un refill normal.');
  return f;
}

/** Marca en la fila si es una reserva que aún no sale a preparación. */
function _marcarReserva_(p, hoyIso) {
  p.reservaFutura = !!(p.fecha_entrega && p.visible_desde > hoyIso);
  if (p.reservaFutura) p.estadoTexto = 'Reservada';
}

/** Cambiar la fecha de entrega de una reserva que aún no es visible para
 *  operarios. Mismo permiso que anularPeticion (gestor/master). */
function cambiarFechaEntrega(ldap, peticionId, nuevaFecha) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor' && u.rol !== 'master') throw new Error('Solo un gestor puede cambiar la fecha de entrega.');
  const hoy = _hoyMadridIso_();
  const fecha = _validarFechaEntrega_(nuevaFecha, hoy);
  const visibleDesde = _ultimoLaborableAnterior_(fecha);

  const cab = supaSelect_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&select=id,tipo,estado,fecha_entrega,visible_desde');
  if (!cab.length) throw new Error('Petición no encontrada.');
  const p = cab[0];
  if (p.tipo !== 'refill' || !p.fecha_entrega) throw new Error('Esta petición no es una reserva.');
  if (p.estado !== 'pendiente' || p.visible_desde <= hoy) throw new Error('Ya está en preparación, no se puede cambiar la fecha.');

  // Mismo filtro en el UPDATE: si la reserva pasa a visible o se anula entre
  // el SELECT y el UPDATE, no se pisa.
  const filas = supaUpdate_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&estado=eq.pendiente&visible_desde=gt.' + encodeURIComponent(hoy),
    { fecha_entrega: fecha, visible_desde: visibleDesde });
  if (!filas.length) throw new Error('Ya está en preparación, no se puede cambiar la fecha.');
  return _json_({ ok: true, fechaEntrega: fecha, visibleDesde: visibleDesde });
}
```

- [ ] **Step 2: Probar las funciones puras en Node**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal" && node -e "
const src = require('fs').readFileSync('Reservas.js', 'utf8');
const f = new Function(src + '; return { ult: _ultimoLaborableAnterior_, val: _validarFechaEntrega_, marca: _marcarReserva_ };')();
const eq = function (a, b, m) { if (a !== b) { console.log('FALLO', m, a, '!=', b); process.exitCode = 1; } else console.log('ok', m); };
eq(f.ult('2026-10-05'), '2026-10-02', 'lunes -> viernes');
eq(f.ult('2026-10-06'), '2026-10-05', 'martes -> lunes');
eq(f.ult('2026-10-03'), '2026-10-02', 'sabado -> viernes');
eq(f.ult('2026-10-04'), '2026-10-02', 'domingo -> viernes');
eq(f.ult('2026-10-01'), '2026-09-30', 'jueves -> miercoles');
eq(f.ult('2026-11-02'), '2026-10-30', 'lunes cambio de mes -> viernes');
eq(f.val('2026-10-05', '2026-09-30'), '2026-10-05', 'valida futura');
['2026-09-30', '2026-09-29', '2026-13-01', '2026-02-30', 'hoy', ''].forEach(function (m) {
  try { f.val(m, '2026-09-30'); console.log('FALLO no lanzo', m); process.exitCode = 1; } catch (e) { console.log('ok lanza', JSON.stringify(m)); }
});
var p1 = { fecha_entrega: '2026-10-05', visible_desde: '2026-10-02', estadoTexto: 'Solicitado' };
f.marca(p1, '2026-09-30'); eq(p1.reservaFutura + '|' + p1.estadoTexto, 'true|Reservada', 'reserva futura');
var p2 = { fecha_entrega: '2026-10-05', visible_desde: '2026-10-02', estadoTexto: 'Solicitado' };
f.marca(p2, '2026-10-02'); eq(p2.reservaFutura + '|' + p2.estadoTexto, 'false|Solicitado', 'reserva ya visible');
var p3 = { fecha_entrega: null, visible_desde: '2026-09-30', estadoTexto: 'Solicitado' };
f.marca(p3, '2026-09-30'); eq(p3.reservaFutura + '|' + p3.estadoTexto, 'false|Solicitado', 'peticion normal');
"
```
Esperado: todas las líneas empiezan por `ok`, código de salida 0.

- [ ] **Step 3: Commit**

```bash
git add kairos-portal/Reservas.js
git commit -m "feat(portal): funciones de fechas y cambio de fecha de reservas de refill

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Portal — crear reserva y devolver los datos

**Files:**
- Modify: `kairos-portal/Peticiones.js` (`_crearPeticion_`, `listarMisPeticiones`, `obtenerDetallePeticion`)
- Modify: `kairos-portal/Trazabilidad.js` (`listarTrazabilidad`)

- [ ] **Step 1: `_crearPeticion_` acepta `fechaEntrega` (solo refill)**

En `kairos-portal/Peticiones.js`, sustituir el bloque `else { ... }` del motivo de refill:

```js
  } else {
    if (!datos.motivo) throw new Error('Falta el motivo del refill.');
    cabecera.motivo = String(datos.motivo).trim();
  }
```

por:

```js
  } else {
    if (!datos.motivo) throw new Error('Falta el motivo del refill.');
    cabecera.motivo = String(datos.motivo).trim();
    if (datos.fechaEntrega) {
      const fecha = _validarFechaEntrega_(datos.fechaEntrega, _hoyMadridIso_());
      cabecera.fecha_entrega = fecha;
      cabecera.visible_desde = _ultimoLaborableAnterior_(fecha);
    }
  }
```

- [ ] **Step 2: `listarMisPeticiones` devuelve los campos y marca la reserva**

Cambiar la línea del `select`:

```js
    '&select=id,tipo,num_pedido,num_cesion,tienda_destino,estado,creada_en,solicitante_ldap' +
```
por:
```js
    '&select=id,tipo,num_pedido,num_cesion,tienda_destino,estado,creada_en,solicitante_ldap,fecha_entrega,visible_desde' +
```

Y sustituir:

```js
  filas.forEach(function (p) { p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado; });
```
por:
```js
  const hoy = _hoyMadridIso_();
  filas.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    _marcarReserva_(p, hoy);
  });
```

- [ ] **Step 3: `obtenerDetallePeticion` marca la reserva**

Debajo de `peticion.estadoTexto = TRADUCCION_ESTADO[peticion.estado] || peticion.estado;` añadir:

```js
  _marcarReserva_(peticion, _hoyMadridIso_());
```

(`select *` ya trae `fecha_entrega` y `visible_desde`.)

- [ ] **Step 4: `listarTrazabilidad`**

En `kairos-portal/Trazabilidad.js`, ampliar `campos`:

```js
  const campos = 'id,tipo,num_pedido,num_cesion,tienda_destino,transporte,estado,creada_en,solicitante_ldap,motivo,motivo_anulacion,en_curso_por,ubicacion_consolidacion,fecha_entrega,visible_desde';
```

En el primer `peticiones.forEach` (el que asigna `estadoTexto` y `camino`), añadir al final del callback:

```js
    _marcarReserva_(p, hoyReservas);
```
y definir antes de ese `forEach`:

```js
  const hoyReservas = _hoyMadridIso_();
```

En el bucle `peticionesRefill.forEach(function (p) {`, primera línea del callback:

```js
      if (p.reservaFutura) { p.refillTexto = 'Reservada'; return; }
```

- [ ] **Step 5: Comprobar sintaxis de los tres archivos**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal" && node -e "
['Peticiones.js', 'Trazabilidad.js', 'Reservas.js'].forEach(function (f) {
  new Function(require('fs').readFileSync(f, 'utf8')); console.log('ok', f);
});"
```
Esperado: tres líneas `ok`.

- [ ] **Step 6: Commit**

```bash
git add kairos-portal/Peticiones.js kairos-portal/Trazabilidad.js
git commit -m "feat(portal): crear reserva de refill con fecha de entrega y exponer su estado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Portal — interfaz (formulario, listas, detalle)

**Files:**
- Modify: `kairos-portal/Portal.html`

- [ ] **Step 1: Helpers de fecha en el cliente**

En el `<script>` que contiene `const ETIQUETA_TIPO = ...` (justo después de `const NOMBRE_TIENDA = ...` y su comentario de destinos), añadir:

```js
  function fechaCorta_(iso) {
    const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? m[2] + '/' + m[1] : '';
  }
  function hoyIso_() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ultimoLaborableAnteriorIso_(iso) {
    const p = String(iso).split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }
  function textoEntrega_(p) {
    if (!p.fecha_entrega) return '';
    return 'Entrega ' + fechaCorta_(p.fecha_entrega) + (p.reservaFutura ? ' · sale a preparación ' + fechaCorta_(p.visible_desde) : '');
  }
```

- [ ] **Step 2: Campo de fecha en el formulario de Refill**

En `renderFormulario`, en la rama refill de `camposTipo`:

```js
      camposTipo = '<input class="entrada" id="inMotivo" placeholder="Motivo del refill">';
```
sustituir por:

```js
      camposTipo =
        '<input class="entrada" id="inMotivo" placeholder="Motivo del refill">' +
        '<label style="display:block;margin:8px 0 2px;color:var(--text-500);font-size:13px;" for="inFechaEntrega">Fecha de entrega (reserva, opcional)</label>' +
        '<input class="entrada" id="inFechaEntrega" type="date">' +
        '<div id="ayudaFechaEntrega" style="color:var(--text-500);font-size:12px;margin-bottom:8px;">Vacío = refill normal, se prepara hoy.</div>';
```

Después de `c.querySelector('#btnVolver').onclick = renderCola;` (en `renderFormulario`), añadir:

```js
    const inFechaEntrega = c.querySelector('#inFechaEntrega');
    if (inFechaEntrega) {
      inFechaEntrega.min = (function () {
        const m = new Date(); m.setDate(m.getDate() + 1);
        return m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0');
      })();
      inFechaEntrega.onchange = function () {
        const ayuda = c.querySelector('#ayudaFechaEntrega');
        const f = inFechaEntrega.value;
        if (!f) { ayuda.textContent = 'Vacío = refill normal, se prepara hoy.'; return; }
        if (f <= hoyIso_()) { ayuda.textContent = 'La fecha de entrega debe ser posterior a hoy.'; return; }
        const sale = ultimoLaborableAnteriorIso_(f);
        ayuda.textContent = sale <= hoyIso_()
          ? 'Saldrá a preparación hoy.'
          : 'No la verán en almacén hasta el ' + fechaCorta_(sale) + ' (último día laborable antes de la entrega).';
      };
    }
```

En el handler de `#btnEnviar` de `renderFormulario`, rama `else` del refill:

```js
        datos.motivo = c.querySelector('#inMotivo').value.trim();
        if (!datos.motivo) { err.textContent = 'Falta el motivo.'; err.style.display = 'block'; return; }
```
añadir debajo:

```js
        datos.fechaEntrega = c.querySelector('#inFechaEntrega').value || null;
```

- [ ] **Step 3: Etiqueta en las listas**

En `renderCola`, en la fila de `listarMisPeticiones`, tras la línea del `p.articulo` añadir la línea de entrega. Sustituir:

```js
              '<div style="color:var(--text-500);font-size:12px;">' + escHtml(p.articulo || '') + '</div>' +
              '<div style="color:var(--text-500);font-size:12px;">' + escHtml(p.solicitante_ldap || '—') + ' · ' + new Date(p.creada_en).toLocaleString('es-ES') + '</div>' +
            '</div>' +
            '<span class="estado">' + escHtml(p.estadoTexto) + '</span>' +
```
por:

```js
              '<div style="color:var(--text-500);font-size:12px;">' + escHtml(p.articulo || '') + '</div>' +
              (p.fecha_entrega ? '<div style="color:var(--text-500);font-size:12px;">' + escHtml(textoEntrega_(p)) + '</div>' : '') +
              '<div style="color:var(--text-500);font-size:12px;">' + escHtml(p.solicitante_ldap || '—') + ' · ' + new Date(p.creada_en).toLocaleString('es-ES') + '</div>' +
            '</div>' +
            '<span class="estado">' + escHtml(p.estadoTexto) + '</span>' +
```

En `pintarTraza` (Trazabilidad), en la fila, tras la línea que muestra `p.articulo`/`p.motivo` añadir:

```js
                (p.fecha_entrega ? '<div style="color:var(--text-500);font-size:12px;">' + escHtml(textoEntrega_(p)) + '</div>' : '') +
```
(colocarla inmediatamente después de la línea `'<div ...>' + escHtml(p.articulo || '') + (p.motivo ? ...` y antes de la de SSCC).

- [ ] **Step 4: Detalle con "Cambiar fecha"**

En `renderDetalle`, después de `const puedeAnular = ...;` añadir:

```js
      const puedeCambiarFecha = (ROL === 'gestor' || ROL === 'master') && p.reservaFutura && p.estado === 'pendiente';
```

En el `cont.innerHTML`, tras la línea de `p.motivo` (`(p.motivo ? '<div ...><b>Motivo</b> ...`) añadir:

```js
        (p.fecha_entrega ? '<div style="margin-top:8px;"><b>Entrega</b> ' + escHtml(fechaCorta_(p.fecha_entrega)) + (p.reservaFutura ? ' · sale a preparación ' + escHtml(fechaCorta_(p.visible_desde)) : '') + '</div>' : '') +
        (puedeCambiarFecha
          ? '<div style="margin-top:8px;"><label style="display:block;color:var(--text-500);font-size:13px;" for="inNuevaFecha">Cambiar fecha de entrega</label>' +
            '<input class="entrada" id="inNuevaFecha" type="date" value="' + escHtml(p.fecha_entrega) + '">' +
            '<button class="btn btn-ghost" id="btnCambiarFecha">Guardar nueva fecha</button></div>'
          : '') +
```

Después de `cont.querySelector('#btnVolver2').onclick = origen;` añadir:

```js
      if (puedeCambiarFecha) {
        const btnCambiarFecha = cont.querySelector('#btnCambiarFecha');
        btnCambiarFecha.onclick = function () {
          const nueva = cont.querySelector('#inNuevaFecha').value;
          if (!nueva) { kAlerta('Elige la nueva fecha.'); return; }
          btnCambiarFecha.disabled = true;
          gas('cambiarFechaEntrega', LDAP, id, nueva).then(function () { renderDetalle(id, origen); })
            .catch(function (e) { btnCambiarFecha.disabled = false; kAlerta(e.message); });
        };
        cont.querySelector('#inNuevaFecha').onkeydown = function (e) { if (e.key === 'Enter') btnCambiarFecha.click(); };
      }
```

- [ ] **Step 5: Comprobar sintaxis de Portal.html**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos" && node -e "
const fs = require('fs');
var html = fs.readFileSync('kairos-portal/Portal.html', 'utf8').split('<?= esAdmin ?>').join(\"'false'\");
var re = /<script[^>]*>([\s\S]*?)<\/script>/g, m, i = 0, errs = 0;
while ((m = re.exec(html))) { i++; try { new Function(m[1]); } catch (e) { errs++; console.log('block', i, e.message); } }
console.log('blocks', i, 'errors', errs);"
```
Esperado: `blocks 7 errors 0`.

- [ ] **Step 6: Commit**

```bash
git add kairos-portal/Portal.html
git commit -m "feat(portal): campo de fecha de entrega, etiqueta de reserva y cambio de fecha

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Operario — ocultar reservas futuras

**Files:**
- Create: `kairos-operario/Fechas.js`
- Modify: `kairos-operario/Cola.js`, `kairos-operario/Estado.js`, `kairos-operario/Panel.js`

- [ ] **Step 1: Helper de "hoy" en Madrid**

`kairos-operario/Fechas.js`:

```js
/** "Hoy" en Europe/Madrid como YYYY-MM-DD. Espejo de kairos-portal/Reservas.js
 *  (proyectos GAS separados). Las reservas de refill se ven en las colas
 *  solo cuando visible_desde <= hoy. */
function _hoyMadridIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}
```

- [ ] **Step 2: `Cola.js`**

`listarCola`: sustituir

```js
  var q = 'estado=in.(pendiente,en_preparacion)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,motivo,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap' +
```
por:

```js
  var q = 'estado=in.(pendiente,en_preparacion)' +
    '&visible_desde=lte.' + _hoyMadridIso_() +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,motivo,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap,fecha_entrega' +
```

`contarPeticionesPorTienda`: sustituir

```js
  const filas = supaSelect_('peticiones', 'estado=in.(pendiente,en_preparacion)&select=tienda_origen');
```
por:
```js
  const filas = supaSelect_('peticiones', 'estado=in.(pendiente,en_preparacion)&visible_desde=lte.' + _hoyMadridIso_() + '&select=tienda_origen');
```

- [ ] **Step 3: `Estado.js`**

En `listarEstadoPeticiones`, añadir la línea del filtro justo tras la primera línea de `q`:

```js
  var q = 'estado=in.(pendiente,en_preparacion,a_ubicar,cerrada)' +
    '&visible_desde=lte.' + _hoyMadridIso_() +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,creada_en,en_curso_por,ubicacion_consolidacion&order=creada_en.desc&limit=100';
```

- [ ] **Step 4: `Panel.js`**

En `listarTodasPeticiones`, sustituir

```js
  const peticiones = supaSelect_('peticiones',
    'select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap' +
```
por:

```js
  const peticiones = supaSelect_('peticiones',
    'visible_desde=lte.' + _hoyMadridIso_() +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap,fecha_entrega' +
```

- [ ] **Step 5: Comprobar sintaxis**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario" && node -e "
['Fechas.js', 'Cola.js', 'Estado.js', 'Panel.js'].forEach(function (f) {
  new Function(require('fs').readFileSync(f, 'utf8')); console.log('ok', f);
});"
```
Esperado: cuatro líneas `ok`.

- [ ] **Step 6: Commit**

```bash
git add kairos-operario/Fechas.js kairos-operario/Cola.js kairos-operario/Estado.js kairos-operario/Panel.js
git commit -m "feat(operario): las reservas de refill no salen en colas hasta su dia de preparacion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Operario — mostrar "Entrega dd/mm"

**Files:**
- Modify: `kairos-operario/Index.html`

- [ ] **Step 1: Helper y etiqueta en la cola**

En el `<script>` principal, junto a `function tiempoDesde_(iso) {` (misma zona de helpers), añadir antes de esa función:

```js
    function fechaCortaEntrega_(iso) {
      const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
      return m ? m[2] + '/' + m[1] : '';
    }
```

En `filaHtml(p)`, sustituir la parte del refill de `etiquetaTipo`:

```js
('Refill' + (p.motivo ? ': ' + escHtmlSie_(p.motivo) : ''))
```
por:
```js
('Refill' + (p.motivo ? ': ' + escHtmlSie_(p.motivo) : '') + (p.fecha_entrega ? ' <span class="chip">📅 Entrega ' + fechaCortaEntrega_(p.fecha_entrega) + '</span>' : ''))
```

- [ ] **Step 2: Etiqueta en el detalle**

En el render del detalle, sustituir:

```js
('Refill: ' + escHtmlSie_(p.motivo || ''))
```
por:
```js
('Refill: ' + escHtmlSie_(p.motivo || '') + (p.fecha_entrega ? ' · entrega ' + fechaCortaEntrega_(p.fecha_entrega) : ''))
```

(`obtenerPeticion` ya devuelve la cabecera completa, incluido `fecha_entrega`.)

- [ ] **Step 3: Comprobar sintaxis de Index.html**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos" && node -e "
const fs = require('fs');
var html = fs.readFileSync('kairos-operario/Index.html', 'utf8').split('<?= modoJefe ?>').join(\"'false'\");
var re = /<script[^>]*>([\s\S]*?)<\/script>/g, m, i = 0, errs = 0;
while ((m = re.exec(html))) { i++; try { new Function(m[1]); } catch (e) { errs++; console.log('block', i, e.message); } }
console.log('blocks', i, 'errors', errs);"
```
Esperado: `blocks 2 errors 0`.

- [ ] **Step 4: Commit**

```bash
git add kairos-operario/Index.html
git commit -m "feat(operario): muestra la fecha de entrega de las reservas de refill

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Desplegar y verificar con datos reales

**Files:** ninguno nuevo.

- [ ] **Step 1: Desplegar portal y operario**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-portal" && clasp push --force >/dev/null 2>&1 && clasp deploy -i AKfycbx-OUWwyJijJJLFmpSnVDDDCPjgj6YG2SkbGhKny2rlebGUgoiTBohgcgbwVKhfAJyN -d "feat: reserva de refill para fecha de entrega" 2>&1
cd "C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-operario" && clasp push --force >/dev/null 2>&1 && clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A -d "feat: reservas de refill ocultas hasta su dia" 2>&1
```
Esperado: `Created version N` y `@N` en ambos.

- [ ] **Step 2: Simular una reserva y comprobar el filtro con SQL**

Con `execute_sql` (`project_id = dbxlrnupiwemnarlxmcv`). Se usa la tienda `014`, un artículo de catálogo cualquiera y el LDAP `30081048`:

```sql
with c as (
  insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, motivo, fecha_entrega, visible_desde)
  values ('refill', '014', '30081048', 'PRUEBA RESERVA', current_date + 10, current_date + 9)
  returning id
)
insert into preparacion.lineas (peticion_id, codigo_lm, cantidad, unidad_medida)
select id, '17965871', 1, 'palet' from c;

select
  (select count(*) from preparacion.peticiones where estado in ('pendiente','en_preparacion') and visible_desde <= current_date) as en_cola_hoy,
  (select count(*) from preparacion.peticiones where motivo = 'PRUEBA RESERVA') as total_reserva;
```
Esperado: `en_cola_hoy = 0`, `total_reserva = 1` (la reserva existe pero no sale en las colas).

Adelantar la visibilidad y volver a comprobar:

```sql
update preparacion.peticiones set visible_desde = current_date where motivo = 'PRUEBA RESERVA';
select count(*) as en_cola_hoy from preparacion.peticiones where estado in ('pendiente','en_preparacion') and visible_desde <= current_date;
```
Esperado: `en_cola_hoy = 1`.

- [ ] **Step 3: Limpiar los datos de prueba (producción arranca limpia)**

```sql
delete from preparacion.peticiones where motivo = 'PRUEBA RESERVA';
select (select count(*) from preparacion.peticiones) as peticiones, (select count(*) from preparacion.lineas) as lineas;
```
Esperado: `peticiones = 0`, `lineas = 0`.

- [ ] **Step 4: Actualizar la memoria del proyecto**

Añadir en `C:\Users\30081048\.claude\projects\C--Users-30081048-Desktop-skills\memory\kairos-plataforma-pedidos-taisa.md` una nota: reserva de refill (migración 030, `visible_desde`), desplegada en portal y operario; queda por verificar en real el flujo completo con la interfaz (crear reserva desde el portal, ver el chip, cambiar fecha). Actualizar la línea de `MEMORY.md` si procede.

- [ ] **Step 5: Commit del plan (si hubo cambios)**

```bash
git status --short
```
Si solo queda el plan sin commitear: `git add docs/superpowers/plans/2026-09-30-reserva-refill.md && git commit -m "docs: plan reserva de refill"` con la línea de coautoría.
