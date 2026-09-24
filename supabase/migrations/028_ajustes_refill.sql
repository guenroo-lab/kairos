-- 028 · Ajustes globales: por ahora solo si Refill está habilitado. Fila
-- única (id=1) en vez de Propiedades de Script porque portal/operario/sync
-- son proyectos de Apps Script SEPARADOS — Propiedades no se sincronizan
-- solas entre ellos, una tabla en Supabase sí la ven todos igual.
create table preparacion.ajustes (
  id                 smallint primary key default 1 check (id = 1),
  refill_habilitado  boolean not null default true,
  refill_cambiado_por text,
  refill_cambiado_en  timestamptz
);
insert into preparacion.ajustes (id) values (1);

alter table preparacion.ajustes enable row level security;

notify pgrst, 'reload schema';
