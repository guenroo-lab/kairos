/** Panel jefe de equipo: todas las peticiones, etiquetas HODOS ya creadas
 *  por Kairos, y reintento del envío para las que fallaron. */

function listarTodasPeticiones() {
  const peticiones = supaSelect_('peticiones',
    'select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,estado,cola_individual,creada_en,en_curso_por,en_curso_desde&order=creada_en.desc&limit=300');
  if (!peticiones.length) return _json_([]);

  const ids = peticiones.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,estado_preparacion,hodos_id');

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.necesitaHodos = (p.tipo === 'cesion') || (p.tipo === 'pedido_cliente' && !p.transporte);
    p.tieneHodos = propias.some(function (l) { return l.hodos_id; });
  });
  return _json_(peticiones);
}

function listarEtiquetasHodos() {
  const lineas = supaSelect_('lineas', 'hodos_id=not.is.null&select=hodos_id&order=hodos_id.desc&limit=500');
  const ids = [];
  lineas.forEach(function (l) { if (ids.indexOf(l.hodos_id) === -1) ids.push(l.hodos_id); });
  if (!ids.length) return _json_([]);
  const etiquetas = supaSelect_('etiquetas',
    'id_unico=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id_unico,destino,numero_pedido,estado,fecha_creacion&order=fecha_creacion.desc',
    'public');
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
