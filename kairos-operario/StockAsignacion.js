/** Asignación automática de SSCC — replica el algoritmo de
 *  PreparacionPedidosPC/SSCC y Ubicacion.js (buscarYAsignarSSCC_) contra
 *  preparacion.stock_fisico (ya sincronizado) en vez de leer el Excel en
 *  vivo. El operario nunca elige el palet a mano — se calcula solo. */

function _candidatosStock_(tienda, codigoLm) {
  return supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
}

/** Marca del snapshot de stock_fisico con el que se leyeron `filas` (la
 *  `sincronizado_en` más reciente de ellas). Se saca de las MISMAS filas que
 *  se usan para calcular, no de una consulta aparte: si entre medias entra una
 *  carga nueva de stock, cantidades y marca seguirían siendo de snapshots
 *  distintos y el consumo ya reflejado se restaría dos veces o ninguna. */
function _marcaDeSnapshot_(filas) {
  var max = null;
  filas.forEach(function (f) {
    if (f.sincronizado_en && (!max || Date.parse(f.sincronizado_en) > Date.parse(max))) max = f.sincronizado_en;
  });
  return max;
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

const FALTANTES_TOTALES_ASIGNACION_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];
// Cuánto hacia atrás desde la marca del snapshot se miran líneas ya preparadas
// de pedidos que aún no se habían completado (acota la consulta).
const VENTANA_CONSUMO_MS_ = 7 * 24 * 60 * 60 * 1000;

/** ¿Sigue el consumo de esta línea ya preparada SIN reflejarse en el
 *  snapshot de stock (marca `desde`)? Depende de cuándo se mueve el stock en
 *  myISO (ver Index.html, dispararTransfers_/dispararMoveToAddress_):
 *   - refill: al preparar cada línea (el palet va a XP1, fuera del snapshot);
 *   - pedido cliente / cesión: SOLO cuando el pedido entero está preparado.
 *     Hasta entonces el CSV sigue mostrando las unidades en su palet, aunque
 *     la línea se preparase horas antes del snapshot.
 *  `finPorPeticion` = última preparada_en de cada petición en 'a_ubicar'
 *  (todas preparadas pero sin ubicación de consolidación: no tiene cerrada_en). */
function _consumoSinReflejar_(l, desde, finPorPeticion) {
  const p = l.peticiones || {};
  const marca = Date.parse(desde);
  if (p.tipo === 'refill' || p.estado === 'anulada') return Date.parse(l.preparada_en) >= marca;
  if (p.estado === 'cerrada') return !!p.cerrada_en && Date.parse(p.cerrada_en) >= marca;
  if (p.estado === 'a_ubicar') {
    const fin = finPorPeticion[l.peticion_id];
    return !fin || Date.parse(fin) >= marca;
  }
  return true; // pendiente / en_preparacion: el pedido aún no está completo
}

function _finPreparacionPorPeticion_(idsPeticion) {
  const fin = {};
  if (!idsPeticion.length) return fin;
  supaSelect_('lineas',
    'peticion_id=in.(' + idsPeticion.map(encodeURIComponent).join(',') + ')&select=peticion_id,preparada_en')
    .forEach(function (x) {
      if (x.preparada_en && (!fin[x.peticion_id] || Date.parse(x.preparada_en) > Date.parse(fin[x.peticion_id]))) fin[x.peticion_id] = x.preparada_en;
    });
  return fin;
}

/** Palets y unidades que ocupa una línea ya preparada, para restarlos. */
function _partesDeLineaPreparada_(l) {
  var partes = _parseSsccMulti_(l.sscc, l.cantidad);
  const tipo = (l.peticiones || {}).tipo;
  if (l.estado_negocio === 'Parcial' && tipo !== 'refill') {
    // Solo se cogió cantidad_preparada: se reparte sobre los palets en orden.
    // (En refill no se sabe QUÉ palets se confirmaron: se cuentan todos
    // enteros hasta el siguiente snapshot, que es el lado seguro.)
    var restante = Number(l.cantidad_preparada) || 0;
    partes = partes.map(function (p) {
      const tomado = Math.min(p.cantidad, restante);
      restante -= tomado;
      return { sscc: p.sscc, cantidad: tomado };
    });
  }
  return partes;
}

/** Líneas de esa tienda con palet asignado cuyas unidades el snapshot de
 *  stock_fisico (marca `desde`) TODAVÍA cuenta como disponibles:
 *   - las aún sin preparar (el palet sigue intacto), da igual cuándo se
 *     asignaron: una asignación no caduca con la carga de stock;
 *   - las ya preparadas cuyo consumo el snapshot no refleja (ver
 *     _consumoSinReflejar_), también las de peticiones anuladas después.
 *  Se excluyen las pendientes de peticiones anuladas y las que acabaron en
 *  faltante total (no se cogió nada). Antes solo contaban las asignadas desde
 *  el último sync: tras cada carga de stock se "olvidaba" lo reservado y aún
 *  sin preparar, y otro pedido podía recibir el mismo palet.
 *  Devuelve [{ id, codigo_lm, partes: [{sscc, cantidad}] }] sin repetir líneas
 *  (dos lecturas seguidas pueden ver la misma línea en estados distintos). */
function _lineasComprometidas_(tienda, codigos, desde) {
  if (!codigos.length) return [];
  const comunes = 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')&sscc=not.is.null' +
    '&select=id,peticion_id,codigo_lm,sscc,cantidad,cantidad_preparada,estado_negocio,preparada_en,peticiones!inner(tipo,tienda_origen,estado,cerrada_en)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  const pendientes = supaSelect_('lineas', comunes + '&peticiones.estado=neq.anulada&estado_preparacion=neq.preparado');
  const preparadas = desde
    ? supaSelect_('lineas', comunes + '&estado_preparacion=eq.preparado&preparada_en=gte.' +
        encodeURIComponent(new Date(Date.parse(desde) - VENTANA_CONSUMO_MS_).toISOString()))
    : [];
  const aUbicar = [];
  preparadas.forEach(function (l) {
    if ((l.peticiones || {}).estado === 'a_ubicar' && aUbicar.indexOf(l.peticion_id) === -1) aUbicar.push(l.peticion_id);
  });
  const finPorPeticion = _finPreparacionPorPeticion_(aUbicar);

  const vistas = {};
  const resultado = [];
  pendientes.forEach(function (l) {
    vistas[l.id] = true;
    resultado.push({ id: l.id, codigo_lm: l.codigo_lm, partes: _parseSsccMulti_(l.sscc, l.cantidad) });
  });
  preparadas.forEach(function (l) {
    if (vistas[l.id]) return;
    if (FALTANTES_TOTALES_ASIGNACION_.indexOf(l.estado_negocio) !== -1) return;
    if (!_consumoSinReflejar_(l, desde, finPorPeticion)) return;
    vistas[l.id] = true;
    resultado.push({ id: l.id, codigo_lm: l.codigo_lm, partes: _partesDeLineaPreparada_(l) });
  });
  return resultado;
}

/** Unidades ya comprometidas por SSCC en OTRAS líneas de esa tienda con el
 *  mismo código (ver _lineasComprometidas_). */
function _usoComprometidoPorSscc_(tienda, codigoLm, lineaIdExcluir, desde) {
  const uso = {};
  _lineasComprometidas_(tienda, [codigoLm], desde).forEach(function (l) {
    if (l.id === lineaIdExcluir) return;
    l.partes.forEach(function (p) {
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
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, _marcaDeSnapshot_(candidatos));
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
 *  bloquear o solo avisar).
 *
 *  Bug real (revisión con Codex CLI, 2026-09-22): lee stock/comprometido y
 *  escribe la asignación en pasos separados, sin nada que serialice dos
 *  ejecuciones a la vez — dos operarios abriendo el mismo pedido, o pedidos
 *  distintos del mismo código, a la vez, podían leer el mismo remanente y
 *  asignarse el mismo SSCC por duplicado. LockService serializa las
 *  ejecuciones de ESTE script (kairos-operario) — no es una transacción de
 *  base de datos real, pero cubre el caso real (todo el tráfico de
 *  asignación pasa por este único Apps Script).
 *
 *  Segunda pasada (revisión adversarial con Codex CLI, mismo día): el `if
 *  (linea.sscc) return null` de arriba mira el objeto `linea` tal como lo
 *  pasó el caller, leído ANTES de coger el lock — dos llamadas para la
 *  MISMA línea (p.ej. dos operarios abriendo el mismo pedido a la vez)
 *  pasaban las dos ese check con el mismo objeto viejo, y las dos
 *  reasignaban la línea en su turno (el lock serializaba pero no impedía
 *  la segunda reasignación). Ahora se relee la línea DENTRO del lock y el
 *  PATCH final es condicional (sscc=is.null) — si otra ejecución ya la
 *  asignó, se devuelve esa asignación en vez de pisarla. */
function asignarSsccSiFalta_(linea, peticion) {
  if (linea.sscc) return null;

  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado asignando stock, inténtalo de nuevo en unos segundos.'); }
  try {
    const actual = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(linea.id) + '&select=id,sscc,ubicacion');
    if (!actual.length) throw new Error('Línea no encontrada.');
    if (actual[0].sscc) return { sscc: actual[0].sscc, ubicacion: actual[0].ubicacion }; // ya asignada por otra ejecución mientras esperábamos el lock
    return _asignarSsccSiFalta_(linea, peticion);
  } finally {
    lock.releaseLock();
  }
}

function _asignarSsccSiFalta_(linea, peticion) {
  const tienda = peticion.tienda_origen;
  const candidatos = _candidatosStock_(tienda, linea.codigo_lm);
  if (!candidatos.length) {
    throw new Error('Sin ubicación en edificio 05 para el código ' + linea.codigo_lm + '.');
  }

  var resultado;
  if (peticion.tipo === 'refill') {
    // Y un palet entero solo sirve si NADA de él está reservado por otras
    // líneas (otro refill lo eligió, un pedido cliente tiene unidades suyas).
    const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, _marcaDeSnapshot_(candidatos));
    const c = candidatos.filter(function (x) { return x.cantidad > 0 && !(uso[x.sscc] > 0); })[0];
    if (!c) {
      throw new Error('Sin palet disponible para el código ' + linea.codigo_lm +
        (candidatos.some(function (x) { return x.cantidad > 0; }) ? ' (los que hay están reservados por otras peticiones).' : '.'));
    }
    // Refill se lleva el palet ENTERO: se guarda la cantidad real en el
    // propio string del sscc (mismo formato "sscc (Xud)" que ya usa el
    // reparto normal) para que el remanente de otras líneas del mismo
    // código se calcule bien — límite conocido, ver README.md:106.
    resultado = { sscc: c.sscc + ' (' + c.cantidad + 'ud)', ubicacion: c.ubicacion };
  } else {
    resultado = _repartirEntreCandidatos_(tienda, linea, candidatos);
  }

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(linea.id) + '&sscc=is.null', {
    sscc: resultado.sscc,
    ubicacion: resultado.ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  if (!filas.length) {
    // Carrera improbable dentro del propio lock (no debería pasar) — releer y devolver lo que quedó.
    const relectura = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(linea.id) + '&select=sscc,ubicacion');
    if (relectura.length && relectura[0].sscc) return { sscc: relectura[0].sscc, ubicacion: relectura[0].ubicacion };
    throw new Error('No se pudo asignar el palet a la línea ' + linea.id + '.');
  }
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

  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, _marcaDeSnapshot_(candidatos));
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

  const lineaFilas = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=id,codigo_lm,peticion_id');
  if (!lineaFilas.length) throw new Error('Línea no encontrada.');
  const linea = lineaFilas[0];

  const peticionFilas = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(linea.peticion_id) + '&select=tipo,tienda_origen');
  if (!peticionFilas.length) throw new Error('Petición no encontrada.');
  const peticion = peticionFilas[0];

  var ssccGuardar = sscc;
  if (peticion.tipo === 'refill') {
    // Mismo motivo que en _asignarSsccSiFalta_: refill se lleva el palet
    // entero, hay que guardar su cantidad real en el string del sscc —
    // si no, el remanente de otras líneas del mismo código vuelve a salir
    // mal tras un cambio manual de palet (límite conocido, README.md:106).
    const candidato = supaSelect_('stock_fisico',
      'tienda=eq.' + encodeURIComponent(peticion.tienda_origen) +
      '&codigo_lm=eq.' + encodeURIComponent(linea.codigo_lm) +
      '&sscc=eq.' + encodeURIComponent(sscc));
    if (!candidato.length) throw new Error('No se pudo verificar la cantidad de ese palet, prueba de nuevo.');
    ssccGuardar = sscc + ' (' + candidato[0].cantidad + 'ud)';
  }

  // sscc_asignado_en también se actualiza aquí (bug real, revisión con Codex
  // CLI 2026-09-22): si no, un palet elegido a mano después del último sync
  // quedaba con la marca de tiempo vieja y _usoComprometidoPorSscc_ (filtro
  // sscc_asignado_en >= último sync) lo trataba como si no estuviera
  // comprometido — podía volver a asignarse a otra línea.
  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    sscc: ssccGuardar,
    ubicacion: ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
