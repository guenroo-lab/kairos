/** Trazabilidad (Pieza 6): la tienda ve el estado real de envío de sus
 *  peticiones, cada una por el camino que le corresponde según tipo:
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → Carta de Portes por SSCC (estado_porte)
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 *  Mismo criterio de los 3 caminos que kairos-operario/Estado.js. */

/** Espejo de kairos-operario/StockAsignacion.js:_parseSsccMulti_. */
function _parseSsccMulti_(valorSscc) {
  const raw = String(valorSscc || '').trim();
  if (!raw) return [];
  const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
  return partes.map(function (parte) {
    const m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
    return m ? m[1].trim() : parte.trim();
  }).filter(Boolean);
}

function listarTrazabilidad(ldap) {
  const tienda = _tiendaDe_(ldap);
  const peticiones = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) +
    '&select=id,tipo,num_pedido,tienda_destino,transporte,estado,creada_en&order=creada_en.desc&limit=200');
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'porte'
      : 'hodos';
  });

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,hodos_id');

  const peticionesPorte = peticiones.filter(function (p) { return p.camino === 'porte'; });
  if (peticionesPorte.length) {
    const todosSscc = [];
    lineas.forEach(function (l) {
      _parseSsccMulti_(l.sscc).forEach(function (s) { if (todosSscc.indexOf(s) === -1) todosSscc.push(s); });
    });
    const porte = todosSscc.length
      ? supaSelect_('estado_porte', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')')
      : [];
    peticionesPorte.forEach(function (p) {
      var ssccPeticion = [];
      lineas.filter(function (l) { return l.peticion_id === p.id; })
        .forEach(function (l) { _parseSsccMulti_(l.sscc).forEach(function (s) { if (ssccPeticion.indexOf(s) === -1) ssccPeticion.push(s); }); });
      const filasPorte = porte.filter(function (e) { return ssccPeticion.indexOf(e.sscc) !== -1; });
      p.porteEstado = !filasPorte.length ? 'Sin carta todavía' :
        filasPorte.every(function (e) { return e.estado_recepcion === 'Recepcionado'; }) ? 'Recepcionado' :
        filasPorte.some(function (e) { return e.estado_carga === 'Cargado'; }) ? 'Cargado' : 'Pendiente';
    });
  }

  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  peticionesHodos.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    const conHodosId = propias.filter(function (l) { return l.hodos_id; });
    if (!conHodosId.length) { p.hodosTexto = 'Generando etiqueta…'; return; }
    const etiquetas = supaSelect_('etiquetas', 'id_unico=eq.' + encodeURIComponent(conHodosId[0].hodos_id) + '&select=pendiente_impresion_incpc', CFG.SCHEMA_HODOS);
    p.hodosTexto = etiquetas.length
      ? (etiquetas[0].pendiente_impresion_incpc ? 'Etiqueta pendiente de imprimir' : 'Etiqueta impresa')
      : 'Generando etiqueta…';
  });

  return _json_(peticiones);
}
