-- 012 · Stock físico por ubicación (edificio 05), snapshot diario desde el
-- mismo Excel de inventario que ya usa kairos-sync para preparacion.catalogo.
-- No deduplica por LM — una fila por ubicación/SSCC real. Se reemplaza
-- por completo en cada sync (no es upsert incremental).

create table if not exists preparacion.stock_fisico (
  id              uuid primary key default gen_random_uuid(),
  tienda          text not null references preparacion.tiendas(codigo),
  codigo_lm       text not null,
  sscc            text not null,
  ubicacion       text not null,
  cantidad        numeric not null,
  sincronizado_en timestamptz not null
);

create index if not exists stock_fisico_tienda_lm_idx
  on preparacion.stock_fisico (tienda, codigo_lm);

-- Marca cuándo se asignó el SSCC a una línea — el algoritmo de reparto solo
-- cuenta como "ya comprometido" lo asignado desde el último sync de
-- stock_fisico de esa tienda (ver kairos-operario/StockAsignacion.js).
alter table preparacion.lineas
  add column if not exists sscc_asignado_en timestamptz;
