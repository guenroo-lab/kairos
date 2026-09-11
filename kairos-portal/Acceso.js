/** Login sin contraseña: solo número de empleado (LDAP). El servidor decide
 *  quién eres y a qué tienda perteneces — el cliente nunca manda la tienda. */

function entrar(ldap) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');

  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=id,ldap,tienda,aprobado');
  if (!filas.length) return _json_({ estado: 'no_existe', ldap: ldap });

  const u = filas[0];
  if (!u.aprobado) return _json_({ estado: 'pendiente', ldap: ldap });

  return _json_({
    estado: 'ok',
    ldap: ldap,
    tienda: u.tienda,
    tiendaNombre: CFG.TIENDAS[u.tienda] || u.tienda,
  });
}

function registrarUsuario(ldap, tienda) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');
  if (!CFG.TIENDAS[tienda]) throw new Error('Tienda no válida.');

  const existentes = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap));
  if (existentes.length) throw new Error('Ese número de empleado ya está registrado.');

  supaInsert_('usuarios_tienda', { ldap: ldap, tienda: tienda, aprobado: false });
  return _json_({ ok: true });
}

/** Resuelve la tienda de un LDAP aprobado, o lanza si no está autorizado.
 *  La usan Catalogo.js y Peticiones.js para no confiar nunca en una tienda
 *  que mande el cliente. */
function _tiendaDe_(ldap) {
  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=tienda,aprobado');
  if (!filas.length || !filas[0].aprobado) throw new Error('Usuario no autorizado.');
  return filas[0].tienda;
}
