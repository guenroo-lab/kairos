create table preparacion.pedidos_pyxis (
  id uuid primary key default gen_random_uuid(),
  tienda text not null,
  num_pedido text not null,
  direccion text not null,
  seccion text,
  ref_lm text not null,
  ean text,
  designacion text not null,
  cantidad numeric not null,
  fecha_entrega text,
  sincronizado_en timestamptz not null default now()
);

create index pedidos_pyxis_busqueda_idx
  on preparacion.pedidos_pyxis (tienda, num_pedido);

create index pedidos_pyxis_ref_idx
  on preparacion.pedidos_pyxis (tienda, ref_lm);
