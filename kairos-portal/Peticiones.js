const TRADUCCION_ESTADO = {
  pendiente: 'Recibida',
  en_preparacion: 'En preparación',
  a_ubicar: 'Preparada, pendiente de consolidar',
  cerrada: 'Completada',
};

/** Unidades disponibles ahora mismo en edificio 5 (stock_fisico) para esa
 *  tienda + código LM, sumando todos los SSCC. */
function _stockDisponible_(tienda, codigoLm) {
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=cantidad');
  return filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
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
  }

  const peticion = supaInsert_('peticiones', cabecera);

  const unidadMedida = tipo === 'refill' ? 'palet' : 'ud';
  const lineasPayload = lineas.map(function (l) {
    if (!l.codigoLm || !l.cantidad) throw new Error('Línea incompleta.');
    return {
      peticion_id: peticion.id,
      codigo_lm: String(l.codigoLm).trim(),
      cantidad: Number(l.cantidad),
      unidad_medida: unidadMedida,
      ean: l.ean || null,
      designacion: l.designacion || null,
      seccion: l.seccion || null,
    };
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
