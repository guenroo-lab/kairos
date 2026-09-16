alter table preparacion.peticiones add column en_curso_por text;
alter table preparacion.peticiones add column en_curso_desde timestamptz;
notify pgrst, 'reload schema';
