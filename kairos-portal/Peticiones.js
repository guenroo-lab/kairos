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
// Cuánto hacia atrás desde la marca del snapshot se miran líneas ya preparadas
// de pedidos que aún no se habían completado (acota la consulta).
const VENTANA_CONSUMO_MS_ = 7 * 24 * 60 * 60 * 1000;

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

/** ¿Sigue el consumo de esta línea ya preparada SIN reflejarse en el
 *  snapshot de stock (marca `desde`)? Espejo de _consumoSinReflejar_ de
 *  kairos-operario/StockAsignacion.js — ahí está explicado: en refill el stock
 *  se mueve al preparar cada línea; en pedido cliente / cesión solo cuando el
 *  pedido entero está preparado, así que hasta entonces el CSV sigue contando
 *  las unidades aunque la línea se preparase antes del snapshot. */
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

/** Unidades que sigue ocupando una línea ya preparada (0 si no se cogió nada). */
function _unidadesDeLineaPreparada_(l, tipo) {
  if (FALTANTES_TOTALES_STOCK_.indexOf(l.estado_negocio) !== -1) return 0;
  // Refill: se cuentan los palets elegidos enteros, también en Parcial (no se
  // sabe cuáles se confirmaron; el siguiente snapshot lo corrige).
  if (tipo === 'refill') return _unidadesDeLinea_(l, 'refill');
  if (l.estado_negocio === 'Parcial') return Number(l.cantidad_preparada) || 0;
  return Number(l.cantidad) || 0;
}

/** Líneas de esa tienda y código que el snapshot de stock_fisico (marca
 *  `desde`) todavía cuenta como disponibles:
 *   - las aún sin preparar de peticiones no anuladas, tengan palet o no;
 *   - las ya preparadas cuyo consumo el snapshot no refleja (_consumoSinReflejar_),
 *     también las de peticiones anuladas después de preparar (lo cogido ya
 *     salió de su palet aunque se anule el resto).
 *  Devuelve [{ id, unidades, partes: [{sscc, cantidad}] }] sin repetir líneas. */
function _lineasComprometidasPortal_(tienda, codigo, desde) {
  const comunes = 'codigo_lm=eq.' + encodeURIComponent(codigo) +
    '&select=id,peticion_id,sscc,cantidad,cantidad_preparada,estado_negocio,preparada_en,peticiones!inner(tipo,estado,cerrada_en)' +
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
    resultado.push({ id: l.id, unidades: _unidadesDeLinea_(l, l.peticiones && l.peticiones.tipo), partes: _partesSscc_(l.sscc, l.cantidad) });
  });
  preparadas.forEach(function (l) {
    if (vistas[l.id]) return;
    if (!_consumoSinReflejar_(l, desde, finPorPeticion)) return;
    const unidades = _unidadesDeLineaPreparada_(l, l.peticiones && l.peticiones.tipo);
    if (unidades <= 0) return;
    vistas[l.id] = true;
    resultado.push({ id: l.id, unidades: unidades, partes: _partesSscc_(l.sscc, l.cantidad) });
  });
  return resultado;
}

/** Stock de un código en una tienda: físico (snapshot de stock_fisico,
 *  edificio 05) y lo ya comprometido por peticiones no anuladas — las aún
 *  sin preparar, y las preparadas cuyo consumo el snapshot todavía no
 *  refleja. disponible = físico − comprometido. */
function _stockDetalle_(tienda, codigoLm) {
  const codigo = String(codigoLm || '').trim();
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigo) + '&select=cantidad,sincronizado_en');
  var fisico = 0, desde = null;
  filas.forEach(function (f) {
    fisico += Number(f.cantidad) || 0;
    if (!desde || Date.parse(f.sincronizado_en) > Date.parse(desde)) desde = f.sincronizado_en;
  });

  var comprometido = 0;
  _lineasComprometidasPortal_(tienda, codigo, desde).forEach(function (l) { comprometido += l.unidades; });
  return { fisico: fisico, comprometido: comprometido, disponible: Math.max(0, fisico - comprometido) };
}

/** Palets (SSCC) de ese código con unidades ya reservadas por otras
 *  peticiones — un refill se lleva el palet entero, así que no se pueden
 *  elegir. {sscc: true}. */
function _ssccReservados_(tienda, codigo, desde) {
  const reservados = {};
  _lineasComprometidasPortal_(tienda, codigo, desde).forEach(function (l) {
    l.partes.forEach(function (p) { if (p.sscc) reservados[p.sscc] = true; });
  });
  return reservados;
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
  Object.keys(pedido).forEach(function (codigo) {
    const d = _stockDetalle_(tienda, codigo);
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
  const catalogo = supaSelect_('catalogo', 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')&select=codigo_lm,ean,designacion,seccion');
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

  // Un refill se lleva el palet entero: no se ofrecen los que ya tienen
  // unidades reservadas por otras peticiones (otro refill, un pedido cliente).
  var desde = null;
  todas.forEach(function (f) { if (!desde || Date.parse(f.sincronizado_en) > Date.parse(desde)) desde = f.sincronizado_en; });
  const reservados = _ssccReservados_(tienda, codigo, desde);
  const filas = todas.filter(function (f) { return !reservados[f.sscc]; });
  if (!filas.length) return _json_([]);
  filas.forEach(function (f) { delete f.sincronizado_en; });

  // Contenido completo de cada palet (otras referencias que también lleva),
  // para elegir el que más convenga pedir.
  const sscc = filas.map(function (f) { return f.sscc; });
  const otrasFilas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&sscc=in.(' + sscc.map(encodeURIComponent).join(',') + ')' +
    '&select=sscc,codigo_lm,cantidad');

  const codigos = [];
  otrasFilas.forEach(function (f) { if (codigos.indexOf(f.codigo_lm) === -1) codigos.push(f.codigo_lm); });
  const catalogo = codigos.length
    ? supaSelect_('catalogo', 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')&select=codigo_lm,designacion')
    : [];
  const designacionPorCodigo = {};
  catalogo.forEach(function (c) { designacionPorCodigo[c.codigo_lm] = c.designacion; });

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
    const ids = abiertas.map(function (p) { return p.id; }).join(',');
    const lineasAbiertas = supaSelect_('lineas',
      'peticion_id=in.(' + ids + ')&codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=peticion_id');
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
  const ocupados = [];
  lineas.forEach(function (l) {
    if (!l.sscc) return;
    const codigo = String(l.codigoLm || '').trim();
    const marca = supaSelect_('stock_fisico',
      'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigo) +
      '&select=sincronizado_en&order=sincronizado_en.desc&limit=1');
    const reservados = _ssccReservados_(tienda, codigo, marca.length ? marca[0].sincronizado_en : null);
    _partesSscc_(l.sscc, 0).forEach(function (p) {
      if (p.sscc && reservados[p.sscc]) ocupados.push(p.sscc + ' (' + codigo + ')');
    });
  });
  if (ocupados.length) {
    throw new Error('No se ha enviado el refill: ya hay otra petición con unidades de estos palets: ' +
      ocupados.join(', ') + '. Elige otro palet.');
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
    const lineasRecientes = supaSelect_('lineas',
      'peticion_id=in.(' + recientes.map(function (p) { return p.id; }).map(encodeURIComponent).join(',') + ')&select=peticion_id,codigo_lm');
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
  var q = 'tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&estado=not.in.(cerrada,anulada)' +
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
    const ids = filas.map(function (p) { return p.id; }).join(',');
    const lineas = supaSelect_('lineas', 'peticion_id=in.(' + ids + ')&select=peticion_id,codigo_lm,designacion');
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
