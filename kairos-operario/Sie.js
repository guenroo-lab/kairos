/** SIE por ubicar: palets que llegan de tienda a la plataforma (edificio 05)
 *  y quedan en la zona RC2 pendientes de que se les dé ubicación real. Lee
 *  directo el CSV que ya sube el robot StockSearch_bucle.ps1 (cada ~40 min,
 *  llamada real a la API de MyISO desde el PC de campo — Apps Script no
 *  puede llamarla, es red privada de Adeo) a Drive, carpeta
 *  'stocksearch' — mismo mecanismo que SubirArchivo.gs. El robot crea un
 *  archivo NUEVO cada vez (no sobrescribe en sitio), así que hay que buscar
 *  por nombre en la carpeta, nunca guardar el fileId. */

const SIE_CARPETA_DRIVE_ = '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg';
const SIE_ZONA_POR_UBICAR_ = 'RC2';

function listarSieporUbicar() {
  const palets014 = _leerSiePorUbicarDeTienda_('014', '014.csv');
  const palets279 = _leerSiePorUbicarDeTienda_('279', '279.csv');
  return _json_(palets014.concat(palets279));
}

function _leerSiePorUbicarDeTienda_(codigoTienda, nombreArchivo) {
  const archivo = _archivoMasReciente_(nombreArchivo);
  if (!archivo) return [];

  var texto = archivo.getBlob().getDataAsString('UTF-8');
  texto = texto.replace(/^﻿/, '');
  const filas = Utilities.parseCsv(texto, ';');
  if (filas.length < 2) return [];

  const idx = {};
  filas[0].forEach(function (nombre, i) { idx[nombre] = i; });

  const porPalet = {};
  filas.slice(1).forEach(function (fila) {
    if (fila.length < filas[0].length) return;
    if (fila[idx['Edificio']] !== '05') return;
    const ubicacion = fila[idx['Ubicacion']] || '';
    if (ubicacion.indexOf('05-' + SIE_ZONA_POR_UBICAR_) !== 0) return;

    const sscc = _limpiarTextoExcel_(fila[idx['SSCC']]);
    if (!porPalet[sscc]) porPalet[sscc] = { sscc: sscc, tienda: codigoTienda, ubicacion: ubicacion, articulos: [] };
    porPalet[sscc].articulos.push({
      refLm: fila[idx['Ref_LM']],
      designacion: fila[idx['Articulo']],
      cantidad: fila[idx['Cantidad_Total']],
      unidad: fila[idx['UnidadMedida']],
    });
  });
  return Object.keys(porPalet).map(function (k) { return porPalet[k]; });
}

/** El robot no sobrescribe en sitio (crea nuevo, borra el viejo después) —
 *  si por lo que sea hay más de uno con el mismo nombre, coger el más
 *  reciente. */
function _archivoMasReciente_(nombre) {
  const carpeta = DriveApp.getFolderById(SIE_CARPETA_DRIVE_);
  const it = carpeta.getFilesByName(nombre);
  var mejor = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!mejor || f.getLastUpdated() > mejor.getLastUpdated()) mejor = f;
  }
  return mejor;
}

/** El CSV envuelve SSCC/EAN en ="..." (formato texto de Excel) para que no
 *  se redondeen como número al abrir — hay que quitarlo. */
function _limpiarTextoExcel_(valor) {
  const m = String(valor || '').match(/^="?(.*?)"?$/);
  return m ? m[1] : valor;
}
