/** Carga/reemplaza preparacion.stock_fisico desde los mismos CSV de
 *  inventario que usa CatalogoLoader.js — pero sin deduplicar (una fila por
 *  ubicación/SSCC real) y solo edificio 05 (mismo filtro que el sistema
 *  viejo, PreparacionPedidosPC/config.js PREFIJO_EDIFICIO). El nombre del
 *  fichero (014.csv / 279.csv) indica la tienda de cada fila — mapeo
 *  directo al código de tienda (014→Marbella, 279→Mijas). */

const MAPA_ARCHIVO_TIENDA_ = { '014.csv': '014', '279.csv': '279' };

/** Por tienda: null si el fichero de esa tienda falta o no se pudo leer (no
 *  se debe tocar su stock en Supabase), si no un array de filas (puede estar
 *  vacío si el Excel real no tiene ninguna fila de edificio 05 — eso sí es
 *  un reemplazo válido). */
function _leerStockFisicoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const porTienda = {};
  const ahora = new Date().toISOString();

  CFG.INVENTARIOS.forEach(function (nombre) {
    const tienda = MAPA_ARCHIVO_TIENDA_[nombre];
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre + ' — no se toca el stock de la tienda ' + tienda); porTienda[tienda] = null; return; }
    const file = it.next();

    const csv = _leerCsvConCabeceraSync_(file);
    const colDireccion = csv.indice[CFG.COL_STOCK.direccion];
    const colSscc = csv.indice[CFG.COL_STOCK.sscc];
    const colProducto = csv.indice[CFG.COL_STOCK.producto];
    const colCantidad = csv.indice[CFG.COL_STOCK.cantidad];
    if ([colDireccion, colSscc, colProducto, colCantidad].some(function (c) { return c === undefined; })) {
      throw new Error('Cabecera inesperada en ' + nombre + '. Se esperaban las columnas: ' +
        CFG.COL_STOCK.direccion + ', ' + CFG.COL_STOCK.sscc + ', ' + CFG.COL_STOCK.producto + ', ' + CFG.COL_STOCK.cantidad);
    }

    const filas = [];
    for (var i = 1; i < csv.filas.length; i++) { // fila 0 = cabecera
      const row = csv.filas[i];
      const direccion = String(row[colDireccion] || '').trim();
      if (direccion.slice(0, 2) !== CFG.PREFIJO_EDIFICIO_STOCK) continue;

      const sscc = _limpiarCampoCsvSync_(row[colSscc]);
      const codigoLm = String(row[colProducto] || '').trim();
      const cantidad = Number(row[colCantidad]) || 0;
      if (!sscc || !codigoLm) continue;

      filas.push({
        tienda: tienda,
        codigo_lm: codigoLm,
        sscc: sscc,
        ubicacion: direccion,
        cantidad: cantidad,
        sincronizado_en: ahora,
      });
    }
    porTienda[tienda] = filas;
  });
  return porTienda;
}

/** Reemplazo completo (snapshot) — nunca upsert incremental: una fila que
 *  desapareció del Excel (palet ya no existe en esa ubicación) tiene que
 *  desaparecer también de Supabase. Bug real (revisión con Codex CLI,
 *  2026-09-22): antes se borraba TODA la tabla (de las dos tiendas) en
 *  cuanto se llamaba a esta función, incluso si faltaba el Excel de una
 *  tienda o fallaba a medio subir — dejaba el almacén sin stock. Ahora: se
 *  valida y lee TODO antes de borrar nada, y el borrado+subida es por
 *  tienda, así que un fallo en una tienda no toca el stock ya bueno de la
 *  otra.
 *
 *  Segunda pasada (mismo día, revisión adversarial con Codex CLI): un CSV
 *  presente pero corrupto/mal formado (cabecera bien, cero filas reales de
 *  edificio 05 — encoding raro, columna desplazada) parseaba sin error y
 *  dejaba la tienda a 0 en el primer arreglo. Ahora, si el fichero da 0
 *  filas Y la tienda tenía stock antes, NO se reemplaza — se avisa y se
 *  deja el stock viejo (más seguro que vaciar el almacén por un CSV malo).
 *  También LockService: dos ejecuciones solapadas (trigger horario que
 *  tarda más de 1h) podían borrar+subir a la vez sobre la misma tienda —
 *  stock_fisico no tiene más restricción que el id uuid, así que un
 *  solape podía dejar filas duplicadas o a medio subir. */
function cargarStockFisico() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) {
    Logger.log('cargarStockFisico: ya hay una ejecución en curso, se aborta esta.');
    return 0;
  }
  try {
    return _cargarStockFisico_(_leerStockFisicoDeExcels_());
  } finally {
    lock.releaseLock();
  }
}

function _cargarStockFisico_(porTienda) {
  var subidas = 0;
  Object.keys(porTienda).forEach(function (tienda) {
    const filas = porTienda[tienda];
    if (filas === null) return; // fichero no encontrado: stock de esta tienda se queda como estaba

    if (!filas.length) {
      const habiaStock = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&select=id&limit=1');
      if (habiaStock.length) {
        Logger.log('AVISO: el CSV de la tienda ' + tienda + ' dio 0 filas de edificio 05 pero había stock antes — ' +
          'posible CSV corrupto, NO se reemplaza (se revisa a mano).');
        return;
      }
    }

    supaDelete_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda));
    for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
      const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
      supaInsertMany_('stock_fisico', lote);
      subidas += lote.length;
    }
  });
  Logger.log('Stock físico: ' + subidas + ' ubicaciones subidas a Supabase.');
  return subidas;
}

/** Ejecutar desde el editor para (re)programar el refresco de stock_fisico.
 *  Borra cualquier trigger anterior de cargarStockFisico antes de crear el
 *  nuevo, así que reejecutar esta función es seguro para cambiar el
 *  intervalo. cargarCatalogo sigue con su propio trigger diario aparte. */
function instalarTriggerStockFisico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cargarStockFisico') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cargarStockFisico').timeBased().everyHours(1).create();
  Logger.log('Trigger de cargarStockFisico instalado (cada 60 min).');
}
