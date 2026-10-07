/** Revisión de palet (ver kairos-portal/Revisiones.js): tienda pide que se
 *  revisen cantidad, referencias y ubicación de un palet. Aquí lo trabajan
 *  los operarios (contar y anotar) y el jefe de equipo lo monitoriza y da
 *  seguimiento a las diferencias (rectificar en MyISO si hace falta). */

function _inicioHoyRevisionesIso_() {
  const a = new Date();
  return new Date(a.getFullYear(), a.getMonth(), a.getDate()).toISOString();
}

// Carpeta de Drive donde se guardan las fotos que los operarios añaden a una revisión («FotosRevisionStock»,
// compartida con los jefes y con tienda). Las fotos las crea la cuenta que publica la app.
const REVISION_FOTOS_CARPETA_ = '1enNoKd-PkVOHM2cBPtjsOeDkJb4oQH6x';
const REVISION_FOTOS_MAX_ = 3;
const REVISION_FOTO_MAX_BYTES_ = 6 * 1024 * 1024;
const REVISION_FOTO_TIPOS_ = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Añade el EAN de cada artículo esperado: las revisiones guardan solo código y nombre, el EAN sale del
 *  catálogo. Si el catálogo falla, la revisión sigue funcionando sin EAN. */
function _anadirEanRevisiones_(revisiones) {
  const codigos = [];
  revisiones.forEach(function (r) {
    (r.contenido_esperado || []).forEach(function (c) {
      if (c && c.codigo_lm && codigos.indexOf(c.codigo_lm) === -1) codigos.push(c.codigo_lm);
    });
  });
  if (!codigos.length) return;
  const ean = {};
  try {
    supaSelectIn_('catalogo', 'codigo_lm', codigos, 'select=codigo_lm,ean').forEach(function (f) { if (f.ean) ean[f.codigo_lm] = f.ean; });
  } catch (err) {
    console.error('Revisiones: no se pudo leer el EAN del catálogo: ' + err.message);
    return;
  }
  revisiones.forEach(function (r) {
    (r.contenido_esperado || []).forEach(function (c) { if (c && !c.ean && ean[c.codigo_lm]) c.ean = ean[c.codigo_lm]; });
  });
}

/** Pendientes y en curso de una tienda — pantalla de revisión del operario. */
function listarRevisionesTienda(tienda) {
  const filas = supaSelect_('revisiones_palet',
    'tienda_origen=eq.' + encodeURIComponent(tienda) + '&estado=in.(pendiente,en_revision)' +
    '&select=id,sscc,ubicacion_esperada,contenido_esperado,revisar,comentario,estado,creada_en,solicitante_ldap,en_curso_por,en_curso_desde' +
    '&order=creada_en.asc');
  _anadirEanRevisiones_(filas);
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
  _anadirEanRevisiones_([filas[0]]);
  return _json_(filas[0]);
}

// ——— Fotos de la revisión ———

function _nombreFotoRevision_(revision, operario, extension) {
  const limpio = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''); };
  const que = revision.sscc ? 'SSCC-' + limpio(revision.sscc) : 'LM-' + limpio(((revision.contenido_esperado || [])[0] || {}).codigo_lm || 'busqueda');
  const cuando = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyyMMdd-HHmmss');
  const azar = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return 'Revision_' + limpio(revision.tienda_origen) + '_' + que + '_' + cuando + '_' + limpio(operario).slice(0, 20) + '_' + azar + '.' + extension;
}

/** Guarda una foto (ya reducida en el móvil) en la carpeta de Drive y devuelve su id. La revisión la guarda al
 *  terminarse (completarRevisionPalet); si el operario la quita o abandona, se mueve a la papelera. */
function subirFotoRevision(id, operario, base64, mime) {
  operario = String(operario || '').trim();
  if (!operario) throw new Error('Selecciona tu nombre antes de añadir una foto.');
  mime = String(mime || '').toLowerCase();
  const extension = REVISION_FOTO_TIPOS_[mime];
  if (!extension) throw new Error('Formato de imagen no válido.');
  base64 = String(base64 || '').replace(/^data:[^,]*,/, '');
  if (!base64) throw new Error('La foto está vacía.');
  if (base64.length > Math.ceil(REVISION_FOTO_MAX_BYTES_ * 4 / 3)) throw new Error('La foto es demasiado grande.');

  const filas = supaSelect_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&select=id,estado,tienda_origen,sscc,contenido_esperado');
  if (!filas.length) throw new Error('Revisión no encontrada.');
  if (filas[0].estado === 'revisada') throw new Error('Esta revisión ya está terminada.');

  const bytes = Utilities.base64Decode(base64);
  if (!bytes.length || bytes.length > REVISION_FOTO_MAX_BYTES_) throw new Error('La foto es demasiado grande.');
  const nombre = _nombreFotoRevision_(filas[0], operario, extension);
  const archivo = DriveApp.getFolderById(REVISION_FOTOS_CARPETA_).createFile(Utilities.newBlob(bytes, mime, nombre));
  archivo.setDescription('rev:' + id + ' · ' + operario);
  return _json_({ id: archivo.getId(), nombre: nombre });
}

/** Quita (a la papelera de Drive) una foto que se acaba de subir y no se quiere. Solo vale para una foto de esta
 *  misma revisión mientras siga sin terminar. Es un "si se puede": no bloquea nada si falla. */
function quitarFotoRevision(id, fotoId) {
  const filas = supaSelect_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&select=id,estado');
  if (!filas.length || filas[0].estado === 'revisada') return _json_({ ok: false });
  const archivo = DriveApp.getFileById(String(fotoId || ''));
  if (String(archivo.getDescription() || '').indexOf('rev:' + id + ' ') !== 0) return _json_({ ok: false });
  archivo.setTrashed(true);
  return _json_({ ok: true });
}

/** Comprueba que cada foto existe y está en la carpeta de fotos de revisión (no se acepta un id cualquiera de Drive). */
function _verificarFotosRevision_(ids) {
  if (!Array.isArray(ids)) return [];
  const fotos = [];
  ids.slice(0, REVISION_FOTOS_MAX_).forEach(function (valor) {
    const id = String(valor || '').trim();
    if (!/^[A-Za-z0-9_-]{15,}$/.test(id)) throw new Error('Una de las fotos no es válida: vuelve a añadirla.');
    if (fotos.some(function (f) { return f.id === id; })) return;
    var archivo, enCarpeta = false;
    try {
      archivo = DriveApp.getFileById(id);
      const padres = archivo.getParents();
      while (padres.hasNext()) { if (padres.next().getId() === REVISION_FOTOS_CARPETA_) { enCarpeta = true; break; } }
    } catch (err) {
      throw new Error('No se ha podido comprobar una de las fotos. Inténtalo de nuevo o quítala.');
    }
    if (!enCarpeta) throw new Error('Una de las fotos no es válida: vuelve a añadirla.');
    fotos.push({ id: id, nombre: archivo.getName() });
  });
  return fotos;
}

/** Foto de una revisión ya terminada (para el jefe de equipo): el id sale SIEMPRE de la base de datos, nunca del cliente. */
function obtenerFotoRevision(id, indice) {
  const filas = supaSelect_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&select=id,resultado');
  if (!filas.length) throw new Error('Revisión no encontrada.');
  const fotos = ((filas[0].resultado || {}).fotos) || [];
  const foto = fotos[Number(indice)];
  if (!foto || !foto.id) throw new Error('Esa foto no existe.');
  const blob = DriveApp.getFileById(foto.id).getBlob();
  return _json_({ mime: blob.getContentType(), datos: Utilities.base64Encode(blob.getBytes()), nombre: foto.nombre || '' });
}

// Por qué un palet no se localizó. Solo se pide cuando el sistema no le conocía
// dirección (palet que consta en myISO pero no está en nuestra plataforma);
// sin motivo (o con una pantalla antigua) queda como "no localizado" a secas.
//  - no_en_plataforma: consta en el sistema pero físicamente no está aquí.
//  - ya_salio: figura ya enviado/cargado (solo si se pidió un SSCC concreto).
const MOTIVOS_NO_LOCALIZADO_ = ['no_en_plataforma', 'ya_salio'];

function _sinCerosIzquierda_(sscc) { return String(sscc || '').trim().replace(/^0+/, ''); }

/** resultado = { localizado, motivo?, otroSscc?, ubicacionOk, ubicacionReal, ssccEncontrado,
 *  lineas:[{codigo_lm, contada}], extras:[{codigo_lm, cantidad}], nota }.
 *  otroSscc = true: el palet se encontró, pero con un SSCC distinto al pedido
 *  (ssccEncontrado obligatorio): el sistema tiene que rectificarse, nunca es conforme.
 *  El servidor recalcula si es conforme comparando con lo esperado — no se
 *  fía del cliente. Un palet que el sistema no conoce, o que no se encuentra,
 *  nunca es conforme: siempre queda para que el jefe lo gestione. */
function completarRevisionPalet(id, operario, resultado) {
  operario = String(operario || '').trim();
  if (!operario) throw new Error('Selecciona tu nombre antes de revisar.');
  resultado = resultado || {};

  const filas = supaSelect_('revisiones_palet', 'id=eq.' + encodeURIComponent(id) + '&select=id,estado,sscc,contenido_esperado,ubicacion_esperada,revisar');
  if (!filas.length) throw new Error('Revisión no encontrada.');
  if (filas[0].estado === 'revisada') throw new Error('Esta revisión ya está terminada.');
  const esperado = filas[0].contenido_esperado || [];
  const nota = String(resultado.nota || '').trim() || null;
  // Fotos que el operario ha añadido (ya subidas a Drive): se comprueba que son de la carpeta de fotos.
  const fotos = _verificarFotosRevision_(resultado.fotos);
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
    if (fotos.length) cuerpo.fotos = fotos;
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
    const motivo = MOTIVOS_NO_LOCALIZADO_.indexOf(resultado.motivo) !== -1 ? resultado.motivo : null;
    if (motivo === 'ya_salio' && !filas[0].sscc) {
      throw new Error('"Ya salió" solo vale para un palet con SSCC: aquí se buscaba un artículo, no un palet concreto.');
    }
    return guardar(false, {
      localizado: false, motivo: motivo, ubicacionOk: false, ubicacionReal: null, ssccEncontrado: null, extras: [], nota: nota,
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

  // Encontrado con otro SSCC: el palet que se pidió no existe como tal.
  const ssccEncontrado = String(resultado.ssccEncontrado || '').trim() || null;
  const otroSscc = resultado.otroSscc === true;
  if (otroSscc) {
    if (!filas[0].sscc) throw new Error('"Con otro SSCC" solo vale cuando se pidió un palet con SSCC.');
    if (!ssccEncontrado) throw new Error('Escribe el SSCC con el que lo has encontrado.');
    if (_sinCerosIzquierda_(ssccEncontrado) === _sinCerosIzquierda_(filas[0].sscc)) {
      throw new Error('Ese es el mismo SSCC que se pidió: si lo has encontrado con ese SSCC, no uses "Con otro SSCC".');
    }
  }

  const conforme = !otroSscc && ubicacionOk &&
    (!pideReferencias || (!extras.length && lineas.every(function (l) { return l.contada !== null && l.contada > 0; }))) &&
    (!pideCantidad || lineas.every(function (l) { return l.esperada !== null && l.contada === l.esperada; }));

  return guardar(conforme, {
    localizado: true, ssccDistinto: otroSscc, ubicacionOk: ubicacionOk, ubicacionReal: ubicacionReal,
    ssccEncontrado: ssccEncontrado,
    lineas: lineas, extras: extras, nota: nota,
  });
}

/** Monitor del jefe de equipo: abiertas, diferencias sin gestionar,
 *  resueltas (conformes o diferencias ya gestionadas — antes desaparecían
 *  sin dejar rastro visible en ningún sitio) y contadores del día por
 *  tienda. */
function listarRevisionesJefe() {
  const campos = 'id,tienda_origen,sscc,ubicacion_esperada,contenido_esperado,revisar,comentario,estado,creada_en,solicitante_ldap,en_curso_por,en_curso_desde,resultado,revisada_por,revisada_en,conforme,gestionada_en,gestion_nota';
  const abiertas = supaSelect_('revisiones_palet',
    'estado=in.(pendiente,en_revision)&select=' + campos + '&order=creada_en.asc&limit=200');
  const diferencias = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.false&gestionada_en=is.null&select=' + campos + '&order=revisada_en.desc&limit=200');
  // Dos consultas simples en vez de un or() de PostgREST (sin precedente ya
  // probado en este archivo) — se fusionan y ordenan aquí, más barato de
  // verificar que arriesgar una sintaxis de filtro nueva sin probar.
  const conformes = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.true&select=' + campos + '&order=revisada_en.desc&limit=100');
  const gestionadas = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.false&gestionada_en=not.is.null&select=' + campos + '&order=revisada_en.desc&limit=100');
  const resueltas = conformes.concat(gestionadas)
    .sort(function (a, b) { return new Date(b.revisada_en) - new Date(a.revisada_en); })
    .slice(0, 100);
  _anadirEanRevisiones_(abiertas.concat(diferencias));

  const hoy = supaSelect_('revisiones_palet',
    'creada_en=gte.' + encodeURIComponent(_inicioHoyRevisionesIso_()) + '&select=tienda_origen');
  const conformesHoy = supaSelect_('revisiones_palet',
    'estado=eq.revisada&conforme=eq.true&revisada_en=gte.' + encodeURIComponent(_inicioHoyRevisionesIso_()) + '&select=tienda_origen');

  function contar(filas) {
    const c = { '014': 0, '279': 0 };
    filas.forEach(function (f) { c[f.tienda_origen] = (c[f.tienda_origen] || 0) + 1; });
    return c;
  }
  return _json_({ abiertas: abiertas, diferencias: diferencias, resueltas: resueltas, creadasHoy: contar(hoy), conformesHoy: contar(conformesHoy) });
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
