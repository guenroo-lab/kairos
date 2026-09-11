-- 007 · Detalle de peticion. cantidad + unidad_medida ('ud' | 'palet').
-- estado_negocio con la lista exacta que hoy valida el dropdown de la hoja.

create table if not exists preparacion.lineas (
  id                 uuid primary key default gen_random_uuid(),
  peticion_id        uuid not null references preparacion.peticiones(id) on delete cascade,
  codigo_lm          text not null,
  cantidad           numeric not null check (cantidad > 0),
  unidad_medida      text not null check (unidad_medida in ('ud','palet')),
  ean                text,
  designacion        text,
  seccion            text,
  sscc               text,
  ubicacion          text,
  estado_preparacion text not null default 'pendiente'
                       check (estado_preparacion in ('pendiente','en_curso','preparado')),
  operario           text,
  preparada_en       timestamptz,
  estado_negocio     text
                       check (estado_negocio in
                         ('Consolidado','Preparado','Sin Palet','Sin Mercancía','Otras Incidencias')),
  incidencia_motivo  text,
  hodos_id           text,

  constraint otras_incidencias_tiene_motivo check (
    estado_negocio is distinct from 'Otras Incidencias' or incidencia_motivo is not null)
);

create index if not exists lineas_peticion_idx on preparacion.lineas (peticion_id);
