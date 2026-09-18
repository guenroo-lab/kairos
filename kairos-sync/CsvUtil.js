/** Helpers compartidos por CatalogoLoader.js y StockFisicoLoader.js para leer
 *  el CSV de inventario (StockSearch_bucle.ps1, API MyIso) directo del blob
 *  -- sin pasar por Drive.Files.create/Sheets, evita depender de que el
 *  conversor de Google detecte bien el delimitador ";". */

function _leerCsvConCabeceraSync_(file) {
  const texto = file.getBlob().getDataAsString('UTF-8');
  const textoSinBom = texto.replace(/^﻿/, '');
  const filas = Utilities.parseCsv(textoSinBom, ';');
  if (!filas.length) throw new Error('CSV vacío: ' + file.getName());
  const indice = {};
  filas[0].forEach(function (h, i) { indice[String(h).trim()] = i; });
  return { indice: indice, filas: filas };
}

// Quita el truco Excel de forzar texto que trae el CSV del robot: ="12345" -> 12345
function _limpiarCampoCsvSync_(v) {
  const s = String(v || '').trim();
  const m = s.match(/^="(.*)"$/);
  return m ? m[1] : s;
}
