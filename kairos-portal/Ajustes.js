/** Ajustes globales (028_ajustes_refill.sql): fila única en
 *  preparacion.ajustes. Por ahora solo Refill, pensado para que el perfil
 *  Master lo apague/encienda desde el portal sin tocar código ni Propiedades
 *  de Script (que no se sincronizarían entre kairos-portal/kairos-operario,
 *  proyectos de Apps Script separados). */

function _refillHabilitado_() {
  try {
    const filas = supaSelect_('ajustes', 'id=eq.1&select=refill_habilitado');
    return !filas.length || filas[0].refill_habilitado !== false;
  } catch (err) {
    // Si falla la lectura del ajuste, Refill sigue disponible — un apagón
    // de red no debe bloquear una operación normal por un interruptor.
    console.error('_refillHabilitado_: ' + err.message);
    return true;
  }
}

function refillHabilitado() {
  return _json_({ habilitado: _refillHabilitado_() });
}

function establecerRefillHabilitado(ldap, habilitado) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'master') throw new Error('Solo el perfil Master puede cambiar esto.');
  supaUpdate_('ajustes', 'id=eq.1', {
    refill_habilitado: !!habilitado,
    refill_cambiado_por: ldap,
    refill_cambiado_en: new Date().toISOString(),
  });
  return _json_({ ok: true });
}
