/** Trazabilidad: la tienda ve el estado real de envío de sus peticiones,
 *  cada una por el camino que le corresponde según tipo:
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → seguimiento interno (myISO ya en
 *    tiempo real vía Pieza 4, sin sistema externo que consultar)
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 *  Mismo criterio que kairos-operario/Estado.js. */

function listarTrazabilidad(ldap) {
  const tienda = _tiendaDe_(ldap);
  const peticiones = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) +
    '&select=id,tipo,num_pedido,num_cesion,tienda_destino,transporte,estado,creada_en&order=creada_en.desc&limit=200');
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'interno'
      : 'hodos';
  });

  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  if (peticionesHodos.length) {
    const ids = peticionesHodos.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,hodos_id');
    peticionesHodos.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const conHodosId = propias.filter(function (l) { return l.hodos_id; });
      if (!conHodosId.length) { p.hodosTexto = 'Generando etiqueta…'; return; }
      const etiquetas = supaSelect_('etiquetas', 'id_unico=eq.' + encodeURIComponent(conHodosId[0].hodos_id) + '&select=pendiente_impresion_incpc', CFG.SCHEMA_HODOS);
      p.hodosTexto = etiquetas.length
        ? (etiquetas[0].pendiente_impresion_incpc ? 'Etiqueta pendiente de imprimir' : 'Etiqueta impresa')
        : 'Generando etiqueta…';
    });
  }

  return _json_(peticiones);
}
