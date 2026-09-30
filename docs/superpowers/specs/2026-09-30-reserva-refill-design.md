# Reserva de refill para fecha de entrega — diseño

Fecha: 2026-09-30. Proyectos afectados: `kairos-portal`, `kairos-operario`, base `preparacion` (Supabase).

## Objetivo

La tienda puede pedir un refill para una fecha de entrega concreta. Esa petición no aparece a los operarios ni al jefe de equipo hasta el último día laborable anterior a la entrega, que es cuando se prepara y se envía.

## Decisiones (confirmadas con el usuario)

1. **Cuándo aparece:** el último día laborable (lunes a viernes) estrictamente anterior a la fecha de entrega. Entrega lunes → aparece el viernes anterior. Entrega martes → aparece el lunes. Los festivos no se detectan (límite conocido).
2. **Palets:** la reserva se crea igual que un refill de hoy. La tienda elige los palets concretos en el formulario y quedan guardados en `lineas.sscc`. Por eso `stockDisponible` ya los cuenta como comprometidos y otras peticiones no pueden usarlos. Si el día de preparar el palet no está, el operario usa "Cambiar palet" o la incidencia, como hoy.
3. **Gestión de la reserva:** la tienda (rol gestor o master, igual que Anular) puede anular la reserva o cambiar su fecha de entrega mientras aún no sea visible para operarios. No se editan palets ni motivo; para eso se anula y se crea otra.
4. **Sin vista de "programadas" para el jefe** en esta primera versión.

## Modelo de datos (migración 030)

Dos columnas nuevas en `preparacion.peticiones`:

- `fecha_entrega date` — nullable. Solo válida para `tipo = 'refill'`. Vacío = refill normal.
- `visible_desde date not null default current_date` — día a partir del cual la petición sale en las colas de operarios y jefe. En una petición normal vale el día de creación, es decir, es visible desde el primer momento, igual que ahora. En una reserva vale el último día laborable anterior a `fecha_entrega`, calculado en el servidor al crear o cambiar la fecha.

Restricción: `fecha_entrega is null or tipo = 'refill'`.

No se añade ningún estado nuevo. La reserva sigue en `pendiente`, así que no cambian el trigger `recalcular_estado_peticion` ni los CHECK de estado. No hace falta cron: la visibilidad se decide al consultar (`visible_desde <= hoy`, con "hoy" en zona Europe/Madrid).

Las filas ya existentes reciben `visible_desde = current_date` de la migración. Es inofensivo: hoy no hay peticiones abiertas y todas se consideran visibles.

## Regla de fechas

Función `ultimoLaborableAnterior(fechaEntrega)`: retrocede un día y, mientras caiga en sábado o domingo, sigue retrocediendo.

- Entrega lunes → viernes. Entrega sábado o domingo → viernes. Entrega martes → lunes.
- Si el resultado es hoy o anterior, la petición es visible de inmediato (por ejemplo, entrega mañana).
- La fecha de entrega debe ser posterior a hoy; si es hoy o pasada, se rechaza con "Para hoy usa un refill normal".

El cálculo se hace en el servidor (autoritativo) y en el cliente solo para mostrar la ayuda "Saldrá a preparación el …".

## kairos-portal

- **`Peticiones.js`:** `_crearPeticion_` acepta `datos.fechaEntrega` solo para refill. Valida la fecha, rellena `fecha_entrega` y `visible_desde` en la cabecera. El resto del flujo (guardia de duplicados, líneas, palets) no cambia.
- **Nueva `cambiarFechaEntrega(ldap, peticionId, nuevaFecha)`:** permiso gestor/master, misma tienda, tipo refill, con `fecha_entrega` no nula, estado `pendiente` y `visible_desde > hoy`. Recalcula `visible_desde`. El UPDATE lleva el mismo filtro de estado y visibilidad para evitar carreras con la aparición en cola.
- **`listarMisPeticiones` y `Trazabilidad.js`:** añaden `fecha_entrega` y `visible_desde` a la selección.
- **`Portal.html`:**
  - En el formulario de Refill, campo opcional "Fecha de entrega (reserva)" con la ayuda calculada.
  - En las listas y en el detalle, un chip "Reservada · entrega dd/mm · preparación dd/mm" mientras `visible_desde > hoy`.
  - En el detalle, botón "Cambiar fecha" (rol gestor/master, solo mientras la reserva no sea visible), con el modal propio de la app.

## kairos-operario

Añade `visible_desde=lte.<hoy Madrid>` en las cuatro consultas que muestran peticiones abiertas a operarios y jefe:

- `Cola.js`: `listarCola` y `contarPeticionesPorTienda`.
- `Estado.js`: `listarEstadoPeticiones`.
- `Panel.js`: `listarTodasPeticiones`. `listarHistorialHoy` no lo necesita: solo lista cerradas.

El servidor de operario usa un helper `_hoyMadridIso_()` (proyectos GAS separados, se duplica igual que otros helpers ya documentados). La cola y el detalle muestran "Entrega dd/mm" en las refill con `fecha_entrega`. Al abrirse, el flujo de preparación es el de un refill normal.

## Errores y casos límite

- Reserva anulada antes de aparecer: queda como anulada en trazabilidad, nunca llega a la cola.
- Cambio de fecha con `visible_desde <= hoy`: se rechaza ("Ya está en preparación, no se puede cambiar la fecha").
- Cambio de fecha a otra que dé un `visible_desde` ya pasado: la petición aparece de inmediato; es correcto.
- Palet reservado que ya no está el día de preparar: se gestiona con "Cambiar palet" o incidencia, sin código nuevo.
- Festivos: entrega justo después de un festivo aparecería el propio festivo en vez del laborable anterior. Mitigación manual: cambiar la fecha.
- Refill desactivado desde Master: crear reservas sigue bloqueado por la misma comprobación que un refill normal.

## Pruebas

- Función de fechas en Node con casos: lunes, martes, sábado, domingo, mañana y hoy.
- Migración: aplicada y verificada con consultas (columnas, CHECK, valor por defecto).
- Simulación en Supabase: crear una reserva con `visible_desde` futuro y comprobar que las cuatro consultas de operario no la devuelven; adelantar `visible_desde` y comprobar que aparece. Borrar los datos de prueba al terminar (producción arranca limpia).
- Comprobación de sintaxis de todos los `<script>` de `Portal.html` y del resto de archivos antes de cada despliegue.

## Fuera de alcance

Detección de festivos, vista de programadas para el jefe, reservas de pedido cliente o cesión, edición de palets de una reserva, reserva de stock más allá de lo que ya hace el sistema con los palets elegidos.
