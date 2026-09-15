# Kairos

Plataforma de peticiones y preparación de pedidos de Taisa (Leroy Merlin, zona Málaga).

Sustituye al sistema actual `PreparacionPedidosPC`: la tienda crea peticiones desde
su propio portal, Taisa las prepara, y el material sale a tienda o se consolida para
un pedido de cliente.

- **Nombre:** Kairos (griego, "el momento oportuno"; hace pareja con HODOS, "el camino").
- **Almacenamiento:** Supabase (esquema `preparacion` dentro del proyecto de HODOS).
- **Estado:** en diseño. Ver `docs/superpowers/specs/`.

## Piezas

| # | Pieza | Estado |
|---|---|---|
| 1 | Fundación — modelo de datos y almacenamiento | ✅ completa (catálogo: 7.168 referencias, trigger diario 11:00) |
| 2 | Portal de tienda — crear peticiones + ver estado | ✅ completa |
| 3 | App de operario — cola de peticiones, líneas, HODOS auto-etiqueta | ✅ completa (bug de URL HODOS compartida pendiente de arreglar aparte) |
| 4 | Puentes — TRANSFERS (consumo stock) + move-to-address (refill) | código completo; falta crear shortcut Android XP1 con Pedro |
| 5 | Panel de gestión — Stock, Estado, Panel jefe_equipo, Carta de Portes SIE | ✅ completa, fusionada y en producción |
| 6 | Trazabilidad (portal) + volúmenes de trabajo + cola individual | ✅ completa, fusionada y en producción |
| 7 | Rediseño visual — tema (4 acentos + claro/oscuro), logos | ✅ completa, fusionada y en producción |
| 8 | Pulido UX — modales in-página, pestañas, logos grandes, botones | ✅ completa, fusionada y en producción |
| 9 | Validación stock edificio 5 + alertas duplicado | pendiente |
| 10 | Formulario petición — orden, nº cesión, multi-artículo | pendiente |
| 11 | Entrada operario — 1-2 personas, tienda, filtros | pendiente |
| 12 | Trazabilidad Refill real (puente CartadePortesSIE) | pendiente |
| 13 | Buscador de peticiones realizadas | pendiente |

Pulido: incidencias en preparación (kairos-operario) — completo 2026-09-14.
