-- Pieza 10: campo identificador de cesión, pedido por el usuario.
alter table preparacion.peticiones add column num_cesion text;
notify pgrst, 'reload schema';
