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
// Máximo de ids (uuid / SSCC) por consulta: UrlFetchApp admite URLs de ~2 KB.
const TROZO_IDS_ = 30;

function _trozos_(lista, tamano) {
  const trozos = [];
  for (var i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

/** Lee TODAS las filas de una consulta aunque pasen del tope de filas de la API
 *  (1000): sin esto una consulta que devolviese más se cortaría en silencio y
 *  se "perderían" reservas. Pagina por clave (id mayor que el último leído):
 *  estable aunque entre página y página cambien filas. La consulta debe
 *  incluir `id` en su select. Si no cabe, falla en vez de devolver de menos. */
function _selectTodo_(tabla, consulta) {
  const todas = [];
  var ultimo = null;
  for (var pagina = 0; pagina < 200; pagina++) {
    const filas = supaSelect_(tabla, consulta + '&order=id.asc&limit=1000' + (ultimo ? '&id=gt.' + encodeURIComponent(ultimo) : ''));
    filas.forEach(function (f) { todas.push(f); });
    if (filas.length < 1000) return todas;
    ultimo = filas[filas.length - 1].id;
    if (!ultimo) throw new Error('_selectTodo_: la consulta debe incluir id en el select.');
  }
  throw new Error('Demasiados datos para calcular el stock (más de 200.000 filas).');
}


/** Peticiones de pedido cliente / cesión cuya ÚLTIMA línea se preparó después
 *  de la marca del snapshot: la transferencia de stock en myISO se dispara al
 *  preparar la última línea (Index.html, dispararTransfers_), así que su
 *  consumo todavía no está en el CSV aunque sus primeras líneas se
 *  prepararan mucho antes. (No se usa cerrada_en: es la hora de la
 *  consolidación, no de la transferencia.) Memoizado por ejecución. */
var COMPLETADAS_MEMO_ = {};
var COMPLETADAS_TTL_MS_ = 15000;
function _peticionesCompletadasDesde_(tienda, desde) {
  const clave = tienda + '|' + desde;
  // Memo corto: dentro de una misma ejecución se repite la consulta por cada
  // línea/código; con vida limitada para que un pedido que se completa mientras
  // tanto no quede "congelado" como incompleto.
  const memo = COMPLETADAS_MEMO_[clave];
  if (memo && Date.now() - memo.en < COMPLETADAS_TTL_MS_) return memo.ids;
  const ids = [];
  _selectTodo_('lineas',
    'estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(desde) +
    '&select=id,peticion_id,peticiones!inner(tipo,estado)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) +
    '&peticiones.tipo=neq.refill&peticiones.estado=in.(a_ubicar,cerrada)')
    .forEach(function (l) { if (ids.indexOf(l.peticion_id) === -1) ids.push(l.peticion_id); });
  COMPLETADAS_MEMO_[clave] = { ids: ids, en: Date.now() };
  return ids;
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
    }).filter(function (p) { return p.cantidad > 0; });
  }
  return partes;
}

/** Líneas de esa tienda con palet asignado cuyas unidades el snapshot de
 *  stock_fisico (marca `desde`) TODAVÍA cuenta como disponibles:
 *   - las aún sin preparar (el palet sigue intacto), da igual cuándo se
 *     asignaron: una asignación no caduca con la carga de stock;
 *   - las ya preparadas cuyo consumo el snapshot no refleja. Depende de cuándo
 *     se mueve el stock en myISO (Index.html, dispararTransfers_ y
 *     dispararMoveToAddress_): en refill, al preparar cada línea (el palet va a
 *     XP1, fuera del snapshot); en pedido cliente / cesión, solo cuando el
 *     pedido entero está preparado. Por eso cuentan: lo preparado después de
 *     la marca, lo preparado en pedidos todavía incompletos (da igual hace
 *     cuánto) y lo de pedidos que se completaron después de la marca.
 *  Se excluyen las pendientes de peticiones anuladas y las que acabaron en
 *  faltante total (no se cogió nada). Antes solo contaban las asignadas desde
 *  el último sync: tras cada carga de stock se "olvidaba" lo reservado y aún
 *  sin preparar, y otro pedido podía recibir el mismo palet.
 *  Devuelve [{ id, codigo_lm, partes: [{sscc, cantidad}] }] sin repetir líneas
 *  (varias lecturas seguidas pueden ver la misma línea en estados distintos). */
function _lineasComprometidas_(tienda, codigos, desde) {
  // Trozos de códigos para que la URL no pase de ~2 KB (límite de UrlFetchApp).
  const todas = [];
  _trozos_(codigos, 40).forEach(function (trozo) {
    _lineasComprometidasDe_(tienda, trozo, desde).forEach(function (l) { todas.push(l); });
  });
  return todas;
}

function _lineasComprometidasDe_(tienda, codigos, desde) {
  const comunes = 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')&sscc=not.is.null' +
    '&select=id,peticion_id,codigo_lm,sscc,cantidad,cantidad_preparada,estado_negocio,preparada_en,peticiones!inner(tipo,estado)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  const vistas = {};
  const resultado = [];
  function anadir(l, partes) {
    vistas[l.id] = true;
    resultado.push({ id: l.id, codigo_lm: l.codigo_lm, partes: partes });
  }

  _selectTodo_('lineas', comunes + '&peticiones.estado=neq.anulada&estado_preparacion=neq.preparado')
    .forEach(function (l) { anadir(l, _parseSsccMulti_(l.sscc, l.cantidad)); });
  if (!desde) return resultado;

  const preparadas = comunes + '&estado_preparacion=eq.preparado';
  // Preparadas después de la marca (cualquier estado de la petición, también anuladas después).
  const candidatas = _selectTodo_('lineas', preparadas + '&preparada_en=gte.' + encodeURIComponent(desde));
  // Preparadas en un pedido que aún no está completo (su transferencia no se ha hecho).
  _selectTodo_('lineas', preparadas + '&peticiones.estado=in.(pendiente,en_preparacion)').forEach(function (l) {
    if ((l.peticiones || {}).tipo !== 'refill') candidatas.push(l);
  });
  // Preparadas antes de la marca en un pedido que se completó después de ella.
  // (trozos pequeños: la URL ya lleva la lista de códigos y los filtros)
  _trozos_(_peticionesCompletadasDesde_(tienda, desde), 15).forEach(function (ids) {
    _selectTodo_('lineas', preparadas + '&peticion_id=in.(' + ids.map(encodeURIComponent).join(',') + ')')
      .forEach(function (l) { candidatas.push(l); });
  });
  candidatas.forEach(function (l) {
    if (vistas[l.id]) return;
    if (FALTANTES_TOTALES_ASIGNACION_.indexOf(l.estado_negocio) !== -1) return;
    anadir(l, _partesDeLineaPreparada_(l));
  });
  return resultado;
}

/** Palets que un refill se lleva ENTEROS (con todo lo que lleven dentro, de
 *  cualquier código): los de refills abiertos y los de refills preparados
 *  después de la marca (ya en XP1 pero el snapshot aún los cuenta). Ni un
 *  pedido cliente ni otro refill pueden usar nada de ellos. {sscc: true}. */
function _paletsDeRefill_(tienda, desde) {
  const comunes = 'sscc=not.is.null&select=id,sscc,cantidad,estado_negocio,preparada_en,peticiones!inner(tipo,estado)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) + '&peticiones.tipo=eq.refill';
  const lineas = _selectTodo_('lineas', comunes + '&peticiones.estado=neq.anulada&estado_preparacion=neq.preparado');
  if (desde) {
    _selectTodo_('lineas', comunes + '&estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(desde))
      .forEach(function (l) { if (FALTANTES_TOTALES_ASIGNACION_.indexOf(l.estado_negocio) === -1) lineas.push(l); });
  }
  const set = {};
  lineas.forEach(function (l) {
    _parseSsccMulti_(l.sscc, l.cantidad).forEach(function (p) { if (p.sscc) set[p.sscc] = true; });
  });
  return set;
}

/** Palets (de los `candidatos`) que NO se pueden dar a un refill porque algo
 *  de ellos está ya reservado: por otro refill, o por unidades de CUALQUIER
 *  código que lleve el palet (un refill se lleva el palet entero, no solo el
 *  código pedido). La propia línea (`lineaId`) no cuenta. {sscc: true}. */
function _paletsOcupados_(tienda, candidatos, desde, lineaId) {
  const ocupados = _paletsDeRefill_(tienda, desde);
  const ssccs = [];
  candidatos.forEach(function (c) { if (ssccs.indexOf(c.sscc) === -1) ssccs.push(c.sscc); });
  const codigos = [];
  _trozos_(ssccs, TROZO_IDS_).forEach(function (trozo) {
    supaSelect_('stock_fisico',
      'tienda=eq.' + encodeURIComponent(tienda) + '&sscc=in.(' + trozo.map(encodeURIComponent).join(',') + ')&select=codigo_lm')
      .forEach(function (f) { if (codigos.indexOf(f.codigo_lm) === -1) codigos.push(f.codigo_lm); });
  });
  _trozos_(codigos, TROZO_IDS_).forEach(function (trozo) {
    _lineasComprometidas_(tienda, trozo, desde).forEach(function (l) {
      if (l.id === lineaId) return;
      l.partes.forEach(function (p) { if (p.sscc) ocupados[p.sscc] = true; });
    });
  });
  return ocupados;
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
  const marca = _marcaDeSnapshot_(candidatos);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, marca);
  // Un palet que se lleva un refill se va entero: nada de él está disponible.
  const enRefill = _paletsDeRefill_(tienda, marca);
  function remanente(c) { return enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0); }
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
    // líneas: otro refill, o unidades de cualquier código que lleve el palet.
    const ocupados = _paletsOcupados_(tienda, candidatos, _marcaDeSnapshot_(candidatos), linea.id);
    const c = candidatos.filter(function (x) { return x.cantidad > 0 && !ocupados[x.sscc]; })[0];
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

  const marca = _marcaDeSnapshot_(candidatos);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, marca);
  const enRefill = _paletsDeRefill_(tienda, marca);
  const partesActuales = _parseSsccMulti_(linea.sscc, linea.cantidad);
  const actuales = partesActuales.map(function (p) { return p.sscc; });

  const lista = candidatos.map(function (c) {
    const mia = partesActuales.filter(function (p) { return p.sscc === c.sscc; })[0];
    return {
      sscc: c.sscc,
      ubicacion: c.ubicacion,
      remanente: enRefill[c.sscc] && actuales.indexOf(c.sscc) === -1 ? 0 : c.cantidad - (uso[c.sscc] || 0),
      esActual: actuales.indexOf(c.sscc) !== -1,
      // Unidades que esta línea ya tiene apartadas en este palet (para el reparto manual).
      cantidadActual: mia ? mia.cantidad : 0,
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

/** Reparto MANUAL de una línea entre varios palets: p. ej. 17 uds = 15 de un
 *  palet pequeño (que así se vacía) + 2 de otro, en vez de 17 de uno solo.
 *  `reparto` = [{ sscc, cantidad }]. Se guarda en el mismo formato que el reparto
 *  automático ("sscc1 (15ud) + sscc2 (2ud)"), así que todo lo demás ya lo
 *  entiende: la lista de palets a confirmar uno a uno, la transferencia de
 *  stock de cada soporte en myISO y el cálculo de lo que queda libre en cada
 *  palet para el resto de pedidos.
 *
 *  Nada se fía del cliente: la ubicación sale de stock_fisico, y cada palet
 *  debe tener libres (stock menos lo ya reservado por OTRAS líneas) al menos
 *  las unidades que se le piden. Se serializa con el mismo bloqueo que la
 *  asignación automática, para que dos operarios no se lleven a la vez lo
 *  mismo del mismo palet. */
function repartirPaletsLinea(lineaId, reparto) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado asignando stock, inténtalo de nuevo en unos segundos.'); }
  try {
    return _repartirPaletsLinea_(lineaId, reparto);
  } finally {
    lock.releaseLock();
  }
}

function _repartirPaletsLinea_(lineaId, reparto) {
  const lineaFilas = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) +
    '&select=id,codigo_lm,cantidad,unidad_medida,estado_preparacion,peticion_id,sscc');
  if (!lineaFilas.length) throw new Error('Línea no encontrada.');
  const linea = lineaFilas[0];
  if (linea.estado_preparacion === 'preparado') throw new Error('Esa línea ya está preparada: deshazla antes de cambiar sus palets.');
  if (linea.unidad_medida === 'palet') throw new Error('Esta línea pide palets enteros: no se reparte por unidades.');

  const peticionFilas = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(linea.peticion_id) + '&select=tipo,tienda_origen,estado');
  if (!peticionFilas.length) throw new Error('Petición no encontrada.');
  const peticion = peticionFilas[0];
  if (peticion.tipo === 'refill') throw new Error('Un refill se lleva palets enteros: no se reparte.');
  if (peticion.estado === 'anulada' || peticion.estado === 'cerrada') throw new Error('Esta petición ya no admite cambios.');

  // Reparto limpio: unidades enteras mayores que 0, sin repetir palet.
  const partes = [];
  (reparto || []).forEach(function (r) {
    const sscc = String((r && r.sscc) || '').trim();
    const cantidad = Number(r && r.cantidad);
    if (!sscc) throw new Error('Falta el palet en el reparto.');
    if (!(cantidad > 0) || Math.floor(cantidad) !== cantidad) throw new Error('Las unidades de cada palet tienen que ser un número entero mayor que 0.');
    if (partes.some(function (p) { return p.sscc === sscc; })) throw new Error('El palet ' + sscc + ' está repetido en el reparto.');
    partes.push({ sscc: sscc, cantidad: cantidad });
  });
  if (!partes.length) throw new Error('Elige al menos un palet.');
  const pedidas = Number(linea.cantidad);
  const suma = partes.reduce(function (s, p) { return s + p.cantidad; }, 0);
  if (suma !== pedidas) throw new Error('El reparto suma ' + suma + ' ud y la línea pide ' + pedidas + '.');

  const tienda = peticion.tienda_origen;
  const candidatos = _candidatosStock_(tienda, linea.codigo_lm);
  const marca = _marcaDeSnapshot_(candidatos);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, marca);
  const enRefill = _paletsDeRefill_(tienda, marca);
  const ubicaciones = partes.map(function (p) {
    const c = candidatos.filter(function (x) { return x.sscc === p.sscc; })[0];
    if (!c) throw new Error('El palet ' + p.sscc + ' ya no consta con el código ' + linea.codigo_lm + ' en el edificio 05.');
    const libres = enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0);
    if (p.cantidad > libres) {
      throw new Error('El palet ' + p.sscc + ' solo tiene ' + Math.max(0, libres) + ' ud libres' + (enRefill[c.sscc] ? ' (lo reserva un refill)' : ' (el resto está reservado por otros pedidos)') + ' y le pides ' + p.cantidad + '.');
    }
    return c.ubicacion;
  });

  // sscc_asignado_en como en cambiarPaletLinea (si no, el palet nuevo no contaría como reservado). El filtro por
  // estado evita pisar una línea que otro operario acaba de marcar como preparada.
  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&estado_preparacion=neq.preparado', {
    sscc: partes.map(function (p) { return p.sscc + ' (' + p.cantidad + 'ud)'; }).join(' + '),
    ubicacion: ubicaciones.join(' + '),
    sscc_asignado_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('La línea acaba de cambiar (puede que ya esté preparada). Vuelve a abrir el pedido.');
  return _json_({ ok: true, sscc: filas[0].sscc, ubicacion: filas[0].ubicacion });
}
