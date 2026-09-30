/** "Hoy" en Europe/Madrid como YYYY-MM-DD. Espejo de kairos-portal/Reservas.js
 *  (proyectos GAS separados). Las reservas de refill se ven en las colas
 *  solo cuando visible_desde <= hoy. */
function _hoyMadridIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}
