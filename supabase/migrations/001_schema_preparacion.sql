-- 001 · Esquema preparacion + permisos base.
-- Aditivo. No toca public.

create schema if not exists preparacion;

grant usage on schema preparacion to authenticated, service_role;

alter default privileges in schema preparacion
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema preparacion
  grant select, insert on tables to authenticated;
alter default privileges in schema preparacion
  grant execute on functions to authenticated, service_role;
