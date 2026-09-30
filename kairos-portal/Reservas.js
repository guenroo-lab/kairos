/** Reserva de refill para fecha de entrega (ver docs/superpowers/specs/
 *  2026-09-30-reserva-refill-design.md). visible_desde = último día
 *  laborable (L-V) estrictamente anterior a fecha_entrega; los festivos no
 *  se detectan. */

function _hoyMadridIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}

function _ultimoLaborableAnterior_(fechaIso) {
  const p = String(fechaIso).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Devuelve la fecha normalizada "YYYY-MM-DD" o lanza si no es válida o no
 *  es posterior a hoy. */
function _validarFechaEntrega_(fechaIso, hoyIso) {
  const f = String(fechaIso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Fecha de entrega no válida.');
  const p = f.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.toISOString().slice(0, 10) !== f) throw new Error('Fecha de entrega no válida.');
  if (f <= hoyIso) throw new Error('La fecha de entrega debe ser posterior a hoy. Para hoy usa un refill normal.');
  return f;
}

/** Marca en la fila si es una reserva que aún no sale a preparación. */
function _marcarReserva_(p, hoyIso) {
  p.reservaFutura = !!(p.fecha_entrega && p.visible_desde > hoyIso);
  if (p.reservaFutura) p.estadoTexto = 'Reservada';
}

/** Cambiar la fecha de entrega de una reserva que aún no es visible para
 *  operarios. Mismo permiso que anularPeticion (gestor/master). */
function cambiarFechaEntrega(ldap, peticionId, nuevaFecha) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor' && u.rol !== 'master') throw new Error('Solo un gestor puede cambiar la fecha de entrega.');
  const hoy = _hoyMadridIso_();
  const fecha = _validarFechaEntrega_(nuevaFecha, hoy);
  const visibleDesde = _ultimoLaborableAnterior_(fecha);

  const cab = supaSelect_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&select=id,tipo,estado,fecha_entrega,visible_desde');
  if (!cab.length) throw new Error('Petición no encontrada.');
  const p = cab[0];
  if (p.tipo !== 'refill' || !p.fecha_entrega) throw new Error('Esta petición no es una reserva.');
  if (p.estado !== 'pendiente' || p.visible_desde <= hoy) throw new Error('Ya está en preparación, no se puede cambiar la fecha.');

  // Mismo filtro en el UPDATE: si la reserva pasa a visible o se anula entre
  // el SELECT y el UPDATE, no se pisa.
  const filas = supaUpdate_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&estado=eq.pendiente&visible_desde=gt.' + encodeURIComponent(hoy),
    { fecha_entrega: fecha, visible_desde: visibleDesde });
  if (!filas.length) throw new Error('Ya está en preparación, no se puede cambiar la fecha.');
  return _json_({ ok: true, fechaEntrega: fecha, visibleDesde: visibleDesde });
}
