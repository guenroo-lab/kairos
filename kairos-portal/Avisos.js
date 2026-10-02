/** Marcadores (números) de las pestañas del portal: de un vistazo se ve dónde
 *  hay algo pendiente. UNA llamada devuelve todos. Cada número = lo que la
 *  pestaña lista por defecto, para la tienda activa y el rol del usuario:
 *   - peticiones: por preparar o en preparación (incluye reservas futuras,
 *     que la tienda sí ve). Informativo.
 *   - incidencias: líneas con incidencia que ni plataforma ha resuelto ni la
 *     tienda ha dado por gestionada (= "Pendientes" de la pestaña). Alerta.
 *   - revisiones: revisiones de palet pendientes o en revisión. No aplica al
 *     vendedor (no puede pedirlas).
 *   - usuarios: altas pendientes de aprobar (gestor y master).
 *  Una sección que falla viene como null: la pantalla conserva el valor
 *  anterior en vez de enseñar un 0 falso. */

const AVISOS_PORTAL_TOPE_ = 1000; // la API corta aquí: más de esto se enseña como "999+"

function _contarPortal_(tabla, consulta) {
  return supaSelect_(tabla, consulta + '&limit=' + AVISOS_PORTAL_TOPE_).length;
}

function _seccionPortal_(fn) {
  try { return fn(); } catch (err) {
    console.error('contarAvisosPortal: ' + err.message);
    return null;
  }
}

function contarAvisosPortal(ldap) {
  const u = _usuarioDe_(ldap);
  const tienda = encodeURIComponent(u.tienda);
  const vendedor = u.rol === 'vendedor'; // Vendedor solo ve Refill
  const resultado = {};

  resultado.peticiones = _seccionPortal_(function () {
    return _contarPortal_('peticiones',
      'tienda_origen=eq.' + tienda + '&estado=in.(pendiente,en_preparacion)' + (vendedor ? '&tipo=eq.refill' : '') + '&select=id');
  });

  resultado.incidencias = _seccionPortal_(function () {
    return _contarPortal_('lineas',
      'estado_negocio=in.(' + ESTADOS_INCIDENCIA_PORTAL_.map(encodeURIComponent).join(',') + ')' +
      '&incidencia_revisada_en=is.null&incidencia_tienda_gestionada_en=is.null' +
      '&select=id,peticiones!inner(tienda_origen)&peticiones.tienda_origen=eq.' + tienda +
      (vendedor ? '&peticiones.tipo=eq.refill' : ''));
  });

  resultado.revisiones = vendedor ? 0 : _seccionPortal_(function () {
    return _contarPortal_('revisiones_palet', 'tienda_origen=eq.' + tienda + '&estado=in.(pendiente,en_revision)&select=id');
  });

  resultado.usuarios = (u.rol === 'gestor' || u.rol === 'master') ? _seccionPortal_(function () {
    return _contarPortal_('usuarios_tienda', 'tienda=eq.' + tienda + '&rol=neq.master&aprobado=eq.false&select=id');
  }) : 0;

  return _json_(resultado);
}
