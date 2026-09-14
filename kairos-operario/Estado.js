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
