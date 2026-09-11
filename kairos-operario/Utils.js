/** google.script.run devuelve null en silencio si el objeto lleva un Date
 *  embebido. Workaround: el servidor siempre stringify, el cliente parsea. */
function _json_(obj) {
  return JSON.stringify(obj);
}
