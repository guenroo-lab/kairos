const TRADUCCION_ESTADO = {
  pendiente: 'Solicitado',
  en_preparacion: 'En preparación',
  a_ubicar: 'Preparada, pendiente de consolidar',
  cerrada: 'Completada',
  anulada: 'Anulada',
};

/** Anular una petición abierta (rol gestor). No la borra — queda como
 *  histórico en trazabilidad, pero desaparece de la cola de preparación
 *  (kairos-operario solo lee estado in pendiente/en_preparacion). */
function anularPeticion(ldap, peticionId, motivo) {
  const u = _usuarioDe_(ldap);
  if (u.rol !== 'gestor' && u.rol !== 'master') throw new Error('Solo un gestor puede anular peticiones.');
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Escribe el motivo de la anulación.');

  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) + '&select=id,estado');
  if (!cab.length) throw new Error('Petición no encontrada.');
  if (cab[0].estado === 'cerrada' || cab[0].estado === 'anulada') throw new Error('Esta petición ya no se puede anular.');

  // Filtro por estado también en el UPDATE (no solo en el SELECT previo): si
  // dos anulaciones o un cierre y una anulación llegan a la vez, solo una
  // gana; la otra no pisa el resultado.
  const filas = supaUpdate_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&estado=not.in.(cerrada,anulada)',
    { estado: 'anulada', motivo_anulacion: motivo });
  if (!filas.length) throw new Error('Esta petición ya no se puede anular.');
  _incidenciasGestionadasPorAnulacion_(ldap, peticionId, motivo);
  return _json_({ ok: true });
}

/** Unidades que representa una línea: en refill, la suma de los "(Nud)" de
 *  los palets elegidos (su cantidad es el nº de palets); en el resto, su
 *  cantidad. */
function _unidadesDeLinea_(linea, tipo) {
  if (tipo !== 'refill') return Number(linea.cantidad) || 0;
  const partes = String(linea.sscc || '').match(/\((\d+(?:[.,]\d+)?)\s*ud\)/g) || [];
  return partes.reduce(function (s, p) {
    return s + (Number(p.replace(/[^\d.,]/g, '').replace(',', '.')) || 0);
  }, 0);
}

const FALTANTES_TOTALES_STOCK_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];
// Máximo de ids (uuid / SSCC) por consulta: UrlFetchApp admite URLs de ~2 KB.
const TROZO_IDS_ = 30;

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

function _trozos_(lista, tamano) {
  const trozos = [];
  for (var i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

/** "sscc1 (Xud) + sscc2 (Yud)" o un SSCC suelto (se lleva toda la cantidad de
 *  la línea) → [{sscc, cantidad}]. Espejo de _parseSsccMulti_ de kairos-operario. */
function _partesSscc_(valorSscc, cantidadFila) {
  const raw = String(valorSscc || '').trim();
  if (!raw) return [];
  const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
  return partes.map(function (parte) {
    const m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
    if (m) return { sscc: m[1].trim(), cantidad: Number(m[2].replace(',', '.')) || 0 };
    return { sscc: parte.trim(), cantidad: partes.length === 1 ? (Number(cantidadFila) || 0) : 0 };
  });
}

/** Peticiones de pedido cliente / cesión cuya ÚLTIMA línea se preparó después
 *  de la marca del snapshot. Espejo de kairos-operario/StockAsignacion.js —
 *  allí está explicado: la transferencia de stock en myISO se dispara al
 *  preparar la última línea del pedido, no al preparar cada una. Memoizado
 *  por ejecución. */
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

/** Unidades que sigue ocupando una línea ya preparada (0 si no se cogió nada). */
function _unidadesDeLineaPreparada_(l, tipo) {
  if (FALTANTES_TOTALES_STOCK_.indexOf(l.estado_negocio) !== -1) return 0;
  // Refill: se cuentan los palets elegidos enteros, también en Parcial (no se
  // sabe cuáles se confirmaron; el siguiente snapshot lo corrige).
  if (tipo === 'refill') return _unidadesDeLinea_(l, 'refill');
  if (l.estado_negocio === 'Parcial') return Number(l.cantidad_preparada) || 0;
  return Number(l.cantidad) || 0;
}

/** Palets que ocupa una línea ya preparada (igual que en kairos-operario:
 *  un parcial no-refill solo ocupa lo cogido, repartido en orden). */
function _partesDeLineaPreparada_(l, tipo) {
  var partes = _partesSscc_(l.sscc, l.cantidad);
  if (l.estado_negocio === 'Parcial' && tipo !== 'refill') {
    var restante = Number(l.cantidad_preparada) || 0;
    partes = partes.map(function (p) {
      const tomado = Math.min(p.cantidad, restante);
      restante -= tomado;
      return { sscc: p.sscc, cantidad: tomado };
    }).filter(function (p) { return p.cantidad > 0; });
  }
  return partes;
}

/** Líneas de esa tienda y esos códigos que el snapshot de stock_fisico (marca
 *  `desde`) todavía cuenta como disponibles:
 *   - las aún sin preparar de peticiones no anuladas, tengan palet o no;
 *   - las ya preparadas cuyo consumo el snapshot no refleja: preparadas
 *     después de la marca (también si la petición se anuló luego: lo cogido ya
 *     salió de su palet), preparadas en un pedido todavía incompleto, y las de
 *     un pedido que se completó después de la marca. En refill el stock se
 *     mueve al preparar cada línea; en pedido cliente / cesión, al preparar la
 *     última del pedido (ver kairos-operario/StockAsignacion.js).
 *  Devuelve [{ id, unidades, partes: [{sscc, cantidad}] }] sin repetir líneas. */
function _lineasComprometidasPortal_(tienda, codigos, desde) {
  const todas = [];
  _trozos_(codigos, 40).forEach(function (trozo) {
    _lineasComprometidasDe_(tienda, trozo, desde).forEach(function (l) { todas.push(l); });
  });
  return todas;
}

function _lineasComprometidasDe_(tienda, codigos, desde) {
  const comunes = 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')' +
    '&select=id,peticion_id,codigo_lm,sscc,cantidad,cantidad_preparada,estado_negocio,preparada_en,peticiones!inner(tipo,estado)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  const vistas = {};
  const resultado = [];
  function anadir(l, unidades, partes) {
    vistas[l.id] = true;
    resultado.push({ id: l.id, codigo_lm: l.codigo_lm, tipo: (l.peticiones || {}).tipo, unidades: unidades, partes: partes });
  }

  _selectTodo_('lineas', comunes + '&peticiones.estado=neq.anulada&estado_preparacion=neq.preparado')
    .forEach(function (l) {
      anadir(l, _unidadesDeLinea_(l, (l.peticiones || {}).tipo), _partesSscc_(l.sscc, l.cantidad));
    });
  if (!desde) return resultado;

  const preparadas = comunes + '&estado_preparacion=eq.preparado';
  const candidatas = _selectTodo_('lineas', preparadas + '&preparada_en=gte.' + encodeURIComponent(desde));
  _selectTodo_('lineas', preparadas + '&peticiones.estado=in.(pendiente,en_preparacion)').forEach(function (l) {
    if ((l.peticiones || {}).tipo !== 'refill') candidatas.push(l);
  });
  _trozos_(_peticionesCompletadasDesde_(tienda, desde), 15).forEach(function (ids) {
    _selectTodo_('lineas', preparadas + '&peticion_id=in.(' + ids.map(encodeURIComponent).join(',') + ')')
      .forEach(function (l) { candidatas.push(l); });
  });
  candidatas.forEach(function (l) {
    if (vistas[l.id]) return;
    const tipo = (l.peticiones || {}).tipo;
    const unidades = _unidadesDeLineaPreparada_(l, tipo);
    if (unidades <= 0) return;
    anadir(l, unidades, _partesDeLineaPreparada_(l, tipo));
  });
  return resultado;
}

/** Palets que un refill se lleva ENTEROS (con todo lo que lleven dentro, de
 *  cualquier código): los de refills abiertos y los de refills preparados
 *  después de la marca. Espejo de _paletsDeRefill_ de kairos-operario. {sscc: true}. */
function _paletsDeRefill_(tienda, desde) {
  const comunes = 'sscc=not.is.null&select=id,sscc,cantidad,estado_negocio,preparada_en,peticiones!inner(tipo,estado)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) + '&peticiones.tipo=eq.refill';
  const lineas = _selectTodo_('lineas', comunes + '&peticiones.estado=neq.anulada&estado_preparacion=neq.preparado');
  if (desde) {
    _selectTodo_('lineas', comunes + '&estado_preparacion=eq.preparado&preparada_en=gte.' + encodeURIComponent(desde))
      .forEach(function (l) { if (FALTANTES_TOTALES_STOCK_.indexOf(l.estado_negocio) === -1) lineas.push(l); });
  }
  const set = {};
  lineas.forEach(function (l) {
    _partesSscc_(l.sscc, l.cantidad).forEach(function (p) { if (p.sscc) set[p.sscc] = true; });
  });
  return set;
}

/** Filas de stock_fisico de esos códigos, todas de UN MISMO snapshot: si entre
 *  una lectura y otra entra una carga nueva de stock (cada snapshot lleva su
 *  marca `sincronizado_en`), las cantidades de unos códigos serían de un
 *  snapshot y las de otros de otro, y la marca no valdría para todas. Se
 *  vuelve a leer; si sigue cambiando, se pide reintentar. */
function _leerStockCoherente_(tienda, codigos) {
  for (var intento = 0; intento < 3; intento++) {
    const filas = [];
    _trozos_(codigos, 40).forEach(function (trozo) {
      _selectTodo_('stock_fisico',
        'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=in.(' + trozo.map(encodeURIComponent).join(',') + ')' +
        '&select=id,codigo_lm,sscc,cantidad,sincronizado_en')
        .forEach(function (f) { filas.push(f); });
    });
    const marcas = {};
    filas.forEach(function (f) { marcas[Date.parse(f.sincronizado_en)] = true; });
    if (Object.keys(marcas).length <= 1) return filas;
  }
  throw new Error('El stock se está actualizando en este momento, inténtalo de nuevo en unos segundos.');
}

/** Stock de varios códigos en una tienda, calculado de una vez (pocas
 *  consultas aunque sean muchos códigos): físico (snapshot de stock_fisico,
 *  edificio 05) y lo ya comprometido. Devuelve { codigo: {fisico, comprometido,
 *  disponible} }, disponible = físico − comprometido. Compromete:
 *   - los palets que un refill se lleva ENTEROS: todo lo que lleven, de
 *     cualquier código, deja de estar disponible (también para los códigos que
 *     el refill no pidió);
 *   - las unidades de pedidos y cesiones aún sin preparar (con palet asignado
 *     o no) y las ya preparadas cuyo consumo el snapshot no refleja. */
function _stockDetalleVarios_(tienda, codigos) {
  const lista = [];
  codigos.forEach(function (c) {
    const k = String(c == null ? '' : c).trim();
    if (k && lista.indexOf(k) === -1) lista.push(k);
  });
  const resultado = {};
  lista.forEach(function (k) { resultado[k] = { fisico: 0, comprometido: 0, disponible: 0 }; });
  if (!lista.length) return resultado;

  const filas = _leerStockCoherente_(tienda, lista);
  const desde = _marcaDe_(filas);
  filas.forEach(function (f) {
    const r = resultado[String(f.codigo_lm).trim()];
    if (r) r.fisico += Number(f.cantidad) || 0;
  });

  const enRefill = _paletsDeRefill_(tienda, desde);
  filas.forEach(function (f) {
    const r = resultado[String(f.codigo_lm).trim()];
    if (r && enRefill[f.sscc]) r.comprometido += Number(f.cantidad) || 0;
  });
  _lineasComprometidasPortal_(tienda, lista, desde).forEach(function (l) {
    // Las líneas de refill ya cuentan arriba por palet entero.
    if (l.tipo !== 'refill' && resultado[l.codigo_lm]) resultado[l.codigo_lm].comprometido += l.unidades;
  });
  lista.forEach(function (k) {
    const d = resultado[k];
    d.disponible = Math.max(0, d.fisico - d.comprometido);
  });
  return resultado;
}

/** Stock de un código (ver _stockDetalleVarios_). */
function _stockDetalle_(tienda, codigoLm) {
  const codigo = String(codigoLm == null ? '' : codigoLm).trim();
  return _stockDetalleVarios_(tienda, [codigo])[codigo] || { fisico: 0, comprometido: 0, disponible: 0 };
}

/** De esos palets (SSCC), cuáles NO se pueden dar a un refill porque algo de
 *  ellos está ya reservado: por otro refill, o por unidades de CUALQUIER código
 *  que lleve el palet (un refill se lleva el palet entero, no solo el código
 *  pedido). {sscc: true}. `contenido` = filas de stock_fisico de esos palets
 *  (sscc, codigo_lm, cantidad, sincronizado_en). */
function _paletsOcupados_(tienda, contenido, desde) {
  const ocupados = _paletsDeRefill_(tienda, desde);
  const codigos = [];
  contenido.forEach(function (f) { if (codigos.indexOf(f.codigo_lm) === -1) codigos.push(f.codigo_lm); });
  _lineasComprometidasPortal_(tienda, codigos, desde).forEach(function (l) {
    l.partes.forEach(function (p) { if (p.sscc) ocupados[p.sscc] = true; });
  });
  return ocupados;
}

/** Contenido completo (todas las referencias) de esos palets en el snapshot. */
function _contenidoDePalets_(tienda, ssccs) {
  // SSCC únicos antes de partirlos en trozos: uno repetido en dos trozos
  // añadiría su contenido dos veces.
  const unicos = [];
  ssccs.forEach(function (s) { if (unicos.indexOf(s) === -1) unicos.push(s); });
  // Todas las filas de UN MISMO snapshot (como _leerStockCoherente_): si entre
  // dos lecturas entra una carga de stock, los ids cambian y el mismo palet
  // podría salir dos veces con contenido de snapshots distintos.
  for (var intento = 0; intento < 3; intento++) {
    const filas = [];
    _trozos_(unicos, TROZO_IDS_).forEach(function (trozo) {
      _selectTodo_('stock_fisico',
        'tienda=eq.' + encodeURIComponent(tienda) + '&sscc=in.(' + trozo.map(encodeURIComponent).join(',') + ')' +
        '&select=id,sscc,codigo_lm,cantidad,sincronizado_en')
        .forEach(function (f) { filas.push(f); });
    });
    const marcas = {};
    filas.forEach(function (f) { marcas[Date.parse(f.sincronizado_en)] = true; });
    if (Object.keys(marcas).length <= 1) return filas;
  }
  throw new Error('El stock se está actualizando en este momento, inténtalo de nuevo en unos segundos.');
}

function _marcaDe_(filas) {
  var max = null;
  filas.forEach(function (f) { if (f.sincronizado_en && (!max || Date.parse(f.sincronizado_en) > Date.parse(max))) max = f.sincronizado_en; });
  return max;
}

function _mensajeSinStock_(etiqueta, pedidas, d) {
  if (d.fisico <= 0) return 'No hay stock de ' + etiqueta + ' en almacén.';
  if (d.disponible <= 0) {
    return 'Otras peticiones abiertas ya han agotado el stock de ' + etiqueta + ': hay ' + d.fisico +
      ' en almacén y ' + d.comprometido + ' ya están comprometidas en otros pedidos.';
  }
  return 'Solo quedan ' + d.disponible + ' unidades de ' + etiqueta +
    (d.comprometido > 0 ? ' (otras peticiones abiertas ya tienen comprometidas ' + d.comprometido + ' de las ' + d.fisico + ' que hay en almacén)' : '') +
    ' y pides ' + pedidas + '.';
}

/** Pedido cliente: no se puede pedir más de lo disponible. Se suma por
 *  código (el mismo artículo puede venir en varias líneas). */
function _exigirStockPedidoCliente_(tienda, lineas) {
  const pedido = {};
  lineas.forEach(function (l) {
    const codigo = String(l.codigoLm || '').trim();
    if (!pedido[codigo]) pedido[codigo] = { cantidad: 0, designacion: l.designacion || '' };
    pedido[codigo].cantidad += Number(l.cantidad) || 0;
  });
  const faltan = [];
  const detalle = _stockDetalleVarios_(tienda, Object.keys(pedido));
  Object.keys(pedido).forEach(function (codigo) {
    const d = detalle[codigo] || { fisico: 0, comprometido: 0, disponible: 0 };
    if (pedido[codigo].cantidad > d.disponible) {
      const etiqueta = codigo + (pedido[codigo].designacion ? ' · ' + pedido[codigo].designacion : '');
      faltan.push(_mensajeSinStock_(etiqueta, pedido[codigo].cantidad, d));
    }
  });
  if (faltan.length) throw new Error('No se ha enviado la petición, falta stock:\n' + faltan.join('\n'));
}

/** Buscar un palet directamente por SSCC (Refill) — devuelve todos los LM
 *  que contiene, cada uno con su cantidad y la ubicación del palet, para
 *  elegir cuál de ellos pedir sin pasar por la búsqueda de artículo. */
function buscarPaletPorSscc(ldap, sscc) {
  const tienda = _tiendaDe_(ldap);
  sscc = String(sscc || '').trim();
  if (!sscc) throw new Error('Falta el SSCC.');

  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&sscc=eq.' + encodeURIComponent(sscc) +
    '&select=codigo_lm,ubicacion,cantidad&order=cantidad.desc')
    .filter(function (f) { return f.cantidad > 0; });
  if (!filas.length) return _json_([]);

  const codigos = filas.map(function (f) { return f.codigo_lm; });
  const catalogo = supaSelectIn_('catalogo', 'codigo_lm', codigos, 'select=codigo_lm,ean,designacion,seccion');
  const porCodigo = {};
  catalogo.forEach(function (c) { porCodigo[c.codigo_lm] = c; });

  return _json_(filas.map(function (f) {
    const cat = porCodigo[f.codigo_lm] || {};
    return {
      codigo_lm: f.codigo_lm, designacion: cat.designacion || null, ean: cat.ean || null, seccion: cat.seccion || null,
      ubicacion: f.ubicacion, cantidad: f.cantidad, sscc: sscc,
    };
  }));
}

/** SSCC con stock ahora mismo en edificio 05 para ese código LM, para que
 *  quien pide pueda elegir uno o varios palets concretos en vez de dejar
 *  que el almacén asigne uno solo al preparar. */
function listarSsccDisponibles(ldap, codigoLm) {
  const tienda = _tiendaDe_(ldap);
  const codigo = String(codigoLm || '').trim();
  const todas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigo) +
    '&select=sscc,ubicacion,cantidad,sincronizado_en&order=cantidad.desc')
    .filter(function (f) { return f.cantidad > 0; });
  if (!todas.length) return _json_([]);

  // Contenido completo de cada palet (otras referencias que también lleva),
  // para elegir el que más convenga pedir.
  const otrasFilas = _contenidoDePalets_(tienda, todas.map(function (f) { return f.sscc; }));

  // Un refill se lleva el palet entero: no se ofrecen los que ya tienen algo
  // reservado por otras peticiones (otro refill, o unidades de cualquier
  // referencia del palet en un pedido cliente).
  const ocupados = _paletsOcupados_(tienda, otrasFilas, _marcaDe_(todas));
  const filas = todas.filter(function (f) { return !ocupados[f.sscc]; });
  if (!filas.length) return _json_([]);
  filas.forEach(function (f) { delete f.sincronizado_en; });

  // Designaciones solo de lo que llevan los palets que se van a ofrecer
  // (en trozos: la URL no puede pasar de ~2 KB).
  const codigos = [];
  otrasFilas.forEach(function (f) {
    const ofrecido = filas.some(function (p) { return p.sscc === f.sscc; });
    if (ofrecido && codigos.indexOf(f.codigo_lm) === -1) codigos.push(f.codigo_lm);
  });
  const designacionPorCodigo = {};
  _trozos_(codigos, 40).forEach(function (trozo) {
    supaSelect_('catalogo', 'codigo_lm=in.(' + trozo.map(encodeURIComponent).join(',') + ')&select=codigo_lm,designacion')
      .forEach(function (c) { designacionPorCodigo[c.codigo_lm] = c.designacion; });
  });

  filas.forEach(function (f) {
    f.contenido = otrasFilas
      .filter(function (o) { return o.sscc === f.sscc && Number(o.cantidad) > 0; })
      .map(function (o) {
        return { codigo_lm: o.codigo_lm, designacion: designacionPorCodigo[o.codigo_lm] || null, cantidad: o.cantidad };
      });
  });

  return _json_(filas);
}

/** Peticiones abiertas (no cerradas) de la misma tienda que ya llevan ese
 *  código LM — aviso de posible duplicado, no bloqueante. */
function verificarAntesDeAnadir(ldap, codigoLm, cantidad) {
  const tienda = _tiendaDe_(ldap);
  const stock = _stockDetalle_(tienda, codigoLm);

  const abiertas = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) + '&estado=in.(pendiente,en_preparacion,a_ubicar)&select=id,tipo,creada_en');
  var duplicados = [];
  if (abiertas.length) {
    const lineasAbiertas = supaSelectIn_('lineas', 'peticion_id', abiertas.map(function (p) { return p.id; }),
      'codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=peticion_id');
    const idsConLinea = lineasAbiertas.map(function (l) { return l.peticion_id; });
    duplicados = abiertas.filter(function (p) { return idsConLinea.indexOf(p.id) !== -1; });
  }

  return _json_({
    disponible: stock.disponible,
    fisico: stock.fisico,
    comprometido: stock.comprometido,
    duplicados: duplicados.map(function (p) { return { tipo: p.tipo, fecha: p.creada_en }; }),
  });
}

/** Refill con palets elegidos a mano (listarSsccDisponibles): ninguno puede
 *  estar ya reservado por otra petición — mismo palet en dos refill, o un
 *  palet con unidades de un pedido cliente. Se comprueba también aquí (no
 *  solo al listar) porque pudo reservarse entre medias. */
function _exigirPaletsLibres_(tienda, lineas) {
  const elegidos = [];
  const repetidos = [];
  lineas.forEach(function (l) {
    _partesSscc_(l.sscc, 0).forEach(function (p) {
      if (!p.sscc) return;
      if (elegidos.indexOf(p.sscc) === -1) elegidos.push(p.sscc);
      else if (repetidos.indexOf(p.sscc) === -1) repetidos.push(p.sscc);
    });
  });
  if (repetidos.length) {
    throw new Error('No se ha enviado el refill: el palet ' + repetidos.join(', ') + ' está repetido en la petición. Quita la línea duplicada.');
  }
  if (!elegidos.length) return;

  const contenido = _contenidoDePalets_(tienda, elegidos);
  const marca = _marcaDe_(contenido);
  const faltan = elegidos.filter(function (s) { return !contenido.some(function (f) { return f.sscc === s; }); });
  if (faltan.length) {
    throw new Error('No se ha enviado el refill: el palet ' + faltan.join(', ') + ' ya no está en el almacén. Elige otro palet.');
  }

  // 1) Que ningún palet tenga ya algo reservado (otro refill, o unidades de
  //    cualquier referencia suya en un pedido cliente con palet asignado).
  const ocupados = _paletsOcupados_(tienda, contenido, marca);
  const reservados = elegidos.filter(function (s) { return ocupados[s]; });
  if (reservados.length) {
    throw new Error('No se ha enviado el refill: ya hay otra petición con unidades de estos palets: ' +
      reservados.join(', ') + '. Elige otro palet.');
  }

  // 2) Que llevárselos no deje sin stock a pedidos ya aceptados que aún no
  //    tienen palet asignado: por cada referencia, lo que hay disponible tiene
  //    que cubrir lo que se llevan los palets elegidos (se asigna al abrir el
  //    pedido en almacén, así que el paso 1 no lo ve).
  const seLlevan = {};
  contenido.forEach(function (f) {
    const k = String(f.codigo_lm).trim();
    seLlevan[k] = (seLlevan[k] || 0) + (Number(f.cantidad) || 0);
  });
  const sinCubrir = [];
  const detalle = _stockDetalleVarios_(tienda, Object.keys(seLlevan));
  Object.keys(seLlevan).forEach(function (codigo) {
    const d = detalle[codigo] || { disponible: 0 };
    if (d.disponible < seLlevan[codigo]) {
      sinCubrir.push(codigo + ' (los palets llevan ' + seLlevan[codigo] + ' y solo hay ' + d.disponible + ' sin comprometer)');
    }
  });
  if (sinCubrir.length) {
    throw new Error('No se ha enviado el refill: llevarse esos palets dejaría sin stock a otros pedidos ya aceptados: ' +
      sinCubrir.join('; ') + '.');
  }
}

/** Pedido cliente comprueba stock y refill comprueba que sus palets sigan
 *  libres al enviar: se serializa con un lock para que dos peticiones
 *  simultáneas no reserven las mismas últimas unidades / el mismo palet. */
function crearPeticion(ldap, tipo, datos, lineas) {
  if (tipo !== 'pedido_cliente' && tipo !== 'refill') return _crearPeticion_(ldap, tipo, datos, lineas);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado, inténtalo de nuevo en unos segundos.'); }
  try { return _crearPeticion_(ldap, tipo, datos, lineas); } finally { lock.releaseLock(); }
}

/** Bloqueo de doble envío accidental (bug real 2026-09-28: un pedido_cliente
 *  enviado dos veces por doble clic, misma mercancía, 6s de diferencia).
 *  Ventana corta a propósito: solo bloquea lo que es casi con toda
 *  seguridad un reenvío accidental, nunca un pedido legítimo repetido más
 *  tarde en el día. */
var VENTANA_DUPLICADO_MS_ = 30000;

function _bloquearSiDuplicadoReciente_(tienda, ldap, tipo, cabecera, lineasPayload) {
  const desde = new Date(Date.now() - VENTANA_DUPLICADO_MS_).toISOString();
  const recientes = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) +
    '&solicitante_ldap=eq.' + encodeURIComponent(ldap) +
    '&tipo=eq.' + encodeURIComponent(tipo) +
    '&creada_en=gte.' + encodeURIComponent(desde) +
    '&select=id,num_pedido,num_cesion');
  if (!recientes.length) return;

  if (tipo === 'pedido_cliente' && cabecera.num_pedido) {
    if (recientes.some(function (p) { return p.num_pedido === cabecera.num_pedido; })) {
      throw new Error('Ya has enviado este mismo pedido (' + cabecera.num_pedido + ') hace unos segundos — revisa "Mis peticiones" antes de repetirlo.');
    }
    return;
  }
  if (tipo === 'cesion' && cabecera.num_cesion) {
    if (recientes.some(function (p) { return p.num_cesion === cabecera.num_cesion; })) {
      throw new Error('Ya has enviado esta misma cesión (' + cabecera.num_cesion + ') hace unos segundos — revisa "Mis peticiones" antes de repetirla.');
    }
    return;
  }
  if (tipo === 'refill') {
    const codigosNuevos = lineasPayload.map(function (l) { return l.codigo_lm; }).sort().join(',');
    const lineasRecientes = supaSelectIn_('lineas', 'peticion_id', recientes.map(function (p) { return p.id; }), 'select=peticion_id,codigo_lm');
    const porPeticion = {};
    lineasRecientes.forEach(function (l) { (porPeticion[l.peticion_id] = porPeticion[l.peticion_id] || []).push(l.codigo_lm); });
    const hayDuplicado = Object.keys(porPeticion).some(function (id) { return porPeticion[id].sort().join(',') === codigosNuevos; });
    if (hayDuplicado) {
      throw new Error('Ya has pedido este mismo refill hace unos segundos — revisa "Mis peticiones" antes de repetirlo.');
    }
  }
}

function _crearPeticion_(ldap, tipo, datos, lineas) {
  const u = _usuarioDe_(ldap);
  const tienda = u.tienda;
  if (['pedido_cliente', 'cesion', 'refill'].indexOf(tipo) === -1) {
    throw new Error('Tipo de petición no válido.');
  }
  if (u.rol === 'vendedor' && tipo !== 'refill') {
    throw new Error('Tu rol (Vendedor) solo puede crear peticiones de Refill.');
  }
  // Refill se puede apagar desde Master (Ajustes.js) — este es el bloqueo
  // real, el botón oculto/deshabilitado en Portal.html es solo UX.
  if (tipo === 'refill' && !_refillHabilitado_()) {
    throw new Error('Refill está desactivado temporalmente.');
  }
  if (!lineas || !lineas.length) throw new Error('Añade al menos una línea.');
  // Pedido cliente: sin stock suficiente NO se puede enviar (se re-comprueba
  // aquí aunque ya se avisara al añadir el artículo — el stock pudo agotarse
  // entretanto). Cesión y refill solo avisan al añadir, no bloquean.
  if (tipo === 'pedido_cliente') _exigirStockPedidoCliente_(tienda, lineas);
  if (tipo === 'refill') _exigirPaletsLibres_(tienda, lineas);

  const cabecera = {
    tipo: tipo,
    tienda_origen: tienda,
    solicitante_ldap: ldap,
    comentario: (datos && datos.comentario) || null,
  };

  if (tipo === 'pedido_cliente') {
    if (!datos.numPedido) throw new Error('Falta el número de pedido.');
    if (typeof datos.transporte !== 'boolean') throw new Error('Falta indicar transporte.');
    cabecera.num_pedido = String(datos.numPedido).trim();
    cabecera.transporte = datos.transporte;
  } else if (tipo === 'cesion') {
    if (!datos.tiendaDestino) throw new Error('Falta la tienda destino.');
    if (!datos.numCesion) throw new Error('Falta el número de cesión.');
    cabecera.tienda_destino = datos.tiendaDestino;
    cabecera.num_cesion = String(datos.numCesion).trim();
  } else {
    if (!datos.motivo) throw new Error('Falta el motivo del refill.');
    cabecera.motivo = String(datos.motivo).trim();
    if (datos.fechaEntrega) {
      const fecha = _validarFechaEntrega_(datos.fechaEntrega, _hoyMadridIso_());
      cabecera.fecha_entrega = fecha;
      cabecera.visible_desde = _ultimoLaborableAnterior_(fecha);
    }
  }

  // Asignación automática individual/equipo por peso — solo pedido_cliente
  // (ver Peso.js). Si algo falla leyendo el CSV de pesos, no debe bloquear
  // la creación de la petición: se queda con el default de la tabla.
  if (tipo === 'pedido_cliente') {
    try {
      const codigos = lineas.map(function (l) { return l.codigoLm; });
      cabecera.cola_individual = _calcularColaIndividualPorPeso_(tienda, codigos);
    } catch (err) {
      console.error('_calcularColaIndividualPorPeso_: ' + err.message);
    }
  }

  // Validar TODAS las líneas antes de crear nada — si una línea viene
  // incompleta no debe quedar una cabecera huérfana sin líneas (bug real,
  // revisión con Codex CLI 2026-09-22: antes se insertaba la cabecera y
  // LUEGO se validaba, así que una línea mala dejaba una petición fantasma,
  // pendiente para siempre, sin nada que preparar).
  const unidadMedida = tipo === 'refill' ? 'palet' : 'ud';
  const lineasPayload = lineas.map(function (l) {
    if (!l.codigoLm || !l.cantidad) throw new Error('Línea incompleta.');
    const payload = {
      codigo_lm: String(l.codigoLm).trim(),
      cantidad: Number(l.cantidad),
      unidad_medida: unidadMedida,
      ean: l.ean || null,
      designacion: l.designacion || null,
      seccion: l.seccion || null,
    };
    // Palet(es) elegidos a mano por quien pide (ver listarSsccDisponibles) —
    // si no eligió ninguno, se queda sin sscc y el almacén lo asigna solo
    // al preparar (asignarSsccSiFalta_ en kairos-operario).
    if (l.sscc) {
      payload.sscc = l.sscc;
      payload.ubicacion = l.ubicacion || null;
      payload.sscc_asignado_en = new Date().toISOString();
    }
    return payload;
  });

  _bloquearSiDuplicadoReciente_(tienda, ldap, tipo, cabecera, lineasPayload);

  const peticion = supaInsert_('peticiones', cabecera);
  try {
    supaInsertMany_('lineas', lineasPayload.map(function (l) { return Object.assign({ peticion_id: peticion.id }, l); }));
  } catch (err) {
    // Sin transacción real entre dos llamadas REST: si fallan las líneas,
    // se borra la cabecera para no dejarla huérfana en 'pendiente' para
    // siempre.
    try { supaDelete_('peticiones', 'id=eq.' + encodeURIComponent(peticion.id)); } catch (err2) { /* mejor esfuerzo */ }
    throw err;
  }

  return _json_({ ok: true, id: peticion.id });
}

function listarMisPeticiones(ldap) {
  const u = _usuarioDe_(ldap);
  // Peticiones por preparar o en preparación. Una ya preparada que solo espera
  // ubicación de consolidación en plataforma (a_ubicar) no es una petición
  // pendiente de la tienda: se sigue en Trazabilidad.
  var q = 'tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&estado=not.in.(cerrada,anulada,a_ubicar)' +
    '&select=id,tipo,num_pedido,num_cesion,tienda_destino,estado,creada_en,solicitante_ldap,fecha_entrega,visible_desde' +
    '&order=creada_en.desc&limit=200';
  if (u.rol === 'vendedor') q += '&tipo=eq.refill'; // Vendedor solo ve Refill
  const filas = supaSelect_('peticiones', q);
  const hoy = _hoyMadridIso_();
  filas.forEach(function (p) {
    p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado;
    _marcarReserva_(p, hoy);
  });
  if (filas.length) {
    const lineas = supaSelectIn_('lineas', 'peticion_id', filas.map(function (p) { return p.id; }), 'select=peticion_id,codigo_lm,designacion');
    filas.forEach(function (p) {
      const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
      p.articulo = propias.length === 1 ? (propias[0].codigo_lm + ' — ' + (propias[0].designacion || '')) : (propias.length + ' artículos');
    });
  }
  return _json_(filas);
}

function obtenerDetallePeticion(ldap, peticionId) {
  const tienda = _tiendaDe_(ldap);

  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(tienda));
  if (!cab.length) throw new Error('Petición no encontrada.');
  const peticion = cab[0];
  peticion.estadoTexto = TRADUCCION_ESTADO[peticion.estado] || peticion.estado;
  _marcarReserva_(peticion, _hoyMadridIso_());

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  // Una petición cerrada con incidencias no es una "Completada" a secas.
  const conIncidencia = lineas.some(function (l) { return ESTADOS_INCIDENCIA_PORTAL_.indexOf(l.estado_negocio) !== -1; });
  if (conIncidencia && peticion.estado === 'cerrada') peticion.estadoTexto = 'Cerrada con incidencia';

  var hodosTexto = null;
  const generaEtiqueta = (peticion.tipo === 'pedido_cliente' && !peticion.transporte) || peticion.tipo === 'cesion';
  if (generaEtiqueta) {
    const totalLineas = lineas.length;
    const preparadas = lineas.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    const conHodosId = lineas.filter(function (l) { return l.hodos_id; });
    if (!conHodosId.length) {
      hodosTexto = (peticion.en_curso_por && preparadas < totalLineas) ? 'Preparando'
        : (totalLineas && preparadas === totalLineas) ? 'Preparado'
        : 'Pedido';
    } else {
      const idUnico = conHodosId[0].hodos_id;
      const etiquetas = supaSelect_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico) + '&select=batea_id', CFG.SCHEMA_HODOS);
      const batea = etiquetas.length ? etiquetas[0].batea_id : null;
      if (batea) {
        const cargas = supaSelect_('cargas', 'id_carga=eq.' + encodeURIComponent(batea) + '&select=fecha_entrega,horario', CFG.SCHEMA_HODOS);
        const carga = cargas[0];
        hodosTexto = 'Cargado' + (carga && carga.fecha_entrega ? ' · entrega ' + carga.fecha_entrega + (carga.horario ? ' ' + carga.horario : '') : '');
      } else {
        hodosTexto = 'Preparado';
      }
    }
  } else if (peticion.tipo === 'pedido_cliente' && peticion.transporte && peticion.ubicacion_consolidacion) {
    hodosTexto = 'Consolidado: ' + peticion.ubicacion_consolidacion;
  }

  return _json_({ peticion: peticion, lineas: lineas, hodosTexto: hodosTexto });
}
