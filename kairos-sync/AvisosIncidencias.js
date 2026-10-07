/** Aviso por correo a los gestores de cada tienda cuando entra una incidencia
 *  de preparación (faltante total o parcial) — ver kairos-operario (las
 *  marca el operario) y kairos-portal/Incidencias.js (la tienda las ve y
 *  sigue ahí). Trigger cada 5 minutos: junta las incidencias nuevas de cada
 *  tienda en UN correo y marca las líneas (lineas.incidencia_aviso_en) solo
 *  si el envío ha ido bien, así un fallo de correo se reintenta solo.
 *
 *  Las que ya existían al activar el aviso (migración 032) quedaron marcadas
 *  como avisadas: no se envía nada retroactivo. */

const DESTINATARIOS_INCIDENCIAS_ = {
  '014': ['pedcliente.marbella@leroymerlin.es', 'miguel-angel.gonzalez5@leroymerlin.es', 'juan-ignacio.gonzalez@leroymerlin.es',
    'jose-manuel.botia@leroymerlin.es', 'jose-maria.marandino@leroymerlin.es'],
  '279': ['pedcliente.mijas@leroymerlin.es', 'carlos.fuentes@leroymerlin.es'],
};
const NOMBRE_TIENDA_AVISO_ = { '014': 'Marbella', '279': 'Mijas' };
const PORTAL_URL_AVISO_ = 'https://script.google.com/a/macros/ext.leroymerlin.es/s/AKfycbx-OUWwyJijJJLFmpSnVDDDCPjgj6YG2SkbGhKny2rlebGUgoiTBohgcgbwVKhfAJyN/exec';
const ESTADOS_INCIDENCIA_AVISO_ = ['Sin Palet', 'Sin Mercancía', 'Otras Incidencias', 'Parcial'];
// Solo incidencias recientes: si el aviso estuvo parado, no se manda historia vieja.
const VENTANA_AVISO_MS_ = 3 * 24 * 60 * 60 * 1000;

function _escHtmlAviso_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function _textoIncidenciaAviso_(l) {
  if (l.estado_negocio === 'Parcial') return 'Parcial: preparado ' + l.cantidad_preparada + ' de ' + l.cantidad + ' ' + l.unidad_medida;
  if (l.estado_negocio === 'Sin Mercancía') return 'Sin mercancía: nada preparado de ' + l.cantidad + ' ' + l.unidad_medida;
  if (l.estado_negocio === 'Sin Palet') return 'Sin palet: nada preparado de ' + l.cantidad + ' ' + l.unidad_medida;
  return 'Otra incidencia: nada preparado de ' + l.cantidad + ' ' + l.unidad_medida;
}

function _etiquetaPedidoAviso_(p) {
  if (p.tipo === 'pedido_cliente') return 'Pedido cliente ' + (p.num_pedido || '');
  if (p.tipo === 'cesion') return 'Cesión ' + (p.num_cesion || '');
  return 'Refill';
}

/** Cuerpo HTML del correo de una tienda. Sin emojis (se rompen en algunos
 *  clientes con GmailApp/MailApp). */
function _htmlAvisoIncidencias_(nombreTienda, lineas) {
  const filas = lineas.map(function (l) {
    const p = l.peticiones || {};
    return '<tr>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e3e1da;vertical-align:top;"><b>' + _escHtmlAviso_(_etiquetaPedidoAviso_(p)) + '</b></td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e3e1da;vertical-align:top;">' + _escHtmlAviso_(l.codigo_lm) + '<br>' + _escHtmlAviso_(l.designacion || '') + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e3e1da;vertical-align:top;">' + _escHtmlAviso_(_textoIncidenciaAviso_(l)) +
        (l.incidencia_motivo ? '<br><span style="color:#6b675d;">Motivo: ' + _escHtmlAviso_(l.incidencia_motivo) + '</span>' : '') + '</td>' +
      '</tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#201f1c;max-width:680px;">' +
    '<h2 style="margin:0 0 6px;font-size:18px;">Incidencia de preparación en ' + _escHtmlAviso_(nombreTienda) + '</h2>' +
    '<p style="margin:0 0 12px;color:#4a473f;">Plataforma no ha podido preparar completa esta mercancía:</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:13.5px;">' +
      '<tr style="background:#f1efe8;text-align:left;"><th style="padding:8px 10px;">Pedido</th><th style="padding:8px 10px;">Artículo</th><th style="padding:8px 10px;">Incidencia</th></tr>' +
      filas +
    '</table>' +
    '<p style="margin:14px 0 4px;">Puedes ver el estado y la respuesta de plataforma en la pestaña <b>Incidencias</b> del portal de Kairos:</p>' +
    '<p style="margin:0;"><a href="' + PORTAL_URL_AVISO_ + '">' + PORTAL_URL_AVISO_ + '</a></p>' +
    '</div>';
}

function enviarAvisosIncidencias() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) {
    Logger.log('enviarAvisosIncidencias: ya hay una ejecución en curso, se aborta esta.');
    return 0;
  }
  try {
    return _enviarAvisosIncidencias_();
  } finally {
    lock.releaseLock();
  }
}

function _enviarAvisosIncidencias_() {
  const desde = new Date(Date.now() - VENTANA_AVISO_MS_).toISOString();
  const lineas = supaSelect_('lineas',
    'estado_negocio=in.(' + ESTADOS_INCIDENCIA_AVISO_.map(encodeURIComponent).join(',') + ')' +
    '&incidencia_aviso_en=is.null&preparada_en=gte.' + encodeURIComponent(desde) +
    '&select=id,codigo_lm,designacion,cantidad,cantidad_preparada,unidad_medida,estado_negocio,incidencia_motivo,preparada_en,' +
    'peticiones!inner(tipo,tienda_origen,num_pedido,num_cesion)' +
    '&order=preparada_en.asc&limit=200');
  if (!lineas.length) return 0;

  const porTienda = {};
  lineas.forEach(function (l) {
    const t = (l.peticiones || {}).tienda_origen;
    (porTienda[t] = porTienda[t] || []).push(l);
  });

  var enviadas = 0;
  Object.keys(porTienda).forEach(function (tienda) {
    const destinatarios = DESTINATARIOS_INCIDENCIAS_[tienda];
    if (!destinatarios || !destinatarios.length) {
      Logger.log('AVISO: no hay destinatarios para la tienda ' + tienda + ', no se avisa.');
      return;
    }
    const grupo = porTienda[tienda];
    const nombre = NOMBRE_TIENDA_AVISO_[tienda] || tienda;
    try {
      MailApp.sendEmail({
        to: destinatarios.join(','),
        subject: 'Kairos - Incidencia de preparación en ' + nombre + (grupo.length > 1 ? ' (' + grupo.length + ')' : ''),
        htmlBody: _htmlAvisoIncidencias_(nombre, grupo),
        name: 'Kairos',
      });
    } catch (err) {
      Logger.log('Error enviando el aviso de ' + nombre + ': ' + err.message + ' — se reintenta en la próxima ejecución.');
      return;
    }
    supaUpdate_('lineas',
      'id=in.(' + grupo.map(function (l) { return encodeURIComponent(l.id); }).join(',') + ')',
      { incidencia_aviso_en: new Date().toISOString() });
    enviadas += grupo.length;
  });
  Logger.log('Avisos de incidencias: ' + enviadas + ' línea(s) avisadas.');
  return enviadas;
}

/** Ejecutar UNA vez desde el editor (pide permiso de envío de correo) para
 *  programar el aviso cada 5 minutos. Reejecutarla es seguro. */
function instalarTriggerAvisosIncidencias() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarAvisosIncidencias') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarAvisosIncidencias').timeBased().everyMinutes(5).create();
  Logger.log('Trigger de enviarAvisosIncidencias instalado (cada 5 min).');
}
