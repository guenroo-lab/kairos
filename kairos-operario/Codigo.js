function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Kairos · Operario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
}
