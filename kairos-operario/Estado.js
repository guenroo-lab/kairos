/** Cruce de solo lectura por camino de seguimiento: cada tipo de petición
 *  se sigue con el mecanismo real que le corresponde.
 *  - pedido_cliente con transporte      → flujo "a_ubicar": Pedido/Preparando/
 *    Preparado (peticiones.estado + en_curso_por), y Consolidado + ubicación
 *    en cuanto se guarda ubicacion_consolidacion.
 *  - refill                             → HODOS (fusión Carta de Portes SIE,
 *    2026-09-15): público palets + cargas — Petición enviada / Enviado a
 *    XP1 / Cargado (fecha + hora de entrega), cuando pasa por RC1.
 *  - cesión / pedido_cliente sin transp.→ HODOS genera etiqueta automática
 *    (lineas.hodos_id + public.etiquetas) — Pedido / Preparando (alguien
 *    dentro, en_curso_por) / Preparado (etiqueta generada) / Cargado (la
 *    etiqueta ya viajó en una carga real, público etiquetas.batea_id →
 *    cargas) + fecha + hora de entrega.
 */

function listarEstadoPeticiones() {
  var q = 'estado=in.(pendiente,en_preparacion,a_ubicar,cerrada)' +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,creada_en,en_curso_por,ubicacion_consolidacion&order=creada_en.desc&limit=100';
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  peticiones.forEach(function (p) {
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'refill'
      : 'hodos';
    if (p.camino === 'a_ubicar' && p.ubicacion_consolidacion) {
      p.aUbicarTexto = 'Consolidado: ' + p.ubicacion_consolidacion;
    }
  });

  // Camino "hodos": cesión + pedido_cliente sin transporte.
  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  if (peticionesHodos.length) {
    const ids = peticionesHodos.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,hodos_id,estado_preparacion');

    const idsUnicos = [];
    lineas.forEach(function (l) { if (l.hodos_id && idsUnicos.indexOf(l.hodos_id) === -1) idsUnicos.push(l.hodos_id); });
    const etiquetas = idsUnicos.length
      ? supaSelect_('etiquetas', 'id_unico=in.(' + idsUnicos.map(encodeURIComponent).join(',') + ')&select=id_unico,batea_id', 'public')
      : [];
    const idsCargas = [];
    etiquetas.forEach(function (e) { if (e.batea_id && idsCargas.indexOf(e.batea_id) === -1) idsCargas.push(e.batea_id); });
    const cargas = idsCargas.length
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega,horario', 'public')
      : [];

    peticionesHodos.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const totalLineas = propias.length;
      const preparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
      const conHodosId = propias.filter(function (l) { return l.hodos_id; });

      if (!conHodosId.length) {
        p.hodosEstado = (p.en_curso_por && preparadas < totalLineas) ? 'Preparando'
          : (totalLineas && preparadas === totalLineas) ? 'Preparado'
          : 'Pedido';
        return;
      }
      const etiqueta = etiquetas.filter(function (e) { return e.id_unico === conHodosId[0].hodos_id; })[0];
      const carga = (etiqueta && etiqueta.batea_id) ? cargas.filter(function (c) { return c.id_carga === etiqueta.batea_id; })[0] : null;
      if (carga) {
        p.hodosEstado = 'Cargado';
        p.hodosFecha = carga.fecha_entrega;
        p.hodosHora = carga.horario;
      } else {
        p.hodosEstado = 'Preparado';
      }
    });
  }

  // Camino "refill": enviada / en XP1 (línea marcada preparada, dispara
  // move-to-address, Pieza 4) / cargada en RC1 (fila en public.palets con
  // encontrado=true, fecha + hora real en public.cargas).
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
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega,horario', 'public')
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
        p.refillHora = carga ? carga.horario : null;
      } else if (propias.length && propias.every(function (l) { return l.estado_preparacion === 'preparado'; })) {
        p.refillEstado = 'En silueta, esperando carga';
      } else {
        p.refillEstado = 'Petición enviada';
      }
    });
  }

  return _json_(peticiones);
}
