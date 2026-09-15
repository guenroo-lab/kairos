/** Cruce de solo lectura por camino de seguimiento: cada tipo de petición
 *  se sigue con el mecanismo real que le corresponde.
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → seguimiento interno (myISO ya en
 *    tiempo real vía Pieza 4, sin sistema externo que consultar)
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 */

function listarEstadoPeticiones() {
  var q = 'estado=in.(en_preparacion,a_ubicar,cerrada)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,creada_en&order=creada_en.desc&limit=100';
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'interno'
      : 'hodos';
  });

  // Camino "hodos": cesión + pedido_cliente sin transporte.
  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  if (peticionesHodos.length) {
    const ids = peticionesHodos.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,hodos_id');
    peticionesHodos.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      p.hodosOk = propias.some(function (l) { return l.hodos_id; });
    });
  }

  // Caminos "a_ubicar" e "interno": no necesitan cruce extra, ya viene en p.estado.

  return _json_(peticiones);
}
