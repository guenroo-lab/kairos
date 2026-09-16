/** Asignación automática de SSCC — replica el algoritmo de
 *  PreparacionPedidosPC/SSCC y Ubicacion.js (buscarYAsignarSSCC_) contra
 *  preparacion.stock_fisico (ya sincronizado) en vez de leer el Excel en
 *  vivo. El operario nunca elige el palet a mano — se calcula solo. */

function _candidatosStock_(tienda, codigoLm) {
  return supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
}

function _ultimoSyncStockFisico_(tienda) {
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&select=sincronizado_en&order=sincronizado_en.desc&limit=1');
  return filas.length ? filas[0].sincronizado_en : null;
}

/** Espejo de _parseCeldaSsccMulti_ (sistema viejo): "sscc1 (Xud) + sscc2 (Yud)"
 *  o un SSCC suelto (se lleva toda la cantidad de la línea). */
function _parseSsccMulti_(valorSscc, cantidadFila) {
  const raw = String(valorSscc || '').trim();
  if (!raw) return [];
  const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
  return partes.map(function (parte) {
    const m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
    if (m) return { sscc: m[1].trim(), cantidad: Number(m[2].replace(',', '.')) || 0 };
    return { sscc: parte.trim(), cantidad: partes.length === 1 ? (Number(cantidadFila) || 0) : 0 };
  });
}

/** Unidades ya comprometidas por SSCC en OTRAS líneas de esa tienda con el
 *  mismo código, asignadas desde el último sync (antes de eso, el snapshot
 *  actual ya refleja el consumo real). */
function _usoComprometidoPorSscc_(tienda, codigoLm, lineaIdExcluir, desde) {
  var q = 'codigo_lm=eq.' + encodeURIComponent(codigoLm) +
    '&sscc=not.is.null&select=id,sscc,cantidad,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  if (desde) q += '&sscc_asignado_en=gte.' + encodeURIComponent(desde);
  const filas = supaSelect_('lineas', q);
  const uso = {};
  filas.forEach(function (l) {
    if (l.id === lineaIdExcluir) return;
    _parseSsccMulti_(l.sscc, l.cantidad).forEach(function (p) {
      if (!p.sscc) return;
      uso[p.sscc] = (uso[p.sscc] || 0) + p.cantidad;
    });
  });
  return uso;
}

/** SSCC ya usados en OTRAS líneas de la MISMA petición (prioridad 1 del
 *  reparto: reutilizar soporte ya abierto para este pedido). */
function _ssccUsadosEnPeticion_(peticionId, lineaIdExcluir) {
  const filas = supaSelect_('lineas',
    'peticion_id=eq.' + encodeURIComponent(peticionId) + '&sscc=not.is.null&select=id,sscc');
  const set = [];
  filas.forEach(function (l) {
    if (l.id === lineaIdExcluir) return;
    _parseSsccMulti_(l.sscc, 0).forEach(function (p) {
      if (p.sscc && set.indexOf(p.sscc) === -1) set.push(p.sscc);
    });
  });
  return set;
}

function _repartirEntreCandidatos_(tienda, linea, candidatos) {
  const desde = _ultimoSyncStockFisico_(tienda);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, desde);
  function remanente(c) { return c.cantidad - (uso[c.sscc] || 0); }
  const necesarias = Number(linea.cantidad);

  const usadosEnPeticion = _ssccUsadosEnPeticion_(linea.peticion_id, linea.id);
  for (var i = 0; i < candidatos.length; i++) {
    if (usadosEnPeticion.indexOf(candidatos[i].sscc) === -1) continue;
    if (remanente(candidatos[i]) >= necesarias) {
      return { sscc: candidatos[i].sscc, ubicacion: candidatos[i].ubicacion };
    }
  }
  for (var j = 0; j < candidatos.length; j++) {
    if (remanente(candidatos[j]) >= necesarias) {
      return { sscc: candidatos[j].sscc, ubicacion: candidatos[j].ubicacion };
    }
  }

  const disponibles = candidatos
    .map(function (c) { return { sscc: c.sscc, ubicacion: c.ubicacion, remanente: remanente(c) }; })
    .filter(function (c) { return c.remanente > 0; })
    .sort(function (a, b) { return b.remanente - a.remanente; });

  var restante = necesarias;
  const reparto = [];
  for (var k = 0; k < disponibles.length && restante > 0; k++) {
    const tomar = Math.min(disponibles[k].remanente, restante);
    reparto.push({ sscc: disponibles[k].sscc, ubicacion: disponibles[k].ubicacion, cantidad: tomar });
    restante -= tomar;
  }
  if (restante > 0) {
    throw new Error('Ni repartiendo entre todos los palets del edificio 05 hay ' +
      necesarias + ' uds del código ' + linea.codigo_lm + ' (faltan ' + restante + ').');
  }
  return {
    sscc: reparto.map(function (r) { return r.sscc + ' (' + r.cantidad + 'ud)'; }).join(' + '),
    ubicacion: reparto.map(function (r) { return r.ubicacion; }).join(' + '),
  };
}

/** Punto de entrada. Si la línea ya tiene sscc, no hace nada (devuelve
 *  null). Si no hay stock suficiente, lanza Error (el caller decide si
 *  bloquear o solo avisar). */
function asignarSsccSiFalta_(linea, peticion) {
  if (linea.sscc) return null;

  const tienda = peticion.tienda_origen;
  const candidatos = _candidatosStock_(tienda, linea.codigo_lm);
  if (!candidatos.length) {
    throw new Error('Sin ubicación en edificio 05 para el código ' + linea.codigo_lm + '.');
  }

  var resultado;
  if (peticion.tipo === 'refill') {
    const c = candidatos.filter(function (x) { return x.cantidad > 0; })[0];
    if (!c) throw new Error('Sin palet disponible para el código ' + linea.codigo_lm + '.');
    resultado = { sscc: c.sscc, ubicacion: c.ubicacion };
  } else {
    resultado = _repartirEntreCandidatos_(tienda, linea, candidatos);
  }

  supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(linea.id), {
    sscc: resultado.sscc,
    ubicacion: resultado.ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  return resultado;
}

/** Palets alternativos al ya asignado para el código de esta línea, con su
 *  remanente real (descontando lo comprometido por otras líneas abiertas) —
 *  para el botón "Cambiar palet" cuando el asignado no sirve (sin stock en
 *  ubicación, ubicación errónea, etc). */
function listarPaletsAlternativos(lineaId) {
  const lineaFilas = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=id,codigo_lm,cantidad,sscc,peticion_id');
  if (!lineaFilas.length) throw new Error('Línea no encontrada.');
  const linea = lineaFilas[0];

  const peticionFilas = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(linea.peticion_id) + '&select=tienda_origen');
  if (!peticionFilas.length) throw new Error('Petición no encontrada.');
  const tienda = peticionFilas[0].tienda_origen;

  const candidatos = _candidatosStock_(tienda, linea.codigo_lm);
  if (!candidatos.length) return _json_([]);

  const desde = _ultimoSyncStockFisico_(tienda);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, desde);
  const actuales = _parseSsccMulti_(linea.sscc, linea.cantidad).map(function (p) { return p.sscc; });

  const lista = candidatos.map(function (c) {
    return {
      sscc: c.sscc,
      ubicacion: c.ubicacion,
      remanente: c.cantidad - (uso[c.sscc] || 0),
      esActual: actuales.indexOf(c.sscc) !== -1,
    };
  });
  lista.sort(function (a, b) { return b.remanente - a.remanente; });
  return _json_(lista);
}

/** Aplica a mano el palet elegido (sustituye SSCC + ubicación de la línea
 *  entera, igual que hacía PreparacionPedidosPC/cambiarPaletLinea). */
function cambiarPaletLinea(lineaId, sscc, ubicacion) {
  sscc = String(sscc || '').trim();
  ubicacion = String(ubicacion || '').trim();
  if (!sscc || !ubicacion) throw new Error('Falta el SSCC o la ubicación del palet elegido.');

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    sscc: sscc,
    ubicacion: ubicacion,
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
