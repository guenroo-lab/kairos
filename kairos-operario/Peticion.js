function obtenerPeticion(peticionId) {
  const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId));
  if (!cab.length) throw new Error('Petición no encontrada.');
  const peticion = cab[0];
  peticion.tiendaNombre = CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen;
  peticion.tiendaDestinoNombre = peticion.tienda_destino ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino) : null;

  const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId) + '&order=id.asc');

  lineas.forEach(function (l) {
    if (l.sscc || l.estado_preparacion === 'preparado') return;
    try {
      const asignado = asignarSsccSiFalta_(l, peticion);
      if (asignado) { l.sscc = asignado.sscc; l.ubicacion = asignado.ubicacion; }
    } catch (err) {
      l.avisoStock = err.message;
    }
  });

  return _json_({ peticion: peticion, lineas: lineas });
}

function marcarLineaPreparada(lineaId, operarioNombre, incidencia, motivo) {
  operarioNombre = String(operarioNombre || '').trim();
  if (!operarioNombre) throw new Error('Selecciona tu nombre antes de preparar líneas.');
  incidencia = String(incidencia || '').trim();
  motivo = String(motivo || '').trim();

  const lineaActual = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=peticion_id');
  if (!lineaActual.length) throw new Error('Línea no encontrada.');
  const peticionId = lineaActual[0].peticion_id;

  var estadoNegocio, incidenciaMotivo;
  if (incidencia) {
    if (['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'].indexOf(incidencia) === -1) {
      throw new Error('Incidencia desconocida: ' + incidencia);
    }
    estadoNegocio = incidencia;
    if (incidencia === 'Otras Incidencias') {
      if (!motivo) throw new Error('Falta el motivo para la incidencia "Otras Incidencias".');
      incidenciaMotivo = motivo;
    } else {
      incidenciaMotivo = null;
    }
  } else {
    const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId) + '&select=tipo,transporte');
    const peticion = cab[0];
    estadoNegocio = (peticion.tipo === 'pedido_cliente' && peticion.transporte === true) ? 'Consolidado' : 'Preparado';
    incidenciaMotivo = null;
  }

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    estado_preparacion: 'preparado',
    estado_negocio: estadoNegocio,
    incidencia_motivo: incidenciaMotivo,
    operario: operarioNombre,
    preparada_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');

  _dispararEtiquetaSiProcede_(peticionId);

  return _json_({ ok: true });
}

function deshacerLineaPreparada(lineaId, operarioNombre) {
  operarioNombre = String(operarioNombre || '').trim();
  if (!operarioNombre) throw new Error('Selecciona tu nombre.');

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    estado_preparacion: 'en_curso',
    estado_negocio: null,
    incidencia_motivo: null,
    operario: operarioNombre,
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}

function guardarUbicacionConsolidacion(peticionId, ubicacion) {
  ubicacion = String(ubicacion || '').trim();
  if (!ubicacion) throw new Error('Falta la ubicación de consolidación.');

  const filas = supaUpdate_('peticiones', 'id=eq.' + encodeURIComponent(peticionId), {
    ubicacion_consolidacion: ubicacion,
  });
  if (!filas.length) throw new Error('Petición no encontrada.');
  return _json_({ ok: true });
}
