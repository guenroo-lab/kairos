/** Acceso de administración: una contraseña fija en Propiedades del script,
 *  sin usuario ni tabla propia (un solo admin). */

function _verificarAdmin_(passwordAdmin) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('Falta ADMIN_PASSWORD en Propiedades del script.');
  if (String(passwordAdmin || '') !== real) throw new Error('Contraseña de administrador incorrecta.');
}

function listarPendientesAprobacion(passwordAdmin) {
  _verificarAdmin_(passwordAdmin);
  const filas = supaSelect_('usuarios_tienda', 'aprobado=eq.false&select=id,ldap,tienda,creado_en&order=creado_en.asc');
  filas.forEach(function (f) { f.tiendaNombre = CFG.TIENDAS[f.tienda] || f.tienda; });
  return _json_(filas);
}

function aprobarUsuario(passwordAdmin, id) {
  _verificarAdmin_(passwordAdmin);
  supaUpdate_('usuarios_tienda', 'id=eq.' + encodeURIComponent(id), {
    aprobado: true,
    aprobado_en: new Date().toISOString(),
  });
  return _json_({ ok: true });
}

function rechazarUsuario(passwordAdmin, id) {
  _verificarAdmin_(passwordAdmin);
  supaDelete_('usuarios_tienda', 'id=eq.' + encodeURIComponent(id));
  return _json_({ ok: true });
}
