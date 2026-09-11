/** Carga/actualiza preparacion.catalogo desde los Excel de inventario de Drive.
 *  Mismo patrón de Excel->hoja temporal (Drive API v3) que el sistema viejo. */

/** Lee 014.xlsx y 279.xlsx y devuelve un array de
 *  { codigo_lm, ean, designacion, seccion, foto_url } sin duplicados (primer visto gana). */
function _leerCatalogoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const vistos = {};
  CFG.INVENTARIOS.forEach(function (nombre) {
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre); return; }
    const file = it.next();
    const tmp = Drive.Files.create(
      { name: '__tmp_cat_' + nombre, mimeType: MimeType.GOOGLE_SHEETS },
      file.getBlob()
    );
    try {
      const sh = SpreadsheetApp.openById(tmp.id).getSheets()[0];
      const vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) { // fila 0 = cabecera
        const row = vals[i];
        const lm = String(row[CFG.COL.lm - 1] || '').trim();
        if (!lm || vistos[lm]) continue;
        vistos[lm] = {
          codigo_lm: lm,
          ean: String(row[CFG.COL.ean - 1] || '').trim() || null,
          designacion: String(row[CFG.COL.designacion - 1] || '').trim() || null,
          seccion: String(row[CFG.COL.seccion - 1] || '').trim() || null,
          foto_url: String(row[CFG.COL.foto - 1] || '').trim() || null,
        };
      }
    } finally {
      try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {}
    }
  });
  return Object.keys(vistos).map(function (k) { return vistos[k]; });
}

/** Carga/actualiza el catálogo. Ejecutar a mano ahora; luego con trigger diario. */
function cargarCatalogo() {
  const filas = _leerCatalogoDeExcels_();
  var subidas = 0;
  for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
    const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
    supaUpsert_('catalogo', lote, 'codigo_lm');
    subidas += lote.length;
  }
  Logger.log('Catálogo: ' + subidas + ' referencias subidas a Supabase.');
  return subidas;
}

/** Test: carga y comprueba UNA referencia conocida del Excel de Marbella. */
function test_cargarCatalogo_unaRef() {
  const REF = '92738606'; // RIEL MANUAL MURTRA..., "12 - DECORACION"
  const filas = _leerCatalogoDeExcels_();
  const r = filas.filter(function (f) { return f.codigo_lm === REF; })[0];
  if (!r) throw new Error('No se encontró la referencia ' + REF + ' en los Excel.');
  Logger.log(JSON.stringify(r));
  if (!r.seccion || r.seccion.indexOf('DECORACION') === -1) {
    throw new Error('Sección inesperada para ' + REF + ': ' + r.seccion);
  }
  if (!r.ean) throw new Error('Sin EAN para ' + REF);
  Logger.log('OK: ' + filas.length + ' referencias leídas de los Excel.');
}

/** Ejecutar UNA vez desde el editor para programar el refresco diario (11:00). */
function instalarTriggerCatalogo() {
  const YA = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'cargarCatalogo';
  });
  if (YA) { Logger.log('El trigger de cargarCatalogo ya está instalado.'); return; }
  ScriptApp.newTrigger('cargarCatalogo').timeBased().everyDays(1).atHour(11).create();
  Logger.log('Trigger diario de cargarCatalogo instalado (11:00 Europe/Madrid).');
}
