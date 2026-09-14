-- 014 · Pieza 6: cola individual (jefe de equipo mueve peticiones ligeras
-- a una cola aparte, sin asignar a una persona concreta).
alter table preparacion.peticiones
  add column cola_individual boolean not null default false;

notify pgrst, 'reload schema';
