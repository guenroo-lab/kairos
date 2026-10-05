const FAVICON_KAIROS_URL_ = 'https://lh3.googleusercontent.com/d/1ZitL_PCzVFbXXhqgKR-6cV33sDnUtVUk';

function doGet(e) {
  const modoJefe = !!(e && e.parameter && e.parameter.modo === 'jefe');
  const plantilla = HtmlService.createTemplateFromFile('Index');
  plantilla.modoJefe = modoJefe;
  const output = plantilla.evaluate()
    .setTitle(modoJefe ? 'Kairos · Gestión Jefe de Equipo' : 'Kairos · Operario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
  // El favicon es decorativo: si Drive aún no lo ha compartido con el
  // dominio, o la URL falla, nunca debe romper la carga de la app.
  try { output.setFaviconUrl(FAVICON_KAIROS_URL_); } catch (err) { console.warn('Favicon: ' + err); }
  return output;
}

/** Inserta el contenido de otro archivo HTML del proyecto (sin evaluarlo como plantilla). */
function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}
