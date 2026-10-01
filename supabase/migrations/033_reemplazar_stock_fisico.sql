-- 033 · Recarga atómica de preparacion.stock_fisico
--
-- Antes, kairos-sync borraba el stock de la tienda y lo subía en tandas de
-- 500 filas (llamadas separadas): durante unos segundos la tienda aparecía sin
-- stock, y un fallo a mitad dejaba stock parcial hasta la siguiente carga.
-- Esta función hace borrado + inserción en UNA transacción: los lectores ven
-- el stock anterior hasta el commit y, si algo falla, no cambia nada.
--
-- También rechaza (y deja el stock anterior intacto) un CSV vacío o que traiga
-- menos de p_ratio_min veces las filas actuales (CSV incompleto del robot).
-- p_ratio_min = 0 desactiva la comprobación (carga forzada a mano).

create or replace function preparacion.reemplazar_stock_fisico(
  p_tienda text,
  p_filas jsonb,
  p_ratio_min numeric default 0.6
) returns integer
language plpgsql
as $$
declare
  v_nuevas integer;
  v_antes  integer;
begin
  v_nuevas := coalesce(jsonb_array_length(p_filas), 0);
  if v_nuevas = 0 then
    raise exception 'reemplazar_stock_fisico: no hay filas que cargar para la tienda %', p_tienda;
  end if;

  -- Un solo reemplazo a la vez por tienda: dos ejecuciones solapadas (p.ej.
  -- una carga forzada a mano mientras corre el trigger) no pueden insertar
  -- las dos su snapshot completo y dejar el stock duplicado.
  perform pg_advisory_xact_lock(hashtext('stock_fisico:' || p_tienda));

  select count(*) into v_antes from preparacion.stock_fisico where tienda = p_tienda;
  if p_ratio_min > 0 and v_antes >= 200 and v_nuevas < v_antes * p_ratio_min then
    raise exception 'reemplazar_stock_fisico: la carga trae % filas y hay % en la tienda %; parece incompleta, no se reemplaza',
      v_nuevas, v_antes, p_tienda;
  end if;

  delete from preparacion.stock_fisico where tienda = p_tienda;

  insert into preparacion.stock_fisico (tienda, codigo_lm, sscc, ubicacion, cantidad, sincronizado_en)
  select p_tienda, f.codigo_lm, f.sscc, f.ubicacion, f.cantidad, f.sincronizado_en
  from jsonb_to_recordset(p_filas) as f(
    codigo_lm text, sscc text, ubicacion text, cantidad numeric, sincronizado_en timestamptz
  );

  return v_nuevas;
end;
$$;

-- Solo el service_role (kairos-sync) puede ejecutarla.
revoke all on function preparacion.reemplazar_stock_fisico(text, jsonb, numeric) from public, anon, authenticated;
grant execute on function preparacion.reemplazar_stock_fisico(text, jsonb, numeric) to service_role;
