/** Trazabilidad: la tienda ve el estado real de envío de sus peticiones,
 *  cada una por el camino que le corresponde según tipo:
 *  - pedido_cliente con transporte      → flujo "a_ubicar": Pedido/Preparando/
 *    Preparado (peticiones.estado + en_curso_por), Consolidado + ubicación
 *    en cuanto se guarda ubicacion_consolidacion.
 *  - refill                             → HODOS (fusión Carta de Portes SIE,
 *    2026-09-15): public.palets + public.cargas — Petición enviada / En
 *    silueta esperando carga / Cargado (fecha + hora de entrega), al pasar
 *    por RC1.
 *  - cesión / pedido_cliente sin transp.→ HODOS genera etiqueta automática
 *    (lineas.hodos_id + public.etiquetas) — Pedido / Preparando / Preparado /
 *    Cargado (etiquetas.batea_id → cargas) + fecha + hora de entrega.
 *  Mismo criterio que kairos-operario/Estado.js. */

/** historico=false (por defecto): activas — para a_ubicar hasta que se
 *  guarda la ubicación de consolidación; para hodos/refill hasta que,
 *  cargado, llega la fecha+hora de entrega prevista (hasta entonces sigue
 *  en tránsito, no está en tienda todavía). historico=true: ya sucedió eso
 *  — archivo permanente para buscar/analizar, sigue viéndose ahí si aún
 *  cambia algo más adelante. */
function listarTrazabilidad(ldap, historico) {
  const u = _usuarioDe_(ldap);
  const campos = 'id,tipo,num_pedido,num_cesion,tienda_destino,transporte,estado,creada_en,solicitante_ldap,motivo,motivo_anulacion,en_curso_por,ubicacion_consolidacion,fecha_entrega,visible_desde';
  const filtroTienda = 'tienda_origen=eq.' + encodeURIComponent(u.tienda);
  const filtroRol = u.rol === 'vendedor' ? '&tipo=eq.refill' : ''; // Vendedor solo ve Refill

  // Bug real (revisión con Codex CLI, 2026-09-22): antes se pedían las 200
  // últimas peticiones y LUEGO se separaban activas/histórico en memoria —
  // en una tienda con más de 200 peticiones (activas + cerradas + anuladas)
  // una activa antigua podía quedar fuera de las 200 y desaparecer de la
  // vista "activas" sin más aviso. pendiente/en_preparacion/a_ubicar nunca
  // son histórico, así que se piden aparte y sin límite práctico; cerrada/
  // anulada sí se acotan a las últimas 200 (volumen real de histórico).
  const abiertas = supaSelect_('peticiones',
    filtroTienda + '&estado=in.(pendiente,en_preparacion,a_ubicar)&select=' + campos + '&order=creada_en.desc&limit=1000' + filtroRol);
  const cerradasOAnuladas = supaSelect_('peticiones',
    filtroTienda + '&estado=in.(cerrada,anulada)&select=' + campos + '&order=creada_en.desc&limit=200' + filtroRol);
  const peticiones = abiertas.concat(cerradasOAnuladas);
  if (!peticiones.length) return _json_([]);

  const hoyReservas = _hoyMadridIso_();
  peticiones.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    p.camino = (p.tipo === 'pedido_cliente' && p.transporte) ? 'a_ubicar'
      : (p.tipo === 'refill') ? 'refill'
      : 'hodos';
    if (p.camino === 'a_ubicar' && p.ubicacion_consolidacion) {
      p.aUbicarTexto = 'Consolidado: ' + p.ubicacion_consolidacion;
    }
    _marcarReserva_(p, hoyReservas);
  });

  const idsTodas = peticiones.map(function (p) { return p.id; }).join(',');
  const lineasTodas = supaSelect_('lineas', 'peticion_id=in.(' + idsTodas + ')&select=peticion_id,codigo_lm,designacion,ubicacion,sscc,seccion,cantidad,estado_negocio');
  peticiones.forEach(function (p) {
    const propias = lineasTodas.filter(function (l) { return l.peticion_id === p.id; });
    p.articulo = propias.length === 1 ? (propias[0].codigo_lm + ' — ' + (propias[0].designacion || '')) : (propias.length + ' artículos');
    p.totalUnidades = propias.reduce(function (s, l) { return s + Number(l.cantidad || 0); }, 0);
    var secciones = [];
    propias.forEach(function (l) { if (l.seccion && secciones.indexOf(l.seccion) === -1) secciones.push(l.seccion); });
    p.secciones = secciones;
    var ubicaciones = [];
    propias.forEach(function (l) { if (l.ubicacion && ubicaciones.indexOf(l.ubicacion) === -1) ubicaciones.push(l.ubicacion); });
    p.ubicaciones = ubicaciones;
    var sscc = [];
    propias.forEach(function (l) {
      _parseSsccMulti_(l.sscc, 0).forEach(function (parte) { if (parte.sscc && sscc.indexOf(parte.sscc) === -1) sscc.push(parte.sscc); });
    });
    p.sscc = sscc;
    p.conIncidencia = propias.some(function (l) { return ESTADOS_INCIDENCIA_PORTAL_.indexOf(l.estado_negocio) !== -1; });
    // Todo el pedido en incidencia (nada que enviar): no queda esperando una
    // entrega que nunca llegará, pasa a histórico marcado "Con incidencia".
    p.todoIncidencia = propias.length > 0 && propias.every(function (l) {
      return ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'].indexOf(l.estado_negocio) !== -1;
    });
  });

  // Camino "hodos": cesión + pedido_cliente sin transporte.
  const peticionesHodos = peticiones.filter(function (p) { return p.camino === 'hodos'; });
  if (peticionesHodos.length) {
    const ids = peticionesHodos.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,hodos_id,estado_preparacion');

    const idsUnicos = [];
    lineas.forEach(function (l) { if (l.hodos_id && idsUnicos.indexOf(l.hodos_id) === -1) idsUnicos.push(l.hodos_id); });
    const etiquetas = idsUnicos.length
      ? supaSelect_('etiquetas', 'id_unico=in.(' + idsUnicos.map(encodeURIComponent).join(',') + ')&select=id_unico,batea_id', CFG.SCHEMA_HODOS)
      : [];
    const idsCargas = [];
    etiquetas.forEach(function (e) { if (e.batea_id && idsCargas.indexOf(e.batea_id) === -1) idsCargas.push(e.batea_id); });
    const cargas = idsCargas.length
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega,horario', CFG.SCHEMA_HODOS)
      : [];

    peticionesHodos.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      const totalLineas = propias.length;
      const preparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
      const conHodosId = propias.filter(function (l) { return l.hodos_id; });

      if (!conHodosId.length) {
        p.hodosTexto = (p.en_curso_por && preparadas < totalLineas) ? 'Preparando'
          : (totalLineas && preparadas === totalLineas) ? 'Preparado'
          : 'Pedido';
        return;
      }
      const etiqueta = etiquetas.filter(function (e) { return e.id_unico === conHodosId[0].hodos_id; })[0];
      const carga = (etiqueta && etiqueta.batea_id) ? cargas.filter(function (c) { return c.id_carga === etiqueta.batea_id; })[0] : null;
      if (carga) {
        p.hodosTexto = 'Cargado' + (carga.fecha_entrega ? ' · entrega ' + carga.fecha_entrega + (carga.horario ? ' ' + carga.horario : '') : '');
        p._fechaLlegada = carga.fecha_entrega;
        p._horaLlegada = carga.horario;
      } else {
        p.hodosTexto = 'Preparado';
      }
    });
  }

  // Camino "refill": enviada / en silueta esperando carga / cargada (fecha + hora real).
  const peticionesRefill = peticiones.filter(function (p) { return p.camino === 'refill'; });
  if (peticionesRefill.length) {
    const ids = peticionesRefill.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,sscc,estado_preparacion');

    // Bug real (revisión con Codex CLI, 2026-09-22): lineas.sscc puede venir
    // decorado "SSCC (Nud)" o "SSCC1 (Nud) + SSCC2 (Mud)" cuando se eligió
    // más de un palet al pedir el refill — public.palets guarda el SSCC
    // puro. Comparar el string tal cual nunca hacía match: esos refills se
    // quedaban "Petición Realizada" para siempre, aunque HODOS ya los
    // hubiera cargado. Hay que extraer los SSCC puros con _parseSsccMulti_.
    const todosSscc = [];
    lineas.forEach(function (l) {
      _parseSsccMulti_(l.sscc, 0).forEach(function (parte) {
        if (parte.sscc && todosSscc.indexOf(parte.sscc) === -1) todosSscc.push(parte.sscc);
      });
    });
    const palets = todosSscc.length
      ? supaSelect_('palets', 'sscc=in.(' + todosSscc.map(encodeURIComponent).join(',') + ')&select=sscc,encontrado,batea_id', CFG.SCHEMA_HODOS)
      : [];
    const idsCargas = [];
    palets.forEach(function (pa) { if (pa.batea_id && idsCargas.indexOf(pa.batea_id) === -1) idsCargas.push(pa.batea_id); });
    const cargas = idsCargas.length
      ? supaSelect_('cargas', 'id_carga=in.(' + idsCargas.map(encodeURIComponent).join(',') + ')&select=id_carga,fecha_entrega,horario', CFG.SCHEMA_HODOS)
      : [];

    peticionesRefill.forEach(function (p) {
      if (p.reservaFutura) { p.refillTexto = 'Reservada'; return; }
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
        p.refillTexto = 'Cargado' + (carga && carga.fecha_entrega ? ' · entrega ' + carga.fecha_entrega + (carga.horario ? ' ' + carga.horario : '') : '');
        if (carga) { p._fechaLlegada = carga.fecha_entrega; p._horaLlegada = carga.horario; }
      } else if (propias.length && propias.every(function (l) { return l.estado_preparacion === 'preparado'; })) {
        p.refillTexto = 'En silueta, esperando carga';
      } else {
        p.refillTexto = 'Petición Realizada';
      }
    });
  }

  // "Preparada" (activa -> histórico) depende del camino, no solo de si las
  // líneas están hechas: a_ubicar pasa al dar ubicación; hodos/refill pasan
  // solo cuando, cargados, llega la fecha+hora de entrega prevista (hasta
  // entonces sigue en tránsito, no está físicamente en tienda todavía).
  // Anulada: directa a histórico, no debe quedar visible como activa en
  // ningún camino.
  const ahora = new Date();
  peticiones.forEach(function (p) {
    if (p.estado === 'anulada' || p.todoIncidencia) {
      p.preparada = true;
    } else if (p.camino === 'a_ubicar') {
      p.preparada = !!p.ubicacion_consolidacion;
    } else {
      const llegada = _fechaHoraCarga_(p._fechaLlegada, p._horaLlegada);
      p.preparada = !!(llegada && ahora >= llegada);
    }
    delete p._fechaLlegada;
    delete p._horaLlegada;
  });

  const filtradas = peticiones.filter(function (p) { return !!p.preparada === !!historico; });
  return _json_(filtradas);
}

/** cargas.fecha_entrega es texto "YYYY-MM-DD"; cargas.horario suele ser
 *  "H:MM" pero a veces texto libre ("Envío único diario") — si no hay hora
 *  reconocible se toma las 00:00 de esa fecha como referencia. */
function _fechaHoraCarga_(fechaEntrega, horario) {
  if (!fechaEntrega) return null;
  const partes = String(fechaEntrega).split('-');
  if (partes.length !== 3) return null;
  var horas = 0, minutos = 0;
  const m = String(horario || '').match(/^(\d{1,2}):(\d{2})/);
  if (m) { horas = Number(m[1]); minutos = Number(m[2]); }
  return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), horas, minutos, 0, 0);
}
