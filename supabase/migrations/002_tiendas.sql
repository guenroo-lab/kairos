-- 002 · Tabla de tiendas del circuito Taisa + seed.

create table if not exists preparacion.tiendas (
  codigo             text primary key,
  nombre             text not null,
  archivo_inventario text,          -- null si la tienda solo es destino de cesion
  activa             boolean not null default true
);

insert into preparacion.tiendas (codigo, nombre, archivo_inventario, activa) values
  ('014', 'Marbella', '014.xlsx', true),
  ('279', 'Mijas',    '279.xlsx', true),
  ('036', 'Málaga',   null,       true)
on conflict (codigo) do nothing;
