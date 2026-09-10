/** Configuración de Kairos Sync. Los secretos van en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SUPABASE_SCHEMA: 'preparacion',
  // SUPABASE_SERVICE_KEY -> Propiedades del script (service_role, NO se versiona)

  DRIVE_FOLDER_ID: '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg', // carpeta InventarioSIE
  INVENTARIOS: ['014.xlsx', '279.xlsx'],

  // Columnas del Excel de inventario (1-indexed)
  COL: { lm: 5, ean: 6, foto: 7, designacion: 8, seccion: 9 },

  LOTE_UPSERT: 500,
};
