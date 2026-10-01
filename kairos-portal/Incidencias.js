/** Incidencias de preparación vistas por la tienda (ver
 *  kairos-operario/Incidencias.js): faltantes totales (Sin Palet / Sin
 *  Mercancía / Otras Incidencias) o parciales (Parcial) de las líneas de SUS
 *  peticiones, con el estado que les da el jefe de equipo (abierta → en
 *  gestión → resuelta) y su mensaje. Solo lectura para la tienda. */

const ESTADOS_INCIDENCIA_PORTAL_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias', 'Parcial'];

function listarMisIncidencias(ldap) {
  const u = _usuarioDe_(ldap);
  var q = 'estado_negocio=in.(' + ESTADOS_INCIDENCIA_PORTAL_.map(encodeURIComponent).join(',') + ')' +
    '&select=id,peticion_id,codigo_lm,designacion,cantidad,cantidad_preparada,unidad_medida,estado_negocio,incidencia_motivo,preparada_en,incidencia_gestion_en,incidencia_revisada_en,incidencia_nota_tienda,' +
    'peticiones!inner(tipo,tienda_origen,num_pedido,num_cesion,solicitante_ldap)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&order=preparada_en.desc&limit=200';
  if (u.rol === 'vendedor') q += '&peticiones.tipo=eq.refill'; // Vendedor solo ve Refill
  const filas = supaSelect_('lineas', q);

  filas.forEach(function (l) {
    const p = l.peticiones || {};
    l.tipo = p.tipo || null;
    l.num_pedido = p.num_pedido || null;
    l.num_cesion = p.num_cesion || null;
    l.solicitante_ldap = p.solicitante_ldap || null;
    delete l.peticiones;
    l.estadoIncidencia = l.incidencia_revisada_en ? 'resuelta' : (l.incidencia_gestion_en ? 'en_gestion' : 'abierta');
  });
  return _json_(filas);
}
