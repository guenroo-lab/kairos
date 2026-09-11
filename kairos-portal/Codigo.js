/** Funciones del servidor que el arnés de pruebas puede invocar por nombre.
 *  Se amplía en tasks siguientes según se van escribiendo. */
const FUNCIONES_DEBUG_PERMITIDAS = ['test_supaSmoke', 'entrar', 'registrarUsuario', 'listarPendientesAprobacion', 'aprobarUsuario', 'rechazarUsuario', 'buscarArticulos'];

function doGet(e) {
  if (e && e.parameter && e.parameter.debug === 'test') {
    return _responderDebug_(e);
  }
  return HtmlService.createHtmlOutput('Portal.html pendiente (Task 9).');
}

function _responderDebug_(e) {
  const fn = e.parameter.fn;
  const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
  var salida;
  if (FUNCIONES_DEBUG_PERMITIDAS.indexOf(fn) === -1) {
    salida = JSON.stringify({ error: 'Función no permitida en el arnés: ' + fn });
  } else {
    try {
      salida = globalThis[fn].apply(null, args);
    } catch (err) {
      salida = JSON.stringify({ error: err.message });
    }
  }
  return ContentService.createTextOutput(salida).setMimeType(ContentService.MimeType.JSON);
}
