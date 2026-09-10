# Kairos · Pieza 1 (Fundación) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear el esquema `preparacion` en la base de datos de Supabase del proyecto HODOS, con todas sus tablas, constraints, el trigger de estado y las políticas RLS, y dejar la tabla `catalogo` cargada desde los Excel de inventario de Drive.

**Architecture:** Todo vive en un esquema Postgres nuevo (`preparacion`) dentro del proyecto Supabase de HODOS (`dbxlrnupiwemnarlxmcv`). Solo se **añade**: nunca se toca `public.*` (las tablas de HODOS). El estado de cada petición se cachea en una columna y lo recalcula un trigger sobre `lineas`. La carga del catálogo la hace un proyecto Apps Script pequeño (`kairos-sync`) que lee los Excel de Drive y hace `upsert` contra la API REST de Supabase con la `service_role` key.

**Tech Stack:** Supabase (Postgres 17), PostgREST, Supabase Auth, Google Apps Script + clasp, Drive API v3 (advanced service).

**Cómo se aplican las migraciones:** con la herramienta MCP `apply_migration` del servidor de Supabase (proyecto `dbxlrnupiwemnarlxmcv`). Cada migración es puramente aditiva. Los ficheros `.sql` de `supabase/migrations/` son el registro/fuente de verdad; su contenido se pasa a `apply_migration` con el nombre indicado. Verificación con `execute_sql`.

**Datos del proyecto Supabase:**
- Project ID: `dbxlrnupiwemnarlxmcv`
- URL: `https://dbxlrnupiwemnarlxmcv.supabase.co`
- Org: `ciirfphkobknsouyessy`
- Migración previa existente: `20260907084611_add_expedicion_a_etiquetas` (de HODOS, no se toca)

**Datos de Drive:**
- Carpeta inventario `InventarioSIE`: `10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`
- Ficheros: `014.xlsx` (Marbella), `279.xlsx` (Mijas)
- Columnas del Excel (1-indexed): 1=Export Address, 4=SSCC, **5=Product Code (LM)**, **6=EAN code**, **7=Product picture**, **8=Product name**, **9=Department (sección)**, 14=Qty

---

## File Structure

```
Kairos/
  docs/superpowers/
    specs/2026-09-10-kairos-fundacion-design.md      (ya existe)
    plans/2026-09-10-kairos-fundacion.md             (este fichero)
  supabase/
    README.md                    Cómo se aplican las migraciones y la regla "solo añadir"
    migrations/
      001_schema_preparacion.sql  Esquema + grants + default privileges
      002_tiendas.sql             Tabla tiendas + seed (014, 279, 036)
      003_operarios.sql           Tabla operarios + seed (los 4 actuales)
      004_catalogo.sql            Tabla catalogo (se llena con kairos-sync)
      005_usuarios_tienda.sql     Tabla usuarios_tienda (FK a auth.users)
      006_peticiones.sql          Tabla peticiones + CHECKs por tipo + índices
      007_lineas.sql              Tabla lineas + CHECKs + índice
      008_estado_trigger.sql      Función recalcular_estado_peticion + triggers
      009_rls.sql                 RLS + policies + función mi_tienda()
  kairos-sync/
    .clasp.json                   scriptId del proyecto Apps Script (se crea con clasp)
    appsscript.json               timeZone, Drive advanced service, scopes
    Config.js                     Constantes: URL Supabase, carpeta Drive, columnas Excel
    Supabase.js                   Helper: supaUpsert_(tabla, filas, onConflict)
    CatalogoLoader.js             cargarCatalogo(): lee los Excel -> upsert catalogo
```

Cada migración es un fichero independiente y auto-contenido. `kairos-sync` es un proyecto Apps Script mínimo cuyo único trabajo ahora es cargar el catálogo; crecerá más adelante (refresco periódico).

---

## Task 1: Scaffolding del repo

**Files:**
- Create: `supabase/README.md`
- Create: `supabase/migrations/` (carpeta, con un `.gitkeep` si hace falta)
- Create: `.gitignore`

- [ ] **Step 1: Crear `.gitignore`**

```
node_modules/
.DS_Store
*.log
kairos-sync/.clasp.json
.clasp.json
```

> `.clasp.json` lleva el scriptId; se ignora para no versionar un id que puede cambiar entre entornos. El scriptId real se anota en `supabase/README.md` / `kairos-sync/README` cuando se cree.

- [ ] **Step 2: Crear `supabase/README.md`**

```markdown
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
```

- [ ] **Step 3: Crear `supabase/migrations/.gitkeep`** (fichero vacío)

- [ ] **Step 4: Commit**

```bash
git add .gitignore supabase/
git commit -m "Scaffolding supabase/ para las migraciones de la pieza 1"
```

---

## Task 2: Migración 001 — esquema `preparacion`

**Files:**
- Create: `supabase/migrations/001_schema_preparacion.sql`

- [ ] **Step 1: Escribir la verificación (test) — el esquema NO existe todavía**

Ejecutar con `execute_sql` (`project_id: dbxlrnupiwemnarlxmcv`):

```sql
select schema_name from information_schema.schemata where schema_name = 'preparacion';
```

Esperado ahora: **0 filas**.

- [ ] **Step 2: Escribir `supabase/migrations/001_schema_preparacion.sql`**

```sql
-- 001 · Esquema preparacion + permisos base.
-- Aditivo. No toca public.

create schema if not exists preparacion;

grant usage on schema preparacion to authenticated, service_role;

alter default privileges in schema preparacion
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema preparacion
  grant select, insert on tables to authenticated;
alter default privileges in schema preparacion
  grant execute on functions to authenticated, service_role;
```

- [ ] **Step 3: Aplicar la migración**

`apply_migration` con `name: 001_schema_preparacion`, `query`: el contenido del fichero.

- [ ] **Step 4: Verificar que el esquema existe**

`execute_sql`:

```sql
select schema_name from information_schema.schemata where schema_name = 'preparacion';
```

Esperado: **1 fila** (`preparacion`).

- [ ] **Step 5: Exponer el esquema en PostgREST (paso manual documentado)**

En el panel de Supabase → **Project Settings → API → Exposed schemas** → añadir
`preparacion` a la lista (junto a `public`, `graphql_public`). Guardar.

Verificar con `execute_sql`:

```sql
select current_setting('pgrst.db_schemas', true);
```

Esperado: la cadena contiene `preparacion` (p. ej. `public, graphql_public, preparacion`).

Si el panel no lo permite, alternativa por SQL (requiere que el rol tenga permiso;
si falla, hacerlo por el panel):

```sql
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, preparacion';
notify pgrst, 'reload config';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/001_schema_preparacion.sql
git commit -m "Migracion 001: esquema preparacion + permisos base"
```

---

## Task 3: Migración 002 — tabla `tiendas`

**Files:**
- Create: `supabase/migrations/002_tiendas.sql`

- [ ] **Step 1: Verificación (test) — la tabla no existe**

`execute_sql`:

```sql
select to_regclass('preparacion.tiendas') as tabla;
```

Esperado: `tabla` = `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/002_tiendas.sql`**

```sql
-- 002 · Tabla de tiendas del circuito Taisa + seed.

create table if not exists preparacion.tiendas (
  codigo             text primary key,
  nombre             text not null,
  archivo_inventario text,          -- null si la tienda solo es destino de cesion
  activa             boolean not null default true
);

insert into preparacion.tiendas (codigo, nombre, archivo_inventario, activa) values
  ('014', 'Marbella', '014.xlsx', true),
  ('279', 'Mijas',    '279.xlsx', true),
  ('036', 'Málaga',   null,       true)
on conflict (codigo) do nothing;
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 002_tiendas`.

- [ ] **Step 4: Verificar estructura y seed**

`execute_sql`:

```sql
select codigo, nombre, archivo_inventario, activa
from preparacion.tiendas order by codigo;
```

Esperado: 3 filas — `014 Marbella 014.xlsx t`, `036 Málaga <null> t`, `279 Mijas 279.xlsx t`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/002_tiendas.sql
git commit -m "Migracion 002: tabla tiendas + seed (014, 279, 036)"
```

---

## Task 4: Migración 003 — tabla `operarios`

**Files:**
- Create: `supabase/migrations/003_operarios.sql`

- [ ] **Step 1: Verificación (test)**

`execute_sql`:

```sql
select to_regclass('preparacion.operarios') as tabla;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/003_operarios.sql`**

```sql
-- 003 · Operarios de Taisa (dato de trazabilidad, no de seguridad).
-- Seed con los 4 actuales del sistema viejo (PropertiesService PREP_OPERARIOS_V1).

create table if not exists preparacion.operarios (
  nombre text primary key,
  activo boolean not null default true,
  color  text
);

insert into preparacion.operarios (nombre) values
  ('Pedro.S'), ('Antonio.M'), ('Edson'), ('Alberto')
on conflict (nombre) do nothing;
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 003_operarios`.

- [ ] **Step 4: Verificar**

`execute_sql`:

```sql
select nombre, activo from preparacion.operarios order by nombre;
```

Esperado: 4 filas (`Alberto`, `Antonio.M`, `Edson`, `Pedro.S`), todas `activo = t`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_operarios.sql
git commit -m "Migracion 003: tabla operarios + seed"
```

---

## Task 5: Migración 004 — tabla `catalogo`

**Files:**
- Create: `supabase/migrations/004_catalogo.sql`

- [ ] **Step 1: Verificación (test)**

`execute_sql`:

```sql
select to_regclass('preparacion.catalogo') as tabla;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/004_catalogo.sql`**

```sql
-- 004 · Catalogo maestro LM -> EAN / designacion / seccion / foto.
-- Se deriva 100% de los Excel de inventario (columnas E/F/H/I/G).
-- Lo llena el proyecto Apps Script kairos-sync.

create table if not exists preparacion.catalogo (
  codigo_lm      text primary key,
  ean            text,
  designacion    text,        -- "Product name" del Excel
  seccion        text,        -- "Department" del Excel (p. ej. "09 - JARDIN")
  foto_url       text,        -- "Product picture" del Excel
  actualizado_en timestamptz not null default now()
);
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 004_catalogo`.

- [ ] **Step 4: Verificar columnas**

`execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'preparacion' and table_name = 'catalogo'
order by ordinal_position;
```

Esperado: 6 columnas — `codigo_lm text NO`, `ean text YES`, `designacion text YES`,
`seccion text YES`, `foto_url text YES`, `actualizado_en timestamp with time zone NO`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_catalogo.sql
git commit -m "Migracion 004: tabla catalogo (vacia; la llena kairos-sync)"
```

---

## Task 6: Migración 005 — tabla `usuarios_tienda`

**Files:**
- Create: `supabase/migrations/005_usuarios_tienda.sql`

- [ ] **Step 1: Verificación (test)**

`execute_sql`:

```sql
select to_regclass('preparacion.usuarios_tienda') as tabla;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/005_usuarios_tienda.sql`**

```sql
-- 005 · Perfil de usuario de tienda. id = auth.users.id (Supabase Auth,
-- email sintetico <numempleado>@kairos.taisa). El registro y la aprobacion
-- son de la pieza 2; aqui la tabla nace vacia.

create table if not exists preparacion.usuarios_tienda (
  id          uuid primary key references auth.users(id) on delete cascade,
  ldap        text unique not null,       -- numero de empleado
  tienda      text not null references preparacion.tiendas(codigo),
  aprobado    boolean not null default false,
  creado_en   timestamptz not null default now(),
  aprobado_en timestamptz
);
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 005_usuarios_tienda`.

- [ ] **Step 4: Verificar tabla y FK**

`execute_sql`:

```sql
select
  (select to_regclass('preparacion.usuarios_tienda')) as tabla,
  (select count(*) from information_schema.table_constraints
   where table_schema = 'preparacion' and table_name = 'usuarios_tienda'
     and constraint_type = 'FOREIGN KEY') as num_fks;
```

Esperado: `tabla` = `preparacion.usuarios_tienda`, `num_fks` = `2` (a `auth.users` y a `tiendas`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/005_usuarios_tienda.sql
git commit -m "Migracion 005: tabla usuarios_tienda"
```

---

## Task 7: Migración 006 — tabla `peticiones`

**Files:**
- Create: `supabase/migrations/006_peticiones.sql`

- [ ] **Step 1: Verificación (test)**

`execute_sql`:

```sql
select to_regclass('preparacion.peticiones') as tabla;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/006_peticiones.sql`**

```sql
-- 006 · Cabecera de peticion. Un tipo por peticion. CHECKs de integridad
-- por tipo. num_pedido NO es unico (un mismo Nº PC llega varias veces al dia
-- en expediciones distintas).

create table if not exists preparacion.peticiones (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    text not null check (tipo in ('pedido_cliente','cesion','refill')),
  tienda_origen           text not null references preparacion.tiendas(codigo),
  solicitante_ldap        text not null,
  creada_en               timestamptz not null default now(),
  num_pedido              text,
  transporte              boolean,
  tienda_destino          text references preparacion.tiendas(codigo),
  motivo                  text,
  comentario              text,
  ubicacion_consolidacion text,
  estado                  text not null default 'pendiente'
                            check (estado in ('pendiente','en_preparacion','a_ubicar','cerrada')),
  cerrada_en              timestamptz,

  constraint pc_tiene_num_y_transporte check (
    tipo <> 'pedido_cliente' or (num_pedido is not null and transporte is not null)),
  constraint solo_pc_tiene_num_y_transporte check (
    tipo = 'pedido_cliente' or (num_pedido is null and transporte is null)),
  constraint cesion_tiene_destino check (
    tipo <> 'cesion' or tienda_destino is not null),
  constraint solo_cesion_tiene_destino check (
    tipo = 'cesion' or tienda_destino is null),
  constraint refill_tiene_motivo check (
    tipo <> 'refill' or motivo is not null),
  constraint solo_refill_tiene_motivo check (
    tipo = 'refill' or motivo is null)
);

create index if not exists peticiones_tienda_estado_idx
  on preparacion.peticiones (tienda_origen, estado);
create index if not exists peticiones_num_pedido_idx
  on preparacion.peticiones (num_pedido) where num_pedido is not null;
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 006_peticiones`.

- [ ] **Step 4: Verificar los CHECKs con inserciones válidas e inválidas (en transacción, rollback)**

`execute_sql` (todo en un bloque; si el MCP no admite multi-sentencia, ejecutar cada
`do $$ ... $$` por separado y luego `delete from preparacion.peticiones where solicitante_ldap = 'TEST'`):

```sql
begin;

-- válida: pedido_cliente con num_pedido y transporte
insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, num_pedido, transporte)
values ('pedido_cliente', '014', 'TEST', 'PC123', true);

-- válida: cesion con destino
insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, tienda_destino)
values ('cesion', '014', 'TEST', '036');

-- válida: refill con motivo
insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, motivo)
values ('refill', '014', 'TEST', 'reponer lineal jardin');

select count(*) as validas from preparacion.peticiones where solicitante_ldap = 'TEST';
-- Esperado: validas = 3

-- inválida: pedido_cliente sin num_pedido -> debe fallar
do $$ begin
  insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, transporte)
  values ('pedido_cliente', '014', 'TEST', true);
  raise exception 'NO deberia haber insertado (pc sin num_pedido)';
exception when check_violation then
  raise notice 'OK: rechazada pc sin num_pedido';
end $$;

-- inválida: cesion con num_pedido -> debe fallar
do $$ begin
  insert into preparacion.peticiones (tipo, tienda_origen, solicitante_ldap, tienda_destino, num_pedido)
  values ('cesion', '014', 'TEST', '036', 'PC999');
  raise exception 'NO deberia haber insertado (cesion con num_pedido)';
exception when check_violation then
  raise notice 'OK: rechazada cesion con num_pedido';
end $$;

rollback;
```

Esperado: `validas = 3`, y los dos `raise notice 'OK: ...'` (ningún `raise exception`).
El `rollback` deja la tabla vacía.

- [ ] **Step 5: Confirmar que la tabla quedó vacía**

`execute_sql`:

```sql
select count(*) from preparacion.peticiones;
```

Esperado: `0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/006_peticiones.sql
git commit -m "Migracion 006: tabla peticiones + CHECKs por tipo + indices"
```

---

## Task 8: Migración 007 — tabla `lineas`

**Files:**
- Create: `supabase/migrations/007_lineas.sql`

- [ ] **Step 1: Verificación (test)**

`execute_sql`:

```sql
select to_regclass('preparacion.lineas') as tabla;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/007_lineas.sql`**

```sql
-- 007 · Detalle de peticion. cantidad + unidad_medida ('ud' | 'palet').
-- estado_negocio con la lista exacta que hoy valida el dropdown de la hoja.

create table if not exists preparacion.lineas (
  id                 uuid primary key default gen_random_uuid(),
  peticion_id        uuid not null references preparacion.peticiones(id) on delete cascade,
  codigo_lm          text not null,
  cantidad           numeric not null check (cantidad > 0),
  unidad_medida      text not null check (unidad_medida in ('ud','palet')),
  ean                text,
  designacion        text,
  seccion            text,
  sscc               text,
  ubicacion          text,
  estado_preparacion text not null default 'pendiente'
                       check (estado_preparacion in ('pendiente','en_curso','preparado')),
  operario           text,
  preparada_en       timestamptz,
  estado_negocio     text
                       check (estado_negocio in
                         ('Consolidado','Preparado','Sin Palet','Sin Mercancía','Otras Incidencias')),
  incidencia_motivo  text,
  hodos_id           text,

  constraint otras_incidencias_tiene_motivo check (
    estado_negocio is distinct from 'Otras Incidencias' or incidencia_motivo is not null)
);

create index if not exists lineas_peticion_idx on preparacion.lineas (peticion_id);
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 007_lineas`.

- [ ] **Step 4: Verificar CHECKs (transacción, rollback)**

`execute_sql`:

```sql
begin;
insert into preparacion.peticiones (id, tipo, tienda_origen, solicitante_ldap, motivo)
values ('00000000-0000-0000-0000-0000000000aa', 'refill', '014', 'TEST', 'test');

-- válida
insert into preparacion.lineas (peticion_id, codigo_lm, cantidad, unidad_medida)
values ('00000000-0000-0000-0000-0000000000aa', '92738606', 2, 'palet');

-- inválida: unidad_medida rara
do $$ begin
  insert into preparacion.lineas (peticion_id, codigo_lm, cantidad, unidad_medida)
  values ('00000000-0000-0000-0000-0000000000aa', '92738606', 2, 'cajas');
  raise exception 'NO deberia (unidad_medida invalida)';
exception when check_violation then raise notice 'OK: unidad_medida invalida rechazada'; end $$;

-- inválida: Otras Incidencias sin motivo
do $$ begin
  insert into preparacion.lineas (peticion_id, codigo_lm, cantidad, unidad_medida, estado_negocio)
  values ('00000000-0000-0000-0000-0000000000aa', '92738606', 1, 'ud', 'Otras Incidencias');
  raise exception 'NO deberia (otras incidencias sin motivo)';
exception when check_violation then raise notice 'OK: otras incidencias sin motivo rechazada'; end $$;

select count(*) as lineas_validas from preparacion.lineas
where peticion_id = '00000000-0000-0000-0000-0000000000aa';
-- Esperado: 1

rollback;
```

Esperado: `lineas_validas = 1`, los dos `raise notice 'OK: ...'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/007_lineas.sql
git commit -m "Migracion 007: tabla lineas + CHECKs + indice"
```

---

## Task 9: Migración 008 — función y triggers de estado

**Files:**
- Create: `supabase/migrations/008_estado_trigger.sql`

Recalcula `peticiones.estado` (y `cerrada_en`) a partir de las líneas y de
`ubicacion_consolidacion`. Reglas (spec §8):

| Situación | estado |
|---|---|
| 0 líneas, o ninguna `preparado`/`en_curso` | `pendiente` |
| alguna `preparado`/`en_curso`, no todas `preparado` | `en_preparacion` |
| todas `preparado`, `transporte = true`, `ubicacion_consolidacion` null | `a_ubicar` |
| resto (todas `preparado`) | `cerrada` |

- [ ] **Step 1: Verificación (test) — la función no existe**

`execute_sql`:

```sql
select to_regprocedure('preparacion.recalcular_estado_peticion(uuid)') as fn;
```

Esperado: `NULL`.

- [ ] **Step 2: Escribir `supabase/migrations/008_estado_trigger.sql`**

```sql
-- 008 · Estado cacheado de la peticion. Trigger sobre lineas (insert/update/delete)
-- y sobre peticiones.ubicacion_consolidacion.

create or replace function preparacion.recalcular_estado_peticion(p_peticion_id uuid)
returns void
language plpgsql
as $$
declare
  v_total      int;
  v_preparadas int;
  v_activas    int;   -- preparado o en_curso
  v_transporte boolean;
  v_ubic       text;
  v_nuevo      text;
begin
  select count(*),
         count(*) filter (where estado_preparacion = 'preparado'),
         count(*) filter (where estado_preparacion in ('preparado','en_curso'))
    into v_total, v_preparadas, v_activas
  from preparacion.lineas
  where peticion_id = p_peticion_id;

  select transporte, ubicacion_consolidacion
    into v_transporte, v_ubic
  from preparacion.peticiones
  where id = p_peticion_id;

  if v_total = 0 or v_activas = 0 then
    v_nuevo := 'pendiente';
  elsif v_preparadas < v_total then
    v_nuevo := 'en_preparacion';
  elsif v_transporte is true and v_ubic is null then
    v_nuevo := 'a_ubicar';
  else
    v_nuevo := 'cerrada';
  end if;

  update preparacion.peticiones
     set estado     = v_nuevo,
         cerrada_en = case
                        when v_nuevo = 'cerrada' and cerrada_en is null then now()
                        when v_nuevo <> 'cerrada'                       then null
                        else cerrada_en
                      end
   where id = p_peticion_id
     and (estado is distinct from v_nuevo
          or (v_nuevo = 'cerrada' and cerrada_en is null)
          or (v_nuevo <> 'cerrada' and cerrada_en is not null));
end;
$$;

create or replace function preparacion.trg_lineas_estado()
returns trigger
language plpgsql
as $$
begin
  perform preparacion.recalcular_estado_peticion(coalesce(new.peticion_id, old.peticion_id));
  return null;
end;
$$;

drop trigger if exists lineas_recalc_estado on preparacion.lineas;
create trigger lineas_recalc_estado
  after insert or update or delete on preparacion.lineas
  for each row execute function preparacion.trg_lineas_estado();

create or replace function preparacion.trg_peticiones_ubic()
returns trigger
language plpgsql
as $$
begin
  perform preparacion.recalcular_estado_peticion(new.id);
  return null;
end;
$$;

drop trigger if exists peticiones_recalc_estado on preparacion.peticiones;
create trigger peticiones_recalc_estado
  after update of ubicacion_consolidacion on preparacion.peticiones
  for each row execute function preparacion.trg_peticiones_ubic();
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 008_estado_trigger`.

- [ ] **Step 4: Test de comportamiento completo (transacción, rollback)**

`execute_sql`:

```sql
begin;

-- Pedido cliente CON transporte, 2 líneas
insert into preparacion.peticiones (id, tipo, tienda_origen, solicitante_ldap, num_pedido, transporte)
values ('00000000-0000-0000-0000-0000000000bb', 'pedido_cliente', '014', 'TEST', 'PC777', true);

insert into preparacion.lineas (id, peticion_id, codigo_lm, cantidad, unidad_medida) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'A', 1, 'ud'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000bb', 'B', 1, 'ud');

select estado as e1 from preparacion.peticiones where id = '00000000-0000-0000-0000-0000000000bb';
-- Esperado e1: 'pendiente'

update preparacion.lineas set estado_preparacion = 'en_curso'
where id = '00000000-0000-0000-0000-0000000000b1';
select estado as e2 from preparacion.peticiones where id = '00000000-0000-0000-0000-0000000000bb';
-- Esperado e2: 'en_preparacion'

update preparacion.lineas set estado_preparacion = 'preparado'
where id = '00000000-0000-0000-0000-0000000000b1';
select estado as e3 from preparacion.peticiones where id = '00000000-0000-0000-0000-0000000000bb';
-- Esperado e3: 'en_preparacion' (falta la línea B)

update preparacion.lineas set estado_preparacion = 'preparado'
where id = '00000000-0000-0000-0000-0000000000b2';
select estado as e4, cerrada_en as c4 from preparacion.peticiones
where id = '00000000-0000-0000-0000-0000000000bb';
-- Esperado e4: 'a_ubicar'  (con transporte y sin ubicacion_consolidacion), c4: null

update preparacion.peticiones set ubicacion_consolidacion = '05-XP1-A-1'
where id = '00000000-0000-0000-0000-0000000000bb';
select estado as e5, cerrada_en is not null as c5 from preparacion.peticiones
where id = '00000000-0000-0000-0000-0000000000bb';
-- Esperado e5: 'cerrada', c5: true

-- Caso SIN transporte: llega a 'cerrada' directo sin pasar por 'a_ubicar'
insert into preparacion.peticiones (id, tipo, tienda_origen, solicitante_ldap, motivo)
values ('00000000-0000-0000-0000-0000000000cc', 'refill', '014', 'TEST', 'test');
insert into preparacion.lineas (peticion_id, codigo_lm, cantidad, unidad_medida, estado_preparacion)
values ('00000000-0000-0000-0000-0000000000cc', 'C', 1, 'palet', 'preparado');
select estado as e6 from preparacion.peticiones where id = '00000000-0000-0000-0000-0000000000cc';
-- Esperado e6: 'cerrada'

rollback;
```

Esperado: `e1=pendiente`, `e2=en_preparacion`, `e3=en_preparacion`, `e4=a_ubicar` (`c4` null),
`e5=cerrada` (`c5` true), `e6=cerrada`.

- [ ] **Step 5: Confirmar que no quedó nada**

`execute_sql`:

```sql
select (select count(*) from preparacion.peticiones) as p,
       (select count(*) from preparacion.lineas) as l;
```

Esperado: `p = 0`, `l = 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/008_estado_trigger.sql
git commit -m "Migracion 008: funcion y triggers de estado de peticion"
```

---

## Task 10: Migración 009 — RLS y políticas

**Files:**
- Create: `supabase/migrations/009_rls.sql`

- [ ] **Step 1: Verificación (test) — RLS aún desactivado en `peticiones`**

`execute_sql`:

```sql
select relrowsecurity from pg_class
where oid = 'preparacion.peticiones'::regclass;
```

Esperado: `f` (false).

- [ ] **Step 2: Escribir `supabase/migrations/009_rls.sql`**

```sql
-- 009 · RLS. El usuario de tienda (authenticated + aprobado) ve/crea SOLO lo de
-- su tienda. service_role (lado operario / kairos-sync) salta RLS por definicion.

alter table preparacion.tiendas          enable row level security;
alter table preparacion.operarios        enable row level security;
alter table preparacion.catalogo         enable row level security;
alter table preparacion.usuarios_tienda  enable row level security;
alter table preparacion.peticiones       enable row level security;
alter table preparacion.lineas           enable row level security;

-- Tienda del usuario logueado, solo si esta aprobado. SECURITY DEFINER para
-- poder leer usuarios_tienda sin recursion de politicas.
create or replace function preparacion.mi_tienda()
returns text
language sql
stable
security definer
set search_path = preparacion
as $$
  select tienda from preparacion.usuarios_tienda
  where id = auth.uid() and aprobado = true
$$;

-- Referencia: lectura para cualquier autenticado
create policy ref_read_tiendas   on preparacion.tiendas   for select to authenticated using (true);
create policy ref_read_operarios on preparacion.operarios for select to authenticated using (true);
create policy ref_read_catalogo  on preparacion.catalogo  for select to authenticated using (true);

-- usuarios_tienda: cada uno ve su propia fila
create policy ut_self_read on preparacion.usuarios_tienda for select to authenticated
  using (id = auth.uid());

-- peticiones: ver y crear las de MI tienda
create policy pet_tienda_read on preparacion.peticiones for select to authenticated
  using (tienda_origen = preparacion.mi_tienda());
create policy pet_tienda_insert on preparacion.peticiones for insert to authenticated
  with check (
    tienda_origen = preparacion.mi_tienda()
    and solicitante_ldap = (select ldap from preparacion.usuarios_tienda where id = auth.uid())
  );

-- lineas: siguen a su peticion
create policy lin_tienda_read on preparacion.lineas for select to authenticated
  using (exists (
    select 1 from preparacion.peticiones p
    where p.id = lineas.peticion_id and p.tienda_origen = preparacion.mi_tienda()));
create policy lin_tienda_insert on preparacion.lineas for insert to authenticated
  with check (exists (
    select 1 from preparacion.peticiones p
    where p.id = lineas.peticion_id and p.tienda_origen = preparacion.mi_tienda()));
```

- [ ] **Step 3: Aplicar** — `apply_migration` `name: 009_rls`.

- [ ] **Step 4: Verificar que RLS está activo y las políticas existen**

`execute_sql`:

```sql
select tablename, rowsecurity,
       (select count(*) from pg_policies pp
        where pp.schemaname = 'preparacion' and pp.tablename = t.tablename) as num_policies
from pg_tables t
where schemaname = 'preparacion'
order by tablename;
```

Esperado: las 6 tablas con `rowsecurity = t`. `peticiones` con 2 políticas, `lineas` con 2,
`usuarios_tienda` con 1, `tiendas`/`operarios`/`catalogo` con 1 cada una.

- [ ] **Step 5: Test de aislamiento entre tiendas (crear 2 usuarios de prueba, rollback)**

`execute_sql`:

```sql
begin;

-- dos usuarios auth de prueba
insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-00000000aaaa', 'test014@kairos.taisa', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000bbbb', 'test279@kairos.taisa', 'authenticated', 'authenticated');

insert into preparacion.usuarios_tienda (id, ldap, tienda, aprobado) values
  ('00000000-0000-0000-0000-00000000aaaa', '11111111', '014', true),
  ('00000000-0000-0000-0000-00000000bbbb', '22222222', '279', true);

-- una peticion de cada tienda (como service_role, salta RLS)
insert into preparacion.peticiones (id, tipo, tienda_origen, solicitante_ldap, motivo) values
  ('00000000-0000-0000-0000-0000000d0014', 'refill', '014', '11111111', 'x'),
  ('00000000-0000-0000-0000-0000000d0279', 'refill', '279', '22222222', 'x');

-- Nos hacemos pasar por el usuario de Marbella (014)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}';

select count(*) as ve_marbella from preparacion.peticiones;
-- Esperado ve_marbella: 1 (solo la de 014)

select count(*) as ve_de_279 from preparacion.peticiones where tienda_origen = '279';
-- Esperado ve_de_279: 0

reset role;
rollback;
```

Esperado: `ve_marbella = 1`, `ve_de_279 = 0`.

> Si el MCP `execute_sql` no permite `set local role` / `set local request.jwt.claims`,
> hacer este test desde `kairos-sync` con dos llamadas REST usando un JWT de cada
> usuario de prueba, o marcarlo como verificación manual en la pieza 2 (donde ya hay
> login real). Registrar cuál se hizo.

- [ ] **Step 6: Confirmar limpieza**

`execute_sql`:

```sql
select (select count(*) from preparacion.peticiones) as p,
       (select count(*) from preparacion.usuarios_tienda) as u,
       (select count(*) from auth.users where email like '%@kairos.taisa') as a;
```

Esperado: `p = 0`, `u = 0`, `a = 0`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/009_rls.sql
git commit -m "Migracion 009: RLS + politicas de aislamiento por tienda"
```

---

## Task 11: Scaffold del proyecto `kairos-sync` (Apps Script)

**Files:**
- Create: `kairos-sync/appsscript.json`
- Create: `kairos-sync/Config.js`
- Create: `kairos-sync/.clasp.json` (lo genera `clasp create`)

- [ ] **Step 1: Crear el proyecto Apps Script con clasp**

```bash
cd C:/Users/30081048/Desktop/Proyectos/Kairos/kairos-sync
clasp create --type standalone --title "Kairos Sync"
```

Esto genera `.clasp.json` con el `scriptId`. Anotar ese `scriptId` en
`supabase/README.md` (sección nueva "## Proyecto kairos-sync").

- [ ] **Step 2: Escribir `kairos-sync/appsscript.json`**

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Drive", "serviceId": "drive", "version": "v2" }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

- [ ] **Step 3: Escribir `kairos-sync/Config.js`**

```js
/** Configuración de Kairos Sync. Los secretos van en Propiedades del script. */
const CFG = {
  SUPABASE_URL: 'https://dbxlrnupiwemnarlxmcv.supabase.co',
  SUPABASE_SCHEMA: 'preparacion',
  // SUPABASE_SERVICE_KEY -> Propiedades del script (service_role, NO se versiona)

  DRIVE_FOLDER_ID: '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg', // carpeta InventarioSIE
  INVENTARIOS: ['014.xlsx', '279.xlsx'],

  // Columnas del Excel de inventario (1-indexed)
  COL: { lm: 5, ean: 6, foto: 7, designacion: 8, seccion: 9 },

  LOTE_UPSERT: 500,
};
```

- [ ] **Step 4: `clasp push` y verificar que sube sin error**

```bash
clasp push -f
```

Esperado: `Pushed 2 files.` (appsscript.json + Config.js). Sin errores de sintaxis.

- [ ] **Step 5: Configurar la Service Key (paso manual documentado)**

En el editor de Apps Script del proyecto → ⚙️ Configuración del proyecto →
Propiedades del script → añadir `SUPABASE_SERVICE_KEY` con la `service_role` key del
proyecto Supabase de HODOS (panel de Supabase → Project Settings → API → Project API
keys → `service_role` → Reveal). **Esta key salta RLS: no se comparte ni se
versiona.**

- [ ] **Step 6: Commit**

```bash
cd C:/Users/30081048/Desktop/Proyectos/Kairos
git add kairos-sync/appsscript.json kairos-sync/Config.js supabase/README.md
git commit -m "Scaffold kairos-sync (Apps Script): appsscript.json + Config"
```

---

## Task 12: Helper `Supabase.js` en `kairos-sync`

**Files:**
- Create: `kairos-sync/Supabase.js`

- [ ] **Step 1: Escribir la función de prueba (test manual desde el editor)**

En `kairos-sync/Supabase.js`, al final, una función de humo:

```js
/** Ejecutar a mano desde el editor tras escribir el helper. */
function test_supaPing() {
  const resp = UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/tiendas?select=codigo', {
    method: 'get',
    headers: _supaHeaders_('GET'),
    muteHttpExceptions: true,
  });
  Logger.log(resp.getResponseCode() + ' ' + resp.getContentText());
  if (resp.getResponseCode() !== 200) throw new Error('Ping falló');
  const filas = JSON.parse(resp.getContentText());
  if (filas.length !== 3) throw new Error('Esperaba 3 tiendas, hay ' + filas.length);
  Logger.log('OK: ' + filas.map(function (f) { return f.codigo; }).join(', '));
}
```

- [ ] **Step 2: Escribir el helper**

```js
/** Cliente mínimo de la API REST de Supabase (PostgREST) para el esquema preparacion. */

function _supaKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('Falta SUPABASE_SERVICE_KEY en Propiedades del script.');
  return k;
}

function _supaHeaders_(metodo) {
  const h = {
    apikey: _supaKey_(),
    Authorization: 'Bearer ' + _supaKey_(),
  };
  if (metodo === 'GET') {
    h['Accept-Profile'] = CFG.SUPABASE_SCHEMA;
  } else {
    h['Content-Profile'] = CFG.SUPABASE_SCHEMA;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

/** upsert de un array de objetos en `tabla`, resolviendo conflictos por `onConflict`. */
function supaUpsert_(tabla, filas, onConflict) {
  if (!filas.length) return;
  const url = CFG.SUPABASE_URL + '/rest/v1/' + tabla + '?on_conflict=' + encodeURIComponent(onConflict);
  const headers = _supaHeaders_('POST');
  headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(filas),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('Supabase upsert ' + code + ': ' + resp.getContentText());
}
```

- [ ] **Step 3: `clasp push`**

```bash
clasp push -f
```

Esperado: `Pushed 3 files.`

- [ ] **Step 4: Ejecutar `test_supaPing` desde el editor**

Abrir el editor (`clasp open`), seleccionar `test_supaPing`, Ejecutar. Autorizar los
permisos cuando lo pida.

Esperado en el registro (Ver → Registros): `200 [...]` y `OK: 014, 036, 279`.

- [ ] **Step 5: Commit**

```bash
git add kairos-sync/Supabase.js
git commit -m "kairos-sync: helper Supabase (PostgREST, esquema preparacion) + ping"
```

---

## Task 13: `CatalogoLoader.js` — cargar el catálogo desde los Excel

**Files:**
- Create: `kairos-sync/CatalogoLoader.js`

- [ ] **Step 1: Escribir un test acotado (una sola referencia conocida)**

En `kairos-sync/CatalogoLoader.js`:

```js
/** Test: carga y comprueba UNA referencia conocida del Excel de Marbella. */
function test_cargarCatalogo_unaRef() {
  const REF = '92738606'; // RIEL MANUAL MURTRA EXTEN 110-200 CM BL, "12 - DECORACION"
  const filas = _leerCatalogoDeExcels_();
  const r = filas.filter(function (f) { return f.codigo_lm === REF; })[0];
  if (!r) throw new Error('No se encontró la referencia ' + REF + ' en los Excel.');
  Logger.log(JSON.stringify(r));
  if (!r.seccion || r.seccion.indexOf('DECORACION') === -1) {
    throw new Error('Sección inesperada para ' + REF + ': ' + r.seccion);
  }
  if (!r.ean) throw new Error('Sin EAN para ' + REF);
  Logger.log('OK: ' + filas.length + ' referencias leídas de los Excel.');
}
```

- [ ] **Step 2: Escribir el lector de Excels**

```js
/** Lee 014.xlsx y 279.xlsx de Drive y devuelve un array de
 *  { codigo_lm, ean, designacion, seccion, foto_url } sin duplicados (primer visto gana). */
function _leerCatalogoDeExcels_() {
  const folder = DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID);
  const vistos = {};
  CFG.INVENTARIOS.forEach(function (nombre) {
    const it = folder.getFilesByName(nombre);
    if (!it.hasNext()) { Logger.log('AVISO: no encontrado ' + nombre); return; }
    const file = it.next();
    const tmp = Drive.Files.insert(
      { title: '__tmp_cat_' + nombre, mimeType: MimeType.GOOGLE_SHEETS },
      file.getBlob()
    );
    try {
      const sh = SpreadsheetApp.openById(tmp.id).getSheets()[0];
      const vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) { // fila 0 = cabecera
        const row = vals[i];
        const lm = String(row[CFG.COL.lm - 1] || '').trim();
        if (!lm || vistos[lm]) continue;
        vistos[lm] = {
          codigo_lm: lm,
          ean: String(row[CFG.COL.ean - 1] || '').trim() || null,
          designacion: String(row[CFG.COL.designacion - 1] || '').trim() || null,
          seccion: String(row[CFG.COL.seccion - 1] || '').trim() || null,
          foto_url: String(row[CFG.COL.foto - 1] || '').trim() || null,
        };
      }
    } finally {
      Drive.Files.remove(tmp.id);
    }
  });
  return Object.keys(vistos).map(function (k) { return vistos[k]; });
}
```

> Nota: `Drive.Files.insert` / `Drive.Files.remove` es la API del servicio avanzado
> "Drive" v2 declarado en `appsscript.json`. Es el mismo patrón que usa hoy
> `_abrirComoSpreadsheetUbic_` en el sistema viejo (`SSCC y Ubicacion.js`).

- [ ] **Step 3: `clasp push` y ejecutar `test_cargarCatalogo_unaRef`**

```bash
clasp push -f
```

Ejecutar `test_cargarCatalogo_unaRef` desde el editor.

Esperado en el registro: el JSON de la referencia `92738606` con `seccion` que
contiene `DECORACION` y un `ean` no vacío, y `OK: <N> referencias leídas` con N de
varios miles.

- [ ] **Step 4: Escribir la función de carga completa**

```js
/** Carga/actualiza preparacion.catalogo desde los Excel de inventario.
 *  Ejecutar a mano ahora; luego con trigger diario (ver Task 14). */
function cargarCatalogo() {
  const filas = _leerCatalogoDeExcels_();
  var subidas = 0;
  for (var i = 0; i < filas.length; i += CFG.LOTE_UPSERT) {
    const lote = filas.slice(i, i + CFG.LOTE_UPSERT);
    supaUpsert_('catalogo', lote, 'codigo_lm');
    subidas += lote.length;
  }
  Logger.log('Catálogo: ' + subidas + ' referencias subidas a Supabase.');
  return subidas;
}
```

- [ ] **Step 5: `clasp push` y ejecutar `cargarCatalogo`**

```bash
clasp push -f
```

Ejecutar `cargarCatalogo` desde el editor. Puede tardar 1-2 min.

Esperado: `Catálogo: <N> referencias subidas a Supabase.` sin excepción.

- [ ] **Step 6: Verificar en Supabase**

`execute_sql` (`project_id: dbxlrnupiwemnarlxmcv`):

```sql
select
  count(*) as total,
  count(*) filter (where ean is null) as sin_ean,
  count(*) filter (where seccion is null) as sin_seccion
from preparacion.catalogo;

select codigo_lm, ean, designacion, seccion
from preparacion.catalogo
where codigo_lm = '92738606';
```

Esperado: `total` de varios miles; `sin_ean` y `sin_seccion` bajos (algunas
referencias sin EAN es normal — se vio en el Excel). La segunda consulta devuelve la
fila de `92738606` con designación `RIEL MANUAL MURTRA...` y sección `12 - DECORACION`.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/30081048/Desktop/Proyectos/Kairos
git add kairos-sync/CatalogoLoader.js
git commit -m "kairos-sync: carga del catalogo desde los Excel de inventario"
```

---

## Task 14: Trigger diario de refresco del catálogo

**Files:**
- Modify: `kairos-sync/CatalogoLoader.js` (añadir instalador de trigger)

- [ ] **Step 1: Añadir el instalador de trigger**

Al final de `kairos-sync/CatalogoLoader.js`:

```js
/** Ejecutar UNA vez desde el editor para programar el refresco diario del catálogo.
 *  El robot de Power BI sube los Excel de madrugada; refrescamos a las 11:00. */
function instalarTriggerCatalogo() {
  const YA = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'cargarCatalogo';
  });
  if (YA) { Logger.log('El trigger de cargarCatalogo ya está instalado.'); return; }
  ScriptApp.newTrigger('cargarCatalogo').timeBased().everyDays(1).atHour(11).create();
  Logger.log('Trigger diario de cargarCatalogo instalado (11:00 Europe/Madrid).');
}
```

- [ ] **Step 2: `clasp push` y ejecutar `instalarTriggerCatalogo`**

```bash
clasp push -f
```

Ejecutar `instalarTriggerCatalogo` desde el editor.

Esperado: `Trigger diario de cargarCatalogo instalado (11:00 Europe/Madrid).`

- [ ] **Step 3: Verificar el trigger**

En el editor → Activadores (icono del reloj) → debe aparecer `cargarCatalogo`,
"Basado en tiempo", "Temporizador de día", "De 11:00 a 12:00".

- [ ] **Step 4: Commit**

```bash
git add kairos-sync/CatalogoLoader.js
git commit -m "kairos-sync: trigger diario de refresco del catalogo (11:00)"
```

---

## Task 15: Cierre de la pieza 1

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-10-kairos-fundacion-design.md`
- Create: `supabase/README.md` (sección de estado)

- [ ] **Step 1: Verificación global — todo el esquema en pie**

`execute_sql`:

```sql
select
  (select count(*) from information_schema.tables
   where table_schema = 'preparacion') as tablas,          -- esperado 6
  (select count(*) from pg_policies where schemaname = 'preparacion') as politicas, -- esperado 8
  (select count(*) from preparacion.tiendas) as tiendas,   -- esperado 3
  (select count(*) from preparacion.operarios) as operarios, -- esperado 4
  (select count(*) from preparacion.catalogo) as catalogo, -- esperado > 1000
  (select to_regprocedure('preparacion.recalcular_estado_peticion(uuid)') is not null) as fn_estado; -- t
```

Esperado: `tablas = 6`, `politicas = 8`, `tiendas = 3`, `operarios = 4`,
`catalogo > 1000`, `fn_estado = t`.

- [ ] **Step 2: Confirmar que HODOS sigue intacto**

`execute_sql`:

```sql
select table_name, (select count(*) from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.table_name) as cols
from information_schema.tables t
where table_schema = 'public' and table_name in ('etiquetas','contenido','cargas')
order by table_name;
```

Esperado: `cargas`, `contenido`, `etiquetas` con el mismo número de columnas que antes
de empezar (no se ha tocado nada de `public`).

- [ ] **Step 3: Actualizar `README.md`**

Cambiar la fila de la pieza 1 en la tabla de piezas:

```markdown
| 1 | Fundación — modelo de datos y almacenamiento | ✅ hecho (esquema `preparacion` en Supabase HODOS, catálogo cargado) |
```

- [ ] **Step 4: Añadir al final de `docs/superpowers/specs/2026-09-10-kairos-fundacion-design.md`**

```markdown
---

## Estado de implementación

Pieza 1 implementada el 2026-09-__ (plan
`docs/superpowers/plans/2026-09-10-kairos-fundacion.md`):

- Esquema `preparacion` en el proyecto Supabase de HODOS con 6 tablas, 8 políticas
  RLS, función/triggers de estado.
- `tiendas` (014/279/036) y `operarios` (los 4 actuales) sembrados.
- `catalogo` cargado desde `014.xlsx` + `279.xlsx` (N referencias). Refresco diario
  a las 11:00 vía `kairos-sync`.
- `usuarios_tienda`, `peticiones` y `lineas` nacen vacías (las llenan las piezas 2 y 3).
- HODOS (`public.*`) sin cambios.
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-10-kairos-fundacion-design.md
git commit -m "Pieza 1 (Fundacion) completada: esquema preparacion + catalogo cargado"
```

---

## Self-Review (hecho al escribir el plan)

**Cobertura de la spec:**

| Sección spec | Tarea(s) |
|---|---|
| §3 Supabase, esquema `preparacion` en HODOS, solo añadir | Task 2 + regla en `supabase/README.md` (Task 1) + Task 15 Step 2 |
| §4 Tipos de petición + campos + CHECKs | Task 7 (`peticiones` CHECKs por tipo), Task 8 (`lineas` `unidad_medida`) |
| §5 usuarios_tienda (nº empleado, aprobado), operarios sin cambios | Task 6 (`usuarios_tienda`), Task 4 (`operarios` seed) |
| §6 Modelo de datos (6 tablas) | Tasks 3–8 |
| §7 Catálogo derivado del Excel (cols E/F/H/I/G) | Tasks 5, 12, 13 |
| §8 Estados + cache + recálculo en trigger | Task 9 (función + triggers + test de comportamiento) |
| §9 Convivencia / sin migración | No hay tarea de migración de datos (correcto: no se migra nada). Hojas viejas: no se tocan. |
| §10 Puntos cerrados (unidad_medida, foto_url, silueta=cerrada) | Tasks 5, 8, 9 |
| RLS aislamiento por tienda | Task 10 |

**Sin placeholders:** todo el SQL y JS está completo. Los "pasos manuales
documentados" (exponer esquema en PostgREST, meter la service key en Propiedades)
llevan instrucciones exactas del panel y una alternativa por SQL donde aplica.

**Consistencia de tipos:** nombres de tabla/columna coinciden entre la spec y todas
las migraciones (`preparacion.peticiones.ubicacion_consolidacion`,
`lineas.unidad_medida in ('ud','palet')`, `estado in
('pendiente','en_preparacion','a_ubicar','cerrada')`,
`recalcular_estado_peticion(uuid)`). El helper `supaUpsert_(tabla, filas,
onConflict)` se define en Task 12 y se usa igual en Tasks 13.

**Fuera de alcance (correcto, es de otras piezas):** registro/login de usuarios de
tienda (pieza 2), app de operario y asignación de SSCC (pieza 3), puentes HODOS /
myISO (pieza 4).
