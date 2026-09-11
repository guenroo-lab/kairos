# Kairos · Pieza 2 — Portal de tienda

**Fecha:** 2026-09-11
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Depende de:** Pieza 1 (Fundación) — completa.

---

## 1. Alcance

Una única app web (Apps Script + Supabase) para que el personal de Marbella y
Mijas: (a) cree peticiones (pedido cliente, cesión, refill), (b) vea el estado de
las suyas, incluido el estado real de la etiqueta en HODOS. Responsive (móvil y
PC de mostrador por igual).

**No cubre:** preparación (pieza 3), ningún puente con myISO más allá de lo que
ya existe (pieza 4), ninguna integración con Carta de Portes SIE — para "cuándo
se envió y a qué hora" el personal de tienda sigue consultando esa app aparte,
Kairos no la toca.

## 2. Acceso — sin contraseña

Decisión (cambia lo previsto en la pieza 1): **login solo con el número de
empleado**, sin contraseña. Justificación explícita del usuario: mismo nivel de
seguridad que la app de operario actual (se elige un nombre de una lista, sin
protección) — aceptado a sabiendas, no es un descuido.

**Mecanismo:** no se usa Supabase Auth para usuarios de tienda. El Apps Script
del portal, usando la `service_role` key, es el único que habla con Supabase; el
control de acceso vive en el código del servidor, igual que en la app de
operario de hoy:

1. El cliente manda el número de empleado tecleado.
2. El servidor busca en `preparacion.usuarios_tienda` por `ldap`.
   - No existe → pantalla de alta.
   - Existe pero `aprobado = false` → "pendiente de aprobación".
   - Existe y `aprobado = true` → entra; el cliente guarda el LDAP en
     `localStorage` (igual que `prep_operario` hoy) y lo manda en cada llamada.
3. Todas las funciones del servidor que tocan `peticiones`/`lineas` reciben el
   LDAP, resuelven su tienda (`usuarios_tienda.tienda`) y filtran ahí —
   nunca confían en un `tienda` que mande el cliente.

La RLS montada en la pieza 1 (`mi_tienda()`, políticas por tienda) **queda tal
cual, sin usarla** en este camino — no estorba, simplemente esta app no pasa por
Supabase Auth así que nunca dispara esas políticas (usa `service_role`, que las
salta). Sigue siendo la protección de base si en el futuro algo llama a Supabase
directamente con la sesión de un usuario.

**Admin (aprobar registros):** acceso aparte, no ligado a `usuarios_tienda`. Una
contraseña fija en Propiedades del script (`ADMIN_PASSWORD`) protege la pantalla
de administración. Sencillo, sin usuarios que gestionar para un solo admin.

## 3. Cambio de esquema respecto a la pieza 1

`preparacion.usuarios_tienda.id` ya no referencia `auth.users` (no hace falta,
no hay sesión de Supabase Auth para tienda). Pasa a ser un `uuid` propio.
Migración aditiva sobre una tabla que sigue vacía (0 filas desde la pieza 1):

```sql
alter table preparacion.usuarios_tienda drop constraint usuarios_tienda_id_fkey;
alter table preparacion.usuarios_tienda alter column id set default gen_random_uuid();
```

Resto del esquema de la pieza 1 (tiendas, operarios, catalogo, peticiones,
lineas, estados, RLS) sin cambios.

## 4. Pantallas

1. **Entrar** — un campo: número de empleado. Botón "Entrar".
2. **Alta** (si el LDAP no existe) — número de empleado (precargado), tienda
   (Marbella/Mijas), botón "Solicitar acceso" → queda pendiente.
3. **Pendiente de aprobación** — mensaje simple, sin acciones.
4. **Mis peticiones** — lista de las peticiones de tu tienda. Cada fila: tipo,
   fecha, estado en lenguaje llano (ver §6), nº de líneas preparadas. Filtro por
   tipo y por estado. Botón "Nueva petición".
5. **Nueva petición** — selector de tipo (Pedido cliente / Cesión / Refill) →
   formulario específico (§5) con una o varias líneas → "Enviar".
6. **Detalle de petición** — cabecera (tipo, fecha, quién la pidió) + líneas
   (LM, designación, cantidad, estado) + estado en HODOS si aplica (§6). Para
   refill: motivo + estado, sin detalle de palets ni de myISO (ver §1).
7. **Admin — aprobar registros** (contraseña aparte) — lista de
   `usuarios_tienda` con `aprobado = false`: **Aprobar** (pone `aprobado = true`)
   o **Rechazar** (borra la fila — `aprobado = false` no distingue "pendiente"
   de "rechazado", así que rechazar es borrar; si era un error, la persona
   vuelve a registrarse).

## 5. Formulario "Nueva petición" por tipo

Común a los tres: buscador de artículo por código LM — al teclear, autocompleta
contra `preparacion.catalogo` (7.168 referencias) mostrando foto + designación +
sección, para confirmar antes de añadir la línea. Se pueden añadir varias líneas
antes de enviar.

- **Pedido cliente:** Nº de pedido (obligatorio), Transporte sí/no
  (obligatorio), líneas (LM + unidades), comentario (opcional).
- **Cesión:** tienda destino (Marbella/Málaga/Mijas, obligatorio), líneas
  (LM + unidades), comentario (opcional).
- **Refill:** motivo (obligatorio, texto libre), líneas (LM + **nº de
  palets**), comentario (opcional).

Al enviar, el servidor crea la fila en `peticiones` + una fila en `lineas` por
cada línea del formulario, con `unidad_medida` fijada según el tipo (`ud` o
`palet`).

## 6. Traducción de estados + estado real en HODOS

`peticiones.estado` (interno) → texto para la tienda:

| interno | tienda ve |
|---|---|
| `pendiente` | "Recibida" |
| `en_preparacion` | "En preparación" |
| `a_ubicar` | "Preparada, pendiente de consolidar" |
| `cerrada` | "Completada" |

**Estado en HODOS:** como el esquema `preparacion` vive en el mismo proyecto
Supabase que HODOS (`public.etiquetas`), no hace falta ningún puente: el
servidor del portal, al pedir el detalle de una petición, cruza
`lineas.hodos_id` contra `public.etiquetas.id_unico` (una sola consulta,
`service_role` ya tiene acceso a los dos esquemas) y devuelve
`pendiente_impresion_incpc` / `estado` de la etiqueta. Traducción:

| HODOS | tienda ve |
|---|---|
| sin `hodos_id` todavía | "Generando etiqueta…" |
| `pendiente_impresion_incpc = true` | "Etiqueta pendiente de imprimir" |
| `pendiente_impresion_incpc = false` | "Etiqueta impresa" |

Solo aplica a pedido cliente sin transporte y a cesión (los que generan
etiqueta HODOS, ver spec pieza 1 §4). Pedido cliente con transporte y refill no
tienen esta fila (usan `ubicacion_consolidacion` / estado de refill en su
lugar).

## 7. Fuera de alcance (recordatorio)

- Integración con Carta de Portes SIE — nunca planeada, el personal de tienda la
  usa aparte para ver hora de envío/entrega.
- Detalle de palets/SSCC del refill — el myISO real lo dispara y registra la
  pieza 3 (operario); aquí solo se ve motivo + estado.
- Cualquier acción de preparación — pieza 3.
