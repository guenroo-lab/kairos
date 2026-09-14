/** Cruce de solo lectura por camino de seguimiento (Pieza 6 — corrige el
 *  cruce genérico de Pieza 5): cada tipo de petición se sigue con el
 *  mecanismo real que le corresponde, no con una mezcla de los tres.
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → Carta de Portes por SSCC (estado_porte)
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 */

function _todosSsccDeLinea_(sscc) {
  return _parseSsccMulti_(sscc, 0).map(function (p) { return p.sscc; }).filter(Boolean);
}

function listarEstadoPeticiones() {
  var q = 'estado=in.(en_preparacion,a_ubicar,cerrada)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,transporte,estado,creada_en&order=creada_en.desc&limit=100';
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'porte'
      : 'hodos';
  });

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,hodos_id');

  // Camino "porte": solo refill.
  const peticionesPorte = peticiones.filter(function (p) { return p.camino === 'porte'; });
  if (peticionesPorte.length) {
    const todosSscc = [];
    lineas.forEach(function (l) {
      _todosSsccDeLinea_(l.sscc).forEach(function (s) { if (todosSscc.indexOf(s) === -1) todosSscc.push(s); });
    });
    const porte = todosSscc.length
      ? supaSelect_('estado_porte', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')')
      : [];
    peticionesPorte.forEach(function (p) {
      var ssccPeticion = [];
      lineas.filter(function (l) { return l.peticion_id === p.id; })
        .forEach(function (l) { _todosSsccDeLinea_(l.sscc).forEach(function (s) { if (ssccPeticion.indexOf(s) === -1) ssccPeticion.push(s); }); });
      const filasPorte = porte.filter(function (e) { return ssccPeticion.indexOf(e.sscc) !== -1; });
      p.porteEstado = !filasPorte.length ? null :
        filasPorte.every(function (e) { return e.estado_recepcion === 'Recepcionado'; }) ? 'Recepcionado' :
        filasPorte.some(function (e) { return e.estado_carga === 'Cargado'; }) ? 'Cargado' : 'Pendiente';
    });
  }

  // Camino "hodos": cesión + pedido_cliente sin transporte.
  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  peticionesHodos.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.hodosOk = propias.some(function (l) { return l.hodos_id; });
  });

  // Camino "a_ubicar": no necesita cruce extra, ya viene en p.estado.

  return _json_(peticiones);
}
