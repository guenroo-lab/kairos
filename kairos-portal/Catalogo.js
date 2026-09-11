/** Autocompletar artículo por código LM o por designación, contra el
 *  catálogo derivado del Excel de inventario (pieza 1). */
function buscarArticulos(texto) {
  texto = String(texto || '').trim();
  if (texto.length < 2) return _json_([]);

  const esCodigo = /^\d+$/.test(texto);
  const filtro = esCodigo
    ? 'codigo_lm=ilike.*' + encodeURIComponent(texto) + '*'
    : 'designacion=ilike.*' + encodeURIComponent(texto) + '*';

  const filas = supaSelect_('catalogo', filtro + '&select=codigo_lm,ean,designacion,seccion,foto_url&limit=15');
  return _json_(filas);
}
