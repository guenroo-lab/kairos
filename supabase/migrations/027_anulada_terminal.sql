-- 027 · Bug real (revisión con Codex CLI, 2026-09-22): recalcular_estado_peticion
-- (008_estado_trigger.sql) nunca contempla 'anulada' como posible resultado —
-- solo calcula pendiente/en_preparacion/a_ubicar/cerrada. El trigger se
-- dispara en cada insert/update/delete de lineas, así que cualquier toque a
-- una línea de una petición ya anulada (un operario que aún tenía el detalle
-- abierto, deshacer una línea, una incidencia) la resucita sin querer.
-- 'anulada' pasa a ser terminal: si la petición ya está anulada, el trigger
-- no la recalcula.
--
-- Segunda pasada (revisión adversarial con Codex CLI, mismo día): el primer
-- SELECT y el UPDATE final eran pasos separados sin lock — anularPeticion
-- (UPDATE directo, en otra conexión) podía anular la petición justo entre
-- medias y este UPDATE la resucitaba igual. Añadido `for update` al primer
-- SELECT (bloquea la fila hasta que esta transacción termina, así que un
-- anularPeticion concurrente espera y gana el que llegue después) más la
-- condición 'anulada' también en el UPDATE final como cinturón y tirantes.

create or replace function preparacion.recalcular_estado_peticion(p_peticion_id uuid)
returns void
language plpgsql
as $$
declare
  v_estado_actual text;
  v_total      int;
  v_preparadas int;
  v_activas    int;   -- preparado o en_curso
  v_transporte boolean;
  v_ubic       text;
  v_nuevo      text;
begin
  select estado into v_estado_actual
  from preparacion.peticiones
  where id = p_peticion_id
  for update;

  if v_estado_actual = 'anulada' then
    return; -- terminal: nada la reabre salvo pasar directamente por anularPeticion/otra vía explícita
  end if;

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
     and estado <> 'anulada'
     and (estado is distinct from v_nuevo
          or (v_nuevo = 'cerrada' and cerrada_en is null)
          or (v_nuevo <> 'cerrada' and cerrada_en is not null));
end;
$$;
