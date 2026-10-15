// Pruebas de mutaciones sobre la asignación de palets «primero los pequeños» (_elegirPaletsDeLinea_ y su uso en
// kairos-operario/StockAsignacion.js y Cola.js): cada mutación rompe a propósito UNA regla en una COPIA de
// kairos-operario y las pruebas de test/asignacionPaletsMenor.test.js tienen que fallar. Si una sobrevive, falta una
// prueba (o la mutación es equivalente).
//
// Las marcadas como equivalentes cambian el coste pero no el resultado (se comprobó con 400.000 repartos al azar), así que
// ninguna prueba puede detectarlas. Una mutación puede dejar un bucle sin fin (quitar el límite de palets por línea):
// por eso cada una tiene 60 s de tope y colgarse cuenta como detectada.
//
// Uso (desde cualquier carpeta): node herramientas/mutar_asignacion.js   — tarda ~1,5 min y sale con error si alguna sobrevive.
// Si se cambian los textos de StockAsignacion.js o Cola.js hay que actualizar la lista: «NO ENCUENTRA EL TEXTO» cuenta como fallo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const repo = path.resolve(__dirname, '..');
const origen = path.join(repo, 'kairos-operario');
const trabajo = path.join(os.tmpdir(), 'kairos_mut_asignacion');

const S = 'StockAsignacion.js';
const C = 'Cola.js';
const CMP = "return (a.libre - b.libre) || ((usados[b.sscc] ? 1 : 0) - (usados[a.sscc] ? 1 : 0)) ||";
const UBI = "_compararTexto_(a.ubicacion, b.ubicacion) || _compararTexto_(a.sscc, b.sscc);";
const REMANENTE_ASIG = "function remanente(c) { return enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0); }\n  const necesarias = Number(linea.cantidad);\n\n  // Palets";
// [archivo, texto original, texto mutado, descripción, equivalente?]
const M = [
  [S, CMP, "return (b.libre - a.libre) || ((usados[b.sscc] ? 1 : 0) - (usados[a.sscc] ? 1 : 0)) ||", 'la lista va de mayor a menor'],
  [S, CMP, "return (a.libre - b.libre) || ((usados[a.sscc] ? 1 : 0) - (usados[b.sscc] ? 1 : 0)) ||", 'a igualdad la lista pone antes los palets que el pedido NO visita'],
  [S, UBI, "0;", 'el empate depende del orden en que llegue el stock'],
  [S, UBI, "_compararTexto_(a.ubicacion, b.ubicacion);", 'el empate de ubicación no mira el SSCC'],
  [S, UBI, "_compararTexto_(a.sscc, b.sscc);", 'el empate no mira la ubicación'],
  [S, "if (a.vaciados.length !== b.vaciados.length) return a.vaciados.length > b.vaciados.length;", "if (a.vaciados.length !== b.vaciados.length) return a.vaciados.length < b.vaciados.length;", 'se prefiere vaciar MENOS palets'],
  [S, "if (a.vaciados.length !== b.vaciados.length) return a.vaciados.length > b.vaciados.length;", "", 'no se mira cuántos palets se vacían'],
  [S, "if (a.tamParcial !== b.tamParcial) return a.tamParcial < b.tamParcial;", "if (a.tamParcial !== b.tamParcial) return a.tamParcial > b.tamParcial;", 'se rompe el palet MÁS grande para lo que falta (y se prefiere romper uno a no romper ninguno)'],
  [S, "if (a.tamParcial !== b.tamParcial) return a.tamParcial < b.tamParcial;", "", 'da igual qué palet se rompa (y las paradas)'],
  [S, "return a.nuevos < b.nuevos;", "return a.nuevos > b.nuevos;", 'se prefieren palets que el pedido no visita'],
  [S, "return a.nuevos < b.nuevos;", "return false;", 'no se mira qué palets visita ya el pedido'],
  [S, "return a.nuevos < b.nuevos;", "return a.nuevos <= b.nuevos;", 'a igualdad total gana el último que se encuentra'],
  [S, "if (!mejor || mejorQue(cand, mejor)) mejor = cand;", "if (!mejor) mejor = cand;", 'el primero que se encuentra gana siempre'],
  [S, "const palets = parcial >= 0 ? vaciados.concat([parcial]) : vaciados;", "const palets = vaciados;", 'el palet roto no cuenta entre los palets nuevos'],
  [S, "tamParcial: parcial >= 0 ? lista[parcial].libre : 0,", "tamParcial: parcial >= 0 ? falta : 0,", 'el tamaño del palet roto es lo que se coge, no lo que tiene'],
  [S, "const MAX_PALETS_POR_LINEA_ = 3;", "const MAX_PALETS_POR_LINEA_ = 4;", 'el máximo de palets por línea es 4'],
  [S, "const MAX_PALETS_POR_LINEA_ = 3;", "const MAX_PALETS_POR_LINEA_ = 2;", 'el máximo de palets por línea es 2'],
  [S, "if (lista.length > MAX_PALETS_A_COMBINAR_) return _repartoDeMayorAMenor_(lista, pedidas);", "if (lista.length >= MAX_PALETS_A_COMBINAR_) return _repartoDeMayorAMenor_(lista, pedidas);", 'con justo 80 palets ya no se combina'],
  [S, "if (lista.length > MAX_PALETS_A_COMBINAR_) return _repartoDeMayorAMenor_(lista, pedidas);", "", 'sin tope de palets a combinar'],
  [S, "const MAX_PALETS_A_COMBINAR_ = 80;", "const MAX_PALETS_A_COMBINAR_ = 79;", 'el tope es 79'],
  [S, "const MAX_PALETS_A_COMBINAR_ = 80;", "const MAX_PALETS_A_COMBINAR_ = 81;", 'el tope es 81'],
  [S, "if (!mejor) return _repartoDeMayorAMenor_(lista, pedidas); // ni con `maxPalets` palets llega", "", 'sin plan B cuando hacen falta más palets del máximo'],
  [S, "if (falta === 0) { proponer(vaciados, -1, 0); return; }", "if (falta === 0) { return; }", 'no se aceptan repartos que vacían palets justo hasta lo pedido'],
  [S, "if (vaciados.length + 1 <= maxPalets) {", "if (true) {", 'el palet que se rompe puede pasarse del máximo'],
  [S, "if (vaciados.length >= maxPalets) return;", "", 'se pueden vaciar más palets que el máximo'],
  [S, "lista[j].libre > falta) { proponer", "lista[j].libre >= falta) { proponer", 'el palet que se rompe puede tener justo lo que falta (lo domina el reparto que vacía ese palet)', true],
  [S, "{ proponer(vaciados, j, falta); break; }", "{ proponer(vaciados, j, falta); }", 'se prueba cada palet para romper y no solo el más pequeño', true],
  [S, "if (suma + lista[x].libre > pedidas) break;", "if (suma + lista[x].libre >= pedidas) break;", 'no se prueba vaciar un palet que da justo lo pedido'],
  [S, "if (hay < pedidas) return null;", "", 'no se detecta que falta stock'],
  [S, ".filter(function (c) { return c.libre > 0; })", ".filter(function (c) { return c.libre >= 0; })", 'los palets sin nada libre cuentan'],
  [S, "const tomar = Math.min(lista[k].libre, restante);", "const tomar = lista[k].libre;", 'el plan B coge de más'],
  [S, "for (var k = lista.length - 1; k >= 0 && restante > 0; k--) {", "for (var k = 0; k < lista.length && restante > 0; k++) {", 'el plan B reparte de menor a mayor'],
  [S, "if (reparto.length === 1) return { sscc: reparto[0].sscc, ubicacion: reparto[0].ubicacion };", "if (reparto.length === 1) return { sscc: reparto[0].sscc + ' (' + reparto[0].cantidad + 'ud)', ubicacion: reparto[0].ubicacion };", 'un solo palet se guarda con sufijo'],
  [S, "sscc: reparto.map(function (r) { return r.sscc + ' (' + r.cantidad + 'ud)'; }).join(' + '),", "sscc: reparto.map(function (r) { return r.sscc; }).join(' + '),", 'varios palets sin sus unidades'],
  [S, "ubicacion: reparto.map(function (r) { return r.ubicacion; }).join(' + '),", "ubicacion: reparto.map(function (r) { return r.ubicacion; }).reverse().join(' + '),", 'las ubicaciones van en otro orden que los palets'],
  [S, REMANENTE_ASIG, REMANENTE_ASIG.replace("enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0)", "c.cantidad - (uso[c.sscc] || 0)"), 'se coge de un palet que se lleva un refill'],
  [S, REMANENTE_ASIG, REMANENTE_ASIG.replace("enRefill[c.sscc] ? 0 : c.cantidad - (uso[c.sscc] || 0)", "enRefill[c.sscc] ? 0 : c.cantidad"), 'no se descuenta lo apartado por otras líneas'],
  [S, "necesarias, { usados: usados });\n  if (!reparto) {", "necesarias, {});\n  if (!reparto) {", 'la asignación real ignora los palets que el pedido ya visita'],
  [S, "candidatos.forEach(function (c) { hay += Math.max(0, remanente(c)); });", "candidatos.forEach(function (c) { hay += remanente(c); });", 'el aviso de faltantes cuenta stock negativo'],
  [S, "' (faltan ' + (necesarias - hay) + ').');", "' (faltan ' + necesarias + ').');", 'el aviso dice mal cuántas faltan'],
  [C, "necesarias, { usados: usados }); // [{sscc, ubicacion, cantidad}] o null si no hay stock", "necesarias, {}); // [{sscc, ubicacion, cantidad}] o null si no hay stock", 'la previsión ignora los palets que el pedido ya visita'],
  [C, "uso[key] = (uso[key] || 0) + t.cantidad;", "", 'la previsión no aparta lo que ya prevé para otras líneas'],
  [C, "if (!tomados) { previstas[l.id] = null; return; }", "if (!tomados) { previstas[l.id] = ''; return; }", 'la previsión no marca «sin stock»'],
  [C, "if (mios.indexOf(t.sscc) === -1) mios.push(t.sscc);", "", 'la previsión no recuerda los palets que visita cada pedido'],
  [C, "function remanente(c) { return enRefill[c.sscc] ? 0 : Number(c.cantidad) - (uso[l.codigo_lm + '|' + c.sscc] || 0); }", "function remanente(c) { return Number(c.cantidad) - (uso[l.codigo_lm + '|' + c.sscc] || 0); }", 'la previsión cuenta un palet de refill'],
];

let sobreviven = 0;
let equivalentes = 0;
M.forEach(([archivo, de, a, que, equivalente], i) => {
  fs.rmSync(trabajo, { recursive: true, force: true });
  fs.cpSync(origen, trabajo, { recursive: true });
  const f = path.join(trabajo, archivo);
  const txt = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (!txt.includes(de)) { console.log('#' + (i + 1) + ' NO ENCUENTRA EL TEXTO: ' + que); sobreviven++; return; }
  fs.writeFileSync(f, txt.replace(de, () => a), 'utf8');
  // Se lanza node DIRECTAMENTE sobre el fichero de pruebas, sin intérprete de comandos ni corredor `--test`: con cualquiera
  // de los dos, al cumplirse el tope se mata al intermediario y el proceso que da vueltas queda huérfano gastando CPU.
  // Más de 60 s = la mutación cuelga las pruebas = detectada.
  const r = cp.spawnSync(process.execPath, ['test/asignacionPaletsMenor.test.js'], {
    cwd: repo, env: Object.assign({}, process.env, { KAIROS_OPERARIO_DIR: trabajo }), stdio: 'pipe', timeout: 60000, killSignal: 'SIGKILL',
  });
  const porTiempo = !!(r.error && r.error.code === 'ETIMEDOUT');
  if (r.error && !porTiempo) throw r.error;   // no se pudo ni lanzar node: eso no es «mutación detectada»
  const fallo = porTiempo || r.status !== 0;
  if (!fallo && equivalente) { equivalentes++; console.log('#' + (i + 1) + ' equivalente  ' + que + ' (cambia el coste, no el resultado)'); return; }
  if (!fallo) sobreviven++;
  console.log('#' + (i + 1) + ' ' + (fallo ? 'detectada   ' : 'SOBREVIVE   ') + que + (porTiempo ? '  (se cuelga: >60 s)' : '') + (fallo && equivalente ? '  (¡era equivalente y se detecta!)' : ''));
});
fs.rmSync(trabajo, { recursive: true, force: true });
console.log(sobreviven ? sobreviven + ' MUTACIONES SIN DETECTAR' : 'TODAS DETECTADAS (' + (M.length - equivalentes) + ' + ' + equivalentes + ' equivalentes)');
process.exitCode = sobreviven ? 1 : 0;
