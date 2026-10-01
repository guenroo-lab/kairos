function listarCola(filtroTienda, filtroTipo) {
  var q = 'estado=in.(pendiente,en_preparacion)' +
    '&visible_desde=lte.' + _hoyMadridIso_() +
    '&select=id,tipo,tienda_origen,tienda_destino,num_pedido,num_cesion,transporte,motivo,cola_individual,creada_en,en_curso_por,en_curso_desde,solicitante_ldap,fecha_entrega' +
    '&order=creada_en.asc&limit=200';
  if (filtroTienda) q += '&tienda_origen=eq.' + encodeURIComponent(filtroTienda);
  if (filtroTipo) q += '&tipo=eq.' + encodeURIComponent(filtroTipo);

  const peticiones = supaSelect_('peticiones', q);
  if (!peticiones.length) return _json_([]);

  const lineas = supaSelectIn_('lineas', 'peticion_id', peticiones.map(function (p) { return p.id; }),
    'select=id,peticion_id,codigo_lm,ean,estado_preparacion,seccion,designacion,ubicacion,sscc,cantidad,unidad_medida');

  const previstas = _ubicacionesPrevistas_(peticiones, lineas);

  peticiones.forEach(function (p) {
    const propias = lineas.filter(function (l) { return l.peticion_id === p.id; });
    p.totalLineas = propias.length;
    p.lineasPreparadas = propias.filter(function (l) { return l.estado_preparacion === 'preparado'; }).length;
    p.tiendaNombre = CFG.TIENDAS[p.tienda_origen] || p.tienda_origen;
    p.tiendaDestinoNombre = p.tienda_destino ? (CFG.TIENDAS[p.tienda_destino] || p.tienda_destino) : null;
    var secciones = [];
    propias.forEach(function (l) { if (l.seccion && secciones.indexOf(l.seccion) === -1) secciones.push(l.seccion); });
    p.secciones = secciones;
    p.articulo = propias.length === 1 ? propias[0].designacion : null;
    if (propias.length === 1) {
      p.articuloLm = propias[0].codigo_lm;
      p.articuloEan = propias[0].ean || null;
    }
    p.totalUnidades = propias.reduce(function (s, l) { return s + (Number(l.cantidad) || 0); }, 0);
    p.unidadTexto = (propias.length && propias[0].unidad_medida === 'palet') ? (p.totalUnidades === 1 ? 'palet' : 'palets') : 'ud';
    var ubicaciones = [];
    propias.forEach(function (l) {
      const dir = l.ubicacion || previstas[l.id];
      if (!dir) return;
      if (!l.ubicacion) p.ubicacionPrevista = true;
      String(dir).split(' + ').forEach(function (d) {
        d = d.trim();
        if (d && ubicaciones.indexOf(d) === -1) ubicaciones.push(d);
      });
    });
    p.ubicaciones = ubicaciones;
    p.sinStockPrevisto = propias.some(function (l) { return !l.sscc && previstas[l.id] === null; });
    var sscc = [];
    propias.forEach(function (l) {
      _parseSsccMulti_(l.sscc, l.cantidad).forEach(function (parte) {
        if (parte.sscc && sscc.indexOf(parte.sscc) === -1) sscc.push(parte.sscc);
      });
    });
    p.sscc = sscc;
  });

  return _json_(peticiones);
}

/** Dirección PREVISTA de las líneas que aún no tienen palet asignado (el
 *  palet real se asigna al abrir el pedido, ver asignarSsccSiFalta_). Solo
 *  lectura: no reserva ni escribe nada. Misma lógica que
 *  _repartirEntreCandidatos_ pero en lote para toda la cola, simulando el
 *  reparto en orden de creación para que dos líneas del mismo código no
 *  apunten al mismo palet. Devuelve {lineaId: 'dir' | 'dir1 + dir2' | null};
 *  null = no hay stock suficiente. Si falla, la cola sigue sin previsión. */
function _ubicacionesPrevistas_(peticiones, lineas) {
  const previstas = {};
  try {
    const tiendaDe = {};
    const orden = {};
    peticiones.forEach(function (p, i) { tiendaDe[p.id] = p.tienda_origen; orden[p.id] = i; });
    const pendientes = lineas.filter(function (l) { return !l.sscc; });
    if (!pendientes.length) return previstas;

    const tiendas = [];
    pendientes.forEach(function (l) {
      const t = tiendaDe[l.peticion_id];
      if (tiendas.indexOf(t) === -1) tiendas.push(t);
    });

    tiendas.forEach(function (tienda) {
      const deTienda = pendientes
        .filter(function (l) { return tiendaDe[l.peticion_id] === tienda; })
        .sort(function (a, b) { return orden[a.peticion_id] - orden[b.peticion_id]; });
      const codigos = [];
      deTienda.forEach(function (l) { if (codigos.indexOf(l.codigo_lm) === -1) codigos.push(l.codigo_lm); });
      const lista = codigos.map(encodeURIComponent).join(',');

      const stock = supaSelectIn_('stock_fisico', 'codigo_lm', codigos, 'tienda=eq.' + encodeURIComponent(tienda));
      const marca = _marcaDeSnapshot_(stock);
      const comprometidas = _lineasComprometidas_(tienda, codigos, marca);
      const enRefill = _paletsDeRefill_(tienda, marca); // palets que un refill se lleva enteros

      const uso = {};
      comprometidas.forEach(function (l) {
        l.partes.forEach(function (parte) {
          if (!parte.sscc) return;
          const k = l.codigo_lm + '|' + parte.sscc;
          uso[k] = (uso[k] || 0) + parte.cantidad;
        });
      });

      // SSCC ya asignados (reales) a otras líneas de la misma petición.
      const usadosEnPeticion = {};
      lineas.forEach(function (l) {
        if (!l.sscc || tiendaDe[l.peticion_id] !== tienda) return;
        const arr = usadosEnPeticion[l.peticion_id] || (usadosEnPeticion[l.peticion_id] = []);
        _parseSsccMulti_(l.sscc, 0).forEach(function (parte) { if (parte.sscc && arr.indexOf(parte.sscc) === -1) arr.push(parte.sscc); });
      });

      deTienda.forEach(function (l) {
        const candidatos = stock.filter(function (c) { return c.codigo_lm === l.codigo_lm; });
        function remanente(c) { return enRefill[c.sscc] ? 0 : Number(c.cantidad) - (uso[l.codigo_lm + '|' + c.sscc] || 0); }
        const necesarias = Number(l.cantidad);
        const mios = usadosEnPeticion[l.peticion_id] || (usadosEnPeticion[l.peticion_id] = []);

        var tomados = null; // [{sscc, ubicacion, cantidad}]
        for (var i = 0; i < candidatos.length && !tomados; i++) {
          if (mios.indexOf(candidatos[i].sscc) !== -1 && remanente(candidatos[i]) >= necesarias) {
            tomados = [{ sscc: candidatos[i].sscc, ubicacion: candidatos[i].ubicacion, cantidad: necesarias }];
          }
        }
        for (var j = 0; j < candidatos.length && !tomados; j++) {
          if (remanente(candidatos[j]) >= necesarias) {
            tomados = [{ sscc: candidatos[j].sscc, ubicacion: candidatos[j].ubicacion, cantidad: necesarias }];
          }
        }
        if (!tomados) {
          const disponibles = candidatos
            .map(function (c) { return { sscc: c.sscc, ubicacion: c.ubicacion, remanente: remanente(c) }; })
            .filter(function (c) { return c.remanente > 0; })
            .sort(function (a, b) { return b.remanente - a.remanente; });
          var restante = necesarias;
          const reparto = [];
          for (var k = 0; k < disponibles.length && restante > 0; k++) {
            const tomar = Math.min(disponibles[k].remanente, restante);
            reparto.push({ sscc: disponibles[k].sscc, ubicacion: disponibles[k].ubicacion, cantidad: tomar });
            restante -= tomar;
          }
          if (restante > 0) { previstas[l.id] = null; return; }
          tomados = reparto;
        }

        tomados.forEach(function (t) {
          const key = l.codigo_lm + '|' + t.sscc;
          uso[key] = (uso[key] || 0) + t.cantidad;
          if (mios.indexOf(t.sscc) === -1) mios.push(t.sscc);
        });
        previstas[l.id] = tomados.map(function (t) { return t.ubicacion; }).join(' + ');
      });
    });
  } catch (err) {
    console.error('_ubicacionesPrevistas_: ' + err.message);
  }
  return previstas;
}

/** Recuento de peticiones pendientes/en preparación por tienda, para la
 *  pantalla de selección de tienda (iconos grandes con contador). */
function contarPeticionesPorTienda() {
  const filas = supaSelect_('peticiones', 'estado=in.(pendiente,en_preparacion)&visible_desde=lte.' + _hoyMadridIso_() + '&select=tienda_origen');
  const conteo = {};
  filas.forEach(function (f) { conteo[f.tienda_origen] = (conteo[f.tienda_origen] || 0) + 1; });
  return _json_(conteo);
}
