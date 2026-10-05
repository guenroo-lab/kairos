/** Modificar una petición ya enviada (Logística, Coordinación y Master).
 *
 *  Qué se puede cambiar, mientras la petición esté pendiente o en preparación:
 *   - cabecera: nº de pedido y transporte (pedido cliente), nº de cesión y
 *     tienda destino (cesión), motivo (refill) y comentario (todas);
 *   - líneas SIN preparar: cantidad, quitar, y añadir artículos (pedido
 *     cliente y cesión; en refill los palets se eligen al pedirlo).
 *  Lo ya preparado no se toca nunca.
 *
 *  Dos protecciones de stock:
 *   - pedido cliente: subir una cantidad o añadir un artículo exige stock sin
 *     comprometer (mismo criterio que al crear el pedido);
 *   - un operario con el pedido abierto tiene en pantalla las cantidades y los
 *     palets de antes, y la transferencia de stock en myISO se calcula desde
 *     esa pantalla. Por eso los cambios de líneas se rechazan mientras un
 *     operario lo haya abierto hace menos de MINUTOS_OPERARIO_ACTIVO_.
 *
 *  Cada cambio queda en peticiones.historial_cambios (migración 035) y en
 *  modificada_en/por: el operario lo ve marcado en la cola y en el detalle. */

const ROLES_EDITAN_ = ['logistico', 'gestor', 'master'];
const ESTADOS_EDITABLES_ = ['pendiente', 'en_preparacion'];
const MINUTOS_OPERARIO_ACTIVO_ = 10;
// Destinos válidos de una cesión: las dos tiendas + Málaga (plataforma).
const DESTINOS_CESION_ = ['014', '279', '036'];
const NOMBRE_TIENDA_EDICION_ = { '014': 'Marbella', '279': 'Mijas', '036': 'Málaga' };
const MAX_LINEAS_ANADIR_ = 30;
const MAX_CANTIDAD_EDICION_ = 100000;
const MAX_HISTORIAL_ = 30;
const CAMPOS_CABECERA_POR_TIPO_ = {
  pedido_cliente: ['numPedido', 'transporte', 'comentario'],
  cesion: ['numCesion', 'tiendaDestino', 'comentario'],
  refill: ['motivo', 'comentario'],
};

/** cambios = {
 *    cabecera: { numPedido?, transporte?, numCesion?, tiendaDestino?, motivo?, comentario? },  // solo lo que cambia o todo: lo igual se ignora
 *    lineas:   [{ id, cantidad }],                       // líneas sin preparar
 *    quitar:   [lineaId],
 *    anadir:   [{ codigoLm, cantidad }]                  // pedido cliente / cesión
 *  } */
function modificarPeticion(ldap, peticionId, cambios) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado, inténtalo de nuevo en unos segundos.'); }
  try { return _modificarPeticion_(ldap, peticionId, cambios); } finally { lock.releaseLock(); }
}

function _cantidadEntera_(valor, etiqueta) {
  const n = Number(valor);
  if (!isFinite(n) || n <= 0 || Math.floor(n) !== n || n > MAX_CANTIDAD_EDICION_) {
    throw new Error('La cantidad' + (etiqueta ? ' de ' + etiqueta : '') + ' debe ser un número entero mayor que 0.');
  }
  return n;
}

function _etiquetaLinea_(l) {
  return l.codigo_lm + (l.designacion ? ' (' + l.designacion + ')' : '');
}

function _textoSiNo_(v) { return v ? 'Sí' : 'No'; }

/** Valida lo que llega y calcula, sin escribir nada, qué cambiaría. Devuelve
 *  { cabCambios, descripcionCabecera, cantidades, quitadas, anadidas }. */
function _planificarEdicion_(u, cab, lineas, cambios) {
  const camb = cambios.cabecera || {};
  const permitidos = CAMPOS_CABECERA_POR_TIPO_[cab.tipo] || [];
  Object.keys(camb).forEach(function (k) {
    if (permitidos.indexOf(k) === -1) throw new Error('El campo "' + k + '" no se puede modificar en esta petición.');
  });

  const hayEtiquetaHodos = lineas.some(function (l) { return !!l.hodos_id; });
  const hayPreparadas = lineas.some(function (l) { return l.estado_preparacion === 'preparado'; });
  const cabCambios = {};
  const descripcionCabecera = [];
  function texto(v) { return String(v == null ? '' : v).trim(); }
  function exigirSinEtiqueta(que) {
    if (hayEtiquetaHodos) throw new Error('Esta petición ya tiene etiqueta HODOS: no se puede cambiar ' + que + '.');
  }

  if (camb.numPedido !== undefined) {
    const n = texto(camb.numPedido);
    if (!n) throw new Error('Falta el número de pedido.');
    if (n !== texto(cab.num_pedido)) {
      exigirSinEtiqueta('el número de pedido');
      cabCambios.num_pedido = n;
      descripcionCabecera.push('Nº de pedido: ' + texto(cab.num_pedido) + ' → ' + n);
    }
  }
  if (camb.transporte !== undefined) {
    if (typeof camb.transporte !== 'boolean') throw new Error('Transporte no válido.');
    if (camb.transporte !== !!cab.transporte) {
      exigirSinEtiqueta('el transporte');
      if (hayPreparadas) throw new Error('Ya hay líneas preparadas: no se puede cambiar el transporte.');
      cabCambios.transporte = camb.transporte;
      descripcionCabecera.push('Transporte: ' + _textoSiNo_(!!cab.transporte) + ' → ' + _textoSiNo_(camb.transporte));
    }
  }
  if (camb.numCesion !== undefined) {
    const n = texto(camb.numCesion);
    if (!n) throw new Error('Falta el número de cesión.');
    if (n !== texto(cab.num_cesion)) {
      exigirSinEtiqueta('el número de cesión');
      cabCambios.num_cesion = n;
      descripcionCabecera.push('Nº de cesión: ' + texto(cab.num_cesion) + ' → ' + n);
    }
  }
  if (camb.tiendaDestino !== undefined) {
    const d = texto(camb.tiendaDestino);
    if (DESTINOS_CESION_.indexOf(d) === -1 || d === cab.tienda_origen) throw new Error('Tienda destino no válida.');
    if (d !== cab.tienda_destino) {
      exigirSinEtiqueta('la tienda destino');
      cabCambios.tienda_destino = d;
      descripcionCabecera.push('Destino: ' + (NOMBRE_TIENDA_EDICION_[cab.tienda_destino] || cab.tienda_destino) + ' → ' + NOMBRE_TIENDA_EDICION_[d]);
    }
  }
  if (camb.motivo !== undefined) {
    const m = texto(camb.motivo);
    if (!m) throw new Error('Falta el motivo del refill.');
    if (m !== texto(cab.motivo)) {
      cabCambios.motivo = m;
      descripcionCabecera.push('Motivo: ' + texto(cab.motivo) + ' → ' + m);
    }
  }
  if (camb.comentario !== undefined) {
    const c = texto(camb.comentario);
    if (c.length > 500) throw new Error('El comentario es demasiado largo (máximo 500 caracteres).');
    if (c !== texto(cab.comentario)) {
      cabCambios.comentario = c || null;
      descripcionCabecera.push(c ? 'Comentario modificado' : 'Comentario eliminado');
    }
  }

  // ——— Líneas ———
  const porId = {};
  lineas.forEach(function (l) { porId[l.id] = l; });
  const tocadas = {};
  function lineaSinPreparar(id, accion) {
    const l = porId[String(id)];
    if (!l) throw new Error('Una de las líneas ya no existe en la petición. Vuelve a abrirla.');
    if (l.estado_preparacion === 'preparado') {
      throw new Error('La línea ' + l.codigo_lm + ' ya está preparada: no se puede ' + accion + '.');
    }
    if (tocadas[l.id]) throw new Error('La línea ' + l.codigo_lm + ' aparece dos veces en los cambios.');
    tocadas[l.id] = true;
    return l;
  }

  const cantidades = []; // { linea, nueva }
  (cambios.lineas || []).forEach(function (x) {
    const l = lineaSinPreparar(x && x.id, 'cambiar');
    const nueva = _cantidadEntera_(x.cantidad, l.codigo_lm);
    if (nueva === Number(l.cantidad)) return;
    if (cab.tipo === 'refill' && l.sscc) {
      throw new Error('En un refill los palets se eligen al pedirlo: no se puede cambiar la cantidad de ' + l.codigo_lm +
        '. Quita la línea o anula la petición y vuelve a pedirla.');
    }
    cantidades.push({ linea: l, nueva: nueva });
  });

  const quitadas = [];
  (cambios.quitar || []).forEach(function (id) { quitadas.push(lineaSinPreparar(id, 'quitar')); });

  const anadirPedido = cambios.anadir || [];
  if (anadirPedido.length && cab.tipo === 'refill') {
    throw new Error('En un refill no se pueden añadir artículos desde aquí: los palets se eligen al pedirlo.');
  }
  if (anadirPedido.length > MAX_LINEAS_ANADIR_) throw new Error('Demasiados artículos nuevos de una vez (máximo ' + MAX_LINEAS_ANADIR_ + ').');
  const codigosNuevos = [];
  anadirPedido.forEach(function (a) {
    const codigo = texto(a && a.codigoLm);
    if (!codigo) throw new Error('Falta el código LM de un artículo nuevo.');
    if (codigosNuevos.indexOf(codigo) === -1) codigosNuevos.push(codigo);
  });
  const catalogo = {};
  if (codigosNuevos.length) {
    supaSelectIn_('catalogo', 'codigo_lm', codigosNuevos, 'select=codigo_lm,ean,designacion,seccion')
      .forEach(function (c) { catalogo[c.codigo_lm] = c; });
  }
  const anadidas = anadirPedido.map(function (a) {
    const codigo = texto(a.codigoLm);
    const cat = catalogo[codigo];
    if (!cat) throw new Error('El artículo ' + codigo + ' no está en el catálogo.');
    return {
      codigo_lm: codigo, cantidad: _cantidadEntera_(a.cantidad, codigo),
      ean: cat.ean || null, designacion: cat.designacion || null, seccion: cat.seccion || null,
    };
  });

  if (quitadas.length) {
    const quedan = lineas.filter(function (l) { return l.estado_preparacion !== 'preparado'; }).length - quitadas.length + anadidas.length;
    if (quedan < 1) throw new Error('La petición tiene que conservar al menos una línea sin preparar. Si ya no hace falta, anúlala.');
  }
  return { cabCambios: cabCambios, descripcionCabecera: descripcionCabecera, cantidades: cantidades, quitadas: quitadas, anadidas: anadidas };
}

/** Pedido cliente: lo que sube (cantidades mayores + artículos añadidos) tiene
 *  que caber en el stock sin comprometer. `disponible` ya descuenta las
 *  unidades actuales de este mismo pedido, así que se compara solo lo extra. */
function _exigirStockExtra_(tienda, plan) {
  const extra = {};
  const designacion = {};
  plan.cantidades.forEach(function (c) {
    const d = c.nueva - Number(c.linea.cantidad);
    if (d > 0) { extra[c.linea.codigo_lm] = (extra[c.linea.codigo_lm] || 0) + d; designacion[c.linea.codigo_lm] = c.linea.designacion; }
  });
  plan.anadidas.forEach(function (a) {
    extra[a.codigo_lm] = (extra[a.codigo_lm] || 0) + a.cantidad;
    designacion[a.codigo_lm] = a.designacion;
  });
  const codigos = Object.keys(extra);
  if (!codigos.length) return;
  const detalle = _stockDetalleVarios_(tienda, codigos);
  const faltan = [];
  codigos.forEach(function (codigo) {
    const d = detalle[codigo] || { fisico: 0, comprometido: 0, disponible: 0 };
    if (extra[codigo] > d.disponible) {
      faltan.push(codigo + (designacion[codigo] ? ' · ' + designacion[codigo] : '') + ': quieres ' + extra[codigo] + ' unidades más y ' +
        (d.disponible <= 0 ? 'no queda stock sin comprometer' : 'solo quedan ' + d.disponible + ' sin comprometer') +
        ' (' + d.fisico + ' en almacén, ' + d.comprometido + ' ya comprometidas en otros pedidos).');
    }
  });
  if (faltan.length) throw new Error('No se han guardado los cambios, falta stock:\n' + faltan.join('\n'));
}

function _modificarPeticion_(ldap, peticionId, cambios) {
  const u = _usuarioDe_(ldap);
  if (ROLES_EDITAN_.indexOf(u.rol) === -1) throw new Error('Solo Logística o Coordinación pueden modificar peticiones.');
  cambios = cambios || {};

  const cabs = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) + '&select=*');
  if (!cabs.length) throw new Error('Petición no encontrada.');
  const cab = cabs[0];
  if (!('historial_cambios' in cab)) throw new Error('Falta aplicar la migración 035 (historial de cambios) en la base de datos.');
  if (ESTADOS_EDITABLES_.indexOf(cab.estado) === -1) {
    throw new Error('Esta petición ya no se puede modificar (' + (TRADUCCION_ESTADO[cab.estado] || cab.estado) + ').');
  }
  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  const plan = _planificarEdicion_(u, cab, lineas, cambios);
  const hayCambiosDeLineas = plan.cantidades.length + plan.quitadas.length + plan.anadidas.length > 0;
  if (!hayCambiosDeLineas && !plan.descripcionCabecera.length) throw new Error('No hay ningún cambio que guardar.');

  if (hayCambiosDeLineas && cab.en_curso_por && cab.en_curso_desde) {
    const minutos = (Date.now() - Date.parse(cab.en_curso_desde)) / 60000;
    if (minutos < MINUTOS_OPERARIO_ACTIVO_) {
      throw new Error(cab.en_curso_por + ' tiene este pedido abierto en almacén (hace ' + Math.max(1, Math.round(minutos)) + ' min). ' +
        'Para no descuadrar el stock, espera a que lo cierre o pídele que salga del pedido, y vuelve a intentarlo.');
    }
  }
  if (cab.tipo === 'pedido_cliente') _exigirStockExtra_(u.tienda, plan);

  // ——— Aplicar: primero lo que añade, luego cambios, al final lo que quita (así
  // la petición nunca se queda sin líneas sin preparar a medio guardar). ———
  const aplicados = [];
  var errorAplicando = null;
  try {
    if (plan.anadidas.length) {
      supaInsertMany_('lineas', plan.anadidas.map(function (a) {
        return {
          peticion_id: cab.id, codigo_lm: a.codigo_lm, cantidad: a.cantidad, unidad_medida: 'ud',
          ean: a.ean, designacion: a.designacion, seccion: a.seccion,
        };
      }));
      plan.anadidas.forEach(function (a) {
        aplicados.push('Línea añadida: ' + _etiquetaLinea_({ codigo_lm: a.codigo_lm, designacion: a.designacion }) + ' × ' + a.cantidad);
      });
    }
    plan.cantidades.forEach(function (c) {
      const l = c.linea;
      const cambio = { cantidad: c.nueva };
      // El palet asignado se calculó con la cantidad de antes: se libera para
      // que el almacén lo reasigne al abrir el pedido (en refill los palets
      // los eligió la tienda y esa línea no llega aquí con sscc).
      if (cab.tipo !== 'refill') { cambio.sscc = null; cambio.ubicacion = null; cambio.sscc_asignado_en = null; }
      const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(l.id) + '&estado_preparacion=neq.preparado', cambio);
      if (!filas || !filas.length) throw new Error('La línea ' + l.codigo_lm + ' se acaba de preparar: ya no se puede modificar.');
      aplicados.push('Cantidad de ' + _etiquetaLinea_(l) + ': ' + Number(l.cantidad) + ' → ' + c.nueva);
    });
    plan.quitadas.forEach(function (l) {
      const filas = supaDelete_('lineas', 'id=eq.' + encodeURIComponent(l.id) + '&estado_preparacion=neq.preparado');
      // [] = el filtro no encontró la línea sin preparar (se acaba de preparar).
      if (filas && !filas.length) throw new Error('La línea ' + l.codigo_lm + ' se acaba de preparar: ya no se puede quitar.');
      aplicados.push('Línea quitada: ' + _etiquetaLinea_(l) + ' (' + Number(l.cantidad) + ' ' + (l.unidad_medida === 'palet' ? 'palets' : 'ud') + ')');
    });
  } catch (err) {
    errorAplicando = err;
  }

  const cabCambios = errorAplicando ? {} : plan.cabCambios;
  const descripcion = (errorAplicando ? [] : plan.descripcionCabecera).concat(aplicados);

  // Pedido cliente con artículos nuevos: si alguno pesa más de 20 kg el pedido
  // pasa a la cola de equipo (nunca al revés: si el jefe lo pasó a individual a
  // mano, se respeta). Si el CSV de pesos falla, no bloquea el guardado.
  if (!errorAplicando && cab.tipo === 'pedido_cliente' && plan.anadidas.length && cab.cola_individual) {
    try {
      if (!_calcularColaIndividualPorPeso_(u.tienda, plan.anadidas.map(function (a) { return a.codigo_lm; }))) {
        cabCambios.cola_individual = false;
        descripcion.push('Pasa a la cola de equipo (artículo de más de ' + PESO_LIMITE_EQUIPO_KG_ + ' kg)');
      }
    } catch (err) {
      console.error('modificarPeticion: peso: ' + err.message);
    }
  }

  if (descripcion.length) {
    const entrada = { en: new Date().toISOString(), por: String(ldap), cambios: descripcion };
    const historial = (Array.isArray(cab.historial_cambios) ? cab.historial_cambios : []).concat([entrada]).slice(-MAX_HISTORIAL_);
    const filas = supaUpdate_('peticiones',
      'id=eq.' + encodeURIComponent(cab.id) + '&estado=in.(' + ESTADOS_EDITABLES_.join(',') + ')',
      Object.assign({}, cabCambios, { modificada_en: entrada.en, modificada_por: entrada.por, historial_cambios: historial }));
    if (!filas || !filas.length) {
      throw new Error('La petición ha cambiado de estado mientras se guardaban los cambios. Ábrela de nuevo y revisa cómo ha quedado.');
    }
  }
  if (errorAplicando) {
    throw new Error((aplicados.length ? 'Se han guardado solo algunos cambios (' + aplicados.length + '). ' : 'No se ha guardado nada. ') +
      errorAplicando.message + (aplicados.length ? ' Revisa cómo ha quedado la petición.' : ''));
  }
  return _json_({ ok: true, cambios: descripcion });
}
