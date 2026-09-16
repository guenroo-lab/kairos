alter table preparacion.usuarios_tienda add column rol text not null default 'vendedor';
update preparacion.usuarios_tienda set rol = 'gestor' where aprobado = true;
notify pgrst, 'reload schema';
