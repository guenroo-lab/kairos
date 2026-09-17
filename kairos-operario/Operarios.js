function listarOperarios() {
  const filas = supaSelect_('operarios', 'activo=eq.true&select=nombre,color,rol&order=nombre.asc');
  return _json_(filas);
}

/** ============ Gestión de operarios (jefe de equipo) ============ */

function listarOperariosGestion() {
  const filas = supaSelect_('operarios', 'select=nombre,color,rol,activo&order=activo.desc,nombre.asc');
  return _json_(filas);
}

function crearOperario(nombre, rol) {
  nombre = String(nombre || '').trim();
  rol = (rol === 'jefe_equipo') ? 'jefe_equipo' : 'operario';
  if (!nombre) throw new Error('Falta el nombre.');
  supaInsert_('operarios', { nombre: nombre, activo: true, rol: rol });
  return _json_({ ok: true });
}

function cambiarActivoOperario(nombre, activo) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre.');
  supaUpdate_('operarios', 'nombre=eq.' + encodeURIComponent(nombre), { activo: !!activo });
  return _json_({ ok: true });
}
