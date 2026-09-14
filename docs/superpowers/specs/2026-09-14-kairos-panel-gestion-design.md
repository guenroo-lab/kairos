# Kairos · Pieza 5 — Panel de gestión + puente Carta de Portes — Diseño

**Estado:** aprobado para plan de implementación.

## Qué es

Cuatro añadidos a `kairos-operario`, todos por encima del modelo ya existente
(no tocan el flujo de preparación/incidencias ya construido):

1. **Pestaña Stock** — buscador de solo lectura sobre `preparacion.stock_fisico`.
2. **Rol `jefe_equipo`** — nueva columna en `preparacion.operarios`.
3. **Puente Carta de Portes → Supabase** — `PreparacionPedidosPC` empieza a
   escribir el estado de cierre a una tabla nueva en el esquema `preparacion`,
   de forma **aditiva** (no cambia lo que ya hace hoy con el Sheet).
4. **Pestaña Estado** (cruce HODOS + Carta de Portes) y **Panel jefe de
   equipo** (todas las peticiones, etiquetas HODOS ya creadas, reintento de
   envío).

## 1. Pestaña Stock

Nueva pestaña en la pantalla de la cola (`kairos-operario`), junto a "Cola" y
(si el operario es jefe de equipo) "Panel". Un único campo de búsqueda por
código LM contra `preparacion.stock_fisico` (ya cargado a diario por
`kairos-sync`, ver [[kairos-plataforma-pedidos-taisa]] Pieza 4): muestra
cantidad total y desglose por SSCC/ubicación. Solo lectura, sin escritura,
sin relación con el flujo de preparación.

## 2. Rol `jefe_equipo`

```sql
alter table preparacion.operarios
  add column rol text not null default 'operario'
  check (rol in ('operario', 'jefe_equipo'));
```

Mismo desplegable de "¿Quién eres?" que hoy (sin contraseña nueva). El
cliente recibe el `rol` junto al resto de `listarOperarios()` y lo guarda en
`localStorage` igual que `OPERARIO`. Si `rol === 'jefe_equipo'`, aparecen las
pestañas "Stock", "Estado" y "Panel"; si no, solo ve lo de siempre.

## 3. Puente Carta de Portes → Supabase

**Contexto técnico real** (verificado leyendo el código, no asumido):
`PreparacionPedidosPC/Cerrar Carta de Porte.js` (`cerrarCartaDePorte()`) hoy
copia filas de la hoja activa de "Carta de Porte" a otro libro Google
("Incidencias_Portes" / "Histórico_Portes" según si todos los palets quedaron
`Cargado`+`Recepcionado`) y borra la hoja. No hay ninguna base de datos
digital consultable hoy — el cruce con Kairos no existe.

**Cambio (aditivo, sin quitar nada de lo que hace hoy):** al final de
`cerrarCartaDePorte()`, tras escribir en el Sheet como siempre, un bloque
`try/catch` hace `upsert` a una tabla nueva `preparacion.estado_porte`, una
fila por palet:

```sql
create table preparacion.estado_porte (
  id uuid primary key default gen_random_uuid(),
  expedicion text not null,
  num_palet text not null,
  estado_carga text,
  estado_recepcion text,
  carta_nombre text,
  cerrado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  unique (expedicion, num_palet)
);
create index estado_porte_expedicion_idx on preparacion.estado_porte (expedicion);
```

**Riesgo y por qué es aditivo:** `PreparacionPedidosPC` es código en
producción activo (lo usan a diario). El bloque nuevo va en `try/catch`
alrededor de la llamada a Supabase — si falla (red, credenciales, lo que
sea), se registra el error con `console.error` y el cierre de la carta
**sigue funcionando exactamente igual que hoy**. Nunca bloquea ni retrasa el
flujo real.

**Dato pendiente de confirmar en el plan:** qué celda exacta de la plantilla
"Carta de Porte" contiene el número de expedición (candidatas por lo visto
en el código: `C2`/`C3`, que hoy se copian tal cual a las columnas D/E del
libro de cierre) — se confirma abriendo el Sheet real al implementar esta
tarea, no se adivina aquí.

`PreparacionPedidosPC` necesita sus propias credenciales de Supabase
(`SUPABASE_URL` + `SUPABASE_SERVICE_KEY` en Script Properties, apuntando al
mismo proyecto `dbxlrnupiwemnarlxmcv`) y un cliente mínimo (`supaUpsert_`),
mismo patrón que ya usa `kairos-sync`.

## 4. Pestaña Estado (cruce HODOS + Carta de Portes)

Dentro del detalle de una petición, para `pedido_cliente` sin transporte y
`cesion` (los tipos que generan etiqueta HODOS): sección de solo lectura con

- **HODOS**: si `lineas.hodos_id` está relleno → "Etiqueta creada" +
  `idUnico`; si no y la petición está cerrada → "Sin etiqueta" (posible
  fallo, ver Panel).
- **Carta de Portes**: `select * from preparacion.estado_porte where
  expedicion = ?` (la expedición se guarda ya en `public.etiquetas` de
  HODOS, columna `expedicion`, confirmado por consulta directa) — si hay
  fila, "Cargado"/"Recepcionado" según estado; si no, "Sin carta de porte
  todavía".

## 5. Panel jefe de equipo

Pantalla nueva, solo visible con `rol='jefe_equipo'`:

- **Todas las peticiones**: mismo listado que la cola, sin el filtro
  implícito de pendiente/en_preparación — incluye cerradas. Permite abrir
  cualquiera (reutiliza `renderDetalle` ya existente).
- **Etiquetas HODOS creadas**: `select id, destino, pedido, creada_en from
  public.etiquetas where ...` filtrado por las que tienen origen Kairos
  (cross-schema, solo lectura — mismo patrón ya usado por `kairos-portal`
  para el cruce de estado, "solo añadir, nunca tocar `public.*`" se respeta
  porque es SELECT, no escritura).
- **Reintentar envío a HODOS**: botón sobre una petición cerrada sin
  `hodos_id` que debería tenerlo (no todas las líneas con incidencia) —
  llama de nuevo a `_dispararEtiquetaSiProcede_(peticionId)` ya existente en
  `Hodos.js`. No es un formulario libre tipo Macro Arrastres (eso es de otro
  dominio, arrastres/recepción) — es un reintento del mismo mecanismo que ya
  existe, para el caso real de hoy (`HODOS_WEBAPP_URL` caída).

## Fuera de alcance

- No se toca el flujo de preparación/incidencias ya construido (Piezas 3-4 +
  pulido).
- No se automatiza la generación de la Carta de Porte en sí, solo se lee su
  estado de cierre una vez ya cerrada.
- El panel jefe de equipo no incluye edición masiva ni borrado de
  peticiones — solo ver todo + reintentar HODOS.
- Sin login/contraseña nueva para jefe de equipo (decisión ya tomada).

## Testing

Sin framework (igual que todo el proyecto). Verificación en vivo: marcar un
operario como `jefe_equipo` y confirmar que ve las 3 pestañas extra;
buscador de stock con un código real; cerrar una Carta de Porte de prueba en
`PreparacionPedidosPC` y confirmar la fila en `preparacion.estado_porte`
(y que el Sheet se sigue moviendo igual si Supabase fallara, probado
forzando una URL rota temporalmente); ver el cruce de estado en una
petición real; reintentar HODOS sobre una petición con `hodos_id` vacío.

## Relacionado

[[kairos-plataforma-pedidos-taisa]], [[macro-arrastres-estado-proyecto]]
(patrón de envío a HODOS por lote, no reutilizado tal cual — dominio
distinto), [[preparacionpedidospc-app]] (donde vive `cerrarCartaDePorte()`).
