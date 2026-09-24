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

/** Artículo a partir de un código de barras leído con la cámara: normalmente
 *  el EAN-13 del producto, o el código LM si la etiqueta lo lleva. Solo
 *  dígitos; se prueban las variantes habituales (UPC-A de 12, GTIN-14). */
function buscarArticuloPorCodigo(codigo) {
  const digitos = String(codigo || '').replace(/[^0-9]/g, '');
  if (!digitos) return _json_([]);
  const campos = '&select=codigo_lm,ean,designacion,seccion,foto_url&limit=15';

  const variantesEan = [digitos];
  if (digitos.length === 12) variantesEan.push('0' + digitos);
  if (digitos.length === 14 && digitos.charAt(0) === '0') variantesEan.push(digitos.slice(1));
  for (var i = 0; i < variantesEan.length; i++) {
    const porEan = supaSelect_('catalogo', 'ean=eq.' + encodeURIComponent(variantesEan[i]) + campos);
    if (porEan.length) return _json_(porEan);
  }
  return _json_(supaSelect_('catalogo', 'codigo_lm=eq.' + encodeURIComponent(digitos) + campos));
}
