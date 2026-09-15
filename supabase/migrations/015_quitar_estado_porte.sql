-- Corrección: Carta de Portes SIE no tiene relación con Kairos (proyecto
-- ajeno que además queda obsoleto). El puente que alimentaba esta tabla se
-- revirtió en PreparacionPedidosPC. Refill se sigue por vía interna.
drop table if exists preparacion.estado_porte;

notify pgrst, 'reload schema';
