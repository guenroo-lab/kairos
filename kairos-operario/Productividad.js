/** Panel de productividad del modo jefe (pestaña "Productividad"): una sola
 *  llamada, obtenerProductividad(desde, hasta), devuelve los datos YA
 *  AGREGADOS del periodo; la pantalla (Productividad.html) aplica los filtros
 *  (tienda, servicio, persona/equipo, periodo) en el navegador sin volver al
 *  servidor. Solo lectura, sin migración: sale de lineas, peticiones y
 *  revisiones_palet.
 *
 *  Formato (los textos van en diccionarios para que pese poco):
 *   d: días 'yyyy-MM-dd' · t: tiendas · s: servicios · o: equipos/personas
 *   L: líneas preparadas [dia, hora, tienda, servicio, operario, incidencia, líneas, unidades, palets]
 *      (las revisiones de palet entran aquí con servicio 'rev', 1 por revisión)
 *   P: pedidos en los que participó cada operario [dia, tienda, servicio, operario, nº pedidos]
 *   C: pedidos completados [dia, hora, tienda, servicio, nº, suma minutos de ciclo, b0..b5 por tramos de ciclo]
 *      (día y hora = los de la última línea preparada, que es cuando el equipo termina)
 *   E: pedidos entrados (creados) [dia, tienda, servicio, nº]
 *   B: lo pendiente AHORA [tienda, servicio, por preparar, en preparación, por ubicar, minutos de la más antigua, [quién trabaja]]
 *   J: jefe de cada turno por día { 'yyyy-MM-dd': [jefe de mañana, jefe de tarde] } (TurnosJefe.js)
 *   corte: hora (Madrid) a partir de la cual el turno es de tarde · jefes: lista de jefes de turno
 *  Días y horas siempre en hora de Madrid. */

const PROD_TIENDAS_ = ['014', '279'];
const PROD_MAX_DIAS_ = 100;
// Servicios (cada tipo de trabajo del almacén): se ven por separado en el panel.
const PROD_SERVICIOS_ = {
  pc_t: 'Pedido cliente · con transporte',
  pc_s: 'Pedido cliente · sin transporte',
  ces: 'Cesión',
  ref: 'Refill',
  rev: 'Revisión de stock',
};
const PROD_CODIGO_INCIDENCIA_ = { 'Sin Palet': 'sp', 'Sin Mercancía': 'sm', 'Otras Incidencias': 'oi', 'Parcial': 'pa' };
// Tramos del tiempo de ciclo (minutos): <1h, <2h, <4h, <8h, <24h, 24h o más.
const PROD_TRAMOS_CICLO_MIN_ = [60, 120, 240, 480, 1440];

// ——— Hora de Madrid sin Utilities.formatDate (miles de filas): horario de
// verano de la UE = del último domingo de marzo a las 01:00 UTC al último de
// octubre a las 01:00 UTC. ———
function _ultimoDomingoUtc_(anio, mes) { // mes 0-11 → ms UTC de las 01:00 del último domingo
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0, 1, 0, 0));
  return ultimo.getTime() - ultimo.getUTCDay() * 86400000;
}
function _offsetMadridMin_(utcMs) {
  const anio = new Date(utcMs).getUTCFullYear();
  return (utcMs >= _ultimoDomingoUtc_(anio, 2) && utcMs < _ultimoDomingoUtc_(anio, 9)) ? 120 : 60;
}
function _madridDeUtc_(utcMs) {
  const local = new Date(utcMs + _offsetMadridMin_(utcMs) * 60000);
  return { dia: local.toISOString().slice(0, 10), hora: local.getUTCHours() };
}
/** ms UTC de las 00:00 de Madrid de un día 'yyyy-MM-dd'. */
function _medianocheMadridUtc_(dia) {
  const p = String(dia).split('-');
  const nominal = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  // Se prueba con los dos desfases posibles; vale el que, aplicado, da 00:00 de ese día.
  const c120 = nominal - 120 * 60000;
  return _offsetMadridMin_(c120) === 120 ? c120 : nominal - 60 * 60000;
}
function _sumarDias_(dia, n) {
  const p = String(dia).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n)).toISOString().slice(0, 10);
}

function _servicioDe_(p) {
  if (p.tipo === 'refill') return 'ref';
  if (p.tipo === 'cesion') return 'ces';
  return p.transporte ? 'pc_t' : 'pc_s';
}

/** Equipo canónico: "Edson + Antonio.M" y "Antonio.M + Edson" son el mismo. */
function _equipoCanonico_(texto) {
  const nombres = String(texto || '').split('+').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!nombres.length) return '(sin asignar)';
  nombres.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  return nombres.join(' + ');
}

function _minutosDeCiclo_(creadaMs, visibleDesdeDia, finMs) {
  var inicio = creadaMs;
  // Una reserva se crea días antes de su entrega: el reloj empieza el día en
  // que se hace visible para preparar, no cuando se pidió.
  if (visibleDesdeDia) inicio = Math.max(inicio, _medianocheMadridUtc_(visibleDesdeDia));
  return Math.max(0, Math.round((finMs - inicio) / 60000));
}

function obtenerProductividad(desde, hasta) {
  desde = String(desde || ''); hasta = String(hasta || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new Error('Fechas no válidas.');
  if (hasta < desde) throw new Error('El periodo está al revés.');
  const nDias = Math.round((_medianocheMadridUtc_(_sumarDias_(hasta, 1)) - _medianocheMadridUtc_(desde)) / 86400000);
  if (nDias > PROD_MAX_DIAS_) throw new Error('Máximo ' + PROD_MAX_DIAS_ + ' días por consulta.');

  const t0 = new Date(_medianocheMadridUtc_(desde)).toISOString();
  const t1 = new Date(_medianocheMadridUtc_(_sumarDias_(hasta, 1))).toISOString();
  const tiendas = '=in.(' + PROD_TIENDAS_.join(',') + ')';

  const dic = { d: {}, t: {}, s: {}, o: {} };
  function idx(grupo, valor) {
    if (!(valor in dic[grupo])) dic[grupo][valor] = Object.keys(dic[grupo]).length;
    return dic[grupo][valor];
  }

  // ——— Líneas preparadas ———
  const lineas = _selectTodo_('lineas',
    'estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(t0) + '&preparada_en=lt.' + encodeURIComponent(t1) +
    '&peticiones.tienda_origen' + tiendas +
    '&select=id,peticion_id,operario,preparada_en,estado_negocio,cantidad,cantidad_preparada,unidad_medida,peticiones!inner(tipo,tienda_origen,transporte)');

  const celdasL = {}; const pedidosPorCelda = {}; const ultimaLineaDePeticion = {};
  lineas.forEach(function (l) {
    const p = l.peticiones || {};
    const ms = Date.parse(l.preparada_en);
    const m = _madridDeUtc_(ms);
    const servicio = _servicioDe_(p);
    const operario = _equipoCanonico_(l.operario);
    const inc = PROD_CODIGO_INCIDENCIA_[l.estado_negocio] || '';
    const faltanteTotal = inc === 'sp' || inc === 'sm' || inc === 'oi';
    const cantidad = faltanteTotal ? 0 : Number(inc === 'pa' ? l.cantidad_preparada : l.cantidad) || 0;
    const esPalet = l.unidad_medida === 'palet';

    const k = [idx('d', m.dia), m.hora, idx('t', p.tienda_origen), idx('s', servicio), idx('o', operario), inc].join('|');
    const c = celdasL[k] || (celdasL[k] = { fila: [idx('d', m.dia), m.hora, idx('t', p.tienda_origen), idx('s', servicio), idx('o', operario), inc, 0, 0, 0] });
    c.fila[6] += 1;
    if (esPalet) c.fila[8] += cantidad; else c.fila[7] += cantidad;

    const kp = [idx('d', m.dia), idx('t', p.tienda_origen), idx('s', servicio), idx('o', operario)].join('|');
    (pedidosPorCelda[kp] = pedidosPorCelda[kp] || { fila: [idx('d', m.dia), idx('t', p.tienda_origen), idx('s', servicio), idx('o', operario)], ids: {} }).ids[l.peticion_id] = true;

    if (!ultimaLineaDePeticion[l.peticion_id] || ms > ultimaLineaDePeticion[l.peticion_id]) ultimaLineaDePeticion[l.peticion_id] = ms;
  });

  // ——— Revisiones de palet realizadas (servicio propio) ———
  _selectTodo_('revisiones_palet',
    'estado=eq.revisada&revisada_en=gte.' + encodeURIComponent(t0) + '&revisada_en=lt.' + encodeURIComponent(t1) +
    '&tienda_origen' + tiendas + '&select=id,tienda_origen,revisada_por,revisada_en,conforme')
    .forEach(function (r) {
      const m = _madridDeUtc_(Date.parse(r.revisada_en));
      const inc = r.conforme === false ? 'df' : '';
      const k = [idx('d', m.dia), m.hora, idx('t', r.tienda_origen), idx('s', 'rev'), idx('o', _equipoCanonico_(r.revisada_por)), inc].join('|');
      const c = celdasL[k] || (celdasL[k] = { fila: [idx('d', m.dia), m.hora, idx('t', r.tienda_origen), idx('s', 'rev'), idx('o', _equipoCanonico_(r.revisada_por)), inc, 0, 0, 0] });
      c.fila[6] += 1;
    });

  // ——— Pedidos cerrados y su tiempo de ciclo ———
  const celdasC = {};
  _selectTodo_('peticiones',
    'estado=eq.cerrada&cerrada_en=gte.' + encodeURIComponent(t0) + '&cerrada_en=lt.' + encodeURIComponent(t1) +
    '&tienda_origen' + tiendas + '&select=id,tipo,tienda_origen,transporte,creada_en,cerrada_en,visible_desde')
    .forEach(function (p) {
      const cierreMs = Date.parse(p.cerrada_en);
      // El ciclo termina al preparar la última línea (un pedido con transporte
      // puede esperar horas a que le den ubicación antes de "cerrarse"). El día
      // y la hora del pedido completado son los de esa última línea: es cuando
      // el equipo terminó su trabajo (y de qué turno fue).
      const finMs = ultimaLineaDePeticion[p.id] && ultimaLineaDePeticion[p.id] < cierreMs ? ultimaLineaDePeticion[p.id] : cierreMs;
      const m = _madridDeUtc_(finMs);
      const min = _minutosDeCiclo_(Date.parse(p.creada_en), p.visible_desde, finMs);
      const servicio = _servicioDe_(p);
      const k = [idx('d', m.dia), m.hora, idx('t', p.tienda_origen), idx('s', servicio)].join('|');
      const c = celdasC[k] || (celdasC[k] = { fila: [idx('d', m.dia), m.hora, idx('t', p.tienda_origen), idx('s', servicio), 0, 0, 0, 0, 0, 0, 0, 0] });
      c.fila[4] += 1; c.fila[5] += min;
      var tramo = PROD_TRAMOS_CICLO_MIN_.length;
      for (var i = 0; i < PROD_TRAMOS_CICLO_MIN_.length; i++) { if (min < PROD_TRAMOS_CICLO_MIN_[i]) { tramo = i; break; } }
      c.fila[6 + tramo] += 1;
    });

  // ——— Pedidos que entran ———
  const celdasE = {};
  _selectTodo_('peticiones',
    'creada_en=gte.' + encodeURIComponent(t0) + '&creada_en=lt.' + encodeURIComponent(t1) +
    '&tienda_origen' + tiendas + '&select=id,tipo,tienda_origen,transporte,creada_en')
    .forEach(function (p) {
      const m = _madridDeUtc_(Date.parse(p.creada_en));
      const servicio = _servicioDe_(p);
      const k = [idx('d', m.dia), idx('t', p.tienda_origen), idx('s', servicio)].join('|');
      const c = celdasE[k] || (celdasE[k] = { fila: [idx('d', m.dia), idx('t', p.tienda_origen), idx('s', servicio), 0] });
      c.fila[3] += 1;
    });

  // ——— Pendiente ahora ———
  const ahora = Date.now();
  const hoy = _madridDeUtc_(ahora).dia;
  const celdasB = {};
  function celdaB(tienda, servicio) {
    const k = tienda + '|' + servicio;
    return celdasB[k] || (celdasB[k] = { t: tienda, s: servicio, porPreparar: 0, enPreparacion: 0, porUbicar: 0, masAntigua: 0, quien: {} });
  }
  _selectTodo_('peticiones',
    'estado=in.(pendiente,en_preparacion,a_ubicar)&visible_desde=lte.' + hoy + '&tienda_origen' + tiendas +
    '&select=id,tipo,tienda_origen,transporte,estado,creada_en,visible_desde,en_curso_por,ubicacion_consolidacion')
    .forEach(function (p) {
      const c = celdaB(p.tienda_origen, _servicioDe_(p));
      if (p.estado === 'a_ubicar') {
        if (!p.ubicacion_consolidacion) c.porUbicar += 1;
        return;
      }
      if (p.estado === 'en_preparacion') c.enPreparacion += 1; else c.porPreparar += 1;
      c.masAntigua = Math.max(c.masAntigua, _minutosDeCiclo_(Date.parse(p.creada_en), p.visible_desde, ahora));
      if (p.en_curso_por && p.estado === 'en_preparacion') c.quien[_equipoCanonico_(p.en_curso_por)] = true;
    });
  _selectTodo_('revisiones_palet', 'estado=in.(pendiente,en_revision)&tienda_origen' + tiendas + '&select=id,tienda_origen,creada_en')
    .forEach(function (r) {
      const c = celdaB(r.tienda_origen, 'rev');
      c.porPreparar += 1;
      c.masAntigua = Math.max(c.masAntigua, Math.max(0, Math.round((ahora - Date.parse(r.creada_en)) / 60000)));
    });

  function filas(mapa) { return Object.keys(mapa).map(function (k) { return mapa[k].fila; }); }
  function lista(grupo) { return Object.keys(dic[grupo]).sort(function (a, b) { return dic[grupo][a] - dic[grupo][b]; }); }
  // B se codifica ANTES de leer los diccionarios: puede añadir tiendas o
  // servicios que no salieron en las líneas.
  const filasB = Object.keys(celdasB).map(function (k) {
    const c = celdasB[k];
    return [idx('t', c.t), idx('s', c.s), c.porPreparar, c.enPreparacion, c.porUbicar, c.masAntigua, Object.keys(c.quien)];
  });
  return _json_({
    generado: new Date(ahora).toISOString(), hoy: hoy, desde: desde, hasta: hasta,
    corte: TURNOS_CORTE_HORA_, jefes: TURNOS_JEFES_, J: _turnosLeer_(desde, hasta),
    d: lista('d'), t: lista('t'), s: lista('s'), o: lista('o'),
    L: filas(celdasL),
    P: Object.keys(pedidosPorCelda).map(function (k) { const c = pedidosPorCelda[k]; return c.fila.concat([Object.keys(c.ids).length]); }),
    C: filas(celdasC),
    E: filas(celdasE),
    B: filasB,
  });
}
