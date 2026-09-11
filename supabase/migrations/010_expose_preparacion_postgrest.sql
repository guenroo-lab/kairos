-- 010 · Exponer el esquema preparacion en la API REST (PostgREST).
-- Equivale a Project Settings -> API -> Exposed schemas del panel.
-- Se anade preparacion a la lista por defecto de Supabase (public, graphql_public).
-- NO quita nada: HODOS sigue usando public igual que antes.

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, preparacion';

notify pgrst, 'reload config';
