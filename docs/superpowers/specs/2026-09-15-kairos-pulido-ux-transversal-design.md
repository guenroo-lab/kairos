# Pieza 8: Pulido UX transversal — Design

## Contexto

Feedback directo del usuario tras probar la app real (capturas de
`kairos-portal` en producción): diálogos nativos del navegador, pestañas
demasiado discretas, logos pequeños, botones de acción que no se parecen a
los de `PreparacionPedidosPC` (el sistema real que los operarios ya
conocen), texto pequeño en la pantalla de trabajo.

## Objetivo

Pulido visual/interacción transversal a las dos apps, sin tocar lógica de
negocio ni queries a Supabase.

## Cambios

### 1. Modales in-página (quitar `prompt`/`confirm`/`alert` nativos)

Componente nuevo reutilizable (duplicado en ambas apps, mismo patrón
self-contained del resto de Kairos): overlay + card centrada con los
tokens ya existentes (`--ink-900`, `--radius-card`). Tres variantes,
todas devuelven una `Promise`:
- `kAlerta(mensaje)` → solo botón Aceptar.
- `kConfirmar(mensaje)` → Cancelar/Aceptar, resuelve `true`/`false`.
- `kPedirTexto(mensaje, opts)` → input + Cancelar/Aceptar, resuelve el
  valor o `null` si cancela. `opts.numerico` fuerza teclado numérico.

Sustituye:
- **Portal**: `pedirCantidad()` (`prompt`), confirmación de "Rechazar
  usuario" en `renderAdmin` (`confirm`).
- **Operario**: todos los `alert(err.message)` en `withFailureHandler`
  (cerrarLinea, deshacerLinea, marcarLinea, guardarUbicacion,
  reintentarHodosUI, marcarColaIndividualUI, buscarStockUI).

### 2. Barra de pestañas — ancho completo, icono + etiqueta

Sustituye las pills pequeñas de esquina por una barra de altura fija
(~52px), ancho completo, 5 pestañas repartidas a partes iguales, icono
SVG inline (sin emoji — línea fina, mismo trazo) + etiqueta. Pestaña
activa con fondo `--accent-dim` + texto acento. Icono también para el
botón de tema (sustituye 🎨 por un SVG de paleta/engranaje).

### 3. Logos más grandes

`brand-badge img` de 18px a 30px de alto, badge con más padding.

### 4. Botones de acción de línea — estilo de `PreparacionPedidosPC`

Copiado del sistema real (`Preparacion.html`, ya en uso por los
operarios): `.btn-color` con gradiente pastel suave, `min-height: 56px`,
sombra inferior tipo "prensado" (`box-shadow: 0 3px 0 rgba(0,0,0,.18)`),
texto oscuro sobre fondo claro. Aplica a: Marcar preparada, Sin Palet,
Sin Mercancía, Otras Incidencias, Sin incidencia/Con incidencia,
Confirmar, Deshacer, Guardar (ubicación). El resto de la UI (cards,
chips, tabs) sigue con el tema oscuro+acento — estos botones son
intencionalmente distintos porque el operario ya los reconoce así.

### 5. Texto más grande en pantalla de trabajo

`renderLineaHtml_`: cabecera de línea 13px→15px, meta 12.5px→13.5px.

## Fuera de alcance

Ninguna llamada a `google.script.run` cambia. No se tocan Stock/Estado/
Panel/Volúmenes más allá de la barra de pestañas y los modales. El resto
de piezas del feedback (validación de stock, formulario, entrada
operario, trazabilidad refill, buscador) son piezas 9-13 aparte.

## Archivos afectados

- `kairos-operario/Index.html` — CSS + JS del modal, barra de pestañas,
  botones de línea, tamaños de texto.
- `kairos-portal/Portal.html` — CSS + JS del modal, mismo tratamiento de
  logos (los botones de línea no aplican aquí, el portal no prepara
  líneas).
