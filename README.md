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
| 4 | Puentes — HODOS, myISO Gestión de Stock | pendiente |
