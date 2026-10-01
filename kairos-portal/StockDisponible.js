/** Stock disponible por código+tienda para "Buscar pedido Pyxis" (solo
 *  lectura). Usa el mismo cálculo que el alta de peticiones (_stockDetalle_ en
 *  Peticiones.js): físico del último snapshot menos lo comprometido por
 *  peticiones abiertas (asignadas o no) y por las preparadas después del
 *  snapshot. Antes tenía su propia versión simplificada que solo restaba las
 *  líneas con palet asignado desde la última carga de stock, y por eso se
 *  "olvidaba" lo reservado en cada carga y no veía las líneas sin palet. */
function stockDisponible(tienda, codigoLm) {
  return _stockDetalle_(tienda, codigoLm).disponible;
}
