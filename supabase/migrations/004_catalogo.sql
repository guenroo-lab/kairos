-- 004 · Catalogo maestro LM -> EAN / designacion / seccion / foto.
-- Se deriva 100% de los Excel de inventario (columnas E/F/H/I/G).
-- Lo llena el proyecto Apps Script kairos-sync.

create table if not exists preparacion.catalogo (
  codigo_lm      text primary key,
  ean            text,
  designacion    text,        -- "Product name" del Excel
  seccion        text,        -- "Department" del Excel (p. ej. "09 - JARDIN")
  foto_url       text,        -- "Product picture" del Excel
  actualizado_en timestamptz not null default now()
);
