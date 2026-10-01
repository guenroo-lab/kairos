/** ===================== INTEGRACIÓN HODOS =====================
 * Mismo patrón que PreparacionPedidosPC/PreparacionBackend.js
 * (_intentarCrearEtiquetaHodos_): pedido_cliente SIN transporte, y toda
 * cesión, necesitan una etiqueta HODOS "Petición Reserva" para llegar a la
 * tienda — se crea UNA sola etiqueta por petición completa en cuanto se
 * cierra su última línea. Aquí el idUnico se guarda en lineas.hodos_id
 * (mismo campo en todas las líneas de la petición), ya existente desde
 * Pieza 1 — no hace falta columna nueva.
 */

const SUBTIPO_HODOS_PREPARACION_ = 'Petición Reserva';
const INCIDENCIAS_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias'];

function _dispararEtiquetaSiProcede_(peticionId) {
  // Bug real (revisión con Codex CLI, 2026-09-22): comprobar hodos_id y
  // crear la etiqueta eran dos pasos sin nada que los serializara — dos
  // cierres casi a la vez (última línea marcada dos veces, reintento tras
  // fallo de guardado) podían pasar juntos el check y crear la etiqueta dos
  // veces. LockService serializa las ejecuciones de este script.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (errLock) {
    console.error('_dispararEtiquetaSiProcede_ (' + peticionId + '): no se pudo obtener el lock, se reintentará en el próximo cierre de línea.');
    return;
  }
  try {
    const cab = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(peticionId));
    if (!cab.length) return;
    const peticion = cab[0];
    if (peticion.estado !== 'cerrada') return; // pedido aún no completo

    const generaEtiqueta = (peticion.tipo === 'pedido_cliente' && !peticion.transporte) || peticion.tipo === 'cesion';
    if (!generaEtiqueta) return;

    const lineas = supaSelect_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId));
    if (!lineas.length) return;
    if (lineas.some(function (l) { return l.hodos_id; })) return; // ya se creó (reintentos/carreras)

    const limpias = lineas.filter(function (l) { return INCIDENCIAS_.indexOf(l.estado_negocio) === -1; });
    if (!limpias.length) return; // todo incidencia, no hay nada que enviar a HODOS

    const destino = peticion.tipo === 'cesion'
      ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino)
      : (CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen);

    // Bug real (2026-09-22, encontrado revisando con Codex CLI el bug de
    // HODOS_WEBAPP_URL): una cesión guarda su identificador en num_cesion, no en
    // num_pedido — la propia BD lo exige (006_peticiones.sql: num_pedido debe ser
    // NULL fuera de pedido_cliente). Antes se mandaba siempre num_pedido, así que
    // toda cesión llegaba a HODOS con pedido:null y HODOS la rechazaba con "Falta
    // el número de pedido" (nunca se vio en el E2E del 14-sep porque en ese momento
    // fallaba antes, por la URL).
    const idUnico = _enviarEtiquetaHodos_({
      destino: destino,
      pedido: peticion.tipo === 'cesion' ? peticion.num_cesion : peticion.num_pedido,
      tipo: SUBTIPO_HODOS_PREPARACION_,
      origenIntegracion: 'preparacion',
      operario: (limpias[0].operario || ''),
      // Bug real (revisión con Codex CLI, 2026-09-22): una línea 'Parcial'
      // manda a HODOS la cantidad PEDIDA (l.cantidad), no la que de verdad
      // se preparó (l.cantidad_preparada) — la etiqueta HODOS anunciaba más
      // mercancía de la que MyISO llegó a mover.
      items: limpias.map(function (l) {
        const cantidad = l.estado_negocio === 'Parcial' ? Number(l.cantidad_preparada) : Number(l.cantidad);
        return { referencia: String(l.codigo_lm), cantidad: cantidad };
      }),
    });

    // En lotes de 30 ids: una URL de más de ~2 KB (unos 55 uuids) la rechaza
    // UrlFetchApp, y con la etiqueta ya creada eso dejaba hodos_id vacío y
    // permitía crear una segunda etiqueta al reintentar.
    const idsLimpias = limpias.map(function (l) { return l.id; });
    for (var i = 0; i < idsLimpias.length; i += 30) {
      supaUpdate_('lineas', 'id=in.(' + idsLimpias.slice(i, i + 30).join(',') + ')', { hodos_id: idUnico });
    }
  } catch (err) {
    // No debe romper el marcado de línea (ya guardado) — solo se pierde la
    // etiqueta HODOS; reintentable (hodos_id queda vacío, sin bloqueo).
    console.error('_dispararEtiquetaSiProcede_ (' + peticionId + '): ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

function _enviarEtiquetaHodos_(payload) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('HODOS_WEBAPP_URL');
  const token = props.getProperty('INCPC_SHARED_TOKEN');
  if (!url || !token) throw new Error('Faltan HODOS_WEBAPP_URL o INCPC_SHARED_TOKEN en Propiedades del script.');

  payload.token = token;

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  const texto = resp.getContentText();
  let json;
  try {
    json = JSON.parse(texto);
  } catch (eParse) {
    throw new Error('Respuesta no válida de HODOS (¿problema de autenticación?): ' + texto.substring(0, 200));
  }
  if (!json.ok) throw new Error('HODOS rechazó la etiqueta: ' + json.error);
  return json.idUnico;
}

/** ============ Pantalla HODOS (jefe de equipo): crear/editar/anular ============
 * Crear reutiliza el camino real (_enviarEtiquetaHodos_, mismo que el
 * automático) — seguro, ya probado. Editar/Anular NO tienen endpoint real
 * en HODOS todavía: son UPDATE directos contra public.etiquetas, a riesgo
 * asumido (puede no reflejarse en la lógica interna de la app HODOS real
 * si ella hace algo más al cambiar esos campos). */

/** Igual que la pantalla "Petición de Reserva" de la app HODOS real: solo
 *  las pendientes de imprimir (una vez impresas/EN_RUTA desaparecen de ahí,
 *  no son "por hacer" ya). */
function listarEtiquetasCompleto() {
  const etiquetas = supaSelect_('etiquetas',
    'subtipo=eq.' + encodeURIComponent(SUBTIPO_HODOS_PREPARACION_) +
    '&pendiente_impresion_incpc=eq.true' +
    '&select=id_unico,numero_pedido,destino,origen,subtipo,estado,fecha_creacion,pendiente_impresion_incpc,origen_tienda' +
    '&order=fecha_creacion.desc&limit=200',
    'public');
  return _json_(etiquetas);
}

function crearEtiquetaHodosManual(destino, numeroPedido, codigoLm, cantidad, operario) {
  destino = String(destino || '').trim();
  codigoLm = String(codigoLm || '').trim();
  if (!destino) throw new Error('Falta el destino.');
  if (!codigoLm || !cantidad || Number(cantidad) <= 0) throw new Error('Falta artículo o cantidad.');

  const idUnico = _enviarEtiquetaHodos_({
    destino: destino,
    pedido: numeroPedido ? String(numeroPedido).trim() : null,
    tipo: SUBTIPO_HODOS_PREPARACION_,
    origenIntegracion: 'panel-manual',
    operario: operario || '',
    items: [{ referencia: codigoLm, cantidad: Number(cantidad) }],
  });
  return _json_({ idUnico: idUnico });
}

function editarEtiquetaHodos(idUnico, destino, numeroPedido) {
  const cambios = {};
  destino = String(destino || '').trim();
  if (destino) cambios.destino = destino;
  cambios.numero_pedido = numeroPedido ? String(numeroPedido).trim() : null;
  supaUpdate_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico), cambios, 'public');
  return _json_({ ok: true });
}

function anularEtiquetaHodos(idUnico) {
  supaUpdate_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico), { estado: 'ANULADA' }, 'public');
  return _json_({ ok: true });
}
