/** Trazabilidad: la tienda ve el estado real de envío de sus peticiones,
 *  cada una por el camino que le corresponde según tipo:
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → HODOS (fusión Carta de Portes SIE,
 *    2026-09-15): public.palets + public.cargas, mismo Supabase que etiquetas
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 *  Mismo criterio que kairos-operario/Estado.js. */

function listarTrazabilidad(ldap) {
  const u = _usuarioDe_(ldap);
  var q = 'tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&select=id,tipo,num_pedido,num_cesion,tienda_destino,transporte,estado,creada_en,solicitante_ldap,motivo&order=creada_en.desc&limit=200';
  if (u.rol === 'vendedor') q += '&tipo=eq.refill'; // Vendedor solo ve Refill
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'refill'
      : 'hodos';
  });

  const idsTodas = peticiones.map(function (p) { return p.id; }).join(',');
  const lineasTodas = supaSelect_('lineas', 'peticion_id=in.(' + idsTodas + ')&select=peticion_id,codigo_lm,designacion,ubicacion,sscc');
  peticiones.forEach(function (p) {
    const propias = lineasTodas.filter(function (l) { return l.peticion_id === p.id; });
    p.articulo = propias.length === 1 ? (propias[0].codigo_lm + ' — ' + (propias[0].designacion || '')) : (propias.length + ' artículos');
    var ubicaciones = [];
    propias.forEach(function (l) { if (l.ubicacion && ubicaciones.indexOf(l.ubicacion) === -1) ubicaciones.push(l.ubicacion); });
    p.ubicaciones = ubicaciones;
    var sscc = [];
    propias.forEach(function (l) {
      _parseSsccMulti_(l.sscc, 0).forEach(function (parte) { if (parte.sscc && sscc.indexOf(parte.sscc) === -1) sscc.push(parte.sscc); });
    });
    p.sscc = sscc;
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

  // Camino "refill": enviada / en XP1 / cargada (con fecha de entrega real).
  const peticionesRefill = peticiones.filter(function (p) { return p.camino === 'refill'; });
  if (peticionesRefill.length) {
    const ids = peticionesRefill.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,estado_preparacion');

    const todosSscc = [];
    lineas.forEach(function (l) { if (l.sscc && todosSscc.indexOf(l.sscc) === -1) todosSscc.push(l.sscc); });
    const palets = todosSscc.length
      ? supaSelect_('palets', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')&select=sscc,encontrado,batea_id', CFG.SCHEMA_HODOS)
      : [];
    const idsCargas = [];
    palets.forEach(function (pa) { if (pa.batea_id && idsCargas.indexOf(pa.batea_id) === -1) idsCargas.push(pa.batea_id); });
    const cargas = idsCargas.length
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega', CFG.SCHEMA_HODOS)
      : [];

    peticionesRefill.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const ssccPeticion = propias.map(function (l) { return l.sscc; }).filter(Boolean);
      const paletesPeticion = palets.filter(function (pa) { return ssccPeticion.indexOf(pa.sscc) !== -1; });
      const cargado = paletesPeticion.filter(function (pa) { return pa.encontrado === true; })[0];

      if (cargado) {
        const carga = cargas.filter(function (c) { return c.id_carga === cargado.batea_id; })[0];
        p.refillTexto = 'Cargado' + (carga && carga.fecha_entrega ? ' · entrega ' + carga.fecha_entrega : '');
      } else if (propias.length && propias.every(function (l) { return l.estado_preparacion === 'preparado'; })) {
        p.refillTexto = 'Enviado a XP1';
      } else {
        p.refillTexto = 'Petición enviada';
      }
    });
  }

  return _json_(peticiones);
}
