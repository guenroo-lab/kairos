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

/** Pedidos ya preparados que esperan ubicación de consolidación (transporte,
 *  estado a_ubicar y sin ubicacion_consolidacion): aviso para que no se queden
 *  olvidados. filtroTienda opcional. Con cuándo se preparó la última línea. */
function listarPendientesDeUbicar(filtroTienda) {
  var q = 'estado=eq.a_ubicar&ubicacion_consolidacion=is.null' +
    '&select=id,tipo,tienda_origen,num_pedido,creada_en&order=creada_en.asc&limit=100';
  if (filtroTienda) q += '&tienda_origen=eq.' + encodeURIComponent(filtroTienda);
  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  const lineas = supaSelectIn_('lineas', 'peticion_id', peticiones.map(function (p) { return p.id; }), 'select=peticion_id,preparada_en');
  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.preparadaEn = propias.reduce(function (max, l) { return (l.preparada_en && (!max || l.preparada_en > max)) ? l.preparada_en : max; }, null);
  });
  return _json_(peticiones);
}

function listarEstadoPeticiones() {
  var q = 'estado=in.(pendiente,en_preparacion,a_ubicar,cerrada)' +
    '&visible_desde=lte.' + _hoyMadridIso_() +
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
    const lineas = supaSelectIn_('lineas', 'peticion_id', peticionesHodos.map(function (p) { return p.id; }), 'select=peticion_id,hodos_id,estado_preparacion');

    const idsUnicos = [];
    lineas.forEach(function (l) { if (l.hodos_id && idsUnicos.indexOf(l.hodos_id) === -1) idsUnicos.push(l.hodos_id); });
    const etiquetas = supaSelectIn_('etiquetas', 'id_unico', idsUnicos, 'select=id_unico,batea_id', 'public');
    const idsCargas = [];
    etiquetas.forEach(function (e) { if (e.batea_id && idsCargas.indexOf(e.batea_id) === -1) idsCargas.push(e.batea_id); });
    const cargas = supaSelectIn_('cargas', 'id_carga', idsCargas, 'select=id_carga,fecha_entrega,horario', 'public');

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
    const lineas = supaSelectIn_('lineas', 'peticion_id', peticionesRefill.map(function (p) { return p.id; }), 'select=peticion_id,sscc,estado_preparacion');

    // Bug real (revisión con Codex CLI, 2026-09-22): lineas.sscc puede venir
    // decorado "SSCC (Nud)" o "SSCC1 (Nud) + SSCC2 (Mud)" cuando se eligió
    // más de un palet al pedir el refill — public.palets guarda el SSCC
    // puro. Comparar el string tal cual nunca hacía match: esos refills se
    // quedaban "Petición Realizada" para siempre. Extraer los SSCC puros
    // con _parseSsccMulti_ (StockAsignacion.js).
    const todosSscc = [];
    lineas.forEach(function (l) {
      _parseSsccMulti_(l.sscc, 0).forEach(function (parte) {
        if (parte.sscc && todosSscc.indexOf(parte.sscc) === -1) todosSscc.push(parte.sscc);
      });
    });
    const palets = supaSelectIn_('palets', 'sscc', todosSscc, 'select=sscc,encontrado,batea_id', 'public');
    const idsCargas = [];
    palets.forEach(function (pa) { if (pa.batea_id && idsCargas.indexOf(pa.batea_id) === -1) idsCargas.push(pa.batea_id); });
    const cargas = supaSelectIn_('cargas', 'id_carga', idsCargas, 'select=id_carga,fecha_entrega,horario', 'public');

    peticionesRefill.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const ssccPeticion = [];
      propias.forEach(function (l) {
        _parseSsccMulti_(l.sscc, 0).forEach(function (parte) { if (parte.sscc && ssccPeticion.indexOf(parte.sscc) === -1) ssccPeticion.push(parte.sscc); });
      });
      const paletesPeticion = palets.filter(function (pa) { return ssccPeticion.indexOf(pa.sscc) !== -1; });
      // Bug real (revisión adversarial con Codex CLI, mismo día): en un
      // refill de varios palets, con que UNO estuviera cargado ya se
      // marcaba la petición entera "Cargado" — ahora hacen falta todos los
      // SSCC esperados, cada uno con fila en public.palets y encontrado=true.
      const todosCargados = ssccPeticion.length > 0 && ssccPeticion.every(function (sscc) {
        const pa = palets.filter(function (x) { return x.sscc === sscc; })[0];
        return !!pa && pa.encontrado === true;
      });
      const cargado = todosCargados ? paletesPeticion.filter(function (pa) { return pa.encontrado === true; })[0] : null;

      if (cargado) {
        const carga = cargas.filter(function (c) { return c.id_carga === cargado.batea_id; })[0];
        p.refillEstado = 'Cargado';
        p.refillFecha = carga ? carga.fecha_entrega : null;
        p.refillHora = carga ? carga.horario : null;
      } else if (propias.length && propias.every(function (l) { return l.estado_preparacion === 'preparado'; })) {
        p.refillEstado = 'En silueta, esperando carga';
      } else {
        p.refillEstado = 'Petición Realizada';
      }
    });
  }

  return _json_(peticiones);
}
