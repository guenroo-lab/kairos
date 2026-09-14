/** Buscador de solo lectura sobre preparacion.stock_fisico (Pieza 5). */
function buscarStock(codigoLm) {
  codigoLm = String(codigoLm || '').trim();
  if (!codigoLm) return _json_([]);
  const filas = supaSelect_('stock_fisico',
    'codigo_lm=eq.' + encodeURIComponent(codigoLm) + '&select=tienda,sscc,ubicacion,cantidad&order=tienda.asc');
  return _json_(filas);
}
