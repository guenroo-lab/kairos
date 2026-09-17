/** Asignación automática individual/equipo por peso (pedido cliente).
 *  Mismo origen de datos que "SIE por ubicar" en kairos-operario: el CSV
 *  que sube el robot StockSearch_bucle.ps1 a Drive (physical_stock real de
 *  MyISO, columna Peso_Kg por Ref_LM). Si algún artículo del pedido pesa
 *  más de 20kg, el pedido nace en cola de equipo; si todos pesan igual o
 *  menos, nace individual — sin importar cuántos artículos tenga. Solo
 *  aplica a pedido_cliente (ver crearPeticion) — refill y cesión no usan
 *  esto. El jefe de equipo puede cambiarlo a mano después igualmente. */

const SIE_CARPETA_DRIVE_ = '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg';
const PESO_LIMITE_EQUIPO_KG_ = 20;

function _calcularColaIndividualPorPeso_(tienda, codigosLm) {
  const necesitaEquipo = codigosLm.some(function (codigoLm) {
    const peso = _pesoArticulo_(codigoLm, tienda);
    return peso !== null && peso > PESO_LIMITE_EQUIPO_KG_;
  });
  return !necesitaEquipo;
}

/** Primero en el CSV de la tienda que pide; si el artículo no aparece ahí
 *  (sin stock actual en esa tienda) prueba el de la otra — el peso es del
 *  artículo, no depende de dónde esté. null si no se encuentra en ninguno:
 *  no bloquea, simplemente esa línea no cuenta para forzar equipo. */
function _pesoArticulo_(codigoLm, tienda) {
  const orden = tienda === '279' ? ['279.csv', '014.csv'] : ['014.csv', '279.csv'];
  for (var i = 0; i < orden.length; i++) {
    const peso = _buscarPesoEnArchivo_(orden[i], codigoLm);
    if (peso !== null) return peso;
  }
  return null;
}

function _buscarPesoEnArchivo_(nombreArchivo, codigoLm) {
  const archivo = _archivoSieMasReciente_(nombreArchivo);
  if (!archivo) return null;
  var texto = archivo.getBlob().getDataAsString('UTF-8');
  texto = texto.replace(/^﻿/, '');
  const filas = Utilities.parseCsv(texto, ';');
  if (filas.length < 2) return null;
  const idx = {};
  filas[0].forEach(function (nombre, i) { idx[nombre] = i; });
  const iRefLm = idx['Ref_LM'];
  const iPeso = idx['Peso_Kg'];
  if (iRefLm === undefined || iPeso === undefined) return null;
  const objetivo = String(codigoLm).trim();
  for (var i = 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.length <= Math.max(iRefLm, iPeso)) continue;
    if (String(fila[iRefLm]).trim() !== objetivo) continue;
    const peso = Number(String(fila[iPeso]).replace(',', '.'));
    return isNaN(peso) ? null : peso;
  }
  return null;
}

/** El robot crea archivo nuevo cada vez (no sobrescribe en sitio) — buscar
 *  siempre por nombre en la carpeta, nunca guardar el fileId. */
function _archivoSieMasReciente_(nombre) {
  const carpeta = DriveApp.getFolderById(SIE_CARPETA_DRIVE_);
  const it = carpeta.getFilesByName(nombre);
  var mejor = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!mejor || f.getLastUpdated() > mejor.getLastUpdated()) mejor = f;
  }
  return mejor;
}
