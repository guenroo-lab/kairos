function listarOperarios() {
  const filas = supaSelect_('operarios', 'activo=eq.true&select=nombre,color&order=nombre.asc');
  return _json_(filas);
}
