alter table preparacion.lineas drop constraint lineas_estado_negocio_check;
alter table preparacion.lineas add constraint lineas_estado_negocio_check
  check (estado_negocio = any (array['Consolidado','Preparado','Sin Palet','Sin Mercancía','Otras Incidencias','Parcial']));
