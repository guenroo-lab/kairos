/** Incidencias de preparación vistas por la tienda (ver
 *  kairos-operario/Incidencias.js): faltantes totales (Sin Palet / Sin
 *  Mercancía / Otras Incidencias) o parciales (Parcial) de las líneas de SUS
 *  peticiones, con el estado que les da el jefe de equipo (abierta → en
 *  gestión → resuelta) y su mensaje. La tienda (gestor/master) puede anular
 *  un pedido en el que no se ha podido preparar nada. */

const ESTADOS_INCIDENCIA_PORTAL_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias', 'Parcial'];
const FALTANTES_TOTALES_PORTAL_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];

// Días que una incidencia ya resuelta sigue apareciendo en la pestaña
// (como "Resuelta"); pasado ese tiempo sale de la lista, aunque el pedido sigue
// en Trazabilidad / Histórico.
const DIAS_RESUELTAS_VISIBLES_ = 7;

function listarMisIncidencias(ldap) {
  const u = _usuarioDe_(ldap);
  const base = 'estado_negocio=in.(' + ESTADOS_INCIDENCIA_PORTAL_.map(encodeURIComponent).join(',') + ')' +
    '&select=id,peticion_id,codigo_lm,designacion,cantidad,cantidad_preparada,unidad_medida,estado_negocio,incidencia_motivo,preparada_en,incidencia_gestion_en,incidencia_revisada_en,incidencia_nota_tienda,' +
    'incidencia_tienda_gestionada_en,incidencia_tienda_gestionada_por,incidencia_tienda_gestionada_nota,' +
    'peticiones!inner(tipo,tienda_origen,estado,num_pedido,num_cesion,solicitante_ldap)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    (u.rol === 'vendedor' ? '&peticiones.tipo=eq.refill' : ''); // Vendedor solo ve Refill
  // Pendientes (ni resueltas por plataforma ni dadas por gestionadas por la
  // tienda): todas — una abierta antigua no puede quedar fuera por un límite,
  // _selectTodo_ las lee todas, página a página. Resueltas y gestionadas solo
  // de los últimos días. Sin repetidas; se ordenan abajo.
  const desde = encodeURIComponent(new Date(Date.now() - DIAS_RESUELTAS_VISIBLES_ * 24 * 60 * 60 * 1000).toISOString());
  const vistas = {};
  const filas = [];
  [
    base + '&incidencia_revisada_en=is.null&incidencia_tienda_gestionada_en=is.null',
    base + '&incidencia_revisada_en=gte.' + desde,
    base + '&incidencia_revisada_en=is.null&incidencia_tienda_gestionada_en=gte.' + desde,
  ].forEach(function (consulta) {
    _selectTodo_('lineas', consulta).forEach(function (l) {
      if (vistas[l.id]) return;
      vistas[l.id] = true;
      filas.push(l);
    });
  });

  // ¿En qué pedidos no se ha podido preparar NADA? (solo esos se pueden anular)
  const idsPeticion = [];
  filas.forEach(function (l) { if (idsPeticion.indexOf(l.peticion_id) === -1) idsPeticion.push(l.peticion_id); });
  const todoIncidencia = {};
  if (idsPeticion.length) {
    const todasLasLineas = supaSelectIn_('lineas', 'peticion_id', idsPeticion, 'select=peticion_id,estado_negocio');
    idsPeticion.forEach(function (id) {
      const propias = todasLasLineas.filter(function (x) { return x.peticion_id === id; });
      todoIncidencia[id] = propias.length > 0 && propias.every(function (x) { return FALTANTES_TOTALES_PORTAL_.indexOf(x.estado_negocio) !== -1; });
    });
  }

  filas.forEach(function (l) {
    const p = l.peticiones || {};
    l.tipo = p.tipo || null;
    l.num_pedido = p.num_pedido || null;
    l.num_cesion = p.num_cesion || null;
    l.solicitante_ldap = p.solicitante_ldap || null;
    l.pedidoAnulado = p.estado === 'anulada';
    l.puedeAnular = !!todoIncidencia[l.peticion_id] && !l.pedidoAnulado;
    delete l.peticiones;
    // resuelta = la cerró plataforma; gestionada = la dio por gestionada la tienda
    // (plataforma aún puede verificarla); en_gestion = plataforma trabajando en ella.
    l.estadoIncidencia = l.incidencia_revisada_en ? 'resuelta'
      : (l.incidencia_tienda_gestionada_en ? 'gestionada' : (l.incidencia_gestion_en ? 'en_gestion' : 'abierta'));
    l.puedeGestionar = (u.rol === 'gestor' || u.rol === 'master') && (l.estadoIncidencia === 'abierta' || l.estadoIncidencia === 'en_gestion');
  });
  filas.sort(function (a, b) { return String(b.preparada_en || '').localeCompare(String(a.preparada_en || '')); });
  return _json_(filas);
}

/** La tienda da por gestionada una incidencia (p.ej. la mercancía llegó por
 *  refill): desaparece de SUS pendientes, pero no la cierra por plataforma —
 *  plataforma sigue viéndola, con esta marca y la nota, hasta que verifique y
 *  la resuelva. Gestor y master de la tienda dueña de la línea. */
function gestionarIncidenciaTienda(ldap, lineaId, nota) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor' && u.rol !== 'master') throw new Error('Solo un gestor puede dar por gestionada una incidencia.');
  nota = String(nota || '').trim() || null;

  const linea = supaSelect_('lineas',
    'id=eq.' + encodeURIComponent(lineaId) + '&estado_negocio=in.(' + ESTADOS_INCIDENCIA_PORTAL_.map(encodeURIComponent).join(',') + ')' +
    '&select=id,incidencia_revisada_en,incidencia_tienda_gestionada_en,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(u.tienda));
  if (!linea.length) throw new Error('Incidencia no encontrada.');
  if (linea[0].incidencia_revisada_en) throw new Error('Plataforma ya la ha resuelto.');
  if (linea[0].incidencia_tienda_gestionada_en) throw new Error('Ya la diste por gestionada.');

  const filas = supaUpdate_('lineas',
    'id=eq.' + encodeURIComponent(lineaId) + '&incidencia_revisada_en=is.null&incidencia_tienda_gestionada_en=is.null',
    { incidencia_tienda_gestionada_en: new Date().toISOString(), incidencia_tienda_gestionada_por: ldap, incidencia_tienda_gestionada_nota: nota });
  if (!filas.length) throw new Error('La incidencia ya ha cambiado de estado.');
  return _json_({ ok: true });
}

/** La tienda anuló el pedido (botón normal de Anular): sus incidencias abiertas
 *  pasan a "gestionadas por la tienda" con el motivo, para que no sigan dando
 *  alerta. Mejor esfuerzo: un fallo aquí no debe deshacer la anulación. */
function _incidenciasGestionadasPorAnulacion_(ldap, peticionId, motivo) {
  try {
    supaUpdate_('lineas',
      'peticion_id=eq.' + encodeURIComponent(peticionId) +
      '&estado_negocio=in.(' + ESTADOS_INCIDENCIA_PORTAL_.map(encodeURIComponent).join(',') + ')' +
      '&incidencia_revisada_en=is.null&incidencia_tienda_gestionada_en=is.null',
      { incidencia_tienda_gestionada_en: new Date().toISOString(), incidencia_tienda_gestionada_por: ldap,
        incidencia_tienda_gestionada_nota: 'Pedido anulado por la tienda: ' + motivo });
  } catch (err) {
    console.error('_incidenciasGestionadasPorAnulacion_ (' + peticionId + '): ' + err.message);
  }
}

/** Anular un pedido en el que plataforma no ha podido preparar nada (todas
 *  sus líneas son faltante total). Si hay mercancía preparada o enviada no se
 *  puede anular desde aquí: se gestiona con plataforma. Las incidencias del
 *  pedido pasan a resueltas. Mismo permiso que anularPeticion. */
function anularPedidoPorIncidencia(ldap, peticionId, motivo) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor' && u.rol !== 'master') throw new Error('Solo un gestor puede anular peticiones.');
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Escribe el motivo de la anulación.');

  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) + '&select=id,estado');
  if (!cab.length) throw new Error('Petición no encontrada.');
  if (cab[0].estado === 'anulada') throw new Error('Esta petición ya está anulada.');

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&select=id,estado_negocio');
  const nadaPreparado = lineas.length > 0 && lineas.every(function (l) { return FALTANTES_TOTALES_PORTAL_.indexOf(l.estado_negocio) !== -1; });
  if (!nadaPreparado) {
    throw new Error('Este pedido ya tiene mercancía preparada o pendiente de preparar, no se puede anular desde aquí. Habla con plataforma.');
  }

  const filas = supaUpdate_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&estado=neq.anulada',
    { estado: 'anulada', motivo_anulacion: motivo });
  if (!filas.length) throw new Error('Esta petición ya está anulada.');

  supaUpdate_('lineas',
    'peticion_id=eq.' + encodeURIComponent(peticionId) + '&incidencia_revisada_en=is.null',
    { incidencia_revisada_en: new Date().toISOString(), incidencia_revision_nota: 'Anulado por la tienda (' + ldap + '): ' + motivo });
  return _json_({ ok: true });
}
