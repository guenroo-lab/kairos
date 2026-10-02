/** Contadores (marcadores) de las pestañas del modo jefe: de un vistazo se ve
 *  dónde hay algo que revisar. UNA sola llamada devuelve todos (la pantalla
 *  la repite cada minuto). Cada número = lo que la propia pestaña lista por
 *  defecto; si cambia el criterio de una pestaña, cambiarlo aquí también.
 *   - panel (Control de pedidos): por preparar + pendientes de ubicar +
 *     cerradas sin etiqueta HODOS (las mismas que muestra el panel). Alerta si
 *     hay de las dos últimas.
 *   - incidencias: líneas con incidencia sin resolver por plataforma (incluye
 *     las que la tienda ya dio por gestionada). Siempre alerta.
 *   - revisiones: revisiones de palet abiertas + diferencias sin gestionar.
 *     Alerta si hay diferencias.
 *   - hodos: etiquetas "Petición Reserva" pendientes de imprimir (no anuladas).
 *   - sie: palets por ubicar en RC2 (CSV del robot; cacheado 2 min).
 *  Una sección que falla viene como null: la pantalla conserva el valor
 *  anterior en vez de enseñar un 0 falso. */

const AVISOS_TOPE_FILAS_ = 1000; // la API corta aquí: más de esto se enseña como "1000+"

function _contarFilas_(tabla, consulta, schema) {
  return supaSelect_(tabla, consulta + '&limit=' + AVISOS_TOPE_FILAS_, schema).length;
}

function _seccionAviso_(fn) {
  try { return fn(); } catch (err) {
    console.error('contarAvisosJefe: ' + err.message);
    return null;
  }
}

/** Cerradas recientes que necesitan etiqueta HODOS y aún no la tienen (misma
 *  regla y mismo plazo de 3 días que listarTodasPeticiones). */
function _contarCerradasSinEtiqueta_(hoy) {
  const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  // _selectTodo_ (paginado): con un tope de 1000 filas antes de filtrar, unas
  // cerradas de refill podían ocultar la cesión que sí necesita etiqueta.
  const cerradas = _selectTodo_('peticiones',
    'estado=eq.cerrada&cerrada_en=gte.' + encodeURIComponent(desde) + '&visible_desde=lte.' + hoy +
    '&tienda_origen=in.(014,279)&tipo=in.(cesion,pedido_cliente)&select=id,tipo,transporte')
    .filter(function (p) { return p.tipo === 'cesion' || (p.tipo === 'pedido_cliente' && !p.transporte); });
  if (!cerradas.length) return 0;
  const lineas = supaSelectIn_('lineas', 'peticion_id', cerradas.map(function (p) { return p.id; }),
    'select=peticion_id,hodos_id,estado_negocio');
  return cerradas.filter(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    return _necesitaHodos_(p, propias) && !propias.some(function (l) { return l.hodos_id; });
  }).length;
}

function _contarSiePorUbicarConCache_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('kairos_sie_n_v1');
  if (guardado !== null) return Number(guardado);
  const n = JSON.parse(listarSieporUbicar()).length;
  cache.put('kairos_sie_n_v1', String(n), 120);
  return n;
}

/** `forzar` = true tras una acción del jefe (el número debe bajar ya): se salta
 *  la caché de 45 s. El resto de refrescos —de todas las pantallas abiertas—
 *  comparten el mismo cálculo, así que el coste en peticiones a Supabase no
 *  crece con el número de pantallas. */
function contarAvisosJefe(forzar) {
  const cache = CacheService.getScriptCache();
  if (forzar !== true) {
    const guardado = cache.get('kairos_avisos_jefe_v1');
    if (guardado !== null) return guardado;
  }
  const resultado = _calcularAvisosJefe_();
  const json = _json_(resultado);
  // Solo se cachea si todas las secciones han ido bien (una caída puntual no
  // debe quedarse 45 s en caché).
  if (Object.keys(resultado).every(function (k) { return resultado[k] !== null; })) {
    try { cache.put('kairos_avisos_jefe_v1', json, 45); } catch (err) { /* la caché es una mejora, no debe romper */ }
  }
  return json;
}

function _calcularAvisosJefe_() {
  const hoy = _hoyMadridIso_();
  const tiendas = '&tienda_origen=in.(014,279)';
  const resultado = {};

  resultado.panel = _seccionAviso_(function () {
    const porPreparar = _contarFilas_('peticiones', 'estado=in.(pendiente,en_preparacion)&visible_desde=lte.' + hoy + tiendas + '&select=id');
    const porUbicar = _contarFilas_('peticiones', 'estado=eq.a_ubicar&ubicacion_consolidacion=is.null&visible_desde=lte.' + hoy + tiendas + '&select=id');
    const sinEtiqueta = _contarCerradasSinEtiqueta_(hoy);
    return { n: porPreparar + porUbicar + sinEtiqueta, alerta: (porUbicar + sinEtiqueta) > 0 };
  });

  resultado.incidencias = _seccionAviso_(function () {
    const n = _contarFilas_('lineas',
      'estado_negocio=in.(' + ESTADOS_INCIDENCIA_.map(encodeURIComponent).join(',') + ')&incidencia_revisada_en=is.null&select=id');
    return { n: n, alerta: n > 0 };
  });

  resultado.revisiones = _seccionAviso_(function () {
    const abiertas = _contarFilas_('revisiones_palet', 'estado=in.(pendiente,en_revision)&select=id');
    const diferencias = _contarFilas_('revisiones_palet', 'estado=eq.revisada&conforme=eq.false&gestionada_en=is.null&select=id');
    return { n: abiertas + diferencias, alerta: diferencias > 0 };
  });

  resultado.hodos = _seccionAviso_(function () {
    const n = _contarFilas_('etiquetas',
      'subtipo=eq.' + encodeURIComponent(SUBTIPO_HODOS_PREPARACION_) + '&pendiente_impresion_incpc=eq.true&estado=neq.ANULADA&select=id_unico',
      'public');
    return { n: n, alerta: false };
  });

  resultado.sie = _seccionAviso_(function () {
    return { n: _contarSiePorUbicarConCache_(), alerta: false };
  });

  return resultado;
}
