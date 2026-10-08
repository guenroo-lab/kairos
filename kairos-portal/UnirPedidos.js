/** Unir las líneas de un pedido cliente nuevo a otro ya abierto con el MISMO número.
 *
 *  Pasa mucho: la tienda manda un pedido con una o dos líneas y, minutos después, el mismo
 *  número con otras líneas (en producción, 11 de 122 pedidos cliente, todos con trozos de una
 *  línea separados entre 1 y 25 minutos). Almacén los ve como pedidos distintos y los prepara,
 *  etiqueta y traslada por separado.
 *
 *  Al enviar, el portal pregunta primero (buscarPedidoAbiertoMismoNumero) y, si la tienda
 *  elige unir, añade las líneas al pedido abierto (anadirLineasAPedido) en vez de crear otro.
 *  Crear aparte sigue siendo posible: un mismo número puede llegar legítimamente más de una
 *  vez (otra expedición), así que nunca se une sin preguntar.
 *
 *  Solo se une a un pedido de la misma tienda, pendiente o en preparación, con el mismo
 *  transporte y que ningún operario tenga abierto en almacén ahora mismo (misma protección que
 *  Edicion.js: el operario tiene en pantalla las líneas y los palets de antes). Todo se vuelve
 *  a comprobar en el servidor al unir: lo que haya mandado el navegador no se da por bueno. */

const MAX_COMENTARIO_PEDIDO_ = 500;
const VENTANA_UNION_REPETIDA_MS_ = 30000;

/** Por qué NO se puede unir a este pedido abierto (texto para la tienda), o null si se puede. */
function _motivoNoUnir_(cab, transporte, ahoraMs) {
  if (typeof transporte === 'boolean' && transporte !== !!cab.transporte) {
    return 'el pedido abierto tiene el transporte en «' + (cab.transporte ? 'Sí' : 'No') +
      '» y este lo has marcado en «' + (transporte ? 'Sí' : 'No') + '»';
  }
  if (cab.en_curso_por && cab.en_curso_desde) {
    const minutos = (ahoraMs - Date.parse(cab.en_curso_desde)) / 60000;
    if (minutos < MINUTOS_OPERARIO_ACTIVO_) {
      // En equipo el operario figura como «Ana + Luis».
      return cab.en_curso_por + (String(cab.en_curso_por).indexOf(' + ') !== -1 ? ' lo tienen' : ' lo tiene') +
        ' abierto en almacén ahora mismo (hace ' + Math.max(1, Math.round(minutos)) + ' min)';
    }
  }
  return null;
}

/** Pedidos abiertos de la tienda con este mismo número, del más antiguo al más nuevo:
 *  [{ id, estado, estadoTexto, creada_en, solicitante_ldap, transporte, comentario,
 *     lineas: [{ codigo_lm, designacion, cantidad, unidad_medida, preparada }],
 *     puedeUnirse, motivo }]. Vacío si no hay ninguno (o el rol no puede pedir pedidos). */
function buscarPedidoAbiertoMismoNumero(ldap, numPedido, transporte) {
  const u = _usuarioDe_(ldap);
  const num = String(numPedido == null ? '' : numPedido).trim();
  if (u.rol === 'vendedor' || !num) return _json_([]);
  const cabs = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&tipo=eq.pedido_cliente&num_pedido=eq.' + encodeURIComponent(num) +
    '&estado=in.(' + ESTADOS_EDITABLES_.join(',') + ')' +
    '&select=id,estado,creada_en,solicitante_ldap,transporte,comentario,en_curso_por,en_curso_desde' +
    '&order=creada_en.asc&limit=20');
  if (!cabs.length) return _json_([]);

  const lineas = supaSelectIn_('lineas', 'peticion_id', cabs.map(function (c) { return c.id; }),
    'select=peticion_id,codigo_lm,designacion,cantidad,unidad_medida,estado_preparacion');
  const ahora = Date.now();
  const resultado = cabs.map(function (c) {
    const motivo = _motivoNoUnir_(c, typeof transporte === 'boolean' ? transporte : null, ahora);
    return {
      id: c.id,
      estado: c.estado,
      estadoTexto: TRADUCCION_ESTADO[c.estado] || c.estado,
      creada_en: c.creada_en,
      solicitante_ldap: c.solicitante_ldap,
      transporte: !!c.transporte,
      comentario: c.comentario || null,
      lineas: lineas.filter(function (l) { return l.peticion_id === c.id; }).map(function (l) {
        return { codigo_lm: l.codigo_lm, designacion: l.designacion || null, cantidad: l.cantidad, unidad_medida: l.unidad_medida, preparada: l.estado_preparacion === 'preparado' };
      }),
      puedeUnirse: !motivo,
      motivo: motivo,
    };
  }).sort(function (a, b) { return Date.parse(a.creada_en) - Date.parse(b.creada_en); });
  return _json_(resultado);
}

/** datos = { numPedido, transporte, comentario? } (lo mismo que se manda al crear el pedido);
 *  lineas = las del formulario. Se serializa con el mismo cerrojo que crearPeticion. */
function anadirLineasAPedido(ldap, peticionId, datos, lineas) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado, inténtalo de nuevo en unos segundos.'); }
  try { return _anadirLineasAPedido_(ldap, peticionId, datos, lineas); } finally { lock.releaseLock(); }
}

function _anadirLineasAPedido_(ldap, peticionId, datos, lineas) {
  const u = _usuarioDe_(ldap);
  if (u.rol === 'vendedor') throw new Error('Tu rol (Vendedor) solo puede crear peticiones de Refill.');
  datos = datos || {};
  if (!lineas || !lineas.length) throw new Error('Añade al menos una línea.');

  const cabs = supaSelect_('peticiones',
    'id=eq.' + encodeURIComponent(peticionId) + '&tienda_origen=eq.' + encodeURIComponent(u.tienda) + '&tipo=eq.pedido_cliente&select=*');
  if (!cabs.length) throw new Error('El pedido ya no existe. Envíalo como pedido aparte.');
  const cab = cabs[0];
  if (ESTADOS_EDITABLES_.indexOf(cab.estado) === -1) {
    throw new Error('Ese pedido ya no admite más líneas (' + (TRADUCCION_ESTADO[cab.estado] || cab.estado) + '). Envíalo como pedido aparte.');
  }
  const num = String(datos.numPedido == null ? '' : datos.numPedido).trim();
  if (!num || num !== String(cab.num_pedido == null ? '' : cab.num_pedido).trim()) {
    throw new Error('El número de pedido no coincide con el del pedido abierto.');
  }
  if (typeof datos.transporte !== 'boolean') throw new Error('Falta indicar transporte.');
  const ahora = Date.now();
  const motivo = _motivoNoUnir_(cab, datos.transporte, ahora);
  if (motivo) throw new Error('No se pueden añadir las líneas al pedido abierto porque ' + motivo + '. Envíalas como pedido aparte.');

  // Se valida todo ANTES de escribir nada (igual que al crear un pedido).
  const lineasPayload = _lineasParaGuardar_(lineas, 'ud');
  const descripcion = lineasPayload.map(function (l) {
    return 'Línea añadida: ' + _etiquetaLinea_(l) + ' × ' + l.cantidad;
  });
  descripcion.unshift('Líneas unidas desde un segundo envío con el mismo nº de pedido');

  // Doble clic: las mismas líneas unidas hace unos segundos por la misma persona.
  const historialPrevio = Array.isArray(cab.historial_cambios) ? cab.historial_cambios : [];
  const ultima = historialPrevio[historialPrevio.length - 1];
  if (ultima && String(ultima.por) === String(ldap) && ahora - Date.parse(ultima.en) < VENTANA_UNION_REPETIDA_MS_ &&
      JSON.stringify((ultima.cambios || []).slice(0, descripcion.length)) === JSON.stringify(descripcion)) {
    throw new Error('Ya has añadido estas mismas líneas a este pedido hace unos segundos — revisa "Mis peticiones" antes de repetirlo.');
  }

  // Comentario: el nuevo se suma al que ya tenía (si no está ya dentro).
  const previo = String(cab.comentario == null ? '' : cab.comentario).trim();
  const nuevo = String(datos.comentario == null ? '' : datos.comentario).trim();
  var comentarioFinal = null;
  if (nuevo && previo.indexOf(nuevo) === -1) {
    comentarioFinal = previo ? previo + '\n' + nuevo : nuevo;
    if (comentarioFinal.length > MAX_COMENTARIO_PEDIDO_) {
      throw new Error('El comentario del pedido abierto y el nuevo suman más de ' + MAX_COMENTARIO_PEDIDO_ + ' caracteres. Acorta el comentario y vuelve a enviarlo.');
    }
    descripcion.push('Comentario ampliado');
  }

  // Un pedido ya preparado no llega aquí; lo que se añade necesita stock como cualquier pedido nuevo.
  _exigirStockPedidoCliente_(u.tienda, lineas);

  supaInsertMany_('lineas', lineasPayload.map(function (l) { return Object.assign({ peticion_id: cab.id }, l); }));

  // Si algún artículo nuevo pesa más de 20 kg el pedido pasa a la cola de equipo (nunca al revés).
  const cambios = {};
  if (cab.cola_individual) {
    try {
      if (!_calcularColaIndividualPorPeso_(u.tienda, lineasPayload.map(function (l) { return l.codigo_lm; }))) {
        cambios.cola_individual = false;
        descripcion.push('Pasa a la cola de equipo (artículo de más de ' + PESO_LIMITE_EQUIPO_KG_ + ' kg)');
      }
    } catch (err) {
      console.error('anadirLineasAPedido: peso: ' + err.message);
    }
  }
  if (comentarioFinal) cambios.comentario = comentarioFinal;
  if ('historial_cambios' in cab) {
    const entrada = { en: new Date(ahora).toISOString(), por: String(ldap), cambios: descripcion };
    cambios.modificada_en = entrada.en;
    cambios.modificada_por = entrada.por;
    cambios.historial_cambios = historialPrevio.concat([entrada]).slice(-MAX_HISTORIAL_);
  }

  // Las líneas ya están guardadas: si falla anotar el cambio NO se devuelve error (reintentar
  // las duplicaría), se avisa.
  var aviso = null;
  if (Object.keys(cambios).length) {
    try {
      const filas = supaUpdate_('peticiones', 'id=eq.' + encodeURIComponent(cab.id) + '&estado=in.(' + ESTADOS_EDITABLES_.join(',') + ')', cambios);
      if (!filas || !filas.length) aviso = 'Las líneas se han añadido, pero el pedido ha cambiado de estado mientras tanto: ábrelo en «Mis peticiones» y revisa cómo ha quedado.';
    } catch (err) {
      aviso = 'Las líneas se han añadido, pero no se ha podido avisar a almacén del cambio (' + err.message + '). No las vuelvas a enviar.';
    }
  }
  const previas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(cab.id) + '&select=id');
  return _json_({ ok: true, id: cab.id, numPedido: num, anadidas: lineasPayload.length, totalLineas: previas.length, aviso: aviso });
}
