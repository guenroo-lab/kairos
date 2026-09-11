# Pieza 3 · App de operario — Diseño

**Estado:** aprobado para plan de implementación.

## Qué es

App Apps Script nueva, `kairos-operario`, para el almacén: el operario atiende las
peticiones creadas desde el portal de tienda (Pieza 2), marca líneas preparadas y
cierra la petición. Sustituye la parte de "preparar pedido" de `PreparacionPedidosPC`
para lo que vive ya en el esquema `preparacion` de Kairos.

**Fuera de alcance (se queda igual en `PreparacionPedidosPC`):** generación de
etiquetas SSCC, cartas de porte, robots de muelles/SIE, aviso de cantidad por
Google Chat. Esas siguen funcionando sobre el Sheet viejo, sin tocar.

## Arquitectura

- Apps Script nuevo, mismo patrón que `kairos-portal` (Pieza 2): HtmlService +
  llamadas a Supabase con `service_role` key (legacy JWT, ver
  [[gotcha-supabase-secret-key-bloquea-urlfetchapp]]).
- **Sin login LDAP.** El operario se identifica eligiendo su nombre de un
  desplegable poblado desde `preparacion.operarios` (`nombre`, `activo`, `color`) —
  igual que el sistema actual, no hace falta más fricción para uso interno de
  almacén.
- Un único operario prepara una petición a la vez (no hay bloqueo pesimista de
  fila; si dos operarios abren la misma petición, la última escritura por línea
  gana — mismo riesgo que existe hoy en el Sheet).

## Pantallas

### 1. Cola

Lista de peticiones con `estado in ('pendiente', 'en_preparacion')`, columnas:
tienda origen, tipo (pedido_cliente/cesión/refill), nº pedido (si aplica),
antigüedad, nº líneas total/preparadas. Filtro por tienda y por tipo. Sin
asignación automática — el operario elige de la lista qué petición abrir.

Refill se distingue visualmente (usa color de tienda, ver
[[lm-malaga-colores-por-tienda]]) porque es una única línea de tipo `palet`.

### 2. Detalle de petición

Cabecera: tienda, tipo, solicitante, fecha, comentario/motivo (refill).
Líneas: LM, EAN, designación, sección, cantidad, unidad, ubicación.

Cada línea tiene un checkbox "Preparada". Al marcar:

```
UPDATE preparacion.lineas SET
  estado_preparacion = 'preparado',
  estado_negocio     = 'Preparado',
  operario            = '<nombre elegido>',
  preparada_en         = now()
WHERE id = <linea_id>
```

El trigger `lineas_recalc_estado` (ya existe desde Pieza 1) recalcula solo el
estado de la petición — la app no toca `peticiones.estado` directamente.

**Fuera de alcance en Pieza 3:** marcar incidencia (`Sin Palet`/`Sin Mercancía`/
`Otras Incidencias` + motivo). El checkbox solo tiene estado binario
pendiente/preparado. La columna `estado_negocio` ya soporta incidencias (Pieza 1)
para cuando se añada esa pantalla más adelante.

### 3. A ubicar

Solo aparece para `pedido_cliente` con `transporte = true` cuya líneas están
todas preparadas (la petición ya está en `estado = 'a_ubicar'` por el trigger).
El operario introduce `ubicacion_consolidacion` (texto libre, ubicación física
en plataforma). Al guardar:

```
UPDATE preparacion.peticiones SET ubicacion_consolidacion = '<texto>'
WHERE id = <peticion_id>
```

El trigger `peticiones_recalc_estado` cierra la petición (`estado = 'cerrada'`).

## Auto-etiqueta HODOS (pedido_cliente sin transporte + cesión)

**Corrección tras revisar código ya construido en Pieza 2:** `Peticiones.js:78`
(`obtenerDetallePeticion`) ya calcula
`generaEtiqueta = (tipo === 'pedido_cliente' && !transporte) || tipo === 'cesion'`
y lee `lineas.hodos_id` para mostrar "Etiqueta pendiente/impresa" en el portal.
Pieza 3 tiene que cumplir ese contrato ya existente, no el que se había
esbozado antes (que dejaba fuera la cesión).

Cuando se cierra la última línea de un `pedido_cliente` con `transporte = false`
**o de una `cesion`**, la app crea automáticamente una etiqueta HODOS "Petición
Reserva" — mismo comportamiento que `_intentarCrearEtiquetaHodos_` en
`PreparacionPedidosPC/PreparacionBackend.js:566`.

Trigger: tras el `UPDATE` de línea que la deja `preparado`, re-consultar
`peticiones.estado` — si pasó a `cerrada` y (`tipo='pedido_cliente'` y
`transporte=false`) o `tipo='cesion'`, disparar.

Payload: `destino` = nombre de la tienda que debe recibir el material —
`tienda_origen` para `pedido_cliente` sin transporte, **`tienda_destino`** para
`cesion` (es la tienda distinta a la que la pide). `pedido` = `num_pedido` si
existe (cesión no tiene). `tipo: 'Petición Reserva'`, `origenIntegracion:
'preparacion'`, `operario`, `items` (líneas de la petición — todas, en Kairos
todas están "limpias" porque Pieza 3 no maneja incidencias todavía).

Reusa `HODOS_WEBAPP_URL` e `INCPC_SHARED_TOKEN` en Properties del script nuevo
(mismos valores que ya existen en otras apps del ecosistema — copiar, no
reinventar).

Idempotencia: **reusa `lineas.hodos_id`** (ya existe desde Pieza 1, sin
migración nueva) — guardar el mismo `idUnico` devuelto en todas las líneas de
la petición, igual que hace hoy `_intentarCrearEtiquetaHodos_` con
`colHodosId`. Antes de disparar, comprobar que ninguna línea de la petición ya
tenga `hodos_id` (evita duplicar en reintentos/carreras).

## Refill — sin puente myISO en Pieza 3

Cierra sola en Kairos cuando se completa su única línea (trigger SQL ya
existente, sin acción extra de la app).

**Decisión explícita:** no dispara todavía la llamada real a myISO Gestión de
Stock. Al completar, el palet queda "listo" en Kairos pero el move-to-address
a la ubicación XP1 (silueta para tienda) sigue siendo manual en myISO, como
hoy. Ese puente es Pieza 4.

## Cesión — HODOS ya en Pieza 3, myISO más adelante

La etiqueta HODOS (arriba) sí se dispara ya en Pieza 3. Lo que queda fuera es
una **acción de puente con myISO** que la cesión también necesita — el usuario
ha indicado explícitamente que esa acción se define más adelante, no ahora.
Pieza 3 no bloquea ni condiciona nada a que ese puente exista.

Ambos puentes son Pieza 4 (Puentes — HODOS, myISO Gestión de Stock), reusando
el patrón ya construido en `CartaPortesSIE` (ver
[[cartaportessie-actualizacion-ubicaciones-rc1]]) porque myISO está bloqueado
para tráfico cloud (Adeo) y necesita puente local — mezcla de arquitectura que
no conviene meter a medias en Pieza 3.

## Testing

Sin framework de test en este ecosistema (igual que Piezas 1 y 2).
Verificación en vivo: peticiones reales de prueba en Supabase, deploy real del
script, comprobación manual de cola → detalle → cierre → (si aplica) etiqueta
HODOS creada correctamente en el proyecto HODOS.

## Relacionado

[[kairos-plataforma-pedidos-taisa]], [[preparacionpedidospc-app]] (código
fuente del patrón HODOS a replicar), [[gotcha-supabase-secret-key-bloquea-urlfetchapp]],
[[cartaportessie-actualizacion-ubicaciones-rc1]] (patrón puente myISO para
Pieza 4), [[lm-malaga-colores-por-tienda]].
