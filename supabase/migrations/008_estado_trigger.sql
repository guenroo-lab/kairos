-- 008 · Estado cacheado de la peticion. Trigger sobre lineas (insert/update/delete)
-- y sobre peticiones.ubicacion_consolidacion.

create or replace function preparacion.recalcular_estado_peticion(p_peticion_id uuid)
returns void
language plpgsql
as $$
declare
  v_total      int;
  v_preparadas int;
  v_activas    int;   -- preparado o en_curso
  v_transporte boolean;
  v_ubic       text;
  v_nuevo      text;
begin
  select count(*),
         count(*) filter (where estado_preparacion = 'preparado'),
         count(*) filter (where estado_preparacion in ('preparado','en_curso'))
    into v_total, v_preparadas, v_activas
  from preparacion.lineas
  where peticion_id = p_peticion_id;

  select transporte, ubicacion_consolidacion
    into v_transporte, v_ubic
  from preparacion.peticiones
  where id = p_peticion_id;

  if v_total = 0 or v_activas = 0 then
    v_nuevo := 'pendiente';
  elsif v_preparadas < v_total then
    v_nuevo := 'en_preparacion';
  elsif v_transporte is true and v_ubic is null then
    v_nuevo := 'a_ubicar';
  else
    v_nuevo := 'cerrada';
  end if;

  update preparacion.peticiones
     set estado     = v_nuevo,
         cerrada_en = case
                        when v_nuevo = 'cerrada' and cerrada_en is null then now()
                        when v_nuevo <> 'cerrada'                       then null
                        else cerrada_en
                      end
   where id = p_peticion_id
     and (estado is distinct from v_nuevo
          or (v_nuevo = 'cerrada' and cerrada_en is null)
          or (v_nuevo <> 'cerrada' and cerrada_en is not null));
end;
$$;

create or replace function preparacion.trg_lineas_estado()
returns trigger
language plpgsql
as $$
begin
  perform preparacion.recalcular_estado_peticion(coalesce(new.peticion_id, old.peticion_id));
  return null;
end;
$$;

drop trigger if exists lineas_recalc_estado on preparacion.lineas;
create trigger lineas_recalc_estado
  after insert or update or delete on preparacion.lineas
  for each row execute function preparacion.trg_lineas_estado();

create or replace function preparacion.trg_peticiones_ubic()
returns trigger
language plpgsql
as $$
begin
  perform preparacion.recalcular_estado_peticion(new.id);
  return null;
end;
$$;

drop trigger if exists peticiones_recalc_estado on preparacion.peticiones;
create trigger peticiones_recalc_estado
  after update of ubicacion_consolidacion on preparacion.peticiones
  for each row execute function preparacion.trg_peticiones_ubic();
