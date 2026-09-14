function listarOperarios() {
  const filas = supaSelect_('operarios', 'activo=eq.true&select=nombre,color,rol&order=nombre.asc');
  return _json_(filas);
}
