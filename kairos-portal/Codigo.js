function doGet(e) {
  const plantilla = HtmlService.createTemplateFromFile('Portal');
  plantilla.esAdmin = !!(e && e.parameter && e.parameter.admin === '1');
  return plantilla.evaluate()
    .setTitle('Kairos · Portal de tienda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
