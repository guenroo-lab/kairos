-- 032 · Aviso por correo de incidencias de preparación (kairos-sync
-- AvisosIncidencias.js): marca la línea cuando ya se ha avisado a la tienda,
-- para no repetir el correo. Las incidencias que ya existían al activar el
-- aviso se marcan como avisadas: no se manda retroactivamente (la tienda ya
-- las ve en el portal).
alter table preparacion.lineas
  add column incidencia_aviso_en timestamptz;

update preparacion.lineas
   set incidencia_aviso_en = now()
 where estado_negocio in ('Sin Palet', 'Sin Mercancía', 'Otras Incidencias', 'Parcial');

notify pgrst, 'reload schema';
