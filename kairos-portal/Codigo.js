const FAVICON_KAIROS_URL_ = 'https://lh3.googleusercontent.com/d/1ZitL_PCzVFbXXhqgKR-6cV33sDnUtVUk';

function doGet(e) {
  const plantilla = HtmlService.createTemplateFromFile('Portal');
  plantilla.esAdmin = !!(e && e.parameter && e.parameter.admin === '1');
  const output = plantilla.evaluate()
    .setTitle('Kairos · Portal de tienda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover');
  // El favicon es decorativo: si Drive aún no lo ha compartido con el
  // dominio, o la URL falla, nunca debe romper la carga de la app.
  try { output.setFaviconUrl(FAVICON_KAIROS_URL_); } catch (err) { console.warn('Favicon: ' + err); }
  return output;
}

/** Inserta el contenido de otro archivo HTML del proyecto (sin evaluarlo como plantilla). */
function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

