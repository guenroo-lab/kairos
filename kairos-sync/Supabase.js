/** Cliente mínimo de la API REST de Supabase (PostgREST) para el esquema preparacion. */

function _supaKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeaders_(metodo) {
  const h = {
    apikey: _supaKey_(),
    Authorization: 'Bearer ' + _supaKey_(),
  };
  if (metodo === 'GET') {
    h['Accept-Profile'] = CFG.SUPABASE_SCHEMA;
  } else {
    h['Content-Profile'] = CFG.SUPABASE_SCHEMA;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

/** GET de `tabla` con un filtro PostgREST (p.ej. 'tienda=eq.014&select=id&limit=1').
 *  Bug real (revisión adversarial con Codex CLI, 2026-09-22): cargarStockFisico_
 *  llamaba a supaSelect_ sin que existiera en este proyecto (solo en
 *  kairos-operario/kairos-portal) — ReferenceError en cuanto un CSV daba 0
 *  filas, tirando abajo TODA la carga (no solo la tienda afectada). */
function supaSelect_(tabla, queryString) {
  const url = CFG.SUPABASE_URL + '/rest/v1/' + tabla + '?' + queryString;
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: _supaHeaders_('GET'),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase select ' + code + ': ' + resp.getContentText());
  const texto = resp.getContentText();
  return texto ? JSON.parse(texto) : [];
}

/** upsert de un array de objetos en `tabla`, resolviendo conflictos por `onConflict`. */
function supaUpsert_(tabla, filas, onConflict) {
  if (!filas.length) return;
  const url = CFG.SUPABASE_URL + '/rest/v1/' + tabla + '?on_conflict=' + encodeURIComponent(onConflict);
  const headers = _supaHeaders_('POST');
  headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(filas),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase upsert ' + code + ': ' + resp.getContentText());
}

/** Borra filas de `tabla` que cumplan `queryString` (filtro PostgREST). */
function supaDelete_(tabla, queryString) {
  const url = CFG.SUPABASE_URL + '/rest/v1/' + tabla + '?' + queryString;
  const resp = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: _supaHeaders_('DELETE'),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase delete ' + code + ': ' + resp.getContentText());
}

/** Inserta un array de objetos en `tabla` (sin resolución de conflictos). */
function supaInsertMany_(tabla, filas) {
  if (!filas.length) return;
  const url = CFG.SUPABASE_URL + '/rest/v1/' + tabla;
  const headers = _supaHeaders_('POST');
  headers['Prefer'] = 'return=minimal';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(filas),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase insert ' + code + ': ' + resp.getContentText());
}

/** Ejecutar a mano desde el editor tras escribir el helper. */
function test_supaPing() {
  const resp = UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/tiendas?select=codigo', {
    method: 'get',
    headers: _supaHeaders_('GET'),
    muteHttpExceptions: true,
  });
  Logger.log(resp.getResponseCode() + ' ' + resp.getContentText());
  if (resp.getResponseCode() !== 200) throw new Error('Ping falló');
  const filas = JSON.parse(resp.getContentText());
  if (filas.length !== 3) throw new Error('Esperaba 3 tiendas, hay ' + filas.length);
  Logger.log('OK: ' + filas.map(function (f) { return f.codigo; }).join(', '));
}
