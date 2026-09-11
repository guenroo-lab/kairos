# Migraciones de Kairos (esquema `preparacion`)

Viven en el proyecto Supabase de **HODOS** (`dbxlrnupiwemnarlxmcv`), en un esquema
aparte `preparacion`. **Nunca** se toca `public.*` (tablas de HODOS: `etiquetas`,
`contenido`, `cargas`).

## Cómo se aplica una migración

Con la herramienta MCP `apply_migration` del servidor de Supabase:

- `project_id`: `dbxlrnupiwemnarlxmcv`
- `name`: el nombre del fichero sin extensión (p. ej. `001_schema_preparacion`)
- `query`: el contenido íntegro del `.sql`

Verificación posterior con `execute_sql` (mismo `project_id`).

## Reglas

- Solo añadir. Nunca `drop`/`rename`/`alter` sobre objetos de `public`.
- Cada fichero es idempotente donde se pueda (`create ... if not exists`,
  `create or replace`).
- Numeración correlativa `NNN_nombre.sql`.

## Exposición del esquema en la API (PostgREST)

La migración `010_expose_preparacion_postgrest.sql` hace
`alter role authenticator set pgrst.db_schemas = 'public, graphql_public, preparacion'`
+ `notify pgrst`. Eso es lo que hace por debajo el panel **Project Settings → API →
Exposed schemas**.

⚠️ El campo del panel puede mostrarse desactualizado (`public, graphql_public`), pero
el ajuste del rol es el que manda. **Si editas "Exposed schemas" en el panel, vuelve
a añadir `preparacion`** o la API dejará de ver el esquema.

## Proyecto `kairos-sync` (Apps Script)

scriptId: `1PzUT_19ASC5qvFjjnhl2jmqTtvunzmaAaxJ3MM32drb94fY779TFLKJ0`
(editor: https://script.google.com/d/1PzUT_19ASC5qvFjjnhl2jmqTtvunzmaAaxJ3MM32drb94fY779TFLKJ0/edit )

Carga `preparacion.catalogo` desde los Excel de inventario de Drive
(`014.xlsx` / `279.xlsx`, carpeta `10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`).
Necesita `SUPABASE_SERVICE_KEY` en Propiedades del script (service_role, no se versiona).

## Proyecto `kairos-portal` (Apps Script)

scriptId: `1hUEGvZ_-NyvR_oOFgKuFR-nJRx0t-o3TPf2SbqtxRFYB5lg3yHzx8eKQ`
(editor: https://script.google.com/d/1hUEGvZ_-NyvR_oOFgKuFR-nJRx0t-o3TPf2SbqtxRFYB5lg3yHzx8eKQ/edit )

Portal de tienda (pieza 2): login sin contraseña (solo LDAP), crear
peticiones, ver estado + estado HODOS. `ADMIN_PASSWORD` y
`SUPABASE_SERVICE_KEY` en Propiedades del script (no se versionan).
Admin: `<url-exec>?admin=1`.
