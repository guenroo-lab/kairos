/** Incidencias pendientes de revisión (jefe de equipo): líneas cerradas con
 *  faltante total (Sin Palet / Sin Mercancía / Otras Incidencias) o parcial
 *  (Parcial) — para verificar cantidades y rectificar en MyISO si hace
 *  falta. Al revisarla queda marcada, no se borra: sigue en Histórico. */

const ESTADOS_INCIDENCIA_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias', 'Parcial'];

function listarIncidenciasPendientes() {
  const lineas = supaSelect_('lineas',
    'estado_negocio=in.(' + ESTADOS_INCIDENCIA_.map(encodeURIComponent).join(',') + ')' +
    '&incidencia_revisada_en=is.null' +
    '&select=id,peticion_id,codigo_lm,designacion,cantidad,cantidad_preparada,unidad_medida,estado_negocio,incidencia_motivo,operario,sscc,ubicacion,preparada_en' +
    '&order=preparada_en.desc&limit=300');
  if (!lineas.length) return _json_([]);

  const ids = [];
  lineas.forEach(function (l) { if (ids.indexOf(l.peticion_id) === -1) ids.push(l.peticion_id); });
  const peticiones = supaSelect_('peticiones', 'id=in.(' + ids.join(',') + ')&select=id,tipo,tienda_origen,num_pedido,num_cesion');
  const porPeticion = {};
  peticiones.forEach(function (p) { porPeticion[p.id] = p; });

  lineas.forEach(function (l) {
    const p = porPeticion[l.peticion_id] || {};
    l.tipo = p.tipo || null;
    l.tienda_origen = p.tienda_origen || null;
    l.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    l.num_pedido = p.num_pedido || null;
    l.num_cesion = p.num_cesion || null;
  });
  return _json_(lineas);
}

function marcarIncidenciaRevisada(lineaId, nota) {
  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    incidencia_revisada_en: new Date().toISOString(),
    incidencia_revision_nota: String(nota || '').trim() || null,
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
