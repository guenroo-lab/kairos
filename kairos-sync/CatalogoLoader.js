/** Carga/actualiza preparacion.catalogo desde los CSV de inventario de Drive
 *  (StockSearch_bucle.ps1, API MyIso). Lee el blob directo con Utilities.parseCsv
 *  -- evita depender de que Drive detecte bien el delimitador ";" al convertir. */

/** Lee 014.csv y 279.csv y devuelve un array de
 *  { codigo_lm, ean, designacion, seccion, foto_url } sin duplicados (primer visto gana). */
function _leerCatalogoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const vistos = {};
  CFG.INVENTARIOS.forEach(function (nombre) {
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre); return; }
    const file = it.next();

    const csv = _leerCsvConCabeceraSync_(file);
    const colLm = csv.indice[CFG.COL.lm];
    const colEan = csv.indice[CFG.COL.ean];
    const colDesignacion = csv.indice[CFG.COL.designacion];
    const colSeccion = csv.indice[CFG.COL.seccion];
    const colFoto = csv.indice[CFG.COL.foto];
    if ([colLm, colEan, colDesignacion, colSeccion, colFoto].some(function (c) { return c === undefined; })) {
      throw new Error('Cabecera inesperada en ' + nombre + '. Se esperaban las columnas: ' +
        CFG.COL.lm + ', ' + CFG.COL.ean + ', ' + CFG.COL.designacion + ', ' + CFG.COL.seccion + ', ' + CFG.COL.foto);
    }

    for (var i = 1; i < csv.filas.length; i++) { // fila 0 = cabecera
      const row = csv.filas[i];
      const lm = String(row[colLm] || '').trim();
      if (!lm || vistos[lm]) continue;
      vistos[lm] = {
        codigo_lm: lm,
        ean: _limpiarCampoCsvSync_(row[colEan]) || null,
        designacion: String(row[colDesignacion] || '').trim() || null,
        seccion: String(row[colSeccion] || '').trim() || null,
        foto_url: String(row[colFoto] || '').trim() || null,
      };
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
