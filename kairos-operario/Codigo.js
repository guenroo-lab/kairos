function doGet(e) {
  const modoJefe = !!(e && e.parameter && e.parameter.modo === 'jefe');
  const plantilla = HtmlService.createTemplateFromFile('Index');
  plantilla.modoJefe = modoJefe;
  return plantilla.evaluate()
    .setTitle(modoJefe ? 'Kairos · Gestión Jefe de Equipo' : 'Kairos · Operario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
