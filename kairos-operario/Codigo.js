function doGet(e) {
  const plantilla = HtmlService.createTemplateFromFile('Index');
  plantilla.modoJefe = !!(e && e.parameter && e.parameter.modo === 'jefe');
  return plantilla.evaluate()
    .setTitle('Kairos · Operario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
