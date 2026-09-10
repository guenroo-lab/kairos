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

## Proyecto `kairos-sync` (Apps Script)

scriptId: _(se anota al crearlo con `clasp create`)_

Carga `preparacion.catalogo` desde los Excel de inventario de Drive
(`014.xlsx` / `279.xlsx`, carpeta `10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`).
Necesita `SUPABASE_SERVICE_KEY` en Propiedades del script (service_role, no se versiona).
