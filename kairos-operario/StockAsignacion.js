/** Asignación automática de SSCC contra preparacion.stock_fisico (ya
 *  sincronizado) en vez de leer el Excel en vivo. Nació como réplica del
 *  algoritmo de PreparacionPedidosPC/SSCC y Ubicacion.js (buscarYAsignarSSCC_),
 *  pero desde 2026-10-15 el reparto de pedido cliente / cesión vacía primero
 *  los palets con menos unidades (_elegirPaletsDeLinea_). El operario puede
 *  cambiarlo a mano (Cambiar palet / Repartir entre palets). */

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

// Máximo de palets distintos que se buscan A PROPÓSITO para una línea. Cada palet es una parada y una transferencia
// más en myISO: pasado este número solo se usan los palets imprescindibles (ver _elegirPaletsDeLinea_).
const MAX_PALETS_POR_LINEA_ = 3;
// Con más palets libres que estos de un mismo código no se prueban combinaciones: el coste crece con el número de
// palets elevado a MAX_PALETS_POR_LINEA_ y esto se calcula por cada línea de la cola. Con 3 palets por línea y 80 palets
// son ~3 ms; con 5 serían ~1 s. No subir el máximo de palets por línea sin revisar este tope. Se reparte de mayor a menor.
const MAX_PALETS_A_COMBINAR_ = 80;

function _compararTexto_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reparto "de mayor a menor": los menos palets posibles. Es lo que se hace cuando ni con el máximo de palets
 *  por línea llega (la línea pide mucho y los palets son pequeños) o cuando hay demasiados palets para combinarlos. */
function _repartoDeMayorAMenor_(lista, pedidas) {
  var restante = pedidas;
  const reparto = [];
  for (var k = lista.length - 1; k >= 0 && restante > 0; k--) {
    const tomar = Math.min(lista[k].libre, restante);
    reparto.push({ sscc: lista[k].sscc, ubicacion: lista[k].ubicacion, cantidad: tomar });
    restante -= tomar;
  }
  return reparto;
}

/** De qué palets se coge una línea para que queden los MENOS palets con picking.
 *
 *  Regla (pedida por Pedro, 2026-10-15): se vacían primero los palets con menos unidades y lo que falte sale de otro
 *  palet. Con 3 unidades y palets de 1 y de 30: la 1 del palet pequeño (que así desaparece) y las 2 que faltan del
 *  grande — antes salían las 3 del grande y el pequeño se quedaba para siempre con su unidad.
 *
 *  Entre todas las formas de reunir `necesarias` unidades con como mucho `maxPalets` palets se elige, por este orden:
 *   1. la que deja MÁS palets vacíos;
 *   2. la que rompe el palet más PEQUEÑO para lo que falta, así los grandes se quedan enteros. Si los palets que se
 *      vacían suman justo lo pedido no se rompe ninguno, y eso gana a romper uno: con 3 unidades y palets de 1, 3 y 30
 *      se coge el de 3 entero, que deja lo mismo en el almacén que 1 + 2 con una parada menos;
 *   3. la que visita menos palets nuevos para el pedido (`usados` = palets que otras líneas del mismo pedido ya visitan);
 *   4. la primera según el orden de la lista (menos unidades, luego ubicación y SSCC), para que el resultado no
 *      dependa del orden en que llegue el stock.
 *  Si ni con `maxPalets` llega (hacen falta más palets) o hay demasiados palets para combinarlos
 *  (MAX_PALETS_A_COMBINAR_), se usan los menos posibles, de mayor a menor.
 *
 *  candidatos: [{ sscc, ubicacion, remanente }] — remanente = lo que queda libre en el palet (stock menos lo que ya
 *  tienen apartado otras líneas; 0 si se lo lleva un refill). Los de remanente <= 0 se ignoran.
 *  opciones: { usados: { sscc: true }, maxPalets }.
 *  Devuelve [{ sscc, ubicacion, cantidad }] — primero los palets que se vacían (de menos a más unidades) y al final el
 *  que queda a medias —, o null si entre todos no hay `necesarias` unidades. Función pura: la usan la asignación real
 *  (_repartirEntreCandidatos_) y la previsión de la cola (_ubicacionesPrevistas_), así que nunca pueden discrepar. */
function _elegirPaletsDeLinea_(candidatos, necesarias, opciones) {
  opciones = opciones || {};
  const usados = opciones.usados || {};
  const maxPalets = Number(opciones.maxPalets) > 0 ? Number(opciones.maxPalets) : MAX_PALETS_POR_LINEA_;
  const pedidas = Number(necesarias);
  if (!(pedidas > 0)) return [];

  const lista = candidatos
    .map(function (c) { return { sscc: c.sscc, ubicacion: c.ubicacion, libre: Number(c.remanente) || 0 }; })
    .filter(function (c) { return c.libre > 0; })
    .sort(function (a, b) {
      return (a.libre - b.libre) || ((usados[b.sscc] ? 1 : 0) - (usados[a.sscc] ? 1 : 0)) ||
        _compararTexto_(a.ubicacion, b.ubicacion) || _compararTexto_(a.sscc, b.sscc);
    });
  const hay = lista.reduce(function (s, c) { return s + c.libre; }, 0);
  if (hay < pedidas) return null;

  if (lista.length > MAX_PALETS_A_COMBINAR_) return _repartoDeMayorAMenor_(lista, pedidas);

  const m = lista.length;
  var mejor = null;

  // Un reparto = los palets que se vacían (`vaciados`, índices de la lista) y, si no suman justo lo pedido, UN palet
  // más del que sale lo que falta (`parcial`, -1 si no hay). Se guarda el primero que sea estrictamente mejor: a
  // igualdad total gana el que se encontró antes, que es el primero según el orden de la lista.
  function mejorQue(a, b) {
    if (a.vaciados.length !== b.vaciados.length) return a.vaciados.length > b.vaciados.length;
    if (a.tamParcial !== b.tamParcial) return a.tamParcial < b.tamParcial; // sin palet roto (0) gana a romper uno
    return a.nuevos < b.nuevos;
  }
  function proponer(vaciados, parcial, falta) {
    const palets = parcial >= 0 ? vaciados.concat([parcial]) : vaciados;
    const cand = {
      vaciados: vaciados.slice(), parcial: parcial, falta: falta,
      tamParcial: parcial >= 0 ? lista[parcial].libre : 0,
      nuevos: palets.filter(function (idx) { return !usados[lista[idx].sscc]; }).length,
    };
    if (!mejor || mejorQue(cand, mejor)) mejor = cand;
  }
  // `vaciados` = palets que se cogen enteros (índices de menor a mayor); lo que falte sale de UN palet más,
  // el más pequeño de los demás al que le sobre algo.
  function recorrer(desde, vaciados, suma) {
    const falta = pedidas - suma;
    if (falta === 0) { proponer(vaciados, -1, 0); return; }
    if (vaciados.length + 1 <= maxPalets) {
      for (var j = 0; j < m; j++) {
        if (vaciados.indexOf(j) === -1 && lista[j].libre > falta) { proponer(vaciados, j, falta); break; }
      }
    }
    if (vaciados.length >= maxPalets) return;
    for (var x = desde; x < m; x++) {
      if (suma + lista[x].libre > pedidas) break; // la lista va de menos a más: los siguientes tampoco caben
      vaciados.push(x);
      recorrer(x + 1, vaciados, suma + lista[x].libre);
      vaciados.pop();
    }
  }
  recorrer(0, [], 0);
  if (!mejor) return _repartoDeMayorAMenor_(lista, pedidas); // ni con `maxPalets` palets llega

  const reparto = mejor.vaciados.map(function (idx) {
    return { sscc: lista[idx].sscc, ubicacion: lista[idx].ubicacion, cantidad: lista[idx].libre };
  });
  if (mejor.parcial >= 0) {
    reparto.push({ sscc: lista[mejor.parcial].sscc, ubicacion: lista[mejor.parcial].ubicacion, cantidad: mejor.falta });
  }
  return reparto;
}

/** Cómo se guarda un reparto en la línea: un solo palet = su SSCC suelto (se lleva toda la línea); varios =
 *  "sscc1 (15ud) + sscc2 (2ud)" con las ubicaciones en el mismo orden. */
function _textoDeReparto_(reparto) {
  if (reparto.length === 1) return { sscc: reparto[0].sscc, ubicacion: reparto[0].ubicacion };
  return {
    sscc: reparto.map(function (r) { return r.sscc + ' (' + r.cantidad + 'ud)'; }).join(' + '),
    ubicacion: reparto.map(function (r) { return r.ubicacion; }).join(' + '),
  };
}

function _repartirEntreCandidatos_(tienda, linea, candidatos) {
  const marca = _marcaDeSnapshot_(candidatos);
  const uso = _usoComprometidoPorSscc_(tienda, linea.codigo_lm, linea.id, marca);
  // Un palet que se lleva un refill se va entero: nada de él está disponible.
  const enRefill = _paletsDeRefill_(tienda, marca);
  function remanente(c) { return enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0); }
  const necesarias = Number(linea.cantidad);

  // Palets que otras líneas de este mismo pedido ya visitan: a igualdad de todo lo demás, mejor ir a uno de esos.
  const usados = {};
  _ssccUsadosEnPeticion_(linea.peticion_id, linea.id).forEach(function (s) { usados[s] = true; });

  const reparto = _elegirPaletsDeLinea_(
    candidatos.map(function (c) { return { sscc: c.sscc, ubicacion: c.ubicacion, remanente: remanente(c) }; }),
    necesarias, { usados: usados });
  if (!reparto) {
    var hay = 0;
    candidatos.forEach(function (c) { hay += Math.max(0, remanente(c)); });
    throw new Error('Ni repartiendo entre todos los palets del edificio 05 hay ' +
      necesarias + ' uds del código ' + linea.codigo_lm + ' (faltan ' + (necesarias - hay) + ').');
  }
  return _textoDeReparto_(reparto);
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
