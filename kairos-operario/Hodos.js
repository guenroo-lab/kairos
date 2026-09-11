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

function _dispararEtiquetaSiProcede_(peticionId) {
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

    const destino = peticion.tipo === 'cesion'
      ? (CFG.TIENDAS[peticion.tienda_destino] || peticion.tienda_destino)
      : (CFG.TIENDAS[peticion.tienda_origen] || peticion.tienda_origen);

    const idUnico = _enviarEtiquetaHodos_({
      destino: destino,
      pedido: peticion.num_pedido || null,
      tipo: SUBTIPO_HODOS_PREPARACION_,
      origenIntegracion: 'preparacion',
      operario: (lineas[0].operario || ''),
      items: lineas.map(function (l) { return { referencia: String(l.codigo_lm), cantidad: Number(l.cantidad) }; }),
    });

    supaUpdate_('lineas', 'peticion_id=eq.' + encodeURIComponent(peticionId), { hodos_id: idUnico });
  } catch (err) {
    // No debe romper el marcado de línea (ya guardado) — solo se pierde la
    // etiqueta HODOS; reintentable (hodos_id queda vacío, sin bloqueo).
    console.error('_dispararEtiquetaSiProcede_ (' + peticionId + '): ' + err.message);
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
