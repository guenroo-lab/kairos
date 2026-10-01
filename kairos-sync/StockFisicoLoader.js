/** Carga/reemplaza preparacion.stock_fisico desde los mismos CSV de
 *  inventario que usa CatalogoLoader.js — pero sin deduplicar (una fila por
 *  ubicación/SSCC real) y solo edificio 05 (mismo filtro que el sistema
 *  viejo, PreparacionPedidosPC/config.js PREFIJO_EDIFICIO). El nombre del
 *  fichero (014.csv / 279.csv) indica la tienda de cada fila — mapeo
 *  directo al código de tienda (014→Marbella, 279→Mijas).
 *
 *  Frecuencia: el robot StockSearch sube un CSV nuevo cada ~40 min; este
 *  trigger corre cada 10 min y solo recarga una tienda cuando su CSV es nuevo
 *  (comparando con la marca `sincronizado_en` que dejó la carga anterior).
 *
 *  `sincronizado_en` NO es la hora de la carga sino la hora del CSV menos
 *  MARGEN_CSV_MS_ (el robot tarda unos minutos en consultar antes de subir).
 *  Todo el sistema usa esa marca para saber qué consumo de pedidos el CSV
 *  todavía no refleja (kairos-portal _stockDetalle_, kairos-operario
 *  StockAsignacion): así lo preparado entre que el robot lee y que nosotros
 *  cargamos se sigue descontando, y el stock no sale de más. */

const MAPA_ARCHIVO_TIENDA_ = { '014.csv': '014', '279.csv': '279' };
const MARGEN_CSV_MS_ = 15 * 60 * 1000;
const RATIO_MIN_FILAS_ = 0.6;
// Si el CSV lleva más de esto sin renovarse en horario laborable, el robot está
// parado: la ejecución se marca como fallida para que se note (el stock que
// hay sigue siendo el último bueno, pero se va quedando viejo).
const EDAD_MAX_CSV_MS_ = 3 * 60 * 60 * 1000;
// Filas con cantidad ilegible: hasta este % se descartan y se avisa; por
// encima se rechaza la carga de la tienda entera (CSV con columnas movidas).
const MAX_FILAS_INVALIDAS_ = 0.02;

function _ahoraStock_() { return new Date(); }

/** Lunes a viernes de 7 a 21 (zona horaria del script: Europe/Madrid). */
function _esHorarioLaborableStock_(fecha) {
  const dia = fecha.getDay();
  const hora = fecha.getHours();
  return dia >= 1 && dia <= 5 && hora >= 7 && hora < 21;
}

/** El robot sube el CSV borrando el anterior y creando uno nuevo; si por un
 *  instante hubiera dos con el mismo nombre, se usa el más reciente. */
function _ficheroMasReciente_(folder, nombre) {
  const it = folder.getFilesByName(nombre);
  var mejor = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!mejor || f.getLastUpdated().getTime() > mejor.getLastUpdated().getTime()) mejor = f;
  }
  return mejor;
}

function _ultimaMarcaStockFisico_(tienda) {
  const filas = supaSelect_('stock_fisico',
    'tienda=eq.' + encodeURIComponent(tienda) + '&select=sincronizado_en&order=sincronizado_en.desc&limit=1');
  return filas.length ? filas[0].sincronizado_en : null;
}

/** Lee y valida el CSV de UNA tienda. Devuelve uno de:
 *   { estado: 'falta' }        el fichero no está en Drive: no se toca su stock.
 *   { estado: 'sin_cambios' }  ese CSV ya está cargado: no se hace nada.
 *   { estado: 'ok', filas }    CSV nuevo leído (filas puede ser []: el Excel real
 *                              no tiene ninguna fila de edificio 05).
 *  Lleva además `aviso` si el CSV está obsoleto. Lanza si el CSV está mal. */
function _leerStockTienda_(folder, nombre, tienda, forzar) {
  const file = _ficheroMasReciente_(folder, nombre);
  if (!file) {
    Logger.log('AVISO: no encontrado ' + nombre + ' — no se toca el stock de la tienda ' + tienda);
    // Si la tienda tenía stock, que la ejecución falle visiblemente (el stock
    // que hay se queda como estaba, pero el robot ha dejado de subir el CSV).
    const habiaStock = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&select=id&limit=1');
    return { estado: 'falta', aviso: habiaStock.length ? nombre + ' no está en la carpeta de Drive (la tienda tenía stock cargado)' : null };
  }

  const ahora = _ahoraStock_();
  var aviso = null;
  const edad = ahora.getTime() - file.getLastUpdated().getTime();
  if (edad > EDAD_MAX_CSV_MS_ && _esHorarioLaborableStock_(ahora)) {
    aviso = nombre + ' lleva ' + Math.round(edad / 3600000) + ' h sin renovarse: ¿robot StockSearch parado?';
  }

  const referencia = new Date(file.getLastUpdated().getTime() - MARGEN_CSV_MS_);
  if (!forzar) {
    const marca = _ultimaMarcaStockFisico_(tienda);
    if (marca && Math.abs(new Date(marca).getTime() - referencia.getTime()) < 1000) {
      return { estado: 'sin_cambios', aviso: aviso };
    }
  }

  const csv = _leerCsvConCabeceraSync_(file);
  const colDireccion = csv.indice[CFG.COL_STOCK.direccion];
  const colSscc = csv.indice[CFG.COL_STOCK.sscc];
  const colProducto = csv.indice[CFG.COL_STOCK.producto];
  const colCantidad = csv.indice[CFG.COL_STOCK.cantidad];
  if ([colDireccion, colSscc, colProducto, colCantidad].some(function (c) { return c === undefined; })) {
    throw new Error('Cabecera inesperada en ' + nombre + '. Se esperaban las columnas: ' +
      CFG.COL_STOCK.direccion + ', ' + CFG.COL_STOCK.sscc + ', ' + CFG.COL_STOCK.producto + ', ' + CFG.COL_STOCK.cantidad);
  }

  const marcaCsv = referencia.toISOString();
  const filas = [];
  var invalidas = 0;
  for (var i = 1; i < csv.filas.length; i++) { // fila 0 = cabecera
    const row = csv.filas[i];
    const direccion = String(row[colDireccion] || '').trim();
    if (direccion.slice(0, 2) !== CFG.PREFIJO_EDIFICIO_STOCK) continue;
    if (CFG.ZONAS_STOCK_NO_DISPONIBLE.indexOf(direccion.split('-')[1]) !== -1) continue;

    const sscc = _limpiarCampoCsvSync_(row[colSscc]);
    const codigoLm = String(row[colProducto] || '').trim();
    if (!sscc || !codigoLm) continue;

    const textoCantidad = String(row[colCantidad] == null ? '' : row[colCantidad]).trim().replace(',', '.');
    const cantidad = textoCantidad === '' ? NaN : Number(textoCantidad);
    if (!isFinite(cantidad)) { invalidas++; continue; }

    filas.push({
      codigo_lm: codigoLm,
      sscc: sscc,
      ubicacion: direccion,
      cantidad: cantidad,
      sincronizado_en: marcaCsv,
    });
  }
  if (invalidas) {
    Logger.log('AVISO: ' + nombre + ' tiene ' + invalidas + ' fila(s) de edificio 05 con cantidad ilegible (descartadas).');
    if (invalidas / (invalidas + filas.length) > MAX_FILAS_INVALIDAS_) {
      throw new Error(nombre + ': ' + invalidas + ' de ' + (invalidas + filas.length) + ' filas con cantidad ilegible, ' +
        'CSV sospechoso — no se carga.');
    }
  }
  return { estado: 'ok', filas: filas, aviso: aviso };
}

/** Por tienda: ver _leerStockTienda_. Un fallo leyendo una tienda (cabecera
 *  rara, CSV corrupto) NO impide cargar la otra: queda como { estado:
 *  'error', mensaje }. */
function _leerStockFisicoDeExcels_(forzar) {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const porTienda = {};
  CFG.INVENTARIOS.forEach(function (nombre) {
    const tienda = MAPA_ARCHIVO_TIENDA_[nombre];
    try {
      porTienda[tienda] = _leerStockTienda_(folder, nombre, tienda, forzar);
    } catch (err) {
      Logger.log('ERROR leyendo ' + nombre + ': ' + err.message);
      porTienda[tienda] = { estado: 'error', mensaje: err.message };
    }
  });
  return porTienda;
}

/** Reemplazo completo (snapshot) — nunca upsert incremental: una fila que
 *  desapareció del Excel (palet ya no existe en esa ubicación) tiene que
 *  desaparecer también de Supabase.
 *
 *  El reemplazo es ATÓMICO (función SQL preparacion.reemplazar_stock_fisico,
 *  migración 033): borrado + inserción en una sola transacción. Antes eran
 *  llamadas sueltas (borrar y subir en tandas de 500), con dos riesgos:
 *  unos segundos con la tienda a 0 stock en cada carga, y stock parcial hasta
 *  la siguiente carga si algo fallaba a mitad. Ahora los lectores ven el
 *  stock anterior hasta el commit, y si algo falla no cambia nada.
 *
 *  Protecciones (revisiones con Codex CLI, 2026-09-22 y 2026-10-01): se
 *  valida y lee todo antes de tocar nada; un fallo en una tienda (leyendo o
 *  cargando) no toca la otra; si el fichero da 0 filas y la tienda tenía
 *  stock NO se reemplaza (CSV corrupto, encoding raro, columna desplazada);
 *  LockService evita dos ejecuciones solapadas en este script y la función
 *  SQL serializa por tienda; la función SQL rechaza una carga con menos del
 *  60% de las filas actuales (CSV incompleto) y aquí se rechaza un CSV con
 *  cantidades ilegibles. Si es un cambio real (p.ej. se vació media
 *  plataforma), ejecutar cargarStockFisicoForzado() a mano. */
function cargarStockFisico() {
  return _cargarStockFisicoConLock_(false);
}

/** Igual que cargarStockFisico pero sin esperar a un CSV nuevo y sin la
 *  comprobación de filas mínimas. Solo a mano, desde el editor. */
function cargarStockFisicoForzado() {
  return _cargarStockFisicoConLock_(true);
}

function _cargarStockFisicoConLock_(forzar) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) {
    Logger.log('cargarStockFisico: ya hay una ejecución en curso, se aborta esta.');
    return 0;
  }
  try {
    return _cargarStockFisico_(_leerStockFisicoDeExcels_(forzar), forzar);
  } finally {
    lock.releaseLock();
  }
}

function _cargarStockFisico_(porTienda, forzar) {
  var subidas = 0;
  const errores = [];
  Object.keys(porTienda).forEach(function (tienda) {
    const datos = porTienda[tienda];
    if (datos.aviso) errores.push(tienda + ': ' + datos.aviso);
    if (datos.estado === 'error') { errores.push(tienda + ': ' + datos.mensaje); return; }
    if (datos.estado !== 'ok') return; // fichero ausente o sin cambios: stock de esta tienda se queda como estaba

    try {
      const filas = datos.filas;
      if (!filas.length) {
        const habiaStock = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&select=id&limit=1');
        if (habiaStock.length) {
          Logger.log('AVISO: el CSV de la tienda ' + tienda + ' dio 0 filas de edificio 05 pero había stock antes — ' +
            'posible CSV corrupto, NO se reemplaza (se revisa a mano).');
          errores.push(tienda + ': CSV sin filas de edificio 05 (había stock), no se reemplaza');
        }
        return;
      }
      subidas += Number(supaRpc_('reemplazar_stock_fisico', {
        p_tienda: tienda,
        p_filas: filas,
        p_ratio_min: forzar ? 0 : RATIO_MIN_FILAS_,
      })) || 0;
    } catch (err) {
      // El stock anterior de esta tienda sigue intacto (transacción revertida).
      Logger.log('ERROR cargando el stock de la tienda ' + tienda + ': ' + err.message);
      errores.push(tienda + ': ' + err.message);
    }
  });
  Logger.log('Stock físico: ' + subidas + ' ubicaciones subidas a Supabase.');
  // Que la ejecución figure como fallida (y avise el propio Apps Script), pero
  // solo después de haber intentado todas las tiendas.
  if (errores.length) throw new Error('Carga de stock con problemas — ' + errores.join(' | '));
  return subidas;
}

/** Ejecutar desde el editor para (re)programar el refresco de stock_fisico.
 *  Borra cualquier trigger anterior de cargarStockFisico antes de crear el
 *  nuevo, así que reejecutar esta función es seguro para cambiar el
 *  intervalo. Cada 10 min mira si hay CSV nuevo (el robot sube uno cada ~40
 *  min); si no lo hay, termina en un par de segundos sin tocar nada.
 *  cargarCatalogo sigue con su propio trigger diario aparte. */
function instalarTriggerStockFisico() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cargarStockFisico') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cargarStockFisico').timeBased().everyMinutes(10).create();
  Logger.log('Trigger de cargarStockFisico instalado (cada 10 min, solo recarga si hay CSV nuevo).');
}
