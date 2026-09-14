# Incidencias en preparación (kairos-operario) — Diseño

**Estado:** aprobado para plan de implementación.

## Qué es

Pulido explícitamente pospuesto en Pieza 3: el checkbox de "marcar preparada"
era binario (preparado/no). Esto añade la captura de **incidencias**
(Sin Palet, Sin Mercancía, Otras Incidencias + motivo) al preparar una línea
de `pedido_cliente` o `cesion`, replicando el flujo real ya validado en
producción por `PreparacionPedidosPC` — no se inventa nada nuevo.

`refill` queda fuera: su única línea es "todo o nada" (el palet está o no
está — si no está, el operario simplemente no completa la petición; no tiene
sentido un motivo de incidencia parcial para un palet completo).

## Flujo real (replicado de `Preparacion.html:676-896`)

Al pulsar "Marcar preparada" en una línea:

1. **¿Esta línea tiene alguna incidencia?** — dos botones: `Sin incidencia` /
   `⚠ Con incidencia`.
2. Si `Sin incidencia` → se cierra inmediatamente (igual que hoy).
3. Si `Con incidencia` → tres botones: `Sin Palet` / `Sin Mercancía` /
   `Otras Incidencias`.
   - `Sin Palet` o `Sin Mercancía` → se cierra inmediatamente con ese tipo,
     sin motivo.
   - `Otras Incidencias` → pantalla con input de texto ("Motivo de la
     incidencia") + botón `Confirmar`. No se puede confirmar vacío.

Una línea con incidencia **también cuenta como cerrada** (no vuelve a la
cola) — el operario ya determinó que no hay nada más que hacer con ella.

**Línea ya preparada** (con o sin incidencia) muestra su resumen
(`estado_negocio` + motivo si lo hay) y un botón **Deshacer**, que la
devuelve a `en_curso` y limpia `estado_negocio`/`incidencia_motivo` — permite
corregir un tipo de incidencia mal elegido. Deshacer **no** revierte
llamadas ya disparadas a HODOS/TRANSFERS/move-to-address (igual que el
sistema viejo: si ya salió la transferencia de stock, salió).

## Cambios en el servidor (`kairos-operario/Peticion.js`)

### `marcarLineaPreparada(lineaId, operarioNombre, incidencia, motivo)`

`incidencia` y `motivo` son opcionales (compatibilidad con el flujo sin
incidencia ya existente).

- **Sin incidencia** (`incidencia` vacío): `estado_negocio` se decide igual
  que el sistema viejo —
  - `pedido_cliente` con `transporte = true` → `'Consolidado'`.
  - Cualquier otro caso (`pedido_cliente` sin transporte, `cesion`) →
    `'Preparado'`.
  - (Corrige el comportamiento actual de Pieza 3, que siempre ponía
    `'Preparado'` sin mirar `transporte`.)
- **Con incidencia**: validar que `incidencia` esté en
  `['Sin Palet', 'Sin Mercancía', 'Otras Incidencias']` (mismos 3 valores
  exactos del CHECK de `lineas.estado_negocio`, ya en el esquema desde Pieza
  1). Si es `'Otras Incidencias'`, `motivo` es obligatorio (mismo CHECK
  `otras_incidencias_tiene_motivo` ya existente). `incidencia_motivo` se
  guarda solo en ese caso.
- En ambos casos: `estado_preparacion = 'preparado'`, `operario`,
  `preparada_en = now()`.
- Tras guardar, sigue llamando a `_dispararEtiquetaSiProcede_` igual que hoy
  (la corrección de filtrado de incidencias va dentro de esa función, ver
  abajo).

### `deshacerLineaPreparada(lineaId, operarioNombre)` — nueva

```
UPDATE lineas SET
  estado_preparacion = 'en_curso',
  operario = '<operarioNombre>',
  estado_negocio = null,
  incidencia_motivo = null
WHERE id = <lineaId>
```

No toca `sscc`/`ubicacion`/`sscc_asignado_en` — igual que el sistema viejo,
la reserva de stock ya asignada al abrir el detalle no se libera. No dispara
ningún puente (HODOS/TRANSFERS/move-to-address) — solo los dispara marcar,
nunca deshacer.

## Corrección: HODOS y TRANSFERS deben excluir incidencias

**Gap real encontrado en el código ya construido**: tanto
`kairos-operario/Hodos.js` (`_dispararEtiquetaSiProcede_`) como el `TRANSFERS`
armado en `Index.html` (`dispararPuenteMyIsoSiProcede_`) incluyen hoy
**todas** las líneas de la petición sin filtrar. El sistema viejo excluye
las que tienen incidencia (`INCIDENCIAS.indexOf(x.estadoNegocio) === -1`,
`Preparacion.html:707`) — solo se envía a HODOS/se transfiere en myISO la
mercancía que realmente se cogió.

- `_dispararEtiquetaSiProcede_`: al construir `items`, filtrar
  `lineas.filter(l => ['Sin Palet','Sin Mercancía','Otras Incidencias'].indexOf(l.estado_negocio) === -1)`.
  Si tras filtrar no queda ninguna línea limpia, no crear etiqueta (igual
  que el sistema viejo: "todo incidencia, no hay nada que enviar a HODOS").
- `dispararPuenteMyIsoSiProcede_` (cliente): mismo filtro antes de construir
  el array `transfers`.

Esto es una corrección de un bug ya presente, no depende de que se termine
esta pieza — pero como hasta ahora nunca se había marcado una incidencia de
verdad, no se había manifestado.

## Cambios en el cliente (`kairos-operario/Index.html`)

Reemplaza el checkbox simple por el flujo de botones de arriba, para líneas
de `pedido_cliente` y `cesion` únicamente (refill sigue con checkbox simple,
sin incidencias).

Reutiliza el patrón de "vistas anidadas dentro de la tarjeta de línea" del
sistema viejo (`construirLinea`): cada línea mantiene su propio mini-estado
de vista (pregunta → tipos → motivo) sin recargar el detalle completo hasta
que se confirma una decisión final.

## Fuera de alcance

- `refill`: sin incidencias, checkbox simple como hoy.
- No se re-valida ni se libera el SSCC/ubicación ya reservado al marcar
  incidencia o al deshacer — limitación aceptada, igual que el sistema
  viejo (documentada ya como "limitación conocida" en la spec de Pieza 4).
- Deshacer no revierte llamadas externas ya disparadas.

## Testing

Sin framework de test (igual que todo el proyecto). Verificación en vivo:
marcar una línea sin incidencia (transporte true y false, confirmar
Consolidado/Preparado), marcar con cada uno de los 3 tipos de incidencia,
confirmar que `incidencia_motivo` se exige solo en "Otras Incidencias",
confirmar que HODOS/TRANSFERS excluyen las líneas con incidencia, probar
Deshacer y re-marcar.

## Relacionado

[[kairos-plataforma-pedidos-taisa]], [[preparacionpedidospc-app]] (flujo
real replicado, `Preparacion.html:676-896` y `PreparacionBackend.js:521`).
