/** google.script.run devuelve null en silencio si el objeto lleva un Date
 *  embebido. Workaround: el servidor siempre stringify, el cliente parsea. */
function _json_(obj) {
  return JSON.stringify(obj);
}

/** Espejo de kairos-operario/StockAsignacion.js _parseSsccMulti_ — mismo
 *  formato "sscc1 (Xud) + sscc2 (Yud)" o un SSCC suelto. */
function _parseSsccMulti_(valorSscc, cantidadFila) {
  const raw = String(valorSscc || '').trim();
  if (!raw) return [];
  const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
  return partes.map(function (parte) {
    const m = parte.trim().match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*ud\)$/);
    if (m) return { sscc: m[1].trim(), cantidad: Number(m[2].replace(',', '.')) || 0 };
    return { sscc: parte.trim(), cantidad: partes.length === 1 ? (Number(cantidadFila) || 0) : 0 };
  });
}
