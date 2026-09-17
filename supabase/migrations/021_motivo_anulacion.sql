-- Al anular una petición, el gestor deja constancia del motivo.
alter table preparacion.peticiones add column motivo_anulacion text;
