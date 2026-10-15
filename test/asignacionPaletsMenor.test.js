// Asignación de palets: primero se vacían los palets con menos unidades (kairos-operario/StockAsignacion.js y Cola.js).
//
// Caso de Pedro (2026-10-15): piden 3 unidades y hay un palet con 1 y otro con 30 → la 1 del palet pequeño (que así
// desaparece) y las 2 que faltan del grande. Antes salían las 3 del grande y el palet de 1 se quedaba con picking.
//
// Se carga el código REAL del operario. La elección es una función pura (_elegirPaletsDeLinea_) que se prueba con casos
// concretos y contra una búsqueda exhaustiva independiente; luego se prueba de punta a punta (asignación real y previsión
// de la cola) con una base de datos en memoria (bdMemoria.js).
// Uso: node --test (raíz de Kairos). KAIROS_OPERARIO_DIR apunta a otra copia (pruebas de mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { crearBD } = require('./bdMemoria');

const OPERARIO = process.env.KAIROS_OPERARIO_DIR || path.join(__dirname, '..', 'kairos-operario');

function cargar(archivos, extra) {
  const ctx = Object.assign({ console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error, encodeURIComponent, decodeURIComponent }, extra || {});
  vm.createContext(ctx);
  archivos.forEach((f) => vm.runInContext(fs.readFileSync(path.join(OPERARIO, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

// ——— La elección de palets (función pura) ———

const puro = cargar(['StockAsignacion.js']);

// Palets de prueba: pal('a', 1) = SSCC «a» con 1 unidad libre, en la ubicación «u-a».
const pal = (nombre, libre) => ({ sscc: nombre, ubicacion: 'u-' + nombre, remanente: libre });
const elegir = (candidatos, n, opciones) => {
  const r = puro._elegirPaletsDeLinea_(candidatos, n, opciones);
  // JSON: los arrays nacidos dentro del vm no son «iguales» (prototipo distinto) a los del test.
  return r === null ? null : JSON.parse(JSON.stringify(r.map((x) => [x.sscc, x.cantidad])));
};

test('caso de Pedro: 3 unidades con un palet de 1 y otro de 30 → la 1 del pequeño y las 2 que faltan del grande', () => {
  assert.deepStrictEqual(elegir([pal('grande', 30), pal('pequeno', 1)], 3), [['pequeno', 1], ['grande', 2]]);
  assert.deepStrictEqual(elegir([pal('pequeno', 1), pal('grande', 30)], 3), [['pequeno', 1], ['grande', 2]], 'da igual el orden en que llegue el stock');
});

test('una sola unidad: el palet que solo tiene esa unidad, antes que romper uno grande', () => {
  assert.deepStrictEqual(elegir([pal('grande', 30), pal('uno', 1)], 1), [['uno', 1]]);
  assert.deepStrictEqual(elegir([pal('a', 30), pal('b', 12), pal('c', 1)], 1), [['c', 1]]);
});

test('si ningún palet se vacía, se rompe el más pequeño que llegue (los grandes se quedan enteros)', () => {
  assert.deepStrictEqual(elegir([pal('grande', 30), pal('mediano', 5)], 3), [['mediano', 3]]);
  assert.deepStrictEqual(elegir([pal('a', 30), pal('b', 8), pal('c', 5)], 4), [['c', 4]]);
  assert.deepStrictEqual(elegir([pal('solo', 30)], 3), [['solo', 3]]);
});

test('si un palet tiene justo lo que piden, se coge ese entero (en vez de 1 + el resto de otro, que deja lo mismo con una parada más)', () => {
  assert.deepStrictEqual(elegir([pal('uno', 1), pal('tres', 3), pal('treinta', 30)], 3), [['tres', 3]]);
  assert.deepStrictEqual(elegir([pal('uno', 1), pal('dos', 2), pal('tres', 3), pal('treinta', 30)], 4), [['uno', 1], ['tres', 3]]);
  assert.deepStrictEqual(elegir([pal('uno', 1), pal('dos', 2), pal('tres', 3), pal('treinta', 30)], 5), [['dos', 2], ['tres', 3]]);
});

test('se prefiere vaciar DOS palets pequeños a coger un palet entero del tamaño justo', () => {
  assert.deepStrictEqual(elegir([pal('uno', 1), pal('tres', 3), pal('cuatro', 4), pal('treinta', 30)], 4), [['uno', 1], ['tres', 3]]);
});

test('con dos palets pequeños iguales, lo que falta sale del otro pequeño y no del grande', () => {
  assert.deepStrictEqual(elegir([pal('a', 2), pal('b', 2), pal('grande', 30)], 3), [['a', 2], ['b', 1]]);
});

test('varios palets pequeños: se vacían los que caben y el resto sale del siguiente más pequeño que lo cubra', () => {
  assert.deepStrictEqual(elegir([pal('a', 1), pal('b', 2), pal('c', 5), pal('grande', 30)], 5), [['a', 1], ['b', 2], ['c', 2]]);
  assert.deepStrictEqual(elegir([pal('a', 1), pal('b', 1), pal('c', 30)], 4), [['a', 1], ['b', 1], ['c', 2]]);
});

test('como mucho 3 palets por línea cuando se puede: no se manda al operario a 6 sitios para vaciar unidades sueltas', () => {
  const uno = [pal('a', 1), pal('b', 1), pal('c', 1), pal('d', 1), pal('grande', 30)];
  assert.deepStrictEqual(elegir(uno, 7), [['a', 1], ['b', 1], ['grande', 5]]);
  assert.deepStrictEqual(elegir(uno, 7, { maxPalets: 5 }), [['a', 1], ['b', 1], ['c', 1], ['d', 1], ['grande', 3]], 'el máximo se puede cambiar');
  assert.deepStrictEqual(elegir(uno, 7, { maxPalets: 1 }), [['grande', 7]]);
});

test('si hacen falta más palets del máximo, se usan los menos posibles (de mayor a menor)', () => {
  const casi = [pal('a', 4), pal('b', 5), pal('c', 6), pal('d', 7)];
  assert.deepStrictEqual(elegir(casi, 21), [['d', 7], ['c', 6], ['b', 5], ['a', 3]]);
  const r = elegir([pal('p1', 40), pal('p2', 40), pal('p3', 40), pal('p4', 40), pal('c1', 1), pal('c2', 1)], 130);
  assert.deepStrictEqual(r.map((x) => x[1]), [40, 40, 40, 10], 'cuatro palets, no los seis');
});

test('a igualdad de todo lo demás, se prefiere un palet que el pedido ya visita', () => {
  const dos = [pal('a', 5), pal('b', 5)];
  assert.deepStrictEqual(elegir(dos, 3, { usados: { b: true } }), [['b', 3]]);
  assert.deepStrictEqual(elegir(dos, 3, { usados: { a: true } }), [['a', 3]]);
  // …pero nunca a costa de dejar un palet pequeño con picking
  assert.deepStrictEqual(elegir([pal('uno', 1), pal('visitado', 30)], 3, { usados: { visitado: true } }), [['uno', 1], ['visitado', 2]]);
  assert.deepStrictEqual(elegir([pal('pequeno', 5), pal('visitado', 30)], 3, { usados: { visitado: true } }), [['pequeno', 3]]);
});

test('entre dos formas de vaciar lo mismo se rompe el palet más pequeño (los grandes se quedan enteros)', () => {
  // 5 uds: o se vacía el de 3 y se rompe el de 4 (le quedan 2), o se vacía el de 4 y se rompe el de 3 (le quedan 2)
  assert.deepStrictEqual(elegir([pal('tres', 3), pal('cuatro', 4), pal('veinte', 20)], 5), [['cuatro', 4], ['tres', 1]]);
  assert.deepStrictEqual(elegir([pal('cuatro', 4), pal('veinte', 20), pal('tres', 3)], 5), [['cuatro', 4], ['tres', 1]], 'da igual el orden de llegada');
});

test('a igualdad de todo lo demás, se prefiere vaciar los palets que el pedido ya visita; sin visitas, los primeros de la lista', () => {
  const cuatro = [pal('u1', 1), pal('t1', 3), pal('t2', 3), pal('u5', 5)];
  // 6 uds: 1 + 5 o 3 + 3 — las dos formas vacían dos palets y no rompen ninguno
  assert.deepStrictEqual(elegir(cuatro, 6), [['u1', 1], ['u5', 5]], 'sin visitas: los primeros de la lista');
  assert.deepStrictEqual(elegir(cuatro, 6, { usados: { t1: true, t2: true } }), [['t1', 3], ['t2', 3]], 'el pedido ya visita los dos de 3');
  assert.deepStrictEqual(elegir(cuatro, 6, { usados: { t1: true } }), [['t1', 3], ['t2', 3]], 'con que visite uno de los dos de 3 ya son menos palets nuevos');
  assert.deepStrictEqual(elegir(cuatro, 6, { usados: { u1: true, u5: true } }), [['u1', 1], ['u5', 5]]);
});

test('con más de 80 palets de un mismo código no se prueban combinaciones: se reparte de mayor a menor', () => {
  const grandes = (cuantos) => Array.from({ length: cuantos }, (_, i) => pal('g' + String(i).padStart(2, '0'), 30));
  // 80 palets: la regla de siempre (la 1 del pequeño y las 2 que faltan del primero de los grandes)
  assert.deepStrictEqual(elegir([pal('chico', 1)].concat(grandes(79)), 3), [['chico', 1], ['g00', 2]]);
  // 81 palets: de mayor a menor (el último de la lista, que entre iguales es el de mayor ubicación)
  assert.deepStrictEqual(elegir([pal('chico', 1)].concat(grandes(80)), 3), [['g79', 3]]);
  assert.strictEqual(elegir(grandes(81), 81 * 30 + 1), null, 'sin stock suficiente sigue dando null');
  const r = elegir(grandes(100), 95);
  assert.deepStrictEqual(r.map((x) => x[1]), [30, 30, 30, 5], 'los menos palets posibles');
});

// Si este test no termina enseguida, alguien ha quitado el límite de palets por línea: sin él se prueban TODOS los
// subconjuntos de 80 palets y no acaba nunca.
test('con 80 palets pequeños y un pedido que ni con 3 palets llega, termina enseguida (reparto de mayor a menor)', () => {
  const pequenos = Array.from({ length: 80 }, (_, i) => pal('q' + String(i).padStart(2, '0'), 1 + (i % 9)));
  const inicio = Date.now();
  const reparto = elegir(pequenos, 200);
  assert.ok(Date.now() - inicio < 2000, 'tardó ' + (Date.now() - inicio) + ' ms');
  assert.strictEqual(reparto.reduce((s, x) => s + x[1], 0), 200);
  assert.ok(reparto.every((x) => x[1] <= 9));
  assert.deepStrictEqual(reparto.slice(0, 3).map((x) => x[1]), [9, 9, 9], 'empieza por los más grandes');
});

test('sin stock suficiente devuelve null; lo que no está libre (0 o negativo) no cuenta', () => {
  assert.strictEqual(elegir([pal('a', 1), pal('b', 2)], 4), null);
  assert.strictEqual(elegir([], 1), null);
  assert.strictEqual(elegir([pal('a', 0), pal('b', -3), pal('c', 2)], 3), null);
  assert.deepStrictEqual(elegir([pal('a', 0), pal('b', -3), pal('c', 2), pal('d', 4)], 3), [['c', 2], ['d', 1]], 'el de 0 y el negativo no se tocan');
  assert.deepStrictEqual(elegir([pal('a', 0), pal('b', -3), pal('d', 4)], 3), [['d', 3]]);
  assert.deepStrictEqual(elegir([pal('a', 3)], 3), [['a', 3]], 'justo lo que hay');
  assert.deepStrictEqual(elegir([pal('a', 1), pal('b', 2)], 3), [['a', 1], ['b', 2]]);
});

test('no toca los datos que recibe y el resultado no depende del orden de entrada', () => {
  const entrada = [pal('x', 7), pal('y', 1), pal('z', 20), pal('w', 2)];
  const copia = JSON.parse(JSON.stringify(entrada));
  const r1 = elegir(entrada, 6);
  assert.deepStrictEqual(entrada, copia);
  const barajadas = [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]];
  barajadas.forEach((orden) => assert.deepStrictEqual(elegir(orden.map((i) => entrada[i]), 6), r1));
});

test('los palets iguales se eligen siempre en el mismo orden (ubicación y SSCC), no al azar', () => {
  const a = [{ sscc: 'S2', ubicacion: '05-B', remanente: 3 }, { sscc: 'S1', ubicacion: '05-A', remanente: 3 }, { sscc: 'S3', ubicacion: '05-A', remanente: 3 }];
  assert.deepStrictEqual(elegir(a, 3), [['S1', 3]]);
  assert.deepStrictEqual(elegir(a.slice().reverse(), 3), [['S1', 3]]);
  assert.deepStrictEqual(elegir([{ sscc: 'S9', ubicacion: '05-A', remanente: 3 }, { sscc: 'S3', ubicacion: '05-A', remanente: 3 }], 3), [['S3', 3]]);
  // la ubicación manda sobre el SSCC
  assert.deepStrictEqual(elegir([{ sscc: 'S1', ubicacion: '05-B', remanente: 3 }, { sscc: 'S2', ubicacion: '05-A', remanente: 3 }], 3), [['S2', 3]]);
});

// Búsqueda exhaustiva independiente: prueba TODOS los repartos posibles (cuántas unidades de cada palet) y se queda con
// el mejor según la regla, por este orden: más palets vacíos, menos paradas, palet roto lo más pequeño posible y menos
// palets nuevos para el pedido (`visitados[k]` = el pedido ya va al palet k) — con el mismo máximo de palets.
function oraculo(libres, n, max, visitados) {
  let mejor = null;
  const x = new Array(libres.length).fill(0);
  const mejorQue = (a, b) => (a.vaciados !== b.vaciados ? a.vaciados > b.vaciados
    : a.paradas !== b.paradas ? a.paradas < b.paradas
      : a.tamParcial !== b.tamParcial ? a.tamParcial < b.tamParcial
        : a.nuevos < b.nuevos);
  (function rec(i, resto) {
    if (i === libres.length) {
      if (resto !== 0) return;
      const paradas = x.filter((v) => v > 0).length;
      if (paradas > max) return;
      const vaciados = x.filter((v, k) => v > 0 && v === libres[k]).length;
      const rotos = libres.filter((l, k) => x[k] > 0 && x[k] < l);
      // Dos palets rotos nunca es lo mejor (se pasan unidades de uno a otro): si alguna vez ganara, el test lo vería.
      const tamParcial = rotos.length > 1 ? Infinity : rotos.length ? rotos[0] : 0;
      const nuevos = x.filter((v, k) => v > 0 && !(visitados && visitados[k])).length;
      const candidato = { vaciados, paradas, tamParcial, nuevos };
      if (!mejor || mejorQue(candidato, mejor)) mejor = candidato;
      return;
    }
    for (let v = 0; v <= Math.min(libres[i], resto); v++) { x[i] = v; rec(i + 1, resto - v); }
    x[i] = 0;
  })(0, n);
  return mejor;
}

function aleatorio(semilla) {
  let s = semilla;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test('contra una búsqueda exhaustiva: palets vacíos, paradas, palet roto y palets nuevos para el pedido son siempre los mejores (1500 casos al azar)', () => {
  const azar = aleatorio(20261015);
  let comprobados = 0;
  let conFallback = 0;
  for (let caso = 0; caso < 1500; caso++) {
    const cuantos = 1 + Math.floor(azar() * 5);
    const libres = Array.from({ length: cuantos }, () => 1 + Math.floor(azar() * 7));
    const total = libres.reduce((s, v) => s + v, 0);
    const n = 1 + Math.floor(azar() * Math.min(total, 14));
    const max = 1 + Math.floor(azar() * 4);
    const cand = libres.map((v, i) => pal('p' + i, v));
    const visitados = libres.map(() => azar() < 0.4);   // palets a los que el pedido ya va con otras líneas
    const usados = {};
    visitados.forEach((v, i) => { if (v) usados['p' + i] = true; });
    const r = puro._elegirPaletsDeLinea_(cand, n, { maxPalets: max, usados });
    assert.ok(r, 'hay stock de sobra: ' + JSON.stringify({ libres, n, max }));
    // Invariantes
    assert.strictEqual(r.reduce((s, p) => s + p.cantidad, 0), n, 'suma justo lo pedido ' + JSON.stringify({ libres, n, max, r }));
    assert.strictEqual(new Set(r.map((p) => p.sscc)).size, r.length, 'palets distintos');
    r.forEach((p) => { assert.ok(p.cantidad > 0 && p.cantidad <= libres[Number(p.sscc.slice(1))], 'cantidad dentro de lo libre ' + JSON.stringify({ libres, n, max, r })); });
    const minimo = (() => { let c = 0, k = 0; libres.slice().sort((a, b) => b - a).forEach((v) => { if (c < n) { c += v; k++; } }); return k; })();
    if (minimo > max) {
      conFallback++;
      assert.strictEqual(r.length, minimo, 'si no llega con el máximo, usa los mínimos posibles ' + JSON.stringify({ libres, n, max, r }));
      continue;
    }
    // Óptimo: lo que se vacía, las paradas, el palet que se rompe y los palets nuevos para el pedido
    const o = oraculo(libres, n, max, visitados);
    const idx = (p) => Number(p.sscc.slice(1));
    const rotos = r.filter((p) => p.cantidad < libres[idx(p)]);
    const obtenido = {
      vaciados: r.filter((p) => p.cantidad === libres[idx(p)]).length,
      paradas: r.length,
      tamParcial: rotos.length ? libres[idx(rotos[0])] : 0,
      nuevos: r.filter((p) => !visitados[idx(p)]).length,
    };
    assert.deepStrictEqual(obtenido, o, 'no es el óptimo ' + JSON.stringify({ libres, visitados, n, max, r }));
    assert.ok(r.length <= max);
    // A lo sumo UN palet queda a medias, y va el último
    const aMedias = r.filter((p) => p.cantidad < libres[Number(p.sscc.slice(1))]);
    assert.ok(aMedias.length <= 1, 'a lo sumo uno a medias ' + JSON.stringify({ libres, n, max, r }));
    if (aMedias.length) assert.strictEqual(r[r.length - 1], aMedias[0]);
    // Los que se vacían van de menos a más unidades
    const vacios = r.filter((p) => p.cantidad === libres[Number(p.sscc.slice(1))]).map((p) => p.cantidad);
    assert.deepStrictEqual(vacios, vacios.slice().sort((a, b) => a - b));
    comprobados++;
  }
  assert.ok(comprobados > 1000, 'se comprobaron ' + comprobados + ' casos con óptimo y ' + conFallback + ' con más palets que el máximo');
  assert.ok(conFallback > 0, 'también hay casos que necesitan más palets del máximo');
});

test('lo que se rompe a medias es siempre el palet más pequeño que alcanza (nunca uno grande pudiendo ser uno pequeño)', () => {
  const azar = aleatorio(777);
  for (let caso = 0; caso < 800; caso++) {
    const libres = Array.from({ length: 2 + Math.floor(azar() * 4) }, () => 1 + Math.floor(azar() * 9));
    const n = 1 + Math.floor(azar() * Math.min(libres.reduce((s, v) => s + v, 0), 10));
    const cand = libres.map((v, i) => pal('p' + i, v));
    const r = puro._elegirPaletsDeLinea_(cand, n, { maxPalets: 3 });
    const minimo = (() => { let c = 0, k = 0; libres.slice().sort((a, b) => b - a).forEach((v) => { if (c < n) { c += v; k++; } }); return k; })();
    if (minimo > 3) continue;
    const aMedias = r.filter((p) => p.cantidad < libres[Number(p.sscc.slice(1))]);
    if (!aMedias.length) continue;
    const parcial = aMedias[0];
    const tamParcial = libres[Number(parcial.sscc.slice(1))];
    const faltaAlli = parcial.cantidad;
    // Ningún palet que no se haya usado, con más de lo que se cogió de él y menos que el roto, podía haberlo sustituido
    // dejando igual de vacíos y las mismas paradas.
    const usadosSscc = new Set(r.map((p) => p.sscc));
    cand.forEach((c) => {
      if (usadosSscc.has(c.sscc)) return;
      if (c.remanente > faltaAlli && c.remanente < tamParcial) {
        const sustituido = r.filter((p) => p !== parcial).concat([{ sscc: c.sscc, ubicacion: c.ubicacion, cantidad: faltaAlli }]);
        const alt = { vaciados: sustituido.filter((p) => p.cantidad === c.remanente || p.cantidad === libres[Number(p.sscc.slice(1))]).length };
        // Misma cantidad de palets vaciados y mismas paradas: la elección real tendría que haber sido la otra.
        assert.ok(alt.vaciados < r.filter((p) => p.cantidad === libres[Number(p.sscc.slice(1))]).length || sustituido.length > r.length,
          'se rompió un palet más grande de lo necesario ' + JSON.stringify({ libres, n, r }));
      }
    });
  }
});

// ——— De punta a punta: asignación real y previsión de la cola ———

const T0 = '2026-10-15T06:00:00.000Z';
const P = (n) => String(n).padStart(20, '0');   // SSCC de 20 cifras

function semilla() {
  const stock = (id, sscc, codigo, cantidad, ubicacion, tienda) => ({ id, tienda: tienda || '014', sscc, codigo_lm: codigo, cantidad, ubicacion, sincronizado_en: T0 });
  return {
    stock_fisico: [
      stock('s1', P(1), 'X', 1, '05-A-1-1'),
      stock('s2', P(30), 'X', 30, '05-B-2-2'),
      stock('s3', P(5), 'Z', 5, '05-C-3-3'),
      stock('s4', P(31), 'Z', 30, '05-D-4-4'),
      stock('s9', P(9), 'X', 100, '05-Z-9-9', '279'),
    ],
    peticiones: [],
    lineas: [],
  };
}

const pet = (id, extra) => Object.assign({
  id, tipo: 'pedido_cliente', tienda_origen: '014', estado: 'pendiente', creada_en: '2026-10-15T07:00:00.000Z', visible_desde: '2026-10-01',
  num_pedido: id, transporte: false, cola_individual: true, solicitante_ldap: '100', en_curso_por: null, en_curso_desde: null,
}, extra);
const lin = (id, peticion, codigo, cantidad, extra) => Object.assign({
  id, peticion_id: peticion, codigo_lm: codigo, cantidad, unidad_medida: 'ud', estado_preparacion: 'pendiente', sscc: null, ubicacion: null,
}, extra);

function entorno(ajustar) {
  const datos = semilla();
  if (ajustar) ajustar(datos);
  const bd = crearBD(datos);
  const ctx = cargar(['Config.js', 'Utils.js', 'Fechas.js', 'Supabase.js', 'StockAsignacion.js', 'Cola.js', 'Peticion.js'], {
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { formatDate: () => '2026-10-15' },
  });
  ctx._supaFetch_ = (metodo, tabla, query, payload) => bd.transporte(metodo, tabla, query, payload);
  const linea = (id) => bd.db.lineas.find((l) => l.id === id);
  const asignar = (peticionId, operario) => JSON.parse(ctx.obtenerPeticion(peticionId, operario || 'Ana'));
  const previstas = () => Object.fromEntries(JSON.parse(ctx.listarCola('014', '')).map((p) => [p.id, p.ubicaciones]));
  return { ctx, bd, db: bd.db, linea, asignar, previstas };
}

test('de punta a punta: 3 unidades con palets de 1 y de 30 → «1 del pequeño + 2 del grande», con sus dos ubicaciones', () => {
  const e = entorno((d) => { d.peticiones.push(pet('pc1')); d.lineas.push(lin('L1', 'pc1', 'X', 3)); });
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(1) + ' (1ud) + ' + P(30) + ' (2ud)');
  assert.strictEqual(e.linea('L1').ubicacion, '05-A-1-1 + 05-B-2-2');
  assert.ok(e.linea('L1').sscc_asignado_en);
});

test('de punta a punta: un solo palet se guarda con el SSCC suelto, como siempre', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc1'));
    d.lineas.push(lin('L1', 'pc1', 'Z', 3));    // palets de 5 y de 30: sale del de 5
  });
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(5));
  assert.strictEqual(e.linea('L1').ubicacion, '05-C-3-3');
});

test('de punta a punta: lo que ya tienen apartado otras líneas cuenta (el palet pequeño ya no está libre → sale del grande)', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc1'), pet('pc2'));
    d.lineas.push(lin('L1', 'pc1', 'X', 1), lin('L2', 'pc2', 'X', 3));
  });
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(1), 'la 1 unidad se lleva el palet de 1');
  e.asignar('pc2');
  assert.strictEqual(e.linea('L2').sscc, P(30), 'el palet de 1 ya está apartado: las 3 salen del grande');
});

test('de punta a punta: el palet pequeño solo se vacía por lo que le queda libre', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc1'), pet('pc2'));
    d.lineas.push(lin('Lprev', 'pc1', 'Z', 4, { sscc: P(5) + ' (4ud)', ubicacion: '05-C-3-3' }), lin('L2', 'pc2', 'Z', 3));
  });
  e.asignar('pc2');
  assert.strictEqual(e.linea('L2').sscc, P(5) + ' (1ud) + ' + P(31) + ' (2ud)', 'del palet de 5 solo quedaba 1 libre');
});

test('de punta a punta: un palet que se lleva un refill no se toca', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc1'), pet('rf1', { tipo: 'refill', num_pedido: null, transporte: null, motivo: 'hueco' }));
    d.lineas.push(lin('L1', 'pc1', 'X', 3), lin('LR', 'rf1', 'X', 1, { unidad_medida: 'palet', sscc: P(1) + ' (1ud)', ubicacion: '05-A-1-1' }));
  });
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(30), 'el palet de 1 es de un refill: las 3 salen del grande');
});

test('de punta a punta: a igualdad, el palet que el pedido ya visita (el mismo palet con otra referencia)', () => {
  const e = entorno((d) => {
    d.stock_fisico.push(
      { id: 's20', tienda: '014', sscc: P(20), codigo_lm: 'W', cantidad: 5, ubicacion: '05-E-1-1', sincronizado_en: T0 },
      { id: 's21', tienda: '014', sscc: P(21), codigo_lm: 'W', cantidad: 5, ubicacion: '05-E-1-2', sincronizado_en: T0 },
      { id: 's22', tienda: '014', sscc: P(21), codigo_lm: 'Y', cantidad: 9, ubicacion: '05-E-1-2', sincronizado_en: T0 });
    d.peticiones.push(pet('pc1'));
    d.lineas.push(lin('LY', 'pc1', 'Y', 2, { sscc: P(21), ubicacion: '05-E-1-2' }), lin('LW', 'pc1', 'W', 3));
  });
  e.asignar('pc1');
  assert.strictEqual(e.linea('LW').sscc, P(21), 'el pedido ya va al palet 21 a por la Y');
});

test('de punta a punta: sin stock suficiente falla con el mismo mensaje de siempre y no escribe nada', () => {
  const e = entorno((d) => { d.peticiones.push(pet('pc1')); d.lineas.push(lin('L1', 'pc1', 'X', 40)); });
  const r = e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, null);
  assert.strictEqual(r.lineas[0].avisoStock, 'Ni repartiendo entre todos los palets del edificio 05 hay 40 uds del código X (faltan 9).');
});

test('de punta a punta: una línea ya asignada no se vuelve a repartir', () => {
  const e = entorno((d) => { d.peticiones.push(pet('pc1')); d.lineas.push(lin('L1', 'pc1', 'X', 3, { sscc: P(30), ubicacion: '05-B-2-2' })); });
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(30));
});

test('la previsión de la cola coincide con lo que luego se asigna (mismo reparto, misma ubicación)', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc1', { creada_en: '2026-10-15T07:00:00.000Z' }), pet('pc2', { creada_en: '2026-10-15T07:05:00.000Z' }), pet('pc3', { creada_en: '2026-10-15T07:10:00.000Z' }));
    d.lineas.push(lin('L1', 'pc1', 'X', 3), lin('L2', 'pc2', 'X', 2), lin('L3', 'pc3', 'Z', 4));
  });
  const prevista = e.previstas();
  assert.deepStrictEqual(prevista.pc1, ['05-A-1-1', '05-B-2-2'], 'el palet de 1 y el de 30');
  assert.deepStrictEqual(prevista.pc2, ['05-B-2-2'], 'el palet de 1 ya está previsto para el pedido anterior');
  assert.deepStrictEqual(prevista.pc3, ['05-C-3-3'], 'palet de 5 entero para 4 unidades');
  ['pc1', 'pc2', 'pc3'].forEach((id) => e.asignar(id));
  const ubicacionesReales = (l) => e.linea(l).ubicacion.split(' + ');
  assert.deepStrictEqual(ubicacionesReales('L1'), prevista.pc1);
  assert.deepStrictEqual(ubicacionesReales('L2'), prevista.pc2);
  assert.deepStrictEqual(ubicacionesReales('L3'), prevista.pc3);
});

test('la previsión marca «sin stock» cuando no hay unidades de sobra', () => {
  const e = entorno((d) => { d.peticiones.push(pet('pc1')); d.lineas.push(lin('L1', 'pc1', 'X', 99)); });
  const cola = JSON.parse(e.ctx.listarCola('014', ''));
  assert.strictEqual(cola[0].sinStockPrevisto, true);
});

// ——— Palets mixtos (un mismo SSCC con varios códigos), refills y palets que el pedido ya visita ———

// El palet P(1) lleva además 7 uds del código Y y un refill de la Y se lo lleva ENTERO (con la X que lleva dentro).
function conRefillSobrePaletMixto(d) {
  d.stock_fisico.push({ id: 's5', tienda: '014', sscc: P(1), codigo_lm: 'Y', cantidad: 7, ubicacion: '05-A-1-1', sincronizado_en: T0 });
  d.peticiones.push(pet('pc1'), pet('rf1', { tipo: 'refill', num_pedido: null, transporte: null, motivo: 'hueco' }));
  d.lineas.push(lin('L1', 'pc1', 'X', 3),
    lin('LR', 'rf1', 'Y', 1, { unidad_medida: 'palet', sscc: P(1) + ' (7ud)', ubicacion: '05-A-1-1' }));
}

// Dos palets de 5 uds del código W; el segundo es MIXTO: lleva además 9 uds del código Y.
function paletsWyY(d) {
  d.stock_fisico.push(
    { id: 's20', tienda: '014', sscc: P(20), codigo_lm: 'W', cantidad: 5, ubicacion: '05-E-1-1', sincronizado_en: T0 },
    { id: 's21', tienda: '014', sscc: P(21), codigo_lm: 'W', cantidad: 5, ubicacion: '05-E-1-2', sincronizado_en: T0 },
    { id: 's22', tienda: '014', sscc: P(21), codigo_lm: 'Y', cantidad: 9, ubicacion: '05-E-1-2', sincronizado_en: T0 });
}

test('de punta a punta: un refill de OTRO código que se lleva el mismo palet (palet mixto) también lo aparta', () => {
  const e = entorno(conRefillSobrePaletMixto);
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, P(30), 'el palet de 1 de la X se va entero con el refill de la Y: las 3 salen del grande');
  assert.strictEqual(e.linea('L1').ubicacion, '05-B-2-2');
});

test('la previsión de la cola tampoco cuenta un palet mixto que se lleva un refill de otro código', () => {
  const e = entorno(conRefillSobrePaletMixto);
  assert.deepStrictEqual(e.previstas().pc1, ['05-B-2-2']);
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').ubicacion, '05-B-2-2', 'y es lo que luego se asigna');
});

test('la previsión de la cola: a igualdad, el palet al que el pedido ya va con otra línea ya asignada', () => {
  const e = entorno((d) => {
    paletsWyY(d);
    d.peticiones.push(pet('pc1'));
    d.lineas.push(lin('LY', 'pc1', 'Y', 2, { sscc: P(21), ubicacion: '05-E-1-2' }), lin('LW', 'pc1', 'W', 3));
  });
  assert.deepStrictEqual(e.previstas().pc1, ['05-E-1-2'], 'el pedido ya va al palet 21 a por la Y');
  e.asignar('pc1');
  assert.strictEqual(e.linea('LW').ubicacion, '05-E-1-2', 'y es lo que luego se asigna');
});

test('la previsión de la cola: lo que prevé para una línea cuenta como palet visitado para las siguientes del mismo pedido', () => {
  const e = entorno((d) => {
    paletsWyY(d);
    d.peticiones.push(pet('pc1'));
    d.lineas.push(lin('L1', 'pc1', 'Y', 2), lin('L2', 'pc1', 'W', 3));   // la Y solo está en el palet 21
  });
  assert.deepStrictEqual(e.previstas().pc1, ['05-E-1-2'], 'la W va al palet 21, donde ya va la Y');
  e.asignar('pc1');
  assert.strictEqual(e.linea('L1').ubicacion, '05-E-1-2');
  assert.strictEqual(e.linea('L2').ubicacion, '05-E-1-2', 'y es lo que luego se asigna');
});

test('el aviso «faltan N» no cuenta como stock un palet con más apartado que existencias (remanente negativo)', () => {
  const e = entorno((d) => {
    d.peticiones.push(pet('pc0'), pet('pc1'));
    // otro pedido tiene apartadas 35 uds del palet de 30 (el stock bajó después de asignarlo): le quedan −5
    d.lineas.push(lin('Lprev', 'pc0', 'X', 35, { sscc: P(30) + ' (35ud)', ubicacion: '05-B-2-2' }), lin('L1', 'pc1', 'X', 40));
  });
  const r = e.asignar('pc1');
  assert.strictEqual(e.linea('L1').sscc, null);
  assert.strictEqual(r.lineas[0].avisoStock, 'Ni repartiendo entre todos los palets del edificio 05 hay 40 uds del código X (faltan 39).');
});

test('código fuente: la asignación real y la previsión de la cola usan la MISMA función', () => {
  const asig = fs.readFileSync(path.join(OPERARIO, 'StockAsignacion.js'), 'utf8');
  const cola = fs.readFileSync(path.join(OPERARIO, 'Cola.js'), 'utf8');
  assert.strictEqual((asig.match(/_elegirPaletsDeLinea_\(/g) || []).length >= 2, true, 'definida y usada en la asignación');
  assert.match(cola, /_elegirPaletsDeLinea_\(/);
  assert.ok(!/b\.remanente - a\.remanente/.test(cola), 'la previsión ya no tiene su propio reparto');
  const nombres = fs.readdirSync(OPERARIO).map((f) => f.replace(/\.(js|html)$/, ''));
  assert.strictEqual(new Set(nombres).size, nombres.length, 'hay dos archivos con el mismo nombre base');
});
