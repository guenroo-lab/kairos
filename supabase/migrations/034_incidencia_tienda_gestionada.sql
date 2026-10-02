-- 034 · La tienda puede dar por gestionada una incidencia de preparación
-- (p.ej. la mercancía llegó por refill, o anuló el pedido) sin tocar la
-- resolución de plataforma: la alerta de la tienda desaparece, y plataforma
-- sigue viéndola en su lista (con la marca "la tienda la dio por gestionada")
-- hasta que verifique cantidades / rectifique en MyISO y la marque resuelta.
alter table preparacion.lineas
  add column incidencia_tienda_gestionada_en  timestamptz,
  add column incidencia_tienda_gestionada_por text,
  add column incidencia_tienda_gestionada_nota text;

notify pgrst, 'reload schema';
