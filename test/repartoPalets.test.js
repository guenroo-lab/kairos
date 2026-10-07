// Reparto manual de una línea entre varios palets (kairos-operario/StockAsignacion.js + RepartoPaletsUI.html).
//
// Caso de uso: la línea pide 17 ud y el sistema le dio un palet de 29; hay otro de 15 que no se asignó porque solo
// no llegaba. El operario coge los 15 (vaciando ese palet) y las 2 que faltan del otro, y las dos partes tienen que
// contar como reservadas en SUS palets (para el resto de pedidos) y como dos transferencias de stock distintas.
//
// Se carga el código REAL del operario y solo se sustituye el transporte HTTP (_supaFetch_) por una base de datos en
// memoria que interpreta las consultas reales. La parte de pantalla se ejecuta en un vm con el DOM mínimo.
//
// Uso: node --test   (desde la raíz de Kairos). KAIROS_OPERARIO_DIR apunta a otra copia (pruebas de mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const OPERARIO = process.env.KAIROS_OPERARIO_DIR || path.join(__dirname, '..', 'kairos-operario');
const ARCHIVOS = ['Config.js', 'Utils.js', 'Supabase.js', 'StockAsignacion.js'];

const T0 = '2026-10-07T07:00:00.000Z';       // marca del último stock cargado
const DESPUES = '2026-10-07T09:00:00.000Z';
const P29 = '00000000000000000029';   // 29 ud en 05-A-1-1
const P15 = '00000000000000000015';   // 15 ud en 05-B-2-2
const P40 = '00000000000000000040';   // 40 ud en 05-C-3-3
const P9 = '00000000000000000009';    // de otra tienda

function semilla() {
  const stock = (id, tienda, sscc, codigo, cantidad, ubicacion) => ({ id, tienda, sscc, codigo_lm: codigo, cantidad, ubicacion, sincronizado_en: T0 });
  return {
    stock_fisico: [
      stock('s1', '014', P29, 'X', 29, '05-A-1-1'),
      stock('s2', '014', P15, 'X', 15, '05-B-2-2'),
      stock('s3', '014', P40, 'X', 40, '05-C-3-3'),
      stock('s4', '279', P9, 'X', 100, '05-Z-9-9'),
      stock('s5', '014', P29, 'Y', 5, '05-A-1-1'),   // el mismo palet lleva también otro código
    ],
    peticiones: [
      { id: 'pet1', tipo: 'pedido_cliente', tienda_origen: '014', estado: 'en_preparacion', transporte: false },
    ],
    lineas: [
      // La línea de la prueba: pide 17 y el sistema le dio el palet de 29.
      { id: 'L1', peticion_id: 'pet1', codigo_lm: 'X', cantidad: 17, unidad_medida: 'ud', estado_preparacion: 'pendiente', sscc: P29 + ' (17ud)', ubicacion: '05-A-1-1', sscc_asignado_en: '2026-10-07T08:00:00.000Z' },
    ],
  };
}

const { crearBD } = require('./bdMemoria');

function entorno(opciones) {
  opciones = opciones || {};
  const datos = semilla();
  if (opciones.ajustar) opciones.ajustar(datos);
  const bd = crearBD(datos);
  const cerrojo = { esperas: 0, liberaciones: 0 };
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error, encodeURIComponent, decodeURIComponent,
    LockService: { getScriptLock: () => ({ waitLock: () => { cerrojo.esperas++; }, releaseLock: () => { cerrojo.liberaciones++; } }) },
  };
  vm.createContext(ctx);
  ARCHIVOS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(OPERARIO, f), 'utf8'), ctx, { filename: f }));
  ctx._supaFetch_ = (metodo, tabla, query, payload) => bd.transporte(metodo, tabla, query, payload);
  const lista = (id) => JSON.parse(ctx.listarPaletsAlternativos(id));
  const repartir = (id, reparto) => JSON.parse(ctx.repartirPaletsLinea(id, reparto));
  const falla = (id, reparto) => { try { ctx.repartirPaletsLinea(id, reparto); return null; } catch (e) { return e.message; } };
  const linea = (id) => bd.db.lineas.find((l) => l.id === id);
  return { ctx, bd, db: bd.db, cerrojo, lista, repartir, falla, linea };
}

const otraLinea = (id, sscc, cantidad, extra) => Object.assign({
  id, peticion_id: 'pet2', codigo_lm: 'X', cantidad, unidad_medida: 'ud', estado_preparacion: 'pendiente',
  sscc, ubicacion: '05-?', sscc_asignado_en: '2026-10-07T08:30:00.000Z',
}, extra || {});
const otraPeticion = (extra) => Object.assign({ id: 'pet2', tipo: 'pedido_cliente', tienda_origen: '014', estado: 'pendiente', transporte: false }, extra || {});

// ——— El caso de uso ———

test('17 ud: 15 de un palet pequeño y 2 del grande, guardado en el formato de varios soportes', () => {
  const e = entorno();
  const r = e.repartir('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]);
  assert.strictEqual(r.ok, true);
  const l = e.linea('L1');
  assert.strictEqual(l.sscc, P15 + ' (15ud) + ' + P29 + ' (2ud)');
  assert.strictEqual(l.ubicacion, '05-B-2-2 + 05-A-1-1', 'una ubicación por palet, en el mismo orden');
  assert.ok(l.sscc_asignado_en > '2026-10-07T08:00:00.000Z', 'se renueva la marca de asignación (si no, el palet nuevo no contaría como reservado)');
  assert.strictEqual(r.sscc, l.sscc);
});

test('las dos partes cuentan como reservadas en SUS palets para los demás pedidos', () => {
  const e = entorno({ ajustar: (d) => { d.peticiones.push(otraPeticion()); d.lineas.push(otraLinea('L2', P40 + ' (10ud)', 10), otraLinea('L3', null, 3, { sscc_asignado_en: null })); } });
  e.repartir('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]);
  // Visto desde otra línea del mismo código: el palet de 15 ya no tiene nada libre, el de 29 tiene 27 y el de 40 tiene 30.
  const l = e.lista('L3');
  const libre = (s) => l.find((x) => x.sscc === s).remanente;
  assert.deepStrictEqual([libre(P15), libre(P29), libre(P40)], [0, 27, 30]);
  // Y desde la propia línea, lo suyo no cuenta contra ella: puede volver a repartirlo.
  const propia = e.lista('L1');
  const mio = (s) => propia.find((x) => x.sscc === s);
  assert.deepStrictEqual([mio(P15).remanente, mio(P15).cantidadActual, mio(P29).remanente, mio(P29).cantidadActual, mio(P40).cantidadActual], [15, 15, 29, 2, 0]);
  assert.deepStrictEqual([mio(P15).esActual, mio(P29).esActual, mio(P40).esActual], [true, true, false]);
});

test('otro pedido no puede quedarse con lo que este ya apartó del palet pequeño', () => {
  const e = entorno({ ajustar: (d) => { d.peticiones.push(otraPeticion()); d.lineas.push(otraLinea('L2', null, 10, { sscc_asignado_en: null })); } });
  e.repartir('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]);
  const msg = e.falla('L2', [{ sscc: P15, cantidad: 10 }]);
  assert.match(msg, /solo tiene 0 ud libres/);
});

test('sin cambios la lista de palets sigue igual: la línea antes de repartir tiene todo en un palet', () => {
  const e = entorno();
  const l = e.lista('L1');
  assert.deepStrictEqual(l.map((x) => [x.sscc, x.remanente, x.cantidadActual]).sort(), [[P15, 15, 0], [P29, 29, 17], [P40, 40, 0]]);
  assert.ok(!l.some((x) => x.sscc === P9), 'palets de otra tienda no salen');
});

test('también vale repartir entre tres palets', () => {
  const e = entorno();
  e.repartir('L1', [{ sscc: P15, cantidad: 10 }, { sscc: P29, cantidad: 5 }, { sscc: P40, cantidad: 2 }]);
  assert.strictEqual(e.linea('L1').sscc, P15 + ' (10ud) + ' + P29 + ' (5ud) + ' + P40 + ' (2ud)');
  assert.strictEqual(e.linea('L1').ubicacion, '05-B-2-2 + 05-A-1-1 + 05-C-3-3');
});

test('la ubicación sale del stock, no de lo que mande el cliente', () => {
  const e = entorno();
  e.repartir('L1', [{ sscc: P15, cantidad: 15, ubicacion: 'cualquier-cosa' }, { sscc: P29, cantidad: 2, ubicacion: 'otra' }]);
  assert.strictEqual(e.linea('L1').ubicacion, '05-B-2-2 + 05-A-1-1');
});

// ——— Lo que se rechaza ———

test('el reparto tiene que sumar exactamente lo que pide la línea', () => {
  const e = entorno();
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 1 }]), /suma 16 ud y la línea pide 17/);
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 3 }]), /suma 18 ud y la línea pide 17/);
  assert.strictEqual(e.linea('L1').sscc, P29 + ' (17ud)', 'no se toca nada');
});

test('un palet no puede dar más de lo que tiene libre', () => {
  const e = entorno();
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 16 }, { sscc: P29, cantidad: 1 }]), /solo tiene 15 ud libres/);
});

test('lo reservado por otros pedidos (pendientes o ya preparados después de la carga de stock) no está libre', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push(otraPeticion(), otraPeticion({ id: 'pet3', estado: 'a_ubicar' }));
      d.lineas.push(
        otraLinea('L2', P29 + ' (20ud)', 20),                                              // sin preparar: reserva 20 del de 29
        otraLinea('L3', P15 + ' (6ud)', 6, { peticion_id: 'pet3', estado_preparacion: 'preparado', estado_negocio: 'Preparado', preparada_en: DESPUES }),
      );
    },
  });
  const l = e.lista('L1');
  assert.strictEqual(l.find((x) => x.sscc === P29).remanente, 9);
  assert.strictEqual(l.find((x) => x.sscc === P15).remanente, 9, 'lo preparado después de la marca del stock aún cuenta como consumido');
  assert.match(e.falla('L1', [{ sscc: P29, cantidad: 12 }, { sscc: P40, cantidad: 5 }]), /solo tiene 9 ud libres.*reservado por otros pedidos/);
  e.repartir('L1', [{ sscc: P29, cantidad: 9 }, { sscc: P15, cantidad: 8 }]);   // lo que sí queda libre vale
  assert.strictEqual(e.linea('L1').sscc, P29 + ' (9ud) + ' + P15 + ' (8ud)');
});

test('un palet que se lleva un refill no se puede usar, ni siquiera para otro código que lleve ese mismo palet', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push(otraPeticion({ id: 'ref', tipo: 'refill' }));
      d.lineas.push(
        { id: 'R1', peticion_id: 'ref', codigo_lm: 'X', cantidad: 1, unidad_medida: 'palet', estado_preparacion: 'pendiente', sscc: P15 + ' (15ud)', ubicacion: '05-B-2-2' },
        // Un refill del código Y se lleva el palet de 29 entero, con el código X que también lleva dentro.
        { id: 'R2', peticion_id: 'ref', codigo_lm: 'Y', cantidad: 1, unidad_medida: 'palet', estado_preparacion: 'pendiente', sscc: P29 + ' (5ud)', ubicacion: '05-A-1-1' },
      );
    },
  });
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P40, cantidad: 2 }]), /lo reserva un refill/);
  assert.match(e.falla('L1', [{ sscc: P29, cantidad: 17 }]), /solo tiene 0 ud libres \(lo reserva un refill\)/);
  assert.strictEqual(e.lista('L1').find((x) => x.sscc === P29).remanente, 29, 'la propia línea lo tiene asignado: se le sigue mostrando');
});

test('datos mal formados: palet repetido, unidades 0, negativas, decimales, sin palet o sin nada', () => {
  const e = entorno();
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 10 }, { sscc: P15, cantidad: 7 }]), /repetido/);
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 0 }, { sscc: P29, cantidad: 17 }]), /entero mayor que 0/);
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: -3 }, { sscc: P29, cantidad: 20 }]), /entero mayor que 0/);
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 7.5 }, { sscc: P29, cantidad: 9.5 }]), /entero mayor que 0/);
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 'abc' }, { sscc: P29, cantidad: 17 }]), /entero mayor que 0/);
  assert.match(e.falla('L1', [{ sscc: '', cantidad: 17 }]), /Falta el palet/);
  assert.match(e.falla('L1', []), /al menos un palet/);
  assert.match(e.falla('L1', null), /al menos un palet/);
});

test('un palet que no es de este código y tienda no sirve', () => {
  const e = entorno();
  assert.match(e.falla('L1', [{ sscc: P9, cantidad: 10 }, { sscc: P29, cantidad: 7 }]), /ya no consta con el código X/);     // de otra tienda
  assert.match(e.falla('L1', [{ sscc: 'INVENTADO', cantidad: 10 }, { sscc: P29, cantidad: 7 }]), /ya no consta/);
});

test('solo se reparten líneas de pedido cliente o cesión por unidades y aún sin preparar', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push(otraPeticion({ id: 'ref', tipo: 'refill' }), otraPeticion({ id: 'anul', estado: 'anulada' }), otraPeticion({ id: 'cerr', estado: 'cerrada' }));
      d.lineas.push(
        otraLinea('LR', P15 + ' (15ud)', 1, { peticion_id: 'ref', unidad_medida: 'palet' }),
        otraLinea('LP', null, 2, { unidad_medida: 'palet', sscc_asignado_en: null }),
        otraLinea('LRU', null, 4, { peticion_id: 'ref', sscc_asignado_en: null }),   // línea por unidades dentro de un refill (no debería existir, pero no se reparte)
        otraLinea('LA', null, 4, { peticion_id: 'anul', sscc_asignado_en: null }),
        otraLinea('LC', null, 4, { peticion_id: 'cerr', sscc_asignado_en: null }),
      );
      d.lineas[0].estado_preparacion = 'preparado';
    },
  });
  assert.match(e.falla('L1', [{ sscc: P29, cantidad: 17 }]), /ya está preparada/);
  assert.match(e.falla('LR', [{ sscc: P15, cantidad: 1 }]), /palets enteros|refill/i);
  assert.match(e.falla('LP', [{ sscc: P15, cantidad: 2 }]), /palets enteros/);
  assert.match(e.falla('LRU', [{ sscc: P15, cantidad: 4 }]), /refill se lleva palets enteros/i);
  assert.match(e.falla('LA', [{ sscc: P15, cantidad: 4 }]), /ya no admite cambios/);
  assert.match(e.falla('LC', [{ sscc: P15, cantidad: 4 }]), /ya no admite cambios/);
  assert.match(e.falla('NO-EXISTE', [{ sscc: P15, cantidad: 4 }]), /Línea no encontrada/);
});

test('si la línea se marca preparada justo entre medias, no se pisa', () => {
  const e = entorno();
  // La comprobación de estado también va en el UPDATE: simulamos que otro operario la prepara tras leerla.
  const original = e.bd.transporte;
  let primera = true;
  e.ctx._supaFetch_ = (metodo, tabla, query, payload) => {
    if (metodo === 'PATCH' && primera) { primera = false; e.db.lineas[0].estado_preparacion = 'preparado'; }
    return original(metodo, tabla, query, payload);
  };
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]), /acaba de cambiar/);
  assert.strictEqual(e.linea('L1').sscc, P29 + ' (17ud)');
});

test('el bloqueo del script se coge y se suelta siempre, también si falla', () => {
  const e = entorno();
  e.repartir('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]);
  e.falla('L1', [{ sscc: P15, cantidad: 99 }]);
  e.falla('NO-EXISTE', [{ sscc: P15, cantidad: 1 }]);
  assert.strictEqual(e.cerrojo.esperas, 3);
  assert.strictEqual(e.cerrojo.liberaciones, 3);
});

test('si no se consigue el bloqueo avisa claro y no cambia nada', () => {
  const e = entorno();
  e.ctx.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout'); }, releaseLock: () => { throw new Error('no debería soltarse'); } }) };
  assert.match(e.falla('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]), /ocupado asignando stock/);
  assert.strictEqual(e.linea('L1').sscc, P29 + ' (17ud)');
});

test('repartir y volver a repartir: la segunda vez cuenta con lo que esa línea ya tenía', () => {
  const e = entorno();
  e.repartir('L1', [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }]);
  e.repartir('L1', [{ sscc: P29, cantidad: 17 }]);   // vuelve a un solo palet
  assert.strictEqual(e.linea('L1').sscc, P29 + ' (17ud)');
  e.repartir('L1', [{ sscc: P15, cantidad: 7 }, { sscc: P40, cantidad: 10 }]);
  assert.strictEqual(e.linea('L1').sscc, P15 + ' (7ud) + ' + P40 + ' (10ud)');
});

// ——— Lo que ve y hace el operario (RepartoPaletsUI.html) ———

function pantalla(opciones) {
  opciones = opciones || {};
  const html = fs.readFileSync(path.join(OPERARIO, 'RepartoPaletsUI.html'), 'utf8');
  const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elementos = {};
  const llamadas = [];
  const el = (id) => elementos[id] || (elementos[id] = { id, className: '', textContent: '', disabled: false, classList: { toggle(c, on) { elementos[id].marcas = elementos[id].marcas || {}; elementos[id].marcas[c] = !!on; } } });
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, isFinite,
    document: { getElementById: (id) => el(id) },
    ultimoDetalle: { peticion: { tipo: 'pedido_cliente' }, lineas: [{ id: 'L1', cantidad: 17, unidad_medida: 'ud', estado_preparacion: 'pendiente', sscc: P29 + ' (17ud)' }] },
    selectorPalet: {}, confirmadosPalet: {},
    renderDetalleBody_: () => { ctx.__pintados++; }, renderDetalle: () => { ctx.__recargas++; },
    kAlerta: (m) => { ctx.__alertas.push(m); },
    __pintados: 0, __recargas: 0, __alertas: [],
  };
  if (opciones.detalle) Object.assign(ctx.ultimoDetalle, opciones.detalle);
  const make = (okf, failf) => new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (f) => make(f, failf);
    if (name === 'withFailureHandler') return (f) => make(okf, f);
    return (...args) => { llamadas.push({ name, args, ok: okf, fail: failf }); };
  } });
  ctx.google = { script: { run: make(null, null) } };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'RepartoPaletsUI.html' });
  return { ctx, llamadas, el };
}

const LISTA = [
  { sscc: P29, ubicacion: '05-A-1-1', remanente: 29, esActual: true, cantidadActual: 17 },
  { sscc: P15, ubicacion: '05-B-2-2', remanente: 15, esActual: false, cantidadActual: 0 },
  { sscc: P40, ubicacion: '05-C-3-3', remanente: 40, esActual: false, cantidadActual: 0 },
];

test('pantalla: vaciar el palet de 15 coge los 15 y completa las 2 que faltan con el único palet que alcanza', () => {
  const { ctx } = pantalla();
  const cant = ctx.REP_sugerirVaciando_(LISTA, 17, P15);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cant)), { [P29]: 2, [P15]: 15, [P40]: 0 }.constructor === Object ? { [P29]: 2, [P15]: 15, [P40]: 0 } : null);
});

test('pantalla: para completar elige el palet con MENOS libres que alcance (así se van terminando los pequeños)', () => {
  const { ctx } = pantalla();
  const lista = [
    { sscc: 'A', ubicacion: 'u', remanente: 12, esActual: false }, { sscc: 'B', ubicacion: 'u', remanente: 5, esActual: false },
    { sscc: 'C', ubicacion: 'u', remanente: 3, esActual: false }, { sscc: 'D', ubicacion: 'u', remanente: 1, esActual: false },
  ];
  // Vaciar A (12) y faltan 3 de 15: lo cubre justo C (3), mejor que B (5) o dividir.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.REP_sugerirVaciando_(lista, 15, 'A'))), { A: 12, B: 0, C: 3, D: 0 });
  // En empate de libres gana el palet que la línea ya tenía.
  const empate = [{ sscc: 'A', ubicacion: 'u', remanente: 4 }, { sscc: 'B', ubicacion: 'u', remanente: 6, esActual: false }, { sscc: 'C', ubicacion: 'u', remanente: 6, esActual: true }];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.REP_sugerirVaciando_(empate, 7, 'A'))), { A: 4, B: 0, C: 3 });
});

test('pantalla: si ningún palet solo completa el resto, se reparte de mayor a menor; si no llega, la validación lo dice', () => {
  const { ctx } = pantalla();
  const lista = [{ sscc: 'A', ubicacion: 'u', remanente: 8 }, { sscc: 'B', ubicacion: 'u', remanente: 5 }, { sscc: 'C', ubicacion: 'u', remanente: 4 }];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.REP_sugerirVaciando_(lista, 15, 'C'))), { A: 8, B: 3, C: 4 });
  const corto = ctx.REP_estadoInicial_(lista, 20);
  corto.cant = ctx.REP_sugerirVaciando_(lista, 20, 'A');
  const r = ctx.REP_revisar_(corto);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.falta, 3);
});

test('pantalla: vaciar un palet que ya basta no divide nada', () => {
  const { ctx } = pantalla();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.REP_sugerirVaciando_(LISTA, 17, P40))), { [P29]: 0, [P15]: 0, [P40]: 17 });
});

test('pantalla: la revisión avisa de lo que falta, de lo que sobra y de pasarse de lo libre', () => {
  const { ctx } = pantalla();
  const estado = ctx.REP_estadoInicial_(LISTA, 17);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(estado.cant)), { [P29]: 17, [P15]: 0, [P40]: 0 }, 'empieza con lo que la línea ya tiene');
  assert.strictEqual(ctx.REP_revisar_(estado).ok, true);
  estado.cant[P29] = 2; estado.cant[P15] = 12;
  assert.strictEqual(ctx.REP_revisar_(estado).falta, 3);
  assert.match(ctx.REP_textoResumen_(estado).texto, /Llevas 14 de 17 ud · faltan 3/);
  estado.cant[P15] = 18;
  const r = ctx.REP_revisar_(estado);
  assert.strictEqual(r.ok, false);
  assert.match(r.errores[P15], /Solo hay 15 ud libres/);
  assert.strictEqual(ctx.REP_textoResumen_(estado).cls, 'mal');
  estado.cant[P15] = 15; estado.cant[P29] = 5;
  assert.match(ctx.REP_textoResumen_(estado).texto, /Te pasas 3 ud/);
  estado.cant[P29] = 2;
  const ok = ctx.REP_textoResumen_(estado);
  assert.strictEqual(ok.cls, 'ok');
  assert.match(ok.texto, /17 de 17 ud: 2 del palet 0+29 \+ 15 del palet 0+15/);
  estado.cant[P29] = 1.5; estado.cant[P15] = 15.5;
  assert.match(ctx.REP_revisar_(estado).errores[P29], /entero/);
});

test('pantalla: un reparto con todo a 0 nunca vale, aunque la línea pidiera 0', () => {
  const { ctx } = pantalla();
  const estado = ctx.REP_estadoInicial_(LISTA, 0);
  assert.strictEqual(ctx.REP_revisar_(estado).ok, false);
});

test('pantalla: solo se ofrece repartir pedido cliente / cesión por unidades, sin preparar y de más de 1 ud', () => {
  const { ctx } = pantalla();
  const base = { id: 'L1', cantidad: 17, unidad_medida: 'ud', estado_preparacion: 'pendiente' };
  assert.strictEqual(ctx.repartoPermitido_(base), true);
  assert.strictEqual(ctx.repartoPermitido_(Object.assign({}, base, { estado_preparacion: 'preparado' })), false);
  assert.strictEqual(ctx.repartoPermitido_(Object.assign({}, base, { unidad_medida: 'palet' })), false);
  assert.strictEqual(ctx.repartoPermitido_(Object.assign({}, base, { cantidad: 1 })), false);
  ctx.ultimoDetalle.peticion.tipo = 'refill';
  assert.strictEqual(ctx.repartoPermitido_(base), false);
  ctx.ultimoDetalle.peticion.tipo = 'cesion';
  assert.strictEqual(ctx.repartoPermitido_(base), true);
});

test('pantalla: abrir carga los palets, enseña los que tienen libres (el más pequeño primero) y se puede confirmar', () => {
  const { ctx, llamadas } = pantalla();
  ctx.abrirReparto('L1');
  assert.strictEqual(ctx.repartoPalet.L1, 'cargando');
  assert.match(ctx.repartoHtml_({ id: 'L1' }), /Buscando palets/);
  assert.strictEqual(llamadas.length, 1);
  assert.deepStrictEqual([llamadas[0].name, llamadas[0].args[0]], ['listarPaletsAlternativos', 'L1']);
  llamadas[0].ok(JSON.stringify(LISTA));
  const h = ctx.repartoHtml_({ id: 'L1' });
  assert.match(h, /Repartir 17 ud entre palets/);
  const orden = [...h.matchAll(/SSCC (\d+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(orden, [P15, P29, P40], 'de menos a más libres');
  assert.match(h, /15 ud libres/);
  assert.match(h, /29 ud libres/);
  assert.match(h, new RegExp('SSCC ' + P29 + ' <small>· el actual</small>'));
  assert.match(h, /id="repOk-L1" +onclick/, 'con lo inicial (17 en el palet actual) ya se puede confirmar');
  assert.ok(!/disabled onclick/.test(h));
});

test('pantalla: «Vaciar este» deja 15 + 2 y repinta; confirmar manda al servidor solo los palets con unidades', () => {
  const { ctx, llamadas } = pantalla();
  ctx.abrirReparto('L1'); llamadas[0].ok(JSON.stringify(LISTA));
  const pintados = ctx.__pintados;
  const idx = LISTA.findIndex((c) => c.sscc === P15);
  ctx.repVaciar('L1', idx);
  assert.strictEqual(ctx.__pintados, pintados + 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.repartoPalet.L1.cant)), { [P29]: 2, [P15]: 15, [P40]: 0 });
  ctx.repConfirmar('L1');
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[1].name, 'repartirPaletsLinea');
  assert.strictEqual(llamadas[1].args[0], 'L1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(llamadas[1].args[1])), [{ sscc: P15, cantidad: 15 }, { sscc: P29, cantidad: 2 }], 'primero el palet del que más se coge');
  // doble clic: no se manda dos veces
  ctx.repConfirmar('L1');
  assert.strictEqual(llamadas.length, 2);
  // éxito: se limpia el estado de la línea y se recarga el pedido
  ctx.selectorPalet.L1 = ['x']; ctx.confirmadosPalet.L1 = [true];
  llamadas[1].ok('{"ok":true}');
  assert.ok(!('L1' in ctx.repartoPalet) && !('L1' in ctx.selectorPalet) && !('L1' in ctx.confirmadosPalet));
  assert.strictEqual(ctx.__recargas, 1);
});

test('pantalla: si el servidor rechaza el reparto se avisa con su mensaje y se puede reintentar', () => {
  const { ctx, llamadas, el } = pantalla();
  ctx.abrirReparto('L1'); llamadas[0].ok(JSON.stringify(LISTA));
  ctx.repConfirmar('L1');
  assert.strictEqual(el('repOk-L1').disabled, true, 'mientras se guarda, el botón queda apagado');
  llamadas[1].fail({ message: 'El palet X solo tiene 3 ud libres.' });
  assert.deepStrictEqual(ctx.__alertas, ['El palet X solo tiene 3 ud libres.']);
  assert.strictEqual(ctx.repartoPalet.L1.enviando, false);
  assert.strictEqual(el('repOk-L1').disabled, false);
  ctx.repConfirmar('L1');
  assert.strictEqual(llamadas.length, 3, 'se puede volver a intentar');
});

test('pantalla: al teclear unidades solo se refresca el resumen, sin repintar (no se pierde el cursor)', () => {
  const { ctx, llamadas, el } = pantalla();
  ctx.abrirReparto('L1'); llamadas[0].ok(JSON.stringify(LISTA));
  const pintados = ctx.__pintados;
  const iP15 = LISTA.findIndex((c) => c.sscc === P15), iP29 = LISTA.findIndex((c) => c.sscc === P29);
  ctx.repCambia('L1', iP29, '2');
  assert.match(el('repResumen-L1').textContent, /Llevas 2 de 17 ud · faltan 15/);
  assert.strictEqual(el('repOk-L1').disabled, true);
  ctx.repCambia('L1', iP15, '15');
  assert.strictEqual(el('repResumen-L1').className, 'rep-resumen ok');
  assert.strictEqual(el('repOk-L1').disabled, false);
  ctx.repCambia('L1', iP15, '40');
  assert.strictEqual(el('repResumen-L1').className, 'rep-resumen mal');
  assert.strictEqual(el('repf-L1-' + iP15).marcas['rep-mal'], true, 'la fila con error se marca');
  ctx.repCambia('L1', iP15, '');
  assert.strictEqual(ctx.repartoPalet.L1.cant[P15], 0, 'vacío cuenta como 0');
  assert.strictEqual(ctx.__pintados, pintados, 'ningún repintado');
  ctx.repConfirmar('L1');
  assert.strictEqual(llamadas.length, 1, 'con el reparto mal no se envía');
});

test('pantalla: los textos de palets y ubicaciones van escapados y sin palets no se abre el panel', () => {
  const { ctx, llamadas } = pantalla();
  ctx.abrirReparto('L1');
  llamadas[0].ok(JSON.stringify([{ sscc: '<img src=x onerror=alert(1)>', ubicacion: '<b>', remanente: 20, esActual: true, cantidadActual: 17 }]));
  const h = ctx.repartoHtml_({ id: 'L1' });
  assert.ok(!h.includes('<img src=x') && h.includes('&lt;img'));
  const otra = pantalla();
  otra.ctx.abrirReparto('L1');
  otra.llamadas[0].ok('[]');
  assert.ok(!('L1' in otra.ctx.repartoPalet));
  assert.match(otra.ctx.__alertas[0], /No hay palets con este código/);
  const fallo = pantalla();
  fallo.ctx.abrirReparto('L1');
  fallo.llamadas[0].fail({ message: 'sin conexión' });
  assert.ok(!('L1' in fallo.ctx.repartoPalet));
  assert.deepStrictEqual(fallo.ctx.__alertas, ['sin conexión']);
});

test('Index.html engancha el reparto: botón junto a «Cambiar palet», en la lista de palets y el panel en su lugar', () => {
  const index = fs.readFileSync(path.join(OPERARIO, 'Index.html'), 'utf8');
  assert.match(index, /<\?!= incluir_\('RepartoPaletsUI'\) \?>/);
  assert.match(index, /if \(repartoPalet\[l\.id\]\) return repartoHtml_\(l\);/);
  assert.match(index, /l\.sscc && repartoPermitido_\(l\) \? ' ' \+ repartoBotonHtml_\(l\)/);
  assert.match(index, /repartoPermitido_\(l\) && sel\.length > 1/);
  // En Apps Script los nombres de archivo no llevan extensión: un .js y un .html con el mismo nombre chocan.
  const nombres = fs.readdirSync(OPERARIO).map((f) => f.replace(/\.(js|html)$/, ''));
  assert.strictEqual(new Set(nombres).size, nombres.length, 'hay dos archivos con el mismo nombre base');
  // La barra y el asterisco juntos dentro de una cadena cortan la página que entrega Apps Script.
  const ui = fs.readFileSync(path.join(OPERARIO, 'RepartoPaletsUI.html'), 'utf8');
  const script = ui.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(!/(['"`])[^'"`\n]*\/\*[^'"`\n]*\1/.test(script), 'una cadena del script contiene "/" seguido de "*"');
});
