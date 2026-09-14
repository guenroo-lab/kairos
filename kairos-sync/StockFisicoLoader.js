/** Carga/reemplaza preparacion.stock_fisico desde los mismos Excel de
 *  inventario que usa CatalogoLoader.js — pero sin deduplicar (una fila por
 *  ubicación/SSCC real) y solo edificio 05 (mismo filtro que el sistema
 *  viejo, PreparacionPedidosPC/config.js PREFIJO_EDIFICIO). El nombre del
 *  fichero (014.xlsx / 279.xlsx) indica la tienda de cada fila — mapeo
 *  directo al código de tienda (014→Marbella, 279→Mijas). */

const MAPA_ARCHIVO_TIENDA_ = { '014.xlsx': '014', '279.xlsx': '279' };

function _leerStockFisicoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const filas = [];
  const ahora = new Date().toISOString();

  CFG.INVENTARIOS.forEach(function (nombre) {
    const tienda = MAPA_ARCHIVO_TIENDA_[nombre];
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre); return; }
    const file = it.next();
    const tmp = Drive.Files.create(
      { name: '__tmp_stock_' + nombre, mimeType: MimeType.GOOGLE_SHEETS },
      file.getBlob()
    );
    try {
      const sh = SpreadsheetApp.openById(tmp.id).getSheets()[0];
      const vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) { // fila 0 = cabecera
        const row = vals[i];
        const direccion = String(row[CFG.COL_STOCK.direccion - 1] || '').trim();
        if (direccion.slice(0, 2) !== CFG.PREFIJO_EDIFICIO_STOCK) continue;

        const sscc = String(row[CFG.COL_STOCK.sscc - 1] || '').trim();
        const codigoLm = String(row[CFG.COL_STOCK.producto - 1] || '').trim();
        const cantidad = Number(row[CFG.COL_STOCK.cantidad - 1]) || 0;
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
    } finally {
      try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
    }
  });
  return filas;
}

/** Reemplazo completo (snapshot) — nunca upsert incremental: una fila que
 *  desapareció del Excel (palet ya no existe en esa ubicación) tiene que
 *  desaparecer también de Supabase. */
function cargarStockFisico() {
  const filas = _leerStockFisicoDeExcels_();

  supaDelete_('stock_fisico', 'id=not.is.null'); // borra todo antes de recargar

  var subidas = 0;
  for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
    const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
    supaInsertMany_('stock_fisico', lote);
    subidas += lote.length;
  }
  Logger.log('Stock físico: ' + subidas + ' ubicaciones subidas a Supabase.');
  return subidas;
}

/** Ejecutar UNA vez desde el editor para programar el refresco diario
 *  (11:00, mismo horario que cargarCatalogo — triggers independientes). */
function instalarTriggerStockFisico() {
  const YA = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'cargarStockFisico';
  });
  if (YA) { Logger.log('El trigger de cargarStockFisico ya está instalado.'); return; }
  ScriptApp.newTrigger('cargarStockFisico').timeBased().everyDays(1).atHour(11).create();
  Logger.log('Trigger diario de cargarStockFisico instalado (11:00 Europe/Madrid).');
}
