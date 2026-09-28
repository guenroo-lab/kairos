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

  // Excel de Pyxis ("Listado Inventario Pedido Cliente") — carpeta
  // Inventarios_Plataforma, mismo sitio donde vive pedidos_totales_2.csv
  // (de INCPC) pero un archivo distinto, uno por tienda.
  PEDIDOS_FOLDER_ID: '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG',
  PEDIDOS_ARCHIVOS: { '014.xlsx': '014', '279.xlsx': '279' },
  COL_PEDIDO: {
    direccion: ['dirección', 'direccion'],
    numPedido: ['nº ped', 'n ped', 'num ped', 'numero ped'],
    seccion: ['sección', 'seccion'],
    ref: ['ref.', 'ref', 'referencia'],
    ean: ['código ean', 'codigo ean', 'ean'],
    designacion: ['designación', 'designacion'],
    cantidad: ['ctd recep.', 'ctd recep', 'ctd', 'cantidad'],
    fechaEntrega: ['fecha entre.', 'fecha entre', 'fecha entrega'],
  },
};
