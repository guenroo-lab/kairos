-- 005 · Perfil de usuario de tienda. id = auth.users.id (Supabase Auth,
-- email sintetico <numempleado>@kairos.taisa). El registro y la aprobacion
-- son de la pieza 2; aqui la tabla nace vacia.

create table if not exists preparacion.usuarios_tienda (
  id          uuid primary key references auth.users(id) on delete cascade,
  ldap        text unique not null,       -- numero de empleado
  tienda      text not null references preparacion.tiendas(codigo),
  aprobado    boolean not null default false,
  creado_en   timestamptz not null default now(),
  aprobado_en timestamptz
);
