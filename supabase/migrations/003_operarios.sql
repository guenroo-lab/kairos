-- 003 · Operarios de Taisa (dato de trazabilidad, no de seguridad).
-- Seed con los 4 actuales del sistema viejo (PropertiesService PREP_OPERARIOS_V1).

create table if not exists preparacion.operarios (
  nombre text primary key,
  activo boolean not null default true,
  color  text
);

insert into preparacion.operarios (nombre) values
  ('Pedro.S'), ('Antonio.M'), ('Edson'), ('Alberto')
on conflict (nombre) do nothing;
