/** Cálculo de stock disponible por código+tienda, solo lectura — versión
 *  simplificada del reparto de kairos-operario/StockAsignacion.js para el
 *  portal (aquí no hace falta elegir SSCC concretos, solo un total).
 *
 *  Duplicación deliberada del criterio de parseo del sscc: si cambia el
 *  formato en StockAsignacion.js (sscc + " (Xud)"), hay que actualizar
 *  esta función a la vez, si no una línea de refill se cuenta mal aquí
 *  (mismo bug que se cerró para el remanente del reparto). */
function _totalComprometido_(tienda, codigoLm, desde) {
  var q = 'codigo_lm=eq.' + encodeURIComponent(codigoLm) +
    '&sscc=not.is.null&select=sscc,cantidad,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  if (desde) q += '&sscc_asignado_en=gte.' + encodeURIComponent(desde);
  const filas = supaSelect_('lineas', q);
  var total = 0;
  filas.forEach(function (l) {
    const raw = String(l.sscc || '');
    const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
    partes.forEach(function (p) {
      const m = p.trim().match(/\((\d+(?:[.,]\d+)?)\s*ud\)$/);
      total += m ? Number(m[1].replace(',', '.')) : (partes.length === 1 ? Number(l.cantidad) || 0 : 0);
    });
  });
  return total;
}

function stockDisponible(tienda, codigoLm) {
  const filas = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
  const totalFisico = filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
  const ultimoSync = filas.length ? filas.reduce(function (max, f) { return f.sincronizado_en > max ? f.sincronizado_en : max; }, '') : null;
  return totalFisico - _totalComprometido_(tienda, codigoLm, ultimoSync);
}
