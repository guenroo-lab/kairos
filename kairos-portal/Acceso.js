/** Login sin contraseña: solo número de empleado (LDAP). El servidor decide
 *  quién eres y a qué tienda perteneces — el cliente nunca manda la tienda. */

const ROLES_VALIDOS = ['vendedor', 'logistico', 'gestor'];

function entrar(ldap) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');

  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=id,ldap,tienda,rol,aprobado');
  if (!filas.length) return _json_({ estado: 'no_existe', ldap: ldap });

  const u = filas[0];
  if (!u.aprobado) return _json_({ estado: 'pendiente', ldap: ldap });

  return _json_({
    estado: 'ok',
    ldap: ldap,
    tienda: u.tienda,
    tiendaNombre: CFG.TIENDAS[u.tienda] || u.tienda,
    rol: u.rol,
  });
}

function registrarUsuario(ldap, tienda, rol) {
  ldap = String(ldap || '').trim();
  if (!/^\d+$/.test(ldap)) throw new Error('El número de empleado debe ser numérico.');
  if (!CFG.TIENDAS[tienda]) throw new Error('Tienda no válida.');
  if (ROLES_VALIDOS.indexOf(rol) === -1) throw new Error('Rol no válido.');

  const existentes = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap));
  if (existentes.length) throw new Error('Ese número de empleado ya está registrado.');

  supaInsert_('usuarios_tienda', { ldap: ldap, tienda: tienda, rol: rol, aprobado: false });
  return _json_({ ok: true });
}

/** Resuelve tienda + rol de un LDAP aprobado, o lanza si no está autorizado.
 *  El rol se fija solo al registrarse (registrarUsuario) — no se toca al
 *  aprobar ni después. */
function _usuarioDe_(ldap) {
  const filas = supaSelect_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap) + '&select=tienda,rol,aprobado');
  if (!filas.length || !filas[0].aprobado) throw new Error('Usuario no autorizado.');
  return { tienda: filas[0].tienda, rol: filas[0].rol };
}

/** Solo la tienda — la usan Catalogo.js y el resto de Peticiones.js que
 *  todavía no distinguen por rol. Nunca confiar en una tienda que mande
 *  el cliente. */
function _tiendaDe_(ldap) {
  return _usuarioDe_(ldap).tienda;
}

/** Un gestor no pertenece a una tienda fija — puede entrar en la que
 *  quiera. Cambia su propio registro (usuarios_tienda.tienda); a partir
 *  de ahí todo lo demás (_tiendaDe_, listados, crear peticiones) ya
 *  funciona igual que si estuviera registrado en esa tienda. */
function cambiarTiendaActiva(ldap, tienda) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor') throw new Error('Solo un gestor puede cambiar de tienda.');
  if (!CFG.TIENDAS[tienda]) throw new Error('Tienda no válida.');

  supaUpdate_('usuarios_tienda', 'ldap=eq.' + encodeURIComponent(ldap), { tienda: tienda });
  return _json_({ tienda: tienda, tiendaNombre: CFG.TIENDAS[tienda] });
}
