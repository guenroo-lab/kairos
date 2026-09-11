-- 009 · RLS. El usuario de tienda (authenticated + aprobado) ve/crea SOLO lo de
-- su tienda. service_role (lado operario / kairos-sync) salta RLS por definicion.

alter table preparacion.tiendas          enable row level security;
alter table preparacion.operarios        enable row level security;
alter table preparacion.catalogo         enable row level security;
alter table preparacion.usuarios_tienda  enable row level security;
alter table preparacion.peticiones       enable row level security;
alter table preparacion.lineas           enable row level security;

-- Tienda del usuario logueado, solo si esta aprobado. SECURITY DEFINER para
-- leer usuarios_tienda sin recursion de politicas.
create or replace function preparacion.mi_tienda()
returns text
language sql
stable
security definer
set search_path = preparacion
as $$
  select tienda from preparacion.usuarios_tienda
  where id = auth.uid() and aprobado = true
$$;

-- Referencia: lectura para cualquier autenticado
drop policy if exists ref_read_tiendas   on preparacion.tiendas;
drop policy if exists ref_read_operarios on preparacion.operarios;
drop policy if exists ref_read_catalogo  on preparacion.catalogo;
create policy ref_read_tiendas   on preparacion.tiendas   for select to authenticated using (true);
create policy ref_read_operarios on preparacion.operarios for select to authenticated using (true);
create policy ref_read_catalogo  on preparacion.catalogo  for select to authenticated using (true);

-- usuarios_tienda: cada uno ve su propia fila
drop policy if exists ut_self_read on preparacion.usuarios_tienda;
create policy ut_self_read on preparacion.usuarios_tienda for select to authenticated
  using (id = auth.uid());

-- peticiones: ver y crear las de MI tienda
drop policy if exists pet_tienda_read   on preparacion.peticiones;
drop policy if exists pet_tienda_insert on preparacion.peticiones;
create policy pet_tienda_read on preparacion.peticiones for select to authenticated
  using (tienda_origen = preparacion.mi_tienda());
create policy pet_tienda_insert on preparacion.peticiones for insert to authenticated
  with check (
    tienda_origen = preparacion.mi_tienda()
    and solicitante_ldap = (select ldap from preparacion.usuarios_tienda where id = auth.uid())
  );

-- lineas: siguen a su peticion
drop policy if exists lin_tienda_read   on preparacion.lineas;
drop policy if exists lin_tienda_insert on preparacion.lineas;
create policy lin_tienda_read on preparacion.lineas for select to authenticated
  using (exists (
    select 1 from preparacion.peticiones p
    where p.id = lineas.peticion_id and p.tienda_origen = preparacion.mi_tienda()));
create policy lin_tienda_insert on preparacion.lineas for insert to authenticated
  with check (exists (
    select 1 from preparacion.peticiones p
    where p.id = lineas.peticion_id and p.tienda_origen = preparacion.mi_tienda()));
