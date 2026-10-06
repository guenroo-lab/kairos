/** Jefes de turno: quién llevaba cada turno (mañana / tarde) cada día.
 *
 *  La fuente es el cuadrante («Cuadrante 2.0», hoja «Turnos»): de los jefes de
 *  esta operativa, el que tiene M ese día es el de mañana, el que tiene T el de
 *  tarde, y quien tiene P hace otras funciones (no cuenta). Es la misma hoja que
 *  lee Centinela. Se lee con el permiso de Drive que ya tiene la app (sin
 *  permisos nuevos) y solo las filas de estos jefes.
 *
 *  Si el cuadrante cambia a última hora o el jefe real fue otro, se corrige a
 *  mano desde el panel: lo anotado a mano manda sobre el cuadrante. Esas
 *  correcciones se guardan en las propiedades del script (un valor por mes, unos
 *  2 KB), sin tocar Supabase. Formato de cada mes:
 *    { 'yyyy-MM-dd': [jefe de mañana, jefe de tarde] }   ('' = lo que diga el cuadrante)
 *  más un historial corto de cambios (cuándo y qué; el modo jefe no identifica
 *  a la persona).
 *
 *  Si el cuadrante no se puede leer (permiso, caída) se usa la última copia que
 *  se guardó; sin copia, solo valen las anotaciones a mano. */

// Mismos nombres que usa Centinela (JEFES_EQUIPO). Sebastián Gelvis lleva otra operativa.
const TURNOS_JEFES_ = ['Daniel Arrastio', 'Dani Simo', 'Francisco Parada'];
// Nombres que se anotaron antes de alinearlos con Centinela.
const TURNOS_ALIAS_ = { 'Fran Paradas': 'Francisco Parada', 'Daniel Simó': 'Dani Simo' };
// Hora de Madrid a partir de la cual el trabajo cuenta para el turno de tarde.
const TURNOS_CORTE_HORA_ = 14;
const TURNOS_DIAS_ATRAS_ = 60;
const TURNOS_PREFIJO_ = 'turnos_jefe_';
const TURNOS_HISTORIAL_ = 'turnos_jefe_historial';
const TURNOS_HISTORIAL_MAX_ = 60;

const CUADRANTE_ID_ = '15h2N9yeolUe1hH3dzMTzKlVbIXPNGmKfcUI9Jk5VXdU';
const CUADRANTE_CACHE_DATOS_ = 'turnos_cuadrante_datos';
const CUADRANTE_CACHE_IDS_ = 'turnos_cuadrante_ids';
const CUADRANTE_COPIA_ = 'turnos_cuadrante_copia';
const CUADRANTE_CACHE_DATOS_S_ = 600;
const CUADRANTE_CACHE_IDS_S_ = 21600;
const CUADRANTE_COPIA_MAX_ = 8500;      // las propiedades de script admiten ~9 KB por valor

function _turnosNombre_(n) {
  n = String(n || '');
  if (TURNOS_ALIAS_[n]) n = TURNOS_ALIAS_[n];
  return TURNOS_JEFES_.indexOf(n) === -1 ? '' : n;
}

// ——— Anotaciones a mano ———
function _turnosLeerMes_(mes) {
  try {
    const crudo = PropertiesService.getScriptProperties().getProperty(TURNOS_PREFIJO_ + mes);
    const o = crudo ? JSON.parse(crudo) : {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

/** Anotaciones a mano de los días desde..hasta ('yyyy-MM-dd'): { dia: [mañana, tarde] }. */
function _turnosLeer_(desde, hasta) {
  const meses = {};
  for (let d = desde; d <= hasta; d = _sumarDias_(d, 1)) meses[d.slice(0, 7)] = true;
  const salida = {};
  Object.keys(meses).forEach(function (mes) {
    const o = _turnosLeerMes_(mes);
    Object.keys(o).forEach(function (dia) {
      const v = o[dia];
      if (dia < desde || dia > hasta || !Array.isArray(v)) return;
      const par = [_turnosNombre_(v[0]), _turnosNombre_(v[1])];
      if (par[0] || par[1]) salida[dia] = par;
    });
  });
  return salida;
}

// ——— Cuadrante ———
/** Consulta a una hoja del cuadrante (gviz, CSV, sin cabecera) con el permiso de Drive de la app. */
function _cuadranteCsv_(hoja, consulta) {
  const url = 'https://docs.google.com/spreadsheets/d/' + CUADRANTE_ID_ + '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(hoja) + '&tq=' + encodeURIComponent(consulta);
  const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const codigo = r.getResponseCode();
  if (codigo !== 200) throw new Error('El cuadrante respondió ' + codigo + ' (hoja ' + hoja + ').');
  const texto = r.getContentText();
  if (/^\s*</.test(texto)) throw new Error('El cuadrante no devolvió datos (¿sin permiso?).');
  return Utilities.parseCsv(texto);
}

function _cuadranteSinTildes_(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/** El nombre del cuadrante («DANIEL SIMO BELMONTE») corresponde al jefe («Dani Simo») si contiene el comienzo (4 letras) de cada palabra. */
function _cuadranteNombreCoincide_(jefe, nombreCuadrante) {
  const texto = _cuadranteSinTildes_(nombreCuadrante);
  return _cuadranteSinTildes_(jefe).split(' ').filter(Boolean).every(function (p) { return texto.indexOf(p.slice(0, Math.min(4, p.length))) > -1; });
}

/** { 'M5': 'Dani Simo', ... }: el id de cada jefe en la hoja «Personal» del cuadrante, buscado por nombre. */
function _cuadranteIds_() {
  const cache = CacheService.getScriptCache();
  try { const c = cache.get(CUADRANTE_CACHE_IDS_); if (c) return JSON.parse(c); } catch (e) {}
  const filas = _cuadranteCsv_('Personal', "select A,B where lower(B) contains 'arrastio' or lower(B) contains 'simo' or lower(B) contains 'parada'");
  const ids = {};
  TURNOS_JEFES_.forEach(function (jefe) {
    // Los jefes de equipo están en el grupo Mandos (ids M1, M2…): se prefiere ese id si hubiera un homónimo.
    const candidatas = filas.filter(function (f) { return f[0] && /^[A-Za-z]+\d+$/.test(String(f[0]).trim()) && _cuadranteNombreCoincide_(jefe, f[1]); });
    const f = candidatas.filter(function (c) { return /^M/i.test(String(c[0]).trim()); })[0] || candidatas[0];
    if (f) ids[String(f[0]).trim()] = jefe;
  });
  if (!Object.keys(ids).length) throw new Error('No encuentro a los jefes en la hoja Personal del cuadrante.');
  try { cache.put(CUADRANTE_CACHE_IDS_, JSON.stringify(ids), CUADRANTE_CACHE_IDS_S_); } catch (e) {}
  return ids;
}

function _cuadranteCodigo_(v) {
  const t = String(v == null ? '' : v).trim();
  return t ? t.split(/\s+/)[0].toUpperCase() : '';
}

function _cuadranteLeerCopia_() {
  try {
    const c = JSON.parse(PropertiesService.getScriptProperties().getProperty(CUADRANTE_COPIA_) || 'null');
    return (c && c.dias && typeof c.dias === 'object') ? c : null;
  } catch (e) { return null; }
}

function _cuadranteGuardarCopia_(res) {
  try {
    const hoy = _madridDeUtc_(Date.now()).dia;
    let desde = _sumarDias_(hoy, -TURNOS_DIAS_ATRAS_ - 30);
    const props = PropertiesService.getScriptProperties();
    let texto = '';
    for (;;) {
      const dias = {};
      Object.keys(res.dias).forEach(function (d) { if (d >= desde && d <= _sumarDias_(hoy, 45)) dias[d] = res.dias[d]; });
      texto = JSON.stringify({ actualizado: res.actualizado, dias: dias });
      if (texto.length <= CUADRANTE_COPIA_MAX_ || desde >= hoy) break;
      desde = _sumarDias_(desde, 15);   // no cabe: se recorta lo más antiguo
    }
    if (texto.length > CUADRANTE_COPIA_MAX_) return;
    const previo = props.getProperty(CUADRANTE_COPIA_);
    const igual = previo && JSON.stringify((JSON.parse(previo) || {}).dias) === JSON.stringify(JSON.parse(texto).dias);
    if (!igual) props.setProperty(CUADRANTE_COPIA_, texto);
  } catch (e) { Logger.log('No se pudo guardar la copia del cuadrante: ' + e.message); }
}

/** Turnos del cuadrante de los jefes de esta operativa:
 *  { ok, origen: 'directo'|'copia'|'ninguno', actualizado, dias: { 'yyyy-MM-dd': [[jefes con M], [jefes con T]] } }.
 *  No lanza: si no se puede leer devuelve la última copia o ok:false. */
function _turnosCuadrante_() {
  const cache = CacheService.getScriptCache();
  try { const c = cache.get(CUADRANTE_CACHE_DATOS_); if (c) return JSON.parse(c); } catch (e) {}
  try {
    const ids = _cuadranteIds_();
    const consulta = 'select A,B where ' + Object.keys(ids).map(function (id) { return "A starts with '" + id + "_'"; }).join(' or ');
    const filas = _cuadranteCsv_('Turnos', consulta);
    const dias = {};
    filas.forEach(function (f) {
      const m = /^([A-Za-z]+\d+)_(\d{4}-\d{2}-\d{2})$/.exec(String(f[0] || '').trim());
      if (!m || !ids[m[1]]) return;
      const codigo = _cuadranteCodigo_(f[1]);
      if (codigo !== 'M' && codigo !== 'T') return;
      const d = dias[m[2]] || (dias[m[2]] = [[], []]);
      d[codigo === 'M' ? 0 : 1].push(ids[m[1]]);
    });
    // Un cuadrante real siempre tiene turnos M/T de estos jefes: si no sale ninguno, algo falla (hoja vacía, error devuelto como texto…).
    if (!Object.keys(dias).length) throw new Error('El cuadrante no devolvió ningún turno M o T de estos jefes.');
    const res = { ok: true, origen: 'directo', actualizado: new Date().toISOString(), dias: dias };
    try { cache.put(CUADRANTE_CACHE_DATOS_, JSON.stringify(res), CUADRANTE_CACHE_DATOS_S_); } catch (e) {}
    _cuadranteGuardarCopia_(res);
    return res;
  } catch (e) {
    Logger.log('⚠️ No se pudo leer el cuadrante: ' + e.message);
    const copia = _cuadranteLeerCopia_();
    if (copia) return { ok: true, origen: 'copia', actualizado: copia.actualizado || '', dias: copia.dias, error: e.message };
    return { ok: false, origen: 'ninguno', actualizado: '', dias: {}, error: e.message };
  }
}

/** Jefe de cada turno de un día según el cuadrante: ['mañana', 'tarde'] ('' si nadie o si hay dos con el mismo código). */
function _turnosAutoDelDia_(cuad, dia) {
  const v = cuad.dias[dia];
  if (!v) return ['', ''];
  return [v[0].length === 1 ? v[0][0] : '', v[1].length === 1 ? v[1][0] : ''];
}

/** Los turnos de los días desde..hasta: lo del cuadrante (JA), lo anotado a mano (JM) y lo que vale (J = mano si lo hay, si no cuadrante). */
function _turnosResolver_(desde, hasta) {
  const cuad = _turnosCuadrante_();
  const JM = _turnosLeer_(desde, hasta);
  const J = {}, JA = {}, conflictos = {};
  for (let d = desde; d <= hasta; d = _sumarDias_(d, 1)) {
    const a = _turnosAutoDelDia_(cuad, d);
    const man = JM[d] || ['', ''];
    if (a[0] || a[1]) JA[d] = a;
    const v = [man[0] || a[0], man[1] || a[1]];
    if (v[0] || v[1]) J[d] = v;
    const raw = cuad.dias[d];
    if (raw) {
      const dup = [];
      if (raw[0].length > 1) dup.push('m');
      if (raw[1].length > 1) dup.push('t');
      if (dup.length) conflictos[d] = dup;
    }
  }
  return { J: J, JA: JA, JM: JM, cuad: { ok: cuad.ok, origen: cuad.origen, actualizado: cuad.actualizado, error: cuad.error || '', conflictos: conflictos } };
}

/** Corrige a mano el jefe de un turno ('m' mañana, 't' tarde). Con jefe vacío (o igual al del cuadrante) vuelve a valer el cuadrante. */
function asignarJefeTurno(dia, turno, jefe) {
  dia = String(dia || ''); turno = String(turno || ''); jefe = String(jefe || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('Día no válido.');
  if (turno !== 'm' && turno !== 't') throw new Error('Turno no válido.');
  if (jefe && TURNOS_JEFES_.indexOf(jefe) === -1) throw new Error('Ese nombre no está en la lista de jefes de turno.');
  const hoy = _madridDeUtc_(Date.now()).dia;
  if (dia > hoy) throw new Error('Ese día aún no ha llegado.');
  if (dia < _sumarDias_(hoy, -TURNOS_DIAS_ATRAS_)) throw new Error('Solo se pueden cambiar los últimos ' + TURNOS_DIAS_ATRAS_ + ' días.');

  const i = turno === 'm' ? 0 : 1;
  // Se lee el cuadrante ANTES de bloquear: es una llamada de red y no debe tener parado al resto.
  const auto = _turnosAutoDelDia_(_turnosCuadrante_(), dia);
  const guardar = (jefe && jefe === auto[i]) ? '' : jefe;

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('Otra persona está guardando a la vez. Vuelve a intentarlo.'); }
  try {
    const props = PropertiesService.getScriptProperties();
    const mes = dia.slice(0, 7);
    const o = _turnosLeerMes_(mes);
    const actual = Array.isArray(o[dia]) ? [String(o[dia][0] || ''), String(o[dia][1] || '')] : ['', ''];
    const antes = actual[i];
    if (antes !== guardar) {
      actual[i] = guardar;
      if (!actual[0] && !actual[1]) delete o[dia]; else o[dia] = actual;
      props.setProperty(TURNOS_PREFIJO_ + mes, JSON.stringify(o));
      let h = [];
      try { h = JSON.parse(props.getProperty(TURNOS_HISTORIAL_) || '[]'); if (!Array.isArray(h)) h = []; } catch (e) { h = []; }
      h.push([new Date().toISOString(), dia, turno, guardar, antes]);
      props.setProperty(TURNOS_HISTORIAL_, JSON.stringify(h.slice(-TURNOS_HISTORIAL_MAX_)));
    }
    const manual = [_turnosNombre_(actual[0]), _turnosNombre_(actual[1])];
    return _json_({ dia: dia, v: [manual[0] || auto[0], manual[1] || auto[1]], m: manual, a: auto });
  } finally {
    lock.releaseLock();
  }
}

/** Últimos cambios a mano, el más reciente primero. */
function obtenerHistorialTurnos() {
  let h = [];
  try { h = JSON.parse(PropertiesService.getScriptProperties().getProperty(TURNOS_HISTORIAL_) || '[]'); } catch (e) { h = []; }
  if (!Array.isArray(h)) h = [];
  return _json_(h.slice(-20).reverse().map(function (x) { return { cuando: x[0], dia: x[1], turno: x[2], jefe: _turnosNombre_(x[3]), antes: _turnosNombre_(x[4]) }; }));
}
