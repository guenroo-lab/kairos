-- 013 · Pieza 5: rol jefe_equipo + estado_porte (puente Carta de Portes).
-- Sin tocar nada existente.

alter table preparacion.operarios
  add column rol text not null default 'operario'
  check (rol in ('operario', 'jefe_equipo'));

create table preparacion.estado_porte (
  id uuid primary key default gen_random_uuid(),
  sscc text not null,
  estado_carga text,
  estado_recepcion text,
  carta_nombre text,
  cerrado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  unique (sscc)
);
create index estado_porte_sscc_idx on preparacion.estado_porte (sscc);

notify pgrst, 'reload schema';
