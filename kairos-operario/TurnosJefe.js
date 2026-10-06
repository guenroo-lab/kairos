/** Jefes de turno: quién llevaba cada turno (mañana / tarde) cada día.
 *
 *  Nada en el sistema dice quién es el jefe de turno (el modo jefe no tiene
 *  usuario), así que se anota a mano desde el panel de Productividad y con eso
 *  se reparte el trabajo de cada turno entre los jefes.
 *
 *  Se guarda en las propiedades del script (un valor por mes, unos 2 KB), sin
 *  tocar Supabase: no gasta cupo de datos ni exige migración. Formato de cada mes:
 *    { 'yyyy-MM-dd': [jefe de mañana, jefe de tarde] }   ('' = sin asignar)
 *  y un historial corto de cambios (cuándo se hizo y qué cambió; el modo jefe no
 *  identifica a la persona). */

const TURNOS_JEFES_ = ['Daniel Arrastio', 'Fran Paradas', 'Daniel Simó'];
// Hora de Madrid a partir de la cual el trabajo cuenta para el turno de tarde.
const TURNOS_CORTE_HORA_ = 14;
const TURNOS_DIAS_ATRAS_ = 60;
const TURNOS_PREFIJO_ = 'turnos_jefe_';
const TURNOS_HISTORIAL_ = 'turnos_jefe_historial';
const TURNOS_HISTORIAL_MAX_ = 60;

function _turnosLeerMes_(mes) {
  try {
    const crudo = PropertiesService.getScriptProperties().getProperty(TURNOS_PREFIJO_ + mes);
    const o = crudo ? JSON.parse(crudo) : {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

/** Asignaciones de los días desde..hasta ('yyyy-MM-dd'): { dia: [mañana, tarde] }. */
function _turnosLeer_(desde, hasta) {
  const meses = {};
  for (let d = desde; d <= hasta; d = _sumarDias_(d, 1)) meses[d.slice(0, 7)] = true;
  const salida = {};
  Object.keys(meses).forEach(function (mes) {
    const o = _turnosLeerMes_(mes);
    Object.keys(o).forEach(function (dia) {
      const v = o[dia];
      if (dia >= desde && dia <= hasta && Array.isArray(v)) salida[dia] = [String(v[0] || ''), String(v[1] || '')];
    });
  });
  return salida;
}

/** Anota (o quita, con jefe vacío) el jefe de un turno. turno: 'm' mañana, 't' tarde. */
function asignarJefeTurno(dia, turno, jefe) {
  dia = String(dia || ''); turno = String(turno || ''); jefe = String(jefe || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('Día no válido.');
  if (turno !== 'm' && turno !== 't') throw new Error('Turno no válido.');
  if (jefe && TURNOS_JEFES_.indexOf(jefe) === -1) throw new Error('Ese nombre no está en la lista de jefes de turno.');
  const hoy = _madridDeUtc_(Date.now()).dia;
  if (dia > hoy) throw new Error('Ese día aún no ha llegado.');
  if (dia < _sumarDias_(hoy, -TURNOS_DIAS_ATRAS_)) throw new Error('Solo se pueden cambiar los últimos ' + TURNOS_DIAS_ATRAS_ + ' días.');

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('Otra persona está guardando a la vez. Vuelve a intentarlo.'); }
  try {
    const props = PropertiesService.getScriptProperties();
    const mes = dia.slice(0, 7);
    const o = _turnosLeerMes_(mes);
    const actual = Array.isArray(o[dia]) ? [String(o[dia][0] || ''), String(o[dia][1] || '')] : ['', ''];
    const i = turno === 'm' ? 0 : 1;
    const antes = actual[i];
    if (antes === jefe) return _json_({ dia: dia, v: actual });
    actual[i] = jefe;
    if (!actual[0] && !actual[1]) delete o[dia]; else o[dia] = actual;
    props.setProperty(TURNOS_PREFIJO_ + mes, JSON.stringify(o));
    let h = [];
    try { h = JSON.parse(props.getProperty(TURNOS_HISTORIAL_) || '[]'); if (!Array.isArray(h)) h = []; } catch (e) { h = []; }
    h.push([new Date().toISOString(), dia, turno, jefe, antes]);
    props.setProperty(TURNOS_HISTORIAL_, JSON.stringify(h.slice(-TURNOS_HISTORIAL_MAX_)));
    return _json_({ dia: dia, v: actual });
  } finally {
    lock.releaseLock();
  }
}

/** Últimos cambios de asignación, el más reciente primero. */
function obtenerHistorialTurnos() {
  let h = [];
  try { h = JSON.parse(PropertiesService.getScriptProperties().getProperty(TURNOS_HISTORIAL_) || '[]'); } catch (e) { h = []; }
  if (!Array.isArray(h)) h = [];
  return _json_(h.slice(-20).reverse().map(function (x) { return { cuando: x[0], dia: x[1], turno: x[2], jefe: x[3], antes: x[4] }; }));
}
