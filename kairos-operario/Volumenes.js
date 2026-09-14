/** Productividad de solo lectura (Pieza 6): líneas preparadas por operario,
 *  a partir de lineas.operario + lineas.preparada_en. Sin migración nueva. */

function _inicioDeHoyIso_() {
  const ahora = new Date();
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Utilities.formatDate(inicio, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function listarVolumenesHoy() {
  const desde = _inicioDeHoyIso_();
  const lineas = supaSelect_('lineas',
    'estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(desde) +
    '&select=operario,preparada_en&order=preparada_en.asc&limit=2000');

  const porOperarioHora = {};
  const horas = {};
  lineas.forEach(function (l) {
    if (!l.operario) return;
    const hora = new Date(l.preparada_en).getHours();
    horas[hora] = true;
    porOperarioHora[l.operario] = porOperarioHora[l.operario] || {};
    porOperarioHora[l.operario][hora] = (porOperarioHora[l.operario][hora] || 0) + 1;
  });

  const horasOrdenadas = Object.keys(horas).map(Number).sort(function (a, b) { return a - b; });
  const filas = Object.keys(porOperarioHora).sort().map(function (operario) {
    return {
      operario: operario,
      porHora: horasOrdenadas.map(function (h) { return porOperarioHora[operario][h] || 0; }),
      total: horasOrdenadas.reduce(function (s, h) { return s + (porOperarioHora[operario][h] || 0); }, 0),
    };
  });

  return _json_({ horas: horasOrdenadas, filas: filas });
}

function listarVolumenesHistorico() {
  const desde = new Date();
  desde.setDate(desde.getDate() - 13);
  desde.setHours(0, 0, 0, 0);
  const desdeIso = Utilities.formatDate(desde, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");

  const lineas = supaSelect_('lineas',
    'estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(desdeIso) +
    '&select=preparada_en&order=preparada_en.asc&limit=5000');

  const porDia = {};
  lineas.forEach(function (l) {
    const dia = Utilities.formatDate(new Date(l.preparada_en), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    porDia[dia] = (porDia[dia] || 0) + 1;
  });

  const dias = Object.keys(porDia).sort();
  return _json_(dias.map(function (d) { return { dia: d, total: porDia[d] }; }));
}
