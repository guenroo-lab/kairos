-- Preparación parcial: cuántas unidades se cogieron de verdad cuando no
-- había las que pedía el stock. NULL cuando no aplica (línea normal o
-- incidencia completa sin nada cogido).
alter table preparacion.lineas add column cantidad_preparada numeric;
