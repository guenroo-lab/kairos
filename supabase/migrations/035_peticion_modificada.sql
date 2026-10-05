-- 035 · Modificar una petición ya enviada (portal: Logística / Coordinación).
-- modificada_en / modificada_por: última modificación (quién y cuándo), para
-- que el operario vea en la cola y en el detalle que el pedido ha cambiado.
-- historial_cambios: registro de cambios, el más reciente al final:
--   [{ "en": "2026-10-05T09:12:00Z", "por": "12345", "cambios": ["Cantidad de 123 (Taladro): 5 → 8"] }]
-- Solo se añade: ninguna columna existente cambia.
alter table preparacion.peticiones
  add column if not exists modificada_en    timestamptz,
  add column if not exists modificada_por   text,
  add column if not exists historial_cambios jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
