-- 011 · usuarios_tienda ya no depende de Supabase Auth (pieza 2: login solo
-- por LDAP, sin contraseña, filtrado en el servidor). Tabla vacia, sin riesgo.

alter table preparacion.usuarios_tienda drop constraint if exists usuarios_tienda_id_fkey;
alter table preparacion.usuarios_tienda alter column id set default gen_random_uuid();
