/** Revisión de palet: la tienda pide que plataforma revise cantidad,
 *  referencias y ubicación de un palet. Máximo 3 palets al día por tienda.
 *  Tabla propia (revisiones_palet) — no pasa por la cola de preparación. */

const MAX_REVISIONES_DIA_ = 3;
const REVISAR_VALIDOS_ = ['cantidad', 'referencias', 'ubicacion'];

function _inicioHoyIso_() {
  const a = new Date();
  return new Date(a.getFullYear(), a.getMonth(), a.getDate()).toISOString();
}

function _revisionesCreadasHoy_(tienda) {
  return supaSelect_('revisiones_palet',
    'tienda_origen=eq.' + encodeURIComponent(tienda) + '&creada_en=gte.' + encodeURIComponent(_inicioHoyIso_()) + '&select=id').length;
}

function cupoRevisionesHoy(ldap) {
  const u = _usuarioDe_(ldap);
  return _json_({ usadas: _revisionesCreadasHoy_(u.tienda), maximo: MAX_REVISIONES_DIA_ });
}

/** Se serializa con un lock para que dos peticiones a la vez no se salten el
 *  tope diario. */
function crearRevisionesPalet(ldap, palets, revisar, comentario) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { throw new Error('El sistema está ocupado, inténtalo de nuevo en unos segundos.'); }
  try { return _crearRevisionesPalet_(ldap, palets, revisar, comentario); } finally { lock.releaseLock(); }
}

/** Lo que el sistema sabe de un SSCC (cualquier cantidad, también 0) — para
 *  mostrar el contenido esperado. No exige stock: si no figura, encontrado=false. */
function _contenidoDePalet_(tienda, sscc) {
  const stock = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&sscc=eq.' + encodeURIComponent(sscc) + '&select=codigo_lm,ubicacion,cantidad&order=cantidad.desc');
  if (!stock.length) return { encontrado: false, ubicacion: null, contenido: [] };
  const codigos = stock.map(function (f) { return f.codigo_lm; });
  const catalogo = supaSelect_('catalogo', 'codigo_lm=in.(' + codigos.map(encodeURIComponent).join(',') + ')&select=codigo_lm,designacion');
  const designacion = {};
  catalogo.forEach(function (c) { designacion[c.codigo_lm] = c.designacion; });
  return {
    encontrado: true,
    ubicacion: stock[0].ubicacion,
    contenido: stock.map(function (f) {
      return { codigo_lm: f.codigo_lm, designacion: designacion[f.codigo_lm] || null, cantidad: Number(f.cantidad) };
    }),
  };
}

function buscarPaletParaRevision(ldap, sscc) {
  const u = _usuarioDe_(ldap);
  sscc = String(sscc || '').trim();
  if (!sscc) throw new Error('Falta el SSCC.');
  return _json_(_contenidoDePalet_(u.tienda, sscc));
}

function _crearRevisionesPalet_(ldap, palets, revisar, comentario) {
  const u = _usuarioDe_(ldap);
  if (u.rol === 'vendedor') throw new Error('Tu rol (Vendedor) no puede pedir revisiones de palet.');

  // Cada elemento: { sscc } (palet concreto, exista o no en el sistema) o
  // { busqueda:true, codigo_lm, cantidad } (que busquen un palet de ese artículo).
  const ssccs = [];
  const busquedas = [];
  (palets || []).forEach(function (p) {
    if (p && p.busqueda) {
      const codigo = String(p.codigo_lm || '').trim();
      if (codigo) busquedas.push({ codigo_lm: codigo, cantidad: Number(p.cantidad) > 0 ? Number(p.cantidad) : null });
      return;
    }
    const s = String((p && p.sscc) || '').trim();
    if (s && ssccs.indexOf(s) === -1) ssccs.push(s);
  });
  if (!ssccs.length && !busquedas.length) throw new Error('Elige al menos un palet.');

  const usadas = _revisionesCreadasHoy_(u.tienda);
  if (usadas + ssccs.length + busquedas.length > MAX_REVISIONES_DIA_) {
    const quedan = Math.max(0, MAX_REVISIONES_DIA_ - usadas);
    throw new Error('Máximo ' + MAX_REVISIONES_DIA_ + ' revisiones de palet al día por tienda. Hoy ya se han pedido ' + usadas +
      (quedan ? ' — puedes pedir ' + quedan + ' más.' : ' — no quedan más por hoy.'));
  }

  var queRevisar = (revisar || []).filter(function (r) { return REVISAR_VALIDOS_.indexOf(r) !== -1; });
  if (!queRevisar.length) queRevisar = REVISAR_VALIDOS_.slice();
  comentario = String(comentario || '').trim() || null;

  const filasSscc = ssccs.map(function (sscc) {
    const abiertas = supaSelect_('revisiones_palet',
      'tienda_origen=eq.' + encodeURIComponent(u.tienda) + '&sscc=eq.' + encodeURIComponent(sscc) + '&estado=in.(pendiente,en_revision)&select=id');
    if (abiertas.length) throw new Error('El palet ' + sscc + ' ya tiene una revisión pendiente.');

    const p = _contenidoDePalet_(u.tienda, sscc); // si no figura, se pide igualmente: que lo busquen
    return {
      tienda_origen: u.tienda,
      solicitante_ldap: ldap,
      sscc: sscc,
      ubicacion_esperada: p.ubicacion,
      contenido_esperado: p.contenido,
      revisar: queRevisar,
      comentario: comentario,
    };
  });

  const filasBusqueda = busquedas.map(function (b) {
    const cat = supaSelect_('catalogo', 'codigo_lm=eq.' + encodeURIComponent(b.codigo_lm) + '&select=codigo_lm,designacion');
    return {
      tienda_origen: u.tienda,
      solicitante_ldap: ldap,
      sscc: null,
      ubicacion_esperada: null,
      contenido_esperado: [{ codigo_lm: b.codigo_lm, designacion: cat.length ? cat[0].designacion : null, cantidad: b.cantidad }],
      revisar: queRevisar,
      comentario: comentario,
    };
  });

  const filas = filasSscc.concat(filasBusqueda);
  supaInsertMany_('revisiones_palet', filas);
  return _json_({ ok: true, creadas: filas.length });
}

const TRADUCCION_REVISION_ = { pendiente: 'Solicitada', en_revision: 'En revisión', revisada: 'Revisada' };

function listarMisRevisiones(ldap) {
  const u = _usuarioDe_(ldap);
  if (u.rol === 'vendedor') return _json_([]);
  const filas = supaSelect_('revisiones_palet',
    'tienda_origen=eq.' + encodeURIComponent(u.tienda) +
    '&select=id,sscc,ubicacion_esperada,contenido_esperado,revisar,comentario,estado,conforme,resultado,creada_en,revisada_en,revisada_por,solicitante_ldap' +
    '&order=creada_en.desc&limit=30');
  filas.forEach(function (r) {
    r.estadoTexto = r.estado === 'revisada'
      ? (r.conforme ? 'Revisada · conforme'
        : (r.resultado && r.resultado.localizado === false ? 'Revisada · no localizado' : 'Revisada · con diferencias'))
      : (TRADUCCION_REVISION_[r.estado] || r.estado);
  });
  return _json_(filas);
}
