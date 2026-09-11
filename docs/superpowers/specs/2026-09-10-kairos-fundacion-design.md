# Kairos · Pieza 1 — Fundación (modelo de datos y almacenamiento)

**Fecha:** 2026-09-10
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Autor:** guenroo + Claude

---

## 1. Contexto

Taisa opera la plataforma logística de Leroy Merlin en la zona de Málaga. Hoy, las
tiendas (Marbella, Mijas) piden material a Taisa **tecleando a mano fila a fila** en
una hoja de cálculo de Google Sheets. Taisa lo prepara y lo envía a la tienda o lo
consolida en plataforma para un pedido de cliente final.

El sistema actual ("Preparación de Pedidos", proyecto `PreparacionPedidosPC`) tiene
una parte sólida (la app de operario: cola, reserva, marcar líneas, incidencias,
reparto multi-palet, asignación automática de SSCC, integración con HODOS) y una
parte inexistente o frágil (la entrada de peticiones es manual y sin validación; no
hay identidad ni permisos; dos hojas con estructura desplazada; sin archivado; la
vista de gestión usa jerga interna y vuelca todo el histórico).

Se rehace desde cero, reutilizando la lógica probada del sistema actual pero sobre
un modelo de datos nuevo. El proyecto nuevo se llama **Kairos** (del griego, "el
momento oportuno"; hace pareja con HODOS, "el camino").

### Descomposición del proyecto completo

Kairos se construye en 4 piezas, cada una con su ciclo spec → plan → implementación:

1. **Fundación** — modelo de datos + almacenamiento. *(este documento)*
2. **Portal de tienda** — app para que la tienda cree peticiones y vea su estado.
3. **App de operario** — evolución de la actual, sobre el modelo nuevo, + refill.
4. **Puentes** — HODOS (crear etiqueta + leer estado para la tienda), myISO
   Gestión de Stock (`transfer-to-sfa` actual + `move-to-address` nuevo para refill),
   generalización del disparador.

Orden: 1 → luego 2 y 3 sobre la base de 1 → 4 cose las dos.

---

## 2. Alcance de la Pieza 1

**Cubre:** definir dónde viven los datos y en qué forma. La estructura de Supabase,
los tipos de petición, la identidad de los usuarios de tienda, el modelo de estados,
y de qué fuentes salen los datos maestros.

**No cubre:** ninguna pantalla, ningún puente, ningún cambio en el sistema actual.
Eso es de las piezas 2, 3 y 4.

### Límite del sistema completo (contexto para todas las piezas)

El proceso que gestiona Kairos va desde **la petición de la tienda** hasta
**"preparado en silueta"**. A partir de ahí:

- El seguimiento lo hace **HODOS** (para pedidos sin transporte, cesiones y refill).
- La consolidación y la carga de camión las hace **Carta de Porte SIE** (para
  pedidos con transporte). Kairos solo deja el pedido en un estado que Carta de
  Porte pueda leer.

---

## 3. Decisiones de arquitectura

| Decisión | Elección | Motivo |
|---|---|---|
| Almacenamiento | **Supabase** | Base de datos real, identidad/permisos de verdad, estado en vivo, consultar HODOS sin fricción. Ya se opera Supabase (HODOS, lm-malaga). |
| Proyecto Supabase | **El de HODOS** (`dbxlrnupiwemnarlxmcv`), esquema nuevo `preparacion` | El límite del plan gratuito son 2 proyectos y ya están ocupados. Añadir tablas es gratis. Co-ubicar con `etiquetas` de HODOS hace que "estado en HODOS para la tienda" sea una consulta a la misma base de datos, sin llamadas entre servicios. El esquema aparte mantiene lo de HODOS intacto. |
| Migración de datos | **Ninguna** | Arranque desde cero con las tiendas. Las peticiones nuevas van al sistema nuevo desde una fecha de corte. |
| Código | **Proyecto(s) nuevo(s) desde cero** | No se toca `PreparacionPedidosPC`. Se copia la lógica, no el código. Frontend Apps Script + Supabase REST (patrón ya probado en lm-malaga; la API REST de Supabase no está bloqueada por Adeo). |
| Tiendas | Marbella, Mijas (Málaga como destino de cesión). Modeladas en tabla, no como enum | Permite añadir Málaga/Antequera/Granada sin tocar código. |

### Regla de oro con HODOS

En el proyecto Supabase de HODOS **solo se añade**: el esquema `preparacion` y sus
tablas. Nunca se renombra ni se altera una tabla, columna o función existente de
HODOS (`public.etiquetas`, `public.contenido`, `public.cargas`).

---

## 4. Tipos de petición

Una petición es de **un solo tipo**. Los tres tipos comparten el flujo de preparación
del operario; se diferencian en los campos de la cabecera y en qué pasa al cerrarse.

| Campo | Pedido cliente | Cesión | Refill |
|---|---|---|---|
| Nº de pedido (PC) | **obligatorio** | — | — |
| Artículos: LM + cantidad | unidades (`ud`) | unidades (`ud`) | **nº de palets completos** (`palet`) |
| Transporte sí/no | **obligatorio** | — | — |
| Tienda destino | — | **obligatorio** (Marbella / Málaga / Mijas) | — |
| Para qué es la petición | — | — | **obligatorio** |
| Comentario | opcional | opcional | opcional |
| Quién solicita | **obligatorio** (del usuario logueado, no editable) | ídem | ídem |

Campos que la tienda **no** rellena (los pone el sistema):

- **Sección, EAN, designación** → derivados del código LM (ver §7).
- **SSCC + ubicación** → asignados automáticamente desde el inventario, igual que
  hoy, incluido el **reparto multi-palet** cuando ningún palet cubre la cantidad
  (formato `sscc1 (Xud) + sscc2 (Yud)` / `dir1 + dir2`).
- **Fecha y hora** → automáticas al crear.

### Qué pasa al cerrarse cada tipo

| Tipo | Al terminar la preparación |
|---|---|
| Pedido cliente **sin transporte** | Se crea etiqueta HODOS ("Petición Reserva"). Va a la tienda. Fin del proceso para Taisa; seguimiento = HODOS. |
| Pedido cliente **con transporte** | El operario mete la ubicación/dirección en el paso "A UBICAR" (**igual que hoy, sin cambios**). Queda en plataforma en estado que Carta de Porte SIE puede consolidar. |
| Cesión | Se crea etiqueta HODOS con `destino` = tienda destino. Fin del proceso; seguimiento = HODOS. |
| Refill | Se mueve el/los palet(s) completo(s) en myISO (`move-to-address`, patrón de Carta de Porte SIE RC1). Fin del proceso. |

> El detalle de "A UBICAR", HODOS y myISO es de las piezas 3 y 4. Aquí solo se fija
> que el modelo de datos guarda lo necesario para cada camino.

---

## 5. Identidad de usuarios

### Usuarios de tienda

- **Identificador = número de empleado** (LDAP de Adeo, numérico, p. ej. `30092131`).
- **Registro** (primera vez): número de empleado + contraseña + tienda.
- **Aprobación**: cada registro nuevo queda **pendiente** hasta que el
  administrador (guenroo) lo aprueba. Un usuario no aprobado no puede crear
  peticiones.
- **Login**: número de empleado + contraseña.
- El número de empleado **no se valida** contra Adeo (su directorio está en la red
  privada bloqueada, igual que myISO). Solo se valida el formato (numérico). Se
  guarda tal cual lo escribe la persona.
- El campo "quién solicita" de cada petición se rellena solo con el número de
  empleado del usuario logueado. No es editable.

**Auth:** Supabase Auth con email sintético (`<numempleado>@kairos.taisa` por
debajo, invisible para el usuario, que solo ve y teclea su número). Aporta gestión
de sesión, hash de contraseña y JWT probados, e integra con Row Level Security. El
estado `aprobado` vive en la fila de perfil (`usuarios_tienda`) y las políticas RLS
lo comprueban.

### Operarios (lado Taisa)

**Sin cambios respecto a hoy.** Se elige el nombre de una lista (hoy en
`PropertiesService`, en Kairos en una tabla). Sin contraseña, sin LDAP. Es un dato
de trazabilidad, no de seguridad.

---

## 6. Modelo de datos (esquema `preparacion`)

### `preparacion.tiendas`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | text PK | `014`, `279`, `036`… |
| `nombre` | text | `Marbella`, `Mijas`, `Málaga` |
| `archivo_inventario` | text | `014.xlsx`, `279.xlsx` (null si la tienda solo es destino de cesión y no origen) |
| `activa` | boolean | |

### `preparacion.usuarios_tienda`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | referencia al `auth.users.id` de Supabase Auth |
| `ldap` | text UNIQUE NOT NULL | |
| `tienda` | text FK → `tiendas.codigo` | |
| `aprobado` | boolean DEFAULT false | lo activa el administrador |
| `creado_en` | timestamptz DEFAULT now() | |
| `aprobado_en` | timestamptz | |

### `preparacion.operarios`

| Columna | Tipo | Notas |
|---|---|---|
| `nombre` | text PK | |
| `activo` | boolean DEFAULT true | |
| `color` | text | para la UI, opcional |

### `preparacion.peticiones` (cabecera)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `tipo` | text NOT NULL | CHECK IN (`pedido_cliente`, `cesion`, `refill`) |
| `tienda_origen` | text NOT NULL FK → `tiendas.codigo` | |
| `solicitante_ldap` | text NOT NULL | del usuario logueado |
| `creada_en` | timestamptz DEFAULT now() | |
| `num_pedido` | text | obligatorio si `tipo = pedido_cliente`; **NO único** (un mismo Nº PC llega varias veces al día en expediciones distintas — no es duplicado) |
| `transporte` | boolean | obligatorio si `tipo = pedido_cliente` |
| `tienda_destino` | text FK → `tiendas.codigo` | obligatorio si `tipo = cesion` |
| `motivo` | text | obligatorio si `tipo = refill` |
| `comentario` | text | opcional |
| `ubicacion_consolidacion` | text | solo pedido cliente con transporte: dónde deja el operario el pedido preparado a la espera de consolidación (paso "A UBICAR"). `null` hasta ese paso. No es una dirección de cliente. |
| `estado` | text NOT NULL DEFAULT `pendiente` | cache del estado derivado (ver §8) |
| `cerrada_en` | timestamptz | cuando la petición llega a `cerrada` |

Constraint de integridad por tipo (CHECK): que `num_pedido`/`transporte` solo estén
en `pedido_cliente`, `tienda_destino` solo en `cesion`, `motivo` solo en `refill`.

### `preparacion.lineas` (detalle)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `peticion_id` | uuid NOT NULL FK → `peticiones.id` ON DELETE CASCADE | |
| `codigo_lm` | text NOT NULL | lo teclea la tienda |
| `cantidad` | numeric NOT NULL | cuánto se pide |
| `unidad_medida` | text NOT NULL | `ud` (pedido cliente, cesión) o `palet` (refill) |
| `ean` | text | copiado del catálogo al crear (snapshot) |
| `designacion` | text | snapshot |
| `seccion` | text | snapshot |
| `sscc` | text | asignado por el sistema; formato multi-palet admitido |
| `ubicacion` | text | asignado por el sistema |
| `estado_preparacion` | text NOT NULL DEFAULT `pendiente` | `pendiente` / `en_curso` / `preparado` |
| `operario` | text | quién la preparó |
| `preparada_en` | timestamptz | |
| `estado_negocio` | text | `Consolidado` / `Preparado` / `Sin Palet` / `Sin Mercancía` / `Otras Incidencias` |
| `incidencia_motivo` | text | obligatorio si `estado_negocio = Otras Incidencias` |
| `hodos_id` | text | idUnico de la etiqueta HODOS (vacío = aún no enviada / envío fallido) |

### `preparacion.catalogo` (maestro LM, compartido por las dos tiendas)

| Columna | Tipo | Notas |
|---|---|---|
| `codigo_lm` | text PK | |
| `ean` | text | |
| `designacion` | text | `Product name` del Excel |
| `seccion` | text | `Department` del Excel (p. ej. `09 - JARDIN`) |
| `foto_url` | text | `Product picture` del Excel — para mostrarla en el portal al buscar el LM |
| `actualizado_en` | timestamptz | |

Arregla que hoy Marbella y Mijas tengan cada una su propia hoja "Segmentación"
independiente.

### Row Level Security

- `usuarios_tienda`, `peticiones`, `lineas`: un usuario de tienda solo ve/crea
  filas de **su** tienda (`tienda_origen = su tienda` y `aprobado = true`).
- El lado operario (Taisa) usa una clave de servicio o un rol propio con acceso a
  todas las tiendas.
- `catalogo`, `tiendas`, `operarios`: lectura para todos los autenticados.

---

## 7. Datos maestros

### Inventario (Excel `014.xlsx` / `279.xlsx` en Drive)

Se queda como está: en la carpeta de Drive `InventarioSIE`
(`10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`), alimentados por el robot de Power BI
existente (`014.xlsx` = stock de Marbella, `279.xlsx` = stock de Mijas). El backend
de Kairos los lee igual que el sistema actual (Excel → hoja temporal vía Drive API
v3 → caché troceada por tienda).

**Columnas reales del Excel** (verificado 2026-09-10 leyendo `014.xlsx`):

| # | Columna | Uso en Kairos |
|---|---|---|
| 1 (A) | Export Address | dirección / ubicación del palet |
| 2 (B) | Bloqueado | (no se usa) |
| 3 (C) | Latest stocktake | (no se usa) |
| 4 (D) | SSCC | SSCC del palet |
| 5 (E) | Product Code | código LM |
| 6 (F) | EAN code | EAN → catálogo |
| 7 (G) | Product picture | URL de foto (posible uso futuro en el portal) |
| 8 (H) | Product name | designación → catálogo |
| 9 (I) | Department | sección (p. ej. `09 - JARDIN`, `12 - DECORACION`) → catálogo |
| 10 (J) | Type | familia (p. ej. `RIELES`) — no se usa de momento |
| 11–13 | AVS / Sale Price / Customer orders | (no se usan) |
| 14 (N) | Qty | stock del palet |

Una fila = un palet (SSCC) con su artículo, ubicación y stock. Solo aparecen LM con
stock actual en ese almacén.

### Catálogo LM → EAN / designación / sección

La tabla `preparacion.catalogo` se **deriva 100 % del Excel de inventario**. EAN,
designación (`Product name`) y sección (`Department`) son atributos del producto,
iguales en las dos tiendas; se toman de cualquiera de los dos Excel, con `codigo_lm`
como clave. El stock y el SSCC siguen leyéndose en vivo de cada Excel por separado.

**La hoja "Segmentación" del sistema actual ya no hace falta** — el Excel de
inventario la cubre entera.

Si la tienda pide un LM que no está en ningún Excel (producto sin stock): la línea
entra igual, sin catálogo, y el operario la cierra como incidencia "Sin Mercancía"
(comportamiento actual). Si no hay stock, Taisa no puede prepararlo de todas formas.

---

## 8. Estados

Se reutiliza la lógica de derivación del sistema actual, pero el resultado se
**cachea** en la columna `estado` de `peticiones` (y en `estado_preparacion` de
`lineas`) para que el portal de tienda cargue rápido sin recalcular.

### Estado de línea (`estado_preparacion`)

- `pendiente` → nadie la ha tocado.
- `en_curso` → un operario la ha reservado.
- `preparado` → cerrada (con o sin incidencia; una línea con incidencia también
  cuenta como preparada, no bloquea el cierre del pedido).

### Estado de petición (`estado`)

- `pendiente` → ninguna línea en curso ni preparada.
- `en_preparacion` → alguna línea en curso o preparada, pero no todas.
- `a_ubicar` → **solo pedidos con transporte**: todas las líneas preparadas pero
  `ubicacion_consolidacion` aún vacía (equivalente al "A UBICAR" de hoy).
- `cerrada` → proceso terminado para Taisa. Sin transporte / cesión / refill: todas
  las líneas preparadas. Con transporte: todas preparadas **y**
  `ubicacion_consolidacion` puesta.

El recálculo se hace en el servidor al cerrar/reabrir una línea o al guardar la
ubicación, dentro de la misma transacción. No hay un estado `preparado` separado:
para pedidos sin transporte, "todas las líneas preparadas" ya es `cerrada`.

### `estado_negocio` de línea al cerrar

- Sin incidencia + con transporte → `Consolidado`.
- Sin incidencia + sin transporte → `Preparado`.
- Con incidencia → `Sin Palet` / `Sin Mercancía` / `Otras Incidencias` (+ motivo).

---

## 9. Convivencia con el sistema actual

- Las hojas actuales (`05. PC` de Marbella, `Solicitudes PC` de Mijas) **se
  congelan**: se quedan tal cual para consultar pedidos viejos. No se borran, no se
  importan.
- **Corte** = una fecha acordada. Lo que quede a medias en las hojas se termina por
  el método actual. Desde el corte, toda petición nueva se crea en Kairos.
- **HODOS**: solo se añade (§3). El circuito de la etiqueta "Petición Reserva" ya
  existe y funciona; Kairos lo dispara igual que hoy.
- **Carta de Porte SIE**: en la pieza 4 leerá de Supabase el estado
  "preparado + con transporte" para consolidar. El modelo de datos de esta pieza ya
  guarda todo lo necesario.
- Los triggers `onEdit` de las hojas actuales (autorrelleno de SSCC/EAN, alerta de
  6 dígitos, segmentación automática) dejan de tener sentido cuando la entrada pasa
  al portal; se jubilan tras el corte.
- La alerta de **Google Chat "Transporte Express"** se mantiene como función de
  Kairos.

---

## 10. Puntos cerrados con el usuario (2026-09-10)

1. **Columnas del Excel de inventario** — verificadas leyendo `014.xlsx`. Trae EAN,
   designación y sección. El catálogo se deriva 100 % del Excel; la hoja
   "Segmentación" se retira. Ver §7.
2. **Auth** — Supabase Auth con email sintético. Ver §5.
3. **Identificador de usuario de tienda** — número de empleado (numérico). Ver §5.
4. **Refill** — columna `unidad_medida` (`ud` / `palet`) aparte de `cantidad`. Ver §6.
5. **"Preparado en silueta"** — basta el estado `cerrada`. No hay paso ni
   confirmación de silueta aparte.

---

## 11. Qué NO cubre Kairos (fuera de alcance del proyecto entero)

- Consolidación y carga de camión → sigue en Carta de Porte SIE.
- Seguimiento post-silueta (batea, camión, entrega) → sigue en HODOS.
- El robot que alimenta los Excel de inventario → sigue como está.
- SSO real contra Adeo → imposible (red privada bloqueada).

---

## Estado de implementación

**2026-09-10 — base de datos hecha y verificada** (plan
`docs/superpowers/plans/2026-09-10-kairos-fundacion.md`, rama `pieza-1-fundacion`):

- Esquema `preparacion` en el proyecto Supabase de HODOS: 6 tablas, 8 políticas RLS,
  función/triggers de estado. Migraciones 001–010.
- Esquema expuesto en PostgREST (migración 010, por SQL).
- `tiendas` (014/279/036) y `operarios` (los 4 actuales) sembrados.
- Test de aislamiento RLS entre tiendas: verde.
- HODOS (`public.*`) sin cambios (`cargas`/`contenido`/`etiquetas` intactas).
- `usuarios_tienda`, `peticiones`, `lineas` vacías (las llenan las piezas 2 y 3).

**2026-09-11 — PIEZA 1 COMPLETA.** Catálogo cargado: **7.168 referencias** desde
`014.xlsx` + `279.xlsx`. Trigger diario de refresco instalado (11:00 Europe/Madrid).

Gotcha real encontrado: la `service_role` key nueva de Supabase (formato
`sb_secret_...`) rechaza las llamadas de `UrlFetchApp` de Apps Script con
`401 Forbidden use of secret API key in browser` (el gateway de Supabase las
confunde con tráfico de navegador). Solución: usar la key **legacy JWT** de
`service_role` (Project Settings → API → "Legacy API keys", empieza por `eyJ...`),
que no tiene ese bloqueo. Anotado también como memoria de proyecto.

También hizo falta añadir el scope `https://www.googleapis.com/auth/script.scriptapp`
al manifiesto (`appsscript.json`) para poder usar `ScriptApp.newTrigger`/
`getProjectTriggers` — al declarar `oauthScopes` explícitamente, Apps Script deja de
autodetectar scopes por el código usado.
