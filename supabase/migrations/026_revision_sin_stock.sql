-- La revisión de palet no depende del stock del almacén: puede pedirse por un
-- SSCC que el sistema no conoce, o buscar un palet de un artículo sin SSCC.
alter table preparacion.revisiones_palet alter column sscc drop not null;
