const TRADUCCION_ESTADO = {
  pendiente: 'Recibida',
  en_preparacion: 'En preparación',
  a_ubicar: 'Preparada, pendiente de consolidar',
  cerrada: 'Completada',
};

/** Unidades ya comprometidas en peticiones abiertas (no cerradas, aún no
 *  preparadas) de esa tienda + código LM — para no ofrecer dos veces el
 *  mismo stock a peticiones distintas. */
function _comprometidoEnPeticionesAbiertas_(tienda, codigoLm) {
  const abiertas = supaSelect_('peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) + '&estado=neq.cerrada&select=id');
  if (!abiertas.length) return 0;
  const ids = abiertas.map(function (p) { return p.id; }).join(',');
  const lineas = supaSelect_('lineas',
    'peticion_id=in.(' + ids + ')&codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&estado_preparacion=neq.preparado&select=cantidad');
  return lineas.reduce(function (s, l) { return s + Number(l.cantidad); }, 0);
}

/** Unidades disponibles ahora mismo en edificio 5 (stock_fisico) para esa
 *  tienda + código LM, sumando todos los SSCC, menos lo ya comprometido en
 *  peticiones abiertas de otras peticiones. */
function _stockDisponible_(tienda, codigoLm) {
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=cantidad');
  const fisico = filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
  const comprometido = _comprometidoEnPeticionesAbiertas_(tienda, codigoLm);
  return Math.max(0, fisico - comprometido);
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
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(String(codigoLm || '').trim()) +
    '&select=sscc,ubicacion,cantidad&order=cantidad.desc')
    .filter(function (f) { return f.cantidad > 0; });
  if (!filas.length) return _json_([]);

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
  const disponible = _stockDisponible_(tienda, codigoLm);

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
    disponible: disponible,
    duplicados: duplicados.map(function (p) { return { tipo: p.tipo, fecha: p.creada_en }; }),
  });
}

function crearPeticion(ldap, tipo, datos, lineas) {
  const tienda = _tiendaDe_(ldap);
  if (['pedido_cliente', 'cesion', 'refill'].indexOf(tipo) === -1) {
    throw new Error('Tipo de petición no válido.');
  }
  if (!lineas || !lineas.length) throw new Error('Añade al menos una línea.');

  lineas.forEach(function (l) {
    const disponible = _stockDisponible_(tienda, String(l.codigoLm || '').trim());
    if (Number(l.cantidad) > disponible) {
      throw new Error('No hay stock suficiente de ' + l.codigoLm + ' en almacén (' + disponible + ' disponibles).');
    }
  });

  if (!datos || !datos.motivo || !String(datos.motivo).trim()) throw new Error('Falta el motivo de la petición.');

  const cabecera = {
    tipo: tipo,
    tienda_origen: tienda,
    solicitante_ldap: ldap,
    motivo: String(datos.motivo).trim(),
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
  }

  const peticion = supaInsert_('peticiones', cabecera);

  const unidadMedida = tipo === 'refill' ? 'palet' : 'ud';
  const lineasPayload = lineas.map(function (l) {
    if (!l.codigoLm || !l.cantidad) throw new Error('Línea incompleta.');
    const payload = {
      peticion_id: peticion.id,
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
  supaInsertMany_('lineas', lineasPayload);

  return _json_({ ok: true, id: peticion.id });
}

function listarMisPeticiones(ldap) {
  const tienda = _tiendaDe_(ldap);
  const filas = supaSelect_(
    'peticiones',
    'tienda_origen=eq.' + encodeURIComponent(tienda) +
      '&estado=neq.cerrada' +
      '&select=id,tipo,num_pedido,num_cesion,tienda_destino,estado,creada_en,solicitante_ldap' +
      '&order=creada_en.desc&limit=200'
  );
  filas.forEach(function (p) { p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado; });
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

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  var hodosTexto = null;
  const generaEtiqueta = (peticion.tipo === 'pedido_cliente' && !peticion.transporte) || peticion.tipo === 'cesion';
  if (generaEtiqueta) {
    const conHodosId = lineas.filter(function (l) { return l.hodos_id; });
    if (!conHodosId.length) {
      hodosTexto = 'Generando etiqueta…';
    } else {
      const idUnico = conHodosId[0].hodos_id;
      const etiquetas = supaSelect_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico) + '&select=pendiente_impresion_incpc', CFG.SCHEMA_HODOS);
      if (etiquetas.length) {
        hodosTexto = etiquetas[0].pendiente_impresion_incpc ? 'Etiqueta pendiente de imprimir' : 'Etiqueta impresa';
      }
    }
  }

  return _json_({ peticion: peticion, lineas: lineas, hodosTexto: hodosTexto });
}
