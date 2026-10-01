/** Cliente REST mínimo de Supabase (PostgREST), multi-esquema
 *  (preparacion / public) con la service_role key. */

function _supaKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeaders_(metodo, schema) {
  const key = _supaKey_();
  const h = { apikey: key, Authorization: 'Bearer ' + key };
  if (metodo === 'GET') {
    h['Accept-Profile'] = schema;
  } else {
    h['Content-Profile'] = schema;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

function _supaFetch_(metodo, tabla, queryString, payload, schema) {
  schema = schema || CFG.SCHEMA_PREP;
  var url = CFG.SUPABASE_URL + '/rest/v1/' + tabla;
  if (queryString) url += '?' + queryString;
  const headers = _supaHeaders_(metodo, schema);
  if (payload !== undefined) headers['Prefer'] = 'return=representation';
  const opciones = { method: metodo.toLowerCase(), headers: headers, muteHttpExceptions: true };
  if (payload !== undefined) opciones.payload = JSON.stringify(payload);
  const resp = UrlFetchApp.fetch(url, opciones);
  if (resp.getResponseCode() >= 300) {
    throw new Error('Supabase ' + metodo + ' ' + tabla + ' ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  const texto = resp.getContentText();
  return texto ? JSON.parse(texto) : null;
}

function supaSelect_(tabla, queryString, schema) {
  return _supaFetch_('GET', tabla, queryString, undefined, schema);
}

/** supaSelect_ con un filtro "campo=in.(valores)" partido en lotes de 30: la
 *  URL de UrlFetchApp no admite más de ~2 KB (30 uuids ≈ 1,1 KB), y una lista
 *  de ids que crece con el uso (peticiones activas, etc.) acabaría rompiendo
 *  la pantalla. `resto` = el resto de la query (select, filtros) SIN order ni
 *  limit globales: se aplican por lote. Devuelve todas las filas juntas. */
function supaSelectIn_(tabla, campo, valores, resto, schema) {
  const filas = [];
  function lote_(vals) {
    const q = campo + '=in.(' + vals.map(function (v) { return encodeURIComponent(v); }).join(',') + ')' + (resto ? '&' + resto : '');
    const r = supaSelect_(tabla, q, schema);
    // La API corta en silencio en 1000 filas: si un lote llega justo al tope se
    // parte por la mitad y se repite, para no perder filas.
    if (r.length >= 1000 && vals.length > 1) {
      const mitad = Math.ceil(vals.length / 2);
      lote_(vals.slice(0, mitad));
      lote_(vals.slice(mitad));
      return;
    }
    r.forEach(function (f) { filas.push(f); });
  }
  for (var i = 0; i < valores.length; i += 30) lote_(valores.slice(i, i + 30));
  return filas;
}
function supaInsert_(tabla, fila, schema) {
  const filas = _supaFetch_('POST', tabla, '', fila, schema);
  if (!filas || !filas.length) throw new Error('Supabase insert en "' + tabla + '" no devolvió ninguna fila.');
  return filas[0];
}
function supaInsertMany_(tabla, filas, schema) {
  return _supaFetch_('POST', tabla, '', filas, schema);
}
function supaUpdate_(tabla, queryString, cambios, schema) {
  return _supaFetch_('PATCH', tabla, queryString, cambios, schema);
}
function supaDelete_(tabla, queryString, schema) {
  return _supaFetch_('DELETE', tabla, queryString, {}, schema);
}

/** Prueba de humo: lee las 3 tiendas sembradas en la pieza 1. */
function test_supaSmoke() {
  const filas = supaSelect_('tiendas', 'select=codigo,nombre&order=codigo.asc');
  return _json_({ ok: filas.length === 3, filas: filas });
}
