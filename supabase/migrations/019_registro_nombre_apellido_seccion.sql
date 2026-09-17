-- Solo registro de quién se ha dado de alta (nombre, apellido, sección) —
-- no se muestra en ninguna pantalla, únicamente el LDAP se usa en el resto
-- de la app. Nullable para no romper las filas ya existentes.
alter table preparacion.usuarios_tienda add column nombre text;
alter table preparacion.usuarios_tienda add column apellido text;
alter table preparacion.usuarios_tienda add column seccion text;
