/** ============ Ocupación del almacén SIE (Mijas y Marbella) ============
 * El motor es la app «Ocupación Tiendas SIE» (Desktop\Proyectos\OcupacionTiendas, su Api.js): guarda la fila en su
 * Sheet y su trigger de 5 min manda los 3 correos de siempre. Kairos solo le habla por HTTP, igual que con HODOS:
 *   GET  ?accion=ocupacion                                  → historial + capacidades
 *   POST {accion:'registrar' | 'corregir', idRegistro, libresMijas, libresMarbella, registradoPor, origen}
 * Spec: docs/superpowers/specs/2026-10-16-ocupacion-sie-design.md
 *
 * Las tres funciones públicas devuelven SIEMPRE un JSON {ok, ...}; los errores van en `error` (nunca se lanzan), así la
 * pantalla enseña el motivo tal cual. */

// Deployment de producción del motor (acceso solo dominio). Misma forma de URL (/macros/s/<id>/exec) que las llamadas a
// HODOS que ya funcionan con el token de Bearer. La propiedad OCUPACION_WEBAPP_URL lo sustituye sin tocar código.
const OCUPACION_URL_POR_DEFECTO_ = 'https://script.google.com/macros/s/AKfycbw1ssfsAFEHBS1mm0ya_pE3nNOJALrqPqfXbK0lmQ9uQVZJVk2OqOF2lzV98VdPcTRZ1g/exec';
const OCUPACION_CACHE_CLAVE_ = 'kairos_ocupacion_sie_v1';
const OCUPACION_CACHE_SEGUNDOS_ = 60;
const OCUPACION_ORIGEN_ = 'Kairos operario';

function _urlOcupacion_() {
  const propia = PropertiesService.getScriptProperties().getProperty('OCUPACION_WEBAPP_URL');
  return String(propia || OCUPACION_URL_POR_DEFECTO_).trim();
}

/** Llama al motor. Devuelve el JSON del motor, o {ok:false, error} si no contesta bien. Nunca lanza. */
function _llamarOcupacion_(metodo, urlExtra, payload) {
  try {
    const opciones = {
      method: metodo,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: true,
    };
    if (payload) {
      opciones.contentType = 'application/json';
      opciones.payload = JSON.stringify(payload);
    }
    const resp = UrlFetchApp.fetch(_urlOcupacion_() + (urlExtra || ''), opciones);
    const texto = resp.getContentText();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (eParse) {
      return { ok: false, error: 'La app de Ocupación no ha respondido con datos (código ' + resp.getResponseCode() + '). Puede faltar el permiso o la versión nueva de esa app.' };
    }
    if (!json || typeof json !== 'object') return { ok: false, error: 'Respuesta no válida de la app de Ocupación.' };
    return json;
  } catch (err) {
    return { ok: false, error: 'No se pudo hablar con la app de Ocupación: ' + err.message };
  }
}

function _invalidarCacheOcupacion_() {
  try { CacheService.getScriptCache().remove(OCUPACION_CACHE_CLAVE_); } catch (e) { /* la caché es opcional */ }
}

/** Historial y capacidades para el operario y las pantallas de jefe. Caché de 60 s (el dato cambia 2 veces por semana). */
function obtenerOcupacionSie(forzar) {
  const cache = CacheService.getScriptCache();
  if (!forzar) {
    try {
      const guardado = cache.get(OCUPACION_CACHE_CLAVE_);
      if (guardado) return guardado;
    } catch (e) { /* sin caché se lee directo */ }
  }
  const json = _llamarOcupacion_('get', '?accion=ocupacion', null);
  const texto = _json_(json);
  if (json.ok) {
    try { cache.put(OCUPACION_CACHE_CLAVE_, texto, OCUPACION_CACHE_SEGUNDOS_); } catch (e) { /* demasiado grande o sin caché: da igual */ }
  }
  return texto;
}

function _entero_(v) {
  if (typeof v === 'string') { if (!/^\s*\d+\s*$/.test(v)) return null; v = Number(v); }
  return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0) ? v : null;
}

function _datosOcupacion_(accion, operario, libresMijas, libresMarbella, idRegistro) {
  const mijas = _entero_(libresMijas);
  const marbella = _entero_(libresMarbella);
  if (mijas === null || marbella === null) return { error: 'Los huecos libres tienen que ser números enteros (0 o más).' };
  const id = String(idRegistro == null ? '' : idRegistro);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { error: 'Falta el identificador del registro. Vuelve a empezar.' };
  const nombre = String(operario == null ? '' : operario).replace(/\s+/g, ' ').trim().substring(0, 60);
  if (nombre.length < 2) return { error: 'Elige primero quién eres (operario).' };
  return {
    payload: { accion: accion, idRegistro: id, libresMijas: mijas, libresMarbella: marbella, registradoPor: nombre, origen: OCUPACION_ORIGEN_ },
  };
}

function _enviarOcupacion_(accion, operario, libresMijas, libresMarbella, idRegistro) {
  const d = _datosOcupacion_(accion, operario, libresMijas, libresMarbella, idRegistro);
  if (d.error) return _json_({ ok: false, error: d.error });
  const json = _llamarOcupacion_('post', '', d.payload);
  if (json.ok) _invalidarCacheOcupacion_();
  return _json_(json);
}

/** El operario guarda los huecos libres de las dos tiendas: sale la fila y, en ≤ 5 min, los 3 informes. */
function registrarOcupacionSie(operario, libresMijas, libresMarbella, idRegistro) {
  return _enviarOcupacion_('registrar', operario, libresMijas, libresMarbella, idRegistro);
}

/** Corrige un registro propio mientras sus informes siguen en cola (el motor lo comprueba). */
function corregirOcupacionSie(operario, libresMijas, libresMarbella, idRegistro) {
  return _enviarOcupacion_('corregir', operario, libresMijas, libresMarbella, idRegistro);
}
