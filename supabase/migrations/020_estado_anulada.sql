-- anularPeticion (kairos-portal/Peticiones.js) ya pone estado='anulada'
-- desde hace tiempo, pero el check constraint nunca se actualizó — daba
-- 23514 al anular. Añade 'anulada' a los estados permitidos.
alter table preparacion.peticiones drop constraint peticiones_estado_check;
alter table preparacion.peticiones add constraint peticiones_estado_check
  check (estado = any (array['pendiente','en_preparacion','a_ubicar','cerrada','anulada']));
