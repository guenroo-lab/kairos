/** Configuración de Kairos Sync. Los secretos van en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SUPABASE_SCHEMA: 'preparacion',
  // SUPABASE_SERVICE_KEY -> Propiedades del script (service_role, NO se versiona)

  // 2026-09-17: fuente cambiada de Power BI (.xlsx) al csv del robot StockSearch
  // (API MyIso) — mismos datos, columnas identificadas por nombre de cabecera
  // en vez de posición fija.
  DRIVE_FOLDER_ID: '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg', // carpeta InventarioSIE
  INVENTARIOS: ['014.csv', '279.csv'],

  // Cabeceras del CSV de inventario (StockSearch_bucle.ps1)
  COL: { lm: 'Ref_LM', ean: 'EAN', foto: 'Foto_URL', designacion: 'Articulo', seccion: 'Seccion' },

  // Stock físico por ubicación — mismo CSV, solo edificio 05
  PREFIJO_EDIFICIO_STOCK: '05',
  COL_STOCK: { direccion: 'Ubicacion', sscc: 'SSCC', producto: 'Ref_LM', cantidad: 'Cantidad_Total' },

  LOTE_UPSERT: 500,
};
