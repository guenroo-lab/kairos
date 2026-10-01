/** Panel jefe de equipo: todas las peticiones, etiquetas HODOS ya creadas
 *  por Kairos, y reintento del envío para las que fallaron. */

/** Panel en vivo del jefe de equipo — todas las peticiones (activas Y
 *  cerradas, hasta el límite, para no perder el "Reintentar HODOS" de las
 *  cerradas sin etiqueta), con lo necesario para vigilarlas de un vistazo:
 *  artículos+cantidades, quién las está preparando (en_curso_por) y la
 *  fecha de creación (para el contador de urgencia, calculado en cliente). */
function listarTodasPeticiones() {
  const campos = '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap,fecha_entrega,ubicacion_consolidacion';
  // Activas (de cualquier antigüedad) + cerradas de los últimos 3 días: antes
  // eran las 300 más antiguas de todas, y con el histórico creciendo las
  // peticiones nuevas dejaban de salir en el panel.
  const activas = supaSelect_('peticiones',
    'visible_desde=lte.' + _hoyMadridIso_() + '&estado=in.(pendiente,en_preparacion,a_ubicar)' + campos + '&order=creada_en.asc&limit=300');
  const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const cerradas = supaSelect_('peticiones',
    'visible_desde=lte.' + _hoyMadridIso_() + '&estado=eq.cerrada&cerrada_en=gte.' + encodeURIComponent(desde) + campos + '&order=creada_en.asc&limit=300');
  const peticiones = activas.concat(cerradas);
  if (!peticiones.length) return _json_([]);

  const lineas = supaSelectIn_('lineas', 'peticion_id', peticiones.map(function (p) { return p.id; }),
    'select=peticion_id,estado_preparacion,estado_negocio,preparada_en,hodos_id,codigo_lm,designacion,cantidad,unidad_medida');

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    // Cuándo se preparó la última línea (para "preparado hace X" en pendientes de ubicar).
    p.preparadaEn = propias.reduce(function (max, l) { return (l.preparada_en && (!max || l.preparada_en > max)) ? l.preparada_en : max; }, null);
    // Un pedido cuyas líneas son TODAS incidencia sin mercancía (Sin Palet / Sin
    // Mercancía / Otras) no tiene nada que etiquetar: HODOS no necesita etiqueta
    // y no debe salir como "cerrada sin etiqueta" con botón de reintento.
    const soloIncidencias = propias.length > 0 && propias.every(function (l) { return INCIDENCIAS_.indexOf(l.estado_negocio) !== -1; });
    p.necesitaHodos = ((p.tipo === 'cesion') || (p.tipo === 'pedido_cliente' && !p.transporte)) && !soloIncidencias;
    p.tieneHodos = propias.some(function (l) { return l.hodos_id; });
    p.articulos = propias.map(function (l) {
      return { codigo_lm: l.codigo_lm, designacion: l.designacion, cantidad: l.cantidad, unidad_medida: l.unidad_medida };
    });
  });
  return _json_(peticiones);
}

/** Historial del día para el jefe de equipo: peticiones ya cerradas hoy,
 *  con quién preparó cada una (lineas.operario) — para revisar de un
 *  vistazo qué se ha hecho y quién lo hizo, no solo lo pendiente. */
function listarHistorialHoy() {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
  const peticiones = supaSelect_('peticiones',
    'estado=eq.cerrada&cerrada_en=gte.' + encodeURIComponent(inicioHoy) +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,cerrada_en,solicitante_ldap' +
    '&order=cerrada_en.desc&limit=200');
  if (!peticiones.length) return _json_([]);

  const lineas = supaSelectIn_('lineas', 'peticion_id', peticiones.map(function (p) { return p.id; }),
    'select=peticion_id,codigo_lm,designacion,cantidad,unidad_medida,operario,estado_negocio');

  peticiones.forEach(function (p) {
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    var operarios = [];
    propias.forEach(function (l) { if (l.operario && operarios.indexOf(l.operario) === -1) operarios.push(l.operario); });
    p.operarios = operarios;
    p.articulos = propias.map(function (l) {
      return { codigo_lm: l.codigo_lm, designacion: l.designacion, cantidad: l.cantidad, unidad_medida: l.unidad_medida };
    });
    p.tuvoIncidencia = propias.some(function (l) {
      return l.estado_negocio && l.estado_negocio !== 'Preparado' && l.estado_negocio !== 'Consolidado';
    });
  });
  return _json_(peticiones);
}

function listarEtiquetasHodos() {
  const lineas = supaSelect_('lineas', 'hodos_id=not.is.null&select=hodos_id&order=hodos_id.desc&limit=500');
  const ids = [];
  lineas.forEach(function (l) { if (ids.indexOf(l.hodos_id) === -1) ids.push(l.hodos_id); });
  if (!ids.length) return _json_([]);
  const etiquetas = supaSelectIn_('etiquetas', 'id_unico', ids,
    'select=id_unico,destino,numero_pedido,estado,fecha_creacion', 'public');
  // El orden se aplica aquí (la consulta va en lotes).
  etiquetas.sort(function (a, b) { return String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)); });
  return _json_(etiquetas);
}

function reintentarHodos(peticionId) {
  _dispararEtiquetaSiProcede_(peticionId);
  return _json_({ ok: true });
}

/** Cola individual (Pieza 6): jefe de equipo mueve una petición ligera a una
 *  cola aparte, sin asignar a una persona concreta. Solo pedido_cliente y
 *  cesión — refill ya lo prepara un único operario por naturaleza. */
function marcarColaIndividual(peticionId, valor) {
  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&select=tipo');
  if (!cab.length) throw new Error('Petición no encontrada.');
  if (cab[0].tipo === 'refill') throw new Error('Refill no admite cola individual.');
  supaUpdate_('peticiones', 'id=eq.' + encodeURIComponent(peticionId), { cola_individual: !!valor });
  return _json_({ ok: true });
}
