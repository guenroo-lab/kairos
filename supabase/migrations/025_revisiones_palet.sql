-- 025 · Revisión de palet: la tienda pide (máx. 3 al día por tienda) que
-- plataforma revise cantidad, referencias y ubicación de un palet. Tabla
-- aparte de peticiones/lineas para no mezclarse con la cola de preparación.

create table if not exists preparacion.revisiones_palet (
  id                 uuid primary key default gen_random_uuid(),
  tienda_origen      text not null references preparacion.tiendas(codigo),
  solicitante_ldap   text not null,
  sscc               text not null,
  ubicacion_esperada text,
  contenido_esperado jsonb not null default '[]'::jsonb,
  revisar            text[] not null default array['cantidad','referencias','ubicacion'],
  comentario         text,
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente','en_revision','revisada')),
  creada_en          timestamptz not null default now(),
  en_curso_por       text,
  en_curso_desde     timestamptz,
  resultado          jsonb,
  conforme           boolean,
  revisada_por       text,
  revisada_en        timestamptz,
  gestionada_en      timestamptz,
  gestion_nota       text
);

create index if not exists revisiones_palet_tienda_creada_idx on preparacion.revisiones_palet (tienda_origen, creada_en desc);
create index if not exists revisiones_palet_estado_idx on preparacion.revisiones_palet (estado);

alter table preparacion.revisiones_palet enable row level security;
