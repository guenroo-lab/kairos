-- 030 · Reserva de refill para fecha de entrega.
-- fecha_entrega: solo refill. visible_desde: día a partir del cual la
-- petición sale en las colas de operarios/jefe (peticiones normales: el día
-- de creación; reservas: último día laborable anterior a fecha_entrega).
alter table preparacion.peticiones
  add column fecha_entrega date,
  add column visible_desde date not null default current_date;

alter table preparacion.peticiones
  add constraint solo_refill_tiene_fecha_entrega
  check (fecha_entrega is null or tipo = 'refill');

notify pgrst, 'reload schema';
