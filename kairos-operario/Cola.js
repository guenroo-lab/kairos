function listarCola(filtroTienda, filtroTipo) {
  var q = 'estado=in.(pendiente,en_preparacion)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,transporte,motivo,creada_en' +
    '&order=creada_en.asc&limit=200';
  if (filtroTienda) q += '&tienda_origen=eq.' + encodeURIComponent(filtroTienda);
  if (filtroTipo) q += '&tipo=eq.' + encodeURIComponent(filtroTipo);

  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,estado_preparacion');

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.tiendaDestinoNombre = p.tienda_destino ? (CFG.TIENDAS[p.tienda_destino] || p.tienda_destino) : null;
  });

  return _json_(peticiones);
}
