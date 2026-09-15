/** Cruce de solo lectura por camino de seguimiento: cada tipo de petición
 *  se sigue con el mecanismo real que le corresponde.
 *  - pedido_cliente con transporte      → flujo "a_ubicar" (peticiones.estado)
 *  - refill                             → HODOS (fusión Carta de Portes SIE,
 *    2026-09-15): public.palets + public.cargas, mismo Supabase que etiquetas
 *  - cesión / pedido_cliente sin transp.→ HODOS (lineas.hodos_id + etiquetas)
 */

function listarEstadoPeticiones() {
  var q = 'estado=in.(pendiente,en_preparacion,a_ubicar,cerrada)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,creada_en&order=creada_en.desc&limit=100';
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'refill'
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

  // Camino "refill": enviada / en XP1 (línea marcada preparada, dispara
  // move-to-address, Pieza 4) / cargada (fila en public.palets con
  // encontrado=true, fecha real en public.cargas.fecha_entrega).
  const peticionesRefill = peticiones.filter(function (p) { return p.camino === 'refill'; });
  if (peticionesRefill.length) {
    const ids = peticionesRefill.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,estado_preparacion');

    const todosSscc = [];
    lineas.forEach(function (l) { if (l.sscc && todosSscc.indexOf(l.sscc) === -1) todosSscc.push(l.sscc); });
    const palets = todosSscc.length
      ? supaSelect_('palets', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')&select=sscc,encontrado,batea_id', 'public')
      : [];
    const idsCargas = [];
    palets.forEach(function (pa) { if (pa.batea_id && idsCargas.indexOf(pa.batea_id) === -1) idsCargas.push(pa.batea_id); });
    const cargas = idsCargas.length
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega', 'public')
      : [];

    peticionesRefill.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const ssccPeticion = propias.map(function (l) { return l.sscc; }).filter(Boolean);
      const paletesPeticion = palets.filter(function (pa) { return ssccPeticion.indexOf(pa.sscc) !== -1; });
      const cargado = paletesPeticion.filter(function (pa) { return pa.encontrado === true; })[0];

      if (cargado) {
        const carga = cargas.filter(function (c) { return c.id_carga === cargado.batea_id; })[0];
        p.refillEstado = 'Cargado';
        p.refillFecha = carga ? carga.fecha_entrega : null;
      } else if (propias.length && propias.every(function (l) { return l.estado_preparacion === 'preparado'; })) {
        p.refillEstado = 'Enviado a XP1';
      } else {
        p.refillEstado = 'Petición enviada';
      }
    });
  }

  return _json_(peticiones);
}
