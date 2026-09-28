/** Carga/reemplaza preparacion.pedidos_pyxis desde el Excel de Pyxis
 *  ("Listado Inventario Pedido Cliente", 014.xlsx / 279.xlsx, carpeta
 *  Inventarios_Plataforma). A diferencia de CatalogoLoader/StockFisicoLoader
 *  (CSV de texto plano), este es un .xlsx real — hay que convertirlo a
 *  Google Sheets primero (Drive Advanced Service v3, ya habilitado en el
 *  manifest de este proyecto) para poder leer sus celdas. getValues()
 *  sobre un Sheets real devuelve TIPOS NATIVOS (número, Date), no texto
 *  — a diferencia del resto de loaders de este archivo, aquí NO hay que
 *  hacer Number()/replace(',','.') a mano sobre strings. */

function _leerXlsxComoFilas_(archivo) {
  const blob = archivo.getBlob();
  const recurso = { name: 'temp_pedidos_pyxis_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS };
  const temporal = Drive.Files.create(recurso, blob); // v3: create()+name, NO insert()+title (eso es v2)
  try {
    return SpreadsheetApp.openById(temporal.id).getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(temporal.id);
  }
}

/** Quita acentos/diacríticos para comparar cabeceras sin depender de qué
 *  variante exacta de un carácter trae el Excel (visto real: Pyxis es un
 *  POS francés, "Réf." en vez de "Ref.", "N° Ped" con signo de grado °
 *  en vez del ordinal º español — ninguno de los dos es un simple typo,
 *  son variantes reales de origen). */
function _sinAcentos_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º]/g, 'o');
}

/** Coincidencia por CONTIENE, no por igualdad exacta (mismo criterio que
 *  encontrarColumna en lm_produccion/ImportarPyxis.gs) — una cabecera con
 *  espacio extra, mayúsculas distintas o texto añadido igual encuentra la
 *  columna. */
function _indiceColumnas_(cabecera, mapa) {
  const normalizada = cabecera.map(function (c) { return _sinAcentos_(String(c).trim().toLowerCase()); });
  const idx = {};
  Object.keys(mapa).forEach(function (clave) {
    idx[clave] = -1;
    for (var i = 0; i < normalizada.length && idx[clave] === -1; i++) {
      for (var j = 0; j < mapa[clave].length; j++) {
        if (normalizada[i].indexOf(_sinAcentos_(mapa[clave][j])) !== -1) { idx[clave] = i; break; }
      }
    }
  });
  return idx;
}

/** Regla real (visto en el propio Pyxis, reutilizada de
 *  lm_produccion/ImportarPyxis.gs:deduplicarLineasPyxis_): colapsar solo
 *  cuando pedido+referencia+dirección+cantidad coinciden EXACTOS. Nunca
 *  sumar. Dos líneas con la misma referencia pero designación/dirección
 *  distinta (p.ej. una barra "sobre pedido" cortada a otra longitud) NO
 *  son duplicados y se quedan las dos. */
function _dedupPedidosPyxis_(filas) {
  const vistos = {};
  const resultado = [];
  filas.forEach(function (f) {
    const clave = f.num_pedido + '|' + f.ref_lm + '|' + f.direccion + '|' + f.cantidad;
    if (vistos[clave]) return;
    vistos[clave] = true;
    resultado.push(f);
  });
  return resultado;
}

function _formatearFecha_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, 'Europe/Madrid', 'dd/MM/yyyy');
  return valor ? String(valor).trim() : null;
}

function _leerPedidosPyxisDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.PEDIDOS_FOLDER_ID);
  const porTienda = {};
  const ahora = new Date().toISOString();

  Object.keys(CFG.PEDIDOS_ARCHIVOS).forEach(function (nombre) {
    const tienda = CFG.PEDIDOS_ARCHIVOS[nombre];
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre + ' — no se toca pedidos_pyxis de la tienda ' + tienda); porTienda[tienda] = null; return; }

    const valores = _leerXlsxComoFilas_(it.next());
    if (valores.length < 2) { porTienda[tienda] = []; return; }

    // La fila 0 es un título/banner ("Listado Inventario Pedido Cliente"),
    // NO la cabecera real (confirmado en real, 2026-09-28) — hay que buscar
    // en las primeras filas cuál es la que de verdad trae los nombres de
    // columna, en vez de asumir que siempre es la fila 0.
    var filaCabecera = -1, idx = null;
    for (var h = 0; h < Math.min(5, valores.length); h++) {
      const candidato = _indiceColumnas_(valores[h], CFG.COL_PEDIDO);
      if (candidato.numPedido !== -1 && candidato.ref !== -1 && candidato.direccion !== -1) {
        filaCabecera = h; idx = candidato; break;
      }
    }
    if (filaCabecera === -1) {
      throw new Error('No se encuentra la cabecera (Nº Ped / Ref. / Dirección) en las primeras 5 filas de ' + nombre + '. Primeras filas: ' + JSON.stringify(valores.slice(0, 5)));
    }

    const filas = [];
    for (var i = filaCabecera + 1; i < valores.length; i++) {
      const fila = valores[i];
      const numPedido = String(fila[idx.numPedido] || '').trim();
      const refLm = String(fila[idx.ref] || '').trim();
      if (!numPedido || !refLm) continue;

      filas.push({
        tienda: tienda,
        num_pedido: numPedido,
        direccion: String(fila[idx.direccion] || '').trim(),
        seccion: idx.seccion !== -1 ? (String(fila[idx.seccion] || '').trim() || null) : null,
        ref_lm: refLm,
        ean: idx.ean !== -1 ? (String(fila[idx.ean] || '').trim() || null) : null,
        designacion: idx.designacion !== -1 ? String(fila[idx.designacion] || '').trim() : '',
        cantidad: Number(fila[idx.cantidad]) || 0,
        fecha_entrega: idx.fechaEntrega !== -1 ? _formatearFecha_(fila[idx.fechaEntrega]) : null,
        sincronizado_en: ahora,
      });
    }
    porTienda[tienda] = _dedupPedidosPyxis_(filas);
  });
  return porTienda;
}

/** Mismo patrón que _cargarStockFisico_: reemplazo completo por tienda,
 *  nunca se borra si el archivo falta o si da 0 filas habiendo datos
 *  antes (posible archivo corrupto — se avisa y se deja como estaba). */
function cargarPedidosPyxis() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) {
    Logger.log('cargarPedidosPyxis: ya hay una ejecución en curso, se aborta esta.');
    return 0;
  }
  try {
    return _cargarPedidosPyxis_(_leerPedidosPyxisDeExcels_());
  } finally {
    lock.releaseLock();
  }
}

function _cargarPedidosPyxis_(porTienda) {
  var subidas = 0;
  Object.keys(porTienda).forEach(function (tienda) {
    const filas = porTienda[tienda];
    if (filas === null) return;

    if (!filas.length) {
      const habia = supaSelect_('pedidos_pyxis', 'tienda=eq.' + encodeURIComponent(tienda) + '&select=id&limit=1');
      if (habia.length) {
        Logger.log('AVISO: el Excel de pedidos de la tienda ' + tienda + ' dio 0 filas pero había datos antes — NO se reemplaza.');
        return;
      }
    }

    supaDelete_('pedidos_pyxis', 'tienda=eq.' + encodeURIComponent(tienda));
    for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
      const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
      supaInsertMany_('pedidos_pyxis', lote);
      subidas += lote.length;
    }
  });
  Logger.log('Pedidos Pyxis: ' + subidas + ' líneas subidas a Supabase.');
  return subidas;
}

/** Ejecutar desde el editor una vez para programar el refresco diario
 *  (08:00 — después de que Pyxis regenera el Excel, visto en real
 *  ~07:16). Reejecutar es seguro: borra el trigger anterior primero. */
function instalarTriggerPedidosPyxis() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cargarPedidosPyxis') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cargarPedidosPyxis').timeBased().atHour(8).everyDays(1).create();
  Logger.log('Trigger de cargarPedidosPyxis instalado (diario, 08:00).');
}
