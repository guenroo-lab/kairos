/** Revisión de palet (ver kairos-portal/Revisiones.js): tienda pide que se
 *  revisen cantidad, referencias y ubicación de un palet. Aquí lo trabajan
 *  los operarios (contar y anotar) y el jefe de equipo lo monitoriza y da
 *  seguimiento a las diferencias (rectificar en MyISO si hace falta). */

function _inicioHoyRevisionesIso_() {
  const a = new Date();
  return new Date(a.getFullYear(), a.getMonth(), a.getDate()).toISOString();
}

/** Pendientes y en curso de una tienda — pantalla de revisión del operario. */
function listarRevisionesTienda(tienda) {
  const filas = supaSelect_('revisiones_palet',
    'tienda_origen=eq.' + encodeURIComponent(tienda) + '&estado=in.(pendiente,en_revision)' +
    '&select=id,sscc,ubicacion_esperada,contenido_esperado,revisar,comentario,estado,creada_en,solicitante_ldap,en_curso_por,en_curso_desde' +
    '&order=creada_en.asc');
  return _json_(filas);
}

/** Marca la revisión como en curso por este operario y devuelve la fila
 *  entera para pintar el detalle. No es exclusivo: si dos personas la abren
 *  a la vez, gana quien termine primero. */
function tomarRevision(id, operario) {
  operario = String(operario || '').trim();
  if (!operario) throw new Error('Selecciona tu nombre antes de revisar.');
  const filas = supaUpdate_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&estado=neq.revisada', {
    estado: 'en_revision',
    en_curso_por: operario,
    en_curso_desde: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Esta revisión ya está terminada.');
  return _json_(filas[0]);
}

/** resultado = { localizado, ubicacionOk, ubicacionReal, ssccEncontrado,
 *  lineas:[{codigo_lm, contada}], extras:[{codigo_lm, cantidad}], nota }.
 *  El servidor recalcula si es conforme comparando con lo esperado — no se
 *  fía del cliente. Un palet que el sistema no conoce, o que no se encuentra,
 *  nunca es conforme: siempre queda para que el jefe lo gestione. */
function completarRevisionPalet(id, operario, resultado) {
  operario = String(operario || '').trim();
  if (!operario) throw new Error('Selecciona tu nombre antes de revisar.');
  resultado = resultado || {};

  const filas = supaSelect_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&select=id,estado,contenido_esperado,ubicacion_esperada,revisar');
  if (!filas.length) throw new Error('Revisión no encontrada.');
  if (filas[0].estado === 'revisada') throw new Error('Esta revisión ya está terminada.');
  const esperado = filas[0].contenido_esperado || [];
  const nota = String(resultado.nota || '').trim() || null;
  // Bug real (revisión con Codex CLI, 2026-09-22): la tienda elige qué
  // revisar (cantidad/referencias/ubicación, ver 025_revisiones_palet.sql),
  // pero esta función siempre exigía y evaluaba las tres — un palet pedido
  // solo para comprobar la ubicación podía quedar "no conforme" por una
  // cantidad que nadie pidió revisar. Ahora solo cuenta lo pedido.
  const revisar = filas[0].revisar && filas[0].revisar.length ? filas[0].revisar : ['cantidad', 'referencias', 'ubicacion'];
  const pideCantidad = revisar.indexOf('cantidad') !== -1;
  const pideReferencias = revisar.indexOf('referencias') !== -1;
  const pideUbicacion = revisar.indexOf('ubicacion') !== -1;

  function guardar(conforme, cuerpo) {
    // Filtro por estado también en el UPDATE (bug real, revisión con Codex
    // CLI 2026-09-22): antes era un UPDATE incondicional por id, así que si
    // dos operarios completaban el mismo palet casi a la vez, ganaba quien
    // terminara ÚLTIMO — al revés de lo que dice el comentario de arriba
    // ("gana quien termine primero"). Con el filtro, el segundo en llegar
    // ve 0 filas afectadas y se entera de que ya estaba resuelta.
    const filas = supaUpdate_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&estado=neq.revisada', {
      estado: 'revisada',
      conforme: conforme,
      resultado: cuerpo,
      revisada_por: operario,
      revisada_en: new Date().toISOString(),
    });
    if (!filas.length) throw new Error('Esta revisión ya está terminada.');
    return _json_({ ok: true, conforme: conforme });
  }

  if (resultado.localizado === false) {
    return guardar(false, {
      localizado: false, ubicacionOk: false, ubicacionReal: null, ssccEncontrado: null, extras: [], nota: nota,
      lineas: esperado.map(function (e) {
        return { codigo_lm: e.codigo_lm, designacion: e.designacion || null, esperada: e.cantidad == null ? null : Number(e.cantidad), contada: null };
      }),
    });
  }

  const contadas = {};
  (resultado.lineas || []).forEach(function (l) {
    if (l.contada === '' || l.contada === null || l.contada === undefined) return;
    contadas[String(l.codigo_lm)] = Number(l.contada);
  });

  // Bug real (revisión adversarial con Codex CLI, mismo día): "referencias"
  // (¿lleva el palet lo que debería, sin que falte ninguna?) solo se podía
  // saber contando cada referencia esperada — si tienda pidió "referencias"
  // pero no "cantidad", antes no se exigía el contador y una referencia que
  // faltaba del todo (contada implícita 0) no hacía fallar la revisión.
  const contadorObligatorio = pideCantidad || pideReferencias;
  const lineas = esperado.map(function (e) {
    const contada = contadas[String(e.codigo_lm)];
    if (contadorObligatorio && (contada === undefined || isNaN(contada) || contada < 0)) {
      throw new Error('Falta la cantidad contada de ' + e.codigo_lm + '.');
    }
    return {
      codigo_lm: e.codigo_lm, designacion: e.designacion || null,
      esperada: e.cantidad == null ? null : Number(e.cantidad),
      contada: contada === undefined || isNaN(contada) ? null : contada,
    };
  });

  const extras = (resultado.extras || [])
    .filter(function (x) { return String(x.codigo_lm || '').trim() && Number(x.cantidad) > 0; })
    .map(function (x) { return { codigo_lm: String(x.codigo_lm).trim(), cantidad: Number(x.cantidad) }; });

  const ubicacionOk = !pideUbicacion || (resultado.ubicacionOk !== false && !!filas[0].ubicacion_esperada);
  const ubicacionReal = ubicacionOk ? null : String(resultado.ubicacionReal || '').trim();
  if (pideUbicacion && !ubicacionOk && !ubicacionReal) throw new Error('Indica dónde está el palet.');

  const conforme = ubicacionOk &&
    (!pideReferencias || (!extras.length && lineas.every(function (l) { return l.contada !== null && l.contada > 0; }))) &&
    (!pideCantidad || lineas.every(function (l) { return l.esperada !== null && l.contada === l.esperada; }));

  return guardar(conforme, {
    localizado: true, ubicacionOk: ubicacionOk, ubicacionReal: ubicacionReal,
    ssccEncontrado: String(resultado.ssccEncontrado || '').trim() || null,
    lineas: lineas, extras: extras, nota: nota,
  });
}

/** Monitor del jefe de equipo: abiertas, diferencias sin gestionar y
 *  contadores del día por tienda. */
function listarRevisionesJefe() {
  const campos = 'id,tienda_origen,sscc,ubicacion_esperada,contenido_esperado,revisar,comentario,estado,creada_en,solicitante_ldap,en_curso_por,en_curso_desde,resultado,revisada_por,revisada_en';
  const abiertas = supaSelect_('revisiones_palet',
    'estado=in.(pendiente,en_revision)&select=' + campos + '&order=creada_en.asc&limit=200');
  const diferencias = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.false&gestionada_en=is.null&select=' + campos + '&order=revisada_en.desc&limit=200');
  const hoy = supaSelect_('revisiones_palet',
    'creada_en=gte.' + encodeURIComponent(_inicioHoyRevisionesIso_()) + '&select=tienda_origen');
  const conformesHoy = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.true&revisada_en=gte.' + encodeURIComponent(_inicioHoyRevisionesIso_()) + '&select=tienda_origen');

  function contar(filas) {
    const c = { '014': 0, '279': 0 };
    filas.forEach(function (f) { c[f.tienda_origen] = (c[f.tienda_origen] || 0) + 1; });
    return c;
  }
  return _json_({ abiertas: abiertas, diferencias: diferencias, creadasHoy: contar(hoy), conformesHoy: contar(conformesHoy) });
}

/** Seguimiento del jefe: ya se verificó y, si hacía falta, se rectificó en MyISO. */
function marcarRevisionGestionada(id, nota) {
  const filas = supaUpdate_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&estado=eq.revisada', {
    gestionada_en: new Date().toISOString(),
    gestion_nota: String(nota || '').trim() || null,
  });
  if (!filas.length) throw new Error('Revisión no encontrada.');
  return _json_({ ok: true });
}
