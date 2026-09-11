const TRADUCCION_ESTADO = {
  pendiente: 'Recibida',
  en_preparacion: 'En preparación',
  a_ubicar: 'Preparada, pendiente de consolidar',
  cerrada: 'Completada',
};

function crearPeticion(ldap, tipo, datos, lineas) {
  const tienda = _tiendaDe_(ldap);
  if (['pedido_cliente', 'cesion', 'refill'].indexOf(tipo) === -1) {
    throw new Error('Tipo de petición no válido.');
  }
  if (!lineas || !lineas.length) throw new Error('Añade al menos una línea.');

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
    cabecera.tienda_destino = datos.tiendaDestino;
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
      '&select=id,tipo,num_pedido,tienda_destino,estado,creada_en,solicitante_ldap' +
      '&order=creada_en.desc&limit=200'
  );
  filas.forEach(function (p) { p.estadoTexto = TRADUCCION_ESTADO[p.estado] || p.estado; });
  return _json_(filas);
}
