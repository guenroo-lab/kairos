# Incidencias en preparación — Plan de implementación

> **Para ejecución agéntica:** sin framework de test en este ecosistema.
> Verificación en vivo (`execute_sql`, `clasp push`, prueba manual del
> deploy real). Ejecutar con **superpowers:executing-plans**, tarea por
> tarea, **sin subagentes**.

**Goal:** capturar incidencias (Sin Palet / Sin Mercancía / Otras
Incidencias + motivo) al preparar líneas de `pedido_cliente`/`cesion` en
`kairos-operario`, replicando el flujo real de `PreparacionPedidosPC`, con
botón Deshacer. `refill` no cambia (checkbox simple).

**Architecture:** cambios en 3 ficheros ya existentes — servidor
(`Peticion.js`: nuevos parámetros + nueva función `deshacerLineaPreparada`),
puente HODOS (`Hodos.js`: filtro de incidencias, gap real corregido),
cliente (`Index.html`: sustituye el checkbox por un mini-flujo de vistas por
línea, guardado en una variable JS `vistaLinea`, sin recargar el servidor
entre pantallas).

**Tech Stack:** igual que piezas anteriores.

---

## Task 0: Rama de trabajo

- [ ] **Paso 1:**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos"
git checkout -b pulido-incidencias-preparacion
```

---

## Task 1: Servidor — `marcarLineaPreparada` + `deshacerLineaPreparada`

**Files:**
- Modify: `kairos-operario/Peticion.js`

- [ ] **Paso 1: Reemplazar `marcarLineaPreparada` y añadir `deshacerLineaPreparada`**

```js
function marcarLineaPreparada(lineaId, operarioNombre, incidencia, motivo) {
  operarioNombre = String(operarioNombre || '').trim();
  if (!operarioNombre) throw new Error('Selecciona tu nombre antes de preparar líneas.');
  incidencia = String(incidencia || '').trim();
  motivo = String(motivo || '').trim();

  const lineaActual = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=peticion_id');
  if (!lineaActual.length) throw new Error('Línea no encontrada.');
  const peticionId = lineaActual[0].peticion_id;

  var estadoNegocio, incidenciaMotivo;
  if (incidencia) {
    if (['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'].indexOf(incidencia) === -1) {
      throw new Error('Incidencia desconocida: ' + incidencia);
    }
    estadoNegocio = incidencia;
    if (incidencia === 'Otras Incidencias') {
      if (!motivo) throw new Error('Falta el motivo para la incidencia "Otras Incidencias".');
      incidenciaMotivo = motivo;
    } else {
      incidenciaMotivo = null;
    }
  } else {
    const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&select=tipo,transporte');
    const peticion = cab[0];
    estadoNegocio = (peticion.tipo === 'pedido_cliente' && peticion.transporte === true) ? 'Consolidado' : 'Preparado';
    incidenciaMotivo = null;
  }

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    estado_preparacion: 'preparado',
    estado_negocio: estadoNegocio,
    incidencia_motivo: incidenciaMotivo,
    operario: operarioNombre,
    preparada_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');

  _dispararEtiquetaSiProcede_(peticionId);

  return _json_({ ok: true });
}

function deshacerLineaPreparada(lineaId, operarioNombre) {
  operarioNombre = String(operarioNombre || '').trim();
  if (!operarioNombre) throw new Error('Selecciona tu nombre.');

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    estado_preparacion: 'en_curso',
    estado_negocio: null,
    incidencia_motivo: null,
    operario: operarioNombre,
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
```

`obtenerPeticion` y `guardarUbicacionConsolidacion` no cambian.

- [ ] **Paso 2: Deploy**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
```

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Peticion.js
git commit -m "feat(operario): incidencias y deshacer en marcarLineaPreparada"
```

(Verificación en vivo en Task 4, junto con el resto.)

---

## Task 2: HODOS — excluir líneas con incidencia (gap real corregido)

**Files:**
- Modify: `kairos-operario/Hodos.js`

- [ ] **Paso 1: Reemplazar `_dispararEtiquetaSiProcede_`**

```js
const INCIDENCIAS_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];

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

    const limpias = lineas.filter(function (l) { return INCIDENCIAS_.indexOf(l.estado_negocio) === -1; });
    if (!limpias.length) return; // todo incidencia, no hay nada que enviar a HODOS

    const destino = peticion.tipo === 'cesion'
      ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino)
      : (CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen);

    const idUnico = _enviarEtiquetaHodos_({
      destino: destino,
      pedido: peticion.num_pedido || null,
      tipo: SUBTIPO_HODOS_PREPARACION_,
      origenIntegracion: 'preparacion',
      operario: (limpias[0].operario || ''),
      items: limpias.map(function (l) { return { referencia: String(l.codigo_lm), cantidad: Number(l.cantidad) }; }),
    });

    const idsLimpias = limpias.map(function (l) { return l.id; }).join(',');
    supaUpdate_('lineas', 'id=in.(' + idsLimpias + ')', { hodos_id: idUnico });
  } catch (err) {
    console.error('_dispararEtiquetaSiProcede_ (' + peticionId + '): ' + err.message);
  }
}
```

`_enviarEtiquetaHodos_` no cambia.

- [ ] **Paso 2: Deploy**

```bash
clasp push --force
```

- [ ] **Paso 3: Commit**

```bash
git add kairos-operario/Hodos.js
git commit -m "fix(operario): HODOS excluye lineas con incidencia (gap real)"
```

---

## Task 3: Cliente — flujo de incidencia + Deshacer

**Files:**
- Modify: `kairos-operario/Index.html`

- [ ] **Paso 1: Añadir estilos nuevos**

Junto a `button.secundario { background: #757575; }`:

```css
    button.aviso { background: #ef6c00; }
    button.peligro { background: #c62828; }
```

- [ ] **Paso 2: Añadir variable de estado de vista por línea**

Junto a `var ultimoDetalle = null;`:

```js
    var vistaLinea = {}; // lineaId -> 'pregunta' | 'tipos' | 'motivo' (ausente = vista normal)
    var INCIDENCIAS = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];
```

- [ ] **Paso 3: Reemplazar `pintarDetalle` — separa parseo/estado de render**

```js
    function pintarDetalle(json) {
      ultimoDetalle = JSON.parse(json);
      vistaLinea = {};
      renderDetalleBody_();
    }

    function renderDetalleBody_() {
      const p = ultimoDetalle.peticion;
      var titulo = p.tipo === 'pedido_cliente' ? ('Pedido cliente ' + (p.num_pedido || '')) : (p.tipo === 'cesion' ? ('Cesión → ' + p.tiendaDestinoNombre) : ('Refill: ' + (p.motivo || '')));

      var html = '<h1>' + titulo + '</h1><p class="meta">' + p.tiendaNombre + '</p>';
      html += ultimoDetalle.lineas.map(function (l) { return renderLineaHtml_(p, l); }).join('');

      if (p.estado === 'a_ubicar') {
        html += '<h3>A ubicar</h3><input type="text" id="ubicacion" placeholder="Ubicación de consolidación"> <button onclick="guardarUbicacion(\'' + p.id + '\')">Guardar</button>';
      } else if (p.estado === 'cerrada') {
        html += '<p><strong>Petición completada.</strong></p>';
      }

      document.getElementById('detalleBody').innerHTML = html;
    }

    function renderLineaHtml_(p, l) {
      const cabecera = l.codigo_lm + ' — ' + (l.designacion || '') + ' (' + l.cantidad + ' ' + l.unidad_medida + ')';
      var extraInfo = '';
      if (l.avisoStock) extraInfo = '<div class="meta" style="color:#c62828;">⚠️ ' + l.avisoStock + '</div>';
      else if (l.ubicacion) extraInfo = '<div class="meta">📍 ' + l.ubicacion + '</div>';

      const preparada = l.estado_preparacion === 'preparado';
      if (preparada) {
        const resumen = l.estado_negocio ? (l.estado_negocio + (l.incidencia_motivo ? ' — ' + l.incidencia_motivo : '')) : '';
        var botonDeshacer = '';
        if (p.tipo === 'pedido_cliente' || p.tipo === 'cesion') {
          botonDeshacer = ' <button class="secundario" onclick="deshacerLinea(\'' + l.id + '\')">Deshacer</button>';
        }
        return '<div class="linea preparada"><div>' + cabecera + '</div>' + extraInfo +
          '<div class="meta">✓ Preparada' + (resumen ? ' · ' + resumen : '') + '</div>' + botonDeshacer + '</div>';
      }

      const bloqueada = !l.sscc;

      if (p.tipo === 'refill') {
        return '<div class="linea"><label><input type="checkbox" ' + (bloqueada ? 'disabled' : '') + ' onchange="marcarLinea(\'' + l.id + '\', this)"> ' + cabecera + '</label>' + extraInfo + '</div>';
      }

      // pedido_cliente / cesion: flujo de incidencia
      if (bloqueada) {
        return '<div class="linea"><div>' + cabecera + '</div>' + extraInfo + '</div>';
      }

      const vista = vistaLinea[l.id];

      if (vista === 'motivo') {
        return '<div class="linea"><div>' + cabecera + '</div>' +
          '<input type="text" id="motivo-' + l.id + '" placeholder="Motivo de la incidencia"> ' +
          '<button onclick="confirmarOtrasIncidencias(\'' + l.id + '\')">Confirmar</button> ' +
          '<button class="secundario" onclick="verIncidenciaTipos(\'' + l.id + '\')">‹ Volver</button></div>';
      }
      if (vista === 'tipos') {
        return '<div class="linea"><div>' + cabecera + '</div>' +
          '<button class="aviso" onclick="cerrarLinea(\'' + l.id + '\', \'Sin Palet\', \'\')">Sin Palet</button> ' +
          '<button class="peligro" onclick="cerrarLinea(\'' + l.id + '\', \'Sin Mercancía\', \'\')">Sin Mercancía</button> ' +
          '<button class="secundario" onclick="verIncidenciaMotivo(\'' + l.id + '\')">Otras Incidencias</button> ' +
          '<button class="secundario" onclick="verIncidenciaPregunta(\'' + l.id + '\')">‹ Volver</button></div>';
      }
      if (vista === 'pregunta') {
        return '<div class="linea"><div>' + cabecera + '</div>' +
          '<button onclick="cerrarLinea(\'' + l.id + '\', \'\', \'\')">Sin incidencia</button> ' +
          '<button class="secundario" onclick="verIncidenciaTipos(\'' + l.id + '\')">⚠ Con incidencia</button></div>';
      }
      return '<div class="linea"><div>' + cabecera + '</div>' + extraInfo +
        '<button onclick="verIncidenciaPregunta(\'' + l.id + '\')">Marcar preparada</button></div>';
    }

    function verIncidenciaPregunta(lineaId) { vistaLinea[lineaId] = 'pregunta'; renderDetalleBody_(); }
    function verIncidenciaTipos(lineaId) { vistaLinea[lineaId] = 'tipos'; renderDetalleBody_(); }
    function verIncidenciaMotivo(lineaId) { vistaLinea[lineaId] = 'motivo'; renderDetalleBody_(); }

    function confirmarOtrasIncidencias(lineaId) {
      const input = document.getElementById('motivo-' + lineaId);
      const texto = (input.value || '').trim();
      if (!texto) { input.focus(); return; }
      cerrarLinea(lineaId, 'Otras Incidencias', texto);
    }

    function cerrarLinea(lineaId, incidencia, motivo) {
      delete vistaLinea[lineaId];
      dispararPuenteMyIsoSiProcede_(lineaId, !!incidencia);
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); })
        .marcarLineaPreparada(lineaId, OPERARIO, incidencia, motivo);
    }

    function deshacerLinea(lineaId) {
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); })
        .deshacerLineaPreparada(lineaId, OPERARIO);
    }
```

- [ ] **Paso 4: Actualizar `marcarLinea` (checkbox de refill) y
      `dispararPuenteMyIsoSiProcede_` (filtra incidencias)**

```js
    function marcarLinea(lineaId, checkbox) {
      checkbox.disabled = true;
      dispararPuenteMyIsoSiProcede_(lineaId, false);
      google.script.run
        .withSuccessHandler(function () { renderDetalle(); })
        .withFailureHandler(function (err) { alert(err.message); checkbox.disabled = false; checkbox.checked = false; })
        .marcarLineaPreparada(lineaId, OPERARIO);
    }

    // Debe llamarse SÍNCRONAMENTE dentro del onclick — ver Pieza 4.
    // incidenciaMarcada: true/false para la línea que se está cerrando AHORA
    // (su estado_negocio aún no está en ultimoDetalle — el resto de líneas sí).
    function dispararPuenteMyIsoSiProcede_(lineaIdMarcada, incidenciaMarcada) {
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

        function esIncidencia(l) {
          return l.id === lineaIdMarcada ? !!incidenciaMarcada : INCIDENCIAS.indexOf(l.estado_negocio) !== -1;
        }

        const transfers = [];
        lineas.forEach(function (l) {
          if (esIncidencia(l)) return;
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
```

`limpiarSscc`, `parsearSsccMulti`, `dispararTransfers_`, `dispararMoveToAddress_`,
`renderDetalle`, `guardarUbicacion` no cambian.

- [ ] **Paso 5: Deploy**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario"
clasp push --force
clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A
```

- [ ] **Paso 6: Commit**

```bash
git add kairos-operario/Index.html
git commit -m "feat(operario): flujo de incidencia + deshacer en el cliente"
```

---

## Task 4: Verificación E2E en vivo

- [ ] **Paso 1: Datos de prueba**

Reutilizar `stock_fisico` real ya sincronizado (código `82691471`, tienda
`014`, con SSCC disponibles — confirmar con
`select * from preparacion.stock_fisico where codigo_lm='82691471' and tienda='014';`
si sigue habiendo remanente; si no, insertar filas de prueba nuevas).

Crear 2 peticiones `pedido_cliente` (una `transporte=true`, otra `false`) y
1 `cesion`, cada una con 2 líneas del código de prueba.

- [ ] **Paso 2: Caso sin incidencia — transporte true**

Abrir detalle, "Marcar preparada" → "Sin incidencia" en ambas líneas.
Confirmar por `execute_sql`: `estado_negocio = 'Consolidado'` en ambas.

- [ ] **Paso 3: Caso sin incidencia — transporte false**

Mismo flujo en la petición `transporte=false`. Confirmar
`estado_negocio = 'Preparado'` y que se dispara HODOS (`hodos_id` relleno,
ya verificado el mecanismo en Pieza 3 — aquí solo confirmar que sigue
funcionando con el nuevo código).

- [ ] **Paso 4: Caso con incidencia — Sin Palet / Sin Mercancía**

En la petición de cesión: línea 1 → "Con incidencia" → "Sin Palet". Línea 2
→ "Con incidencia" → "Sin Mercancía". Confirmar:
```sql
select estado_preparacion, estado_negocio, incidencia_motivo from preparacion.lineas where peticion_id = '<id-cesion>';
```
Ambas `estado_preparacion='preparado'`, `estado_negocio` correcto,
`incidencia_motivo` null. Confirmar que **NO** se creó etiqueta HODOS
(`hodos_id` null en ambas — cesión sin líneas limpias, `limpias.length===0`).

- [ ] **Paso 5: Caso "Otras Incidencias" con motivo**

Nueva línea de prueba (o reutilizar una petición nueva): "Con incidencia" →
"Otras Incidencias" → dejar el input vacío y pulsar Confirmar → confirmar
que **no** avanza (el input mantiene el foco). Escribir un motivo → Confirmar
→ verificar `estado_negocio='Otras Incidencias'`, `incidencia_motivo`
relleno con el texto exacto.

- [ ] **Paso 6: Deshacer**

Sobre cualquier línea ya preparada (con o sin incidencia), pulsar
"Deshacer". Confirmar `estado_preparacion='en_curso'`,
`estado_negocio=null`, `incidencia_motivo=null`, y que `sscc`/`ubicacion`
**no** cambiaron. Confirmar que la petición vuelve a `en_preparacion` (el
trigger SQL ya existente lo recalcula solo). Volver a marcarla (con otro
tipo de incidencia distinto) para confirmar que se puede corregir.

- [ ] **Paso 7: Limpiar datos de prueba**

```sql
delete from preparacion.peticiones where solicitante_ldap = 'test.e2e';
```

---

## Task 5: Documentación

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\Kairos\README.md`

- [ ] **Paso 1:** Añadir nota bajo la tabla de piezas: "Pulido: incidencias
  en preparación (kairos-operario) — completo 2026-09-14".

- [ ] **Paso 2: Commit**

```bash
git add README.md
git commit -m "docs: pulido incidencias en preparacion completo"
```

- [ ] **Paso 3: Memoria** (fuera de git) — añadir nota breve en
  `kairos-plataforma-pedidos-taisa.md` bajo la sección de Pieza 3.

---

## Task 6: Cierre de rama

**superpowers:finishing-a-development-branch** tras Task 4 verificado sin
fallos.
