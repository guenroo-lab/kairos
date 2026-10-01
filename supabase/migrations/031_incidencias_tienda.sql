-- 031 · Incidencias visibles para la tienda. El jefe de equipo puede dejar la
-- incidencia "en gestión" y escribir un mensaje que la tienda lee en el portal.
-- Estado derivado: abierta (sin nada) / en gestión (incidencia_gestion_en) /
-- resuelta (incidencia_revisada_en, ya existente).
alter table preparacion.lineas
  add column incidencia_gestion_en timestamptz,
  add column incidencia_nota_tienda text;

notify pgrst, 'reload schema';
