function buscarPedidoPyxis(ldap, numPedido) {
  const tienda = _tiendaDe_(ldap);
  const lineas = supaSelect_('pedidos_pyxis',
    'tienda=eq.' + encodeURIComponent(tienda) + '&num_pedido=eq.' + encodeURIComponent(String(numPedido).trim()));
  if (!lineas.length) return _json_({ lineas: [] });

  // Varias líneas del pedido pueden compartir código (p.ej. una barra
  // "sobre pedido" cortada a longitudes distintas): el remanente de ese
  // código es un pozo compartido — hay que descontarlo en secuencia
  // dentro de esta misma búsqueda, si no dos líneas del mismo código
  // podrían salir ambas "ok" aunque juntas no quepan en el stock real.
  const disponibleRestante = {};
  // Todo el stock del pedido de una vez (no una consulta por línea).
  const detalle = _stockDetalleVarios_(tienda, lineas.map(function (l) { return l.ref_lm; }));
  return _json_({
    lineas: lineas.map(function (l) {
      if (!(l.ref_lm in disponibleRestante)) {
        disponibleRestante[l.ref_lm] = (detalle[String(l.ref_lm).trim()] || { disponible: 0 }).disponible;
      }
      const disponibleAntes = disponibleRestante[l.ref_lm];
      const tomado = Math.min(Math.max(disponibleAntes, 0), l.cantidad);
      disponibleRestante[l.ref_lm] -= tomado;
      return {
        refLm: l.ref_lm, ean: l.ean, designacion: l.designacion, seccion: l.seccion, cantidad: l.cantidad,
        disponibleEnPlataforma: Math.max(disponibleAntes, 0),
        stock: tomado >= l.cantidad ? 'ok' : (tomado > 0 ? 'parcial' : 'sin'),
      };
    }),
  });
}
