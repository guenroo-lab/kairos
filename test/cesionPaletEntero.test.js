// Cesión de palet entero (kairos-portal/Peticiones.js): la tienda elige palets completos al pedir una cesión y
// el servidor los convierte en una línea de unidades por cada referencia del palet.
//
// Se carga el código REAL del portal (Config, Utils, Supabase, Acceso, Ajustes, Reservas, Peticiones) y solo se
// sustituye el transporte HTTP (_supaFetch_) por una base de datos en memoria que interpreta las consultas reales
// (filtros eq/neq/in/gte/gt/is.null, paginación por id y los cruces peticiones!inner que usan las reservas).
//
// Uso: node --test   (desde la raíz de Kairos)
// KAIROS_PORTAL_DIR apunta a otra copia del portal (para las pruebas de mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const PORTAL = process.env.KAIROS_PORTAL_DIR || path.join(__dirname, '..', 'kairos-portal');
const ARCHIVOS = ['Config.js', 'Utils.js', 'Supabase.js', 'Acceso.js', 'Ajustes.js', 'Reservas.js', 'Peticiones.js'];

const T0 = '2026-10-06T08:00:00.000Z';
const P1 = '00000000000000000001'; // A 5 + B 3 + C 2, en 05-A-1-1
const P2 = '00000000000000000002'; // A 4 + D 6, en 05-B-2-2
const P3 = '00000000000000000003'; // E 10, en 05-C-3-3
const P4 = '00000000000000000004'; // B 1, en 05-D-4-4
const P9 = '00000000000000000009'; // de otra tienda (279)

function semilla() {
  const fila = (id, tienda, sscc, codigo, cantidad, ubicacion) => ({ id, tienda, sscc, codigo_lm: codigo, cantidad, ubicacion, sincronizado_en: T0 });
  return {
    usuarios_tienda: [{ ldap: '100', tienda: '014', rol: 'gestor', aprobado: true }],
    stock_fisico: [
      fila('s1', '014', P1, 'A', 5, '05-A-1-1'),
      fila('s2', '014', P1, 'B', 3, '05-A-1-1'),
      fila('s3', '014', P1, 'C', 2, '05-A-1-1'),
      fila('s4', '014', P2, 'A', 4, '05-B-2-2'),
      fila('s5', '014', P2, 'D', 6, '05-B-2-2'),
      fila('s6', '014', P3, 'E', 10, '05-C-3-3'),
      fila('s7', '279', P9, 'A', 7, '05-Z-9-9'),
    ],
    catalogo: ['A', 'B', 'C', 'D', 'E'].map((c) => ({ codigo_lm: c, ean: 'EAN-' + c, designacion: 'Artículo ' + c, seccion: 'Sección ' + c })),
    peticiones: [],
    lineas: [],
    ajustes: [],
  };
}

// ——— "PostgREST" en memoria ———
function decodificar(v) { return decodeURIComponent(v); }

function predicadoDe(clave, valor) {
  let negar = false;
  let v = valor;
  if (v.startsWith('not.')) { negar = true; v = v.slice(4); }
  let fn;
  if (v === 'is.null') fn = (r) => r[clave] == null;
  else if (v.startsWith('eq.')) { const x = decodificar(v.slice(3)); fn = (r) => r[clave] != null && String(r[clave]) === x; }
  else if (v.startsWith('neq.')) { const x = decodificar(v.slice(4)); fn = (r) => r[clave] != null && String(r[clave]) !== x; }
  else if (v.startsWith('in.(')) { const xs = v.slice(4, -1).split(',').map(decodificar); fn = (r) => r[clave] != null && xs.indexOf(String(r[clave])) !== -1; }
  else if (v.startsWith('gte.')) { const x = decodificar(v.slice(4)); fn = (r) => r[clave] != null && String(r[clave]) >= x; }
  else if (v.startsWith('gt.')) { const x = decodificar(v.slice(3)); fn = (r) => r[clave] != null && String(r[clave]) > x; }
  else throw new Error('filtro no soportado en la BD de pruebas: ' + clave + '=' + valor);
  return negar ? (r) => !fn(r) : fn;
}

function crearBD(datos) {
  const db = JSON.parse(JSON.stringify(datos));
  const log = { inserts: [] };
  let contador = 0;

  function consultar(tabla, query) {
    const pares = String(query || '').split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; });
    let limite = null;
    let select = '';
    const propios = [];
    const embebidos = [];
    pares.forEach(([k, v]) => {
      if (k === 'select') { select = v; return; }
      if (k === 'order') return;
      if (k === 'limit') { limite = Number(v); return; }
      if (k.startsWith('peticiones.')) embebidos.push(predicadoDe(k.slice('peticiones.'.length), v));
      else propios.push(predicadoDe(k, v));
    });
    const cruce = /peticiones!inner\(([^)]*)\)/.exec(select);
    let filas = (db[tabla] || []).filter((r) => propios.every((f) => f(r)));
    if (cruce) {
      const columnas = cruce[1].split(',');
      filas = filas.map((r) => {
        const p = db.peticiones.find((x) => x.id === r.peticion_id);
        if (!p || !embebidos.every((f) => f(p))) return null;
        const incrustada = {};
        columnas.forEach((c) => { incrustada[c] = p[c]; });
        return Object.assign({}, r, { peticiones: incrustada });
      }).filter(Boolean);
    }
    filas.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    if (limite != null) filas = filas.slice(0, limite);
    // Como PostgREST: solo llegan las columnas del select (si lo hay y no es "*"). Así una consulta que olvide
    // pedir una columna que luego usa se nota en las pruebas.
    const columnas = select.replace(/peticiones!inner\([^)]*\)/, '').split(',').map((c) => c.trim()).filter(Boolean);
    if (columnas.length && columnas.indexOf('*') === -1) {
      filas = filas.map((r) => {
        const p = {};
        columnas.forEach((c) => { if (c in r) p[c] = r[c]; });
        if (r.peticiones) p.peticiones = r.peticiones;
        return p;
      });
    }
    return JSON.parse(JSON.stringify(filas));
  }

  function transporte(metodo, tabla, query, payload) {
    if (metodo === 'GET') return consultar(tabla, query);
    if (metodo === 'POST') {
      const lista = Array.isArray(payload) ? payload : [payload];
      const creadas = lista.map((f) => {
        contador++;
        const base = tabla === 'peticiones'
          ? { id: 'PET-' + contador, estado: 'pendiente', creada_en: new Date().toISOString() }
          : { id: 'LIN-' + String(contador).padStart(3, '0'), estado_preparacion: 'pendiente' };
        const fila = Object.assign(base, JSON.parse(JSON.stringify(f)));
        db[tabla].push(fila);
        return fila;
      });
      log.inserts.push({ tabla, filas: creadas });
      return JSON.parse(JSON.stringify(creadas));
    }
    if (metodo === 'DELETE') {
      const borradas = consultar(tabla, query);
      db[tabla] = db[tabla].filter((r) => !borradas.some((b) => b.id === r.id));
      return borradas;
    }
    throw new Error('método no soportado en la BD de pruebas: ' + metodo);
  }
  return { db, log, transporte };
}

function entorno(opciones) {
  opciones = opciones || {};
  const datos = semilla();
  if (opciones.ajustar) opciones.ajustar(datos);
  const bd = crearBD(datos);
  const cerrojo = { esperas: 0, liberaciones: 0 };
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error, encodeURIComponent, decodeURIComponent,
    LockService: { getScriptLock: () => ({ waitLock: () => { cerrojo.esperas++; }, releaseLock: () => { cerrojo.liberaciones++; } }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    // Un pedido cliente no entra en estas pruebas, pero el código lo referencia.
    _calcularColaIndividualPorPeso_: () => true,
  };
  vm.createContext(ctx);
  ARCHIVOS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(PORTAL, f), 'utf8'), ctx, { filename: f }));
  ctx._supaFetch_ = (metodo, tabla, query, payload) => bd.transporte(metodo, tabla, query, payload);
  const crear = (tipo, datosPeticion, lineas) => JSON.parse(ctx.crearPeticion('100', tipo, datosPeticion, lineas));
  const cesion = (lineas, extra) => crear('cesion', Object.assign({ tiendaDestino: '279', numCesion: 'C-' + Math.random().toString(36).slice(2, 8) }, extra || {}), lineas);
  return { ctx, bd, db: bd.db, cerrojo, crear, cesion };
}

// Línea de palet entero tal como la manda el formulario del portal.
function lineaPalet(codigo, palets, extra) {
  return Object.assign({
    codigoLm: codigo, designacion: 'Artículo ' + codigo, ean: 'EAN-' + codigo, seccion: 'Sección ' + codigo,
    cantidad: palets.length,
    sscc: palets.map((p) => p.sscc + ' (' + p.unidades + 'ud)').join(' + '),
    ubicacion: palets.map((p) => p.ubicacion).join(' + '),
    paletCompleto: true,
    resumen: '3 referencias · 10 ud',
  }, extra || {});
}
const PALET1 = { sscc: P1, unidades: 5, ubicacion: '05-A-1-1' };
const PALET2 = { sscc: P2, unidades: 4, ubicacion: '05-B-2-2' };
const PALET3 = { sscc: P3, unidades: 10, ubicacion: '05-C-3-3' };

const lineasDe = (e, idPeticion) => e.db.lineas.filter((l) => l.peticion_id === idPeticion);
const resumen = (l) => l.codigo_lm + ' ' + l.cantidad + ' ' + l.sscc;

// ——— Lo que se crea ———

test('un palet entero se convierte en una línea por referencia, con TODAS sus unidades y el palet fijado', () => {
  const e = entorno();
  const r = e.cesion([lineaPalet('A', [PALET1])], { tiendaDestino: '279', numCesion: 'C-1' });
  assert.strictEqual(r.ok, true);
  const cab = e.db.peticiones.find((p) => p.id === r.id);
  assert.strictEqual(cab.tipo, 'cesion');
  assert.strictEqual(cab.tienda_origen, '014');
  assert.strictEqual(cab.tienda_destino, '279');
  assert.strictEqual(cab.num_cesion, 'C-1');

  const ls = lineasDe(e, r.id);
  // Primero lo que la tienda buscó (A), luego lo demás de más a menos unidades (B 3, C 2).
  assert.deepStrictEqual(ls.map(resumen), ['A 5 ' + P1 + ' (5ud)', 'B 3 ' + P1 + ' (3ud)', 'C 2 ' + P1 + ' (2ud)']);
  ls.forEach((l) => {
    assert.strictEqual(l.unidad_medida, 'ud', 'son líneas de unidades normales');
    assert.strictEqual(l.ubicacion, '05-A-1-1');
    assert.ok(l.sscc_asignado_en, 'el palet queda asignado al crear');
    assert.strictEqual(l.estado_preparacion, 'pendiente');
  });
  // Datos de catálogo también para las referencias que la tienda no buscó.
  assert.deepStrictEqual(ls.map((l) => [l.ean, l.designacion, l.seccion]), [
    ['EAN-A', 'Artículo A', 'Sección A'], ['EAN-B', 'Artículo B', 'Sección B'], ['EAN-C', 'Artículo C', 'Sección C'],
  ]);
  // La marca del formulario y el resumen no llegan a la base de datos.
  ls.forEach((l) => { assert.ok(!('paletCompleto' in l) && !('resumen' in l)); });
});

test('con varios palets en una línea, cada palet da sus propias líneas (A sale dos veces, una por palet)', () => {
  const e = entorno();
  const r = e.cesion([lineaPalet('A', [PALET1, PALET2])]);
  const ls = lineasDe(e, r.id);
  assert.deepStrictEqual(ls.map(resumen), [
    'A 5 ' + P1 + ' (5ud)', 'B 3 ' + P1 + ' (3ud)', 'C 2 ' + P1 + ' (2ud)',
    'A 4 ' + P2 + ' (4ud)', 'D 6 ' + P2 + ' (6ud)',
  ]);
  assert.deepStrictEqual(ls.map((l) => l.ubicacion), ['05-A-1-1', '05-A-1-1', '05-A-1-1', '05-B-2-2', '05-B-2-2']);
});

test('el servidor no se fía de las cifras del formulario: manda el contenido real del palet', () => {
  const e = entorno();
  const mentira = lineaPalet('A', [PALET1], { cantidad: 7, sscc: P1 + ' (999ud)', ubicacion: 'cualquier-cosa', designacion: 'Otro nombre' });
  const r = e.cesion([mentira]);
  const ls = lineasDe(e, r.id);
  assert.deepStrictEqual(ls.map(resumen), ['A 5 ' + P1 + ' (5ud)', 'B 3 ' + P1 + ' (3ud)', 'C 2 ' + P1 + ' (2ud)']);
  assert.strictEqual(ls[0].ubicacion, '05-A-1-1');
  assert.strictEqual(ls[0].designacion, 'Artículo A', 'el nombre sale del catálogo');
});

test('si el artículo no está en el catálogo se usa lo que mandó el formulario para el que buscó', () => {
  const e = entorno({ ajustar: (d) => { d.catalogo = d.catalogo.filter((c) => c.codigo_lm !== 'A' && c.codigo_lm !== 'B'); } });
  const r = e.cesion([lineaPalet('A', [PALET1])]);
  const [a, b, c] = lineasDe(e, r.id);
  assert.deepStrictEqual([a.ean, a.designacion, a.seccion], ['EAN-A', 'Artículo A', 'Sección A'], 'el buscado conserva lo del formulario');
  assert.deepStrictEqual([b.ean, b.designacion, b.seccion], [null, null, null], 'otro sin catálogo queda sin datos, sin romper');
  assert.strictEqual(c.designacion, 'Artículo C');
});

test('una referencia repetida en filas del mismo palet se suma; las filas a cero no cuentan', () => {
  const e = entorno({
    ajustar: (d) => {
      d.stock_fisico.push({ id: 's8', tienda: '014', sscc: P1, codigo_lm: 'A', cantidad: 2.5, ubicacion: '05-A-1-1', sincronizado_en: T0 });
      d.stock_fisico.push({ id: 's9', tienda: '014', sscc: P1, codigo_lm: 'B', cantidad: 0, ubicacion: '05-A-1-1', sincronizado_en: T0 });
    },
  });
  const r = e.cesion([lineaPalet('A', [PALET1])]);
  const ls = lineasDe(e, r.id);
  assert.deepStrictEqual(ls.map(resumen), ['A 7.5 ' + P1 + ' (7.5ud)', 'B 3 ' + P1 + ' (3ud)', 'C 2 ' + P1 + ' (2ud)']);
});

test('una cesión mezcla líneas de palet entero y de unidades sueltas, y respeta el orden', () => {
  const e = entorno();
  const suelta = { codigoLm: 'E', designacion: 'Artículo E', ean: 'EAN-E', seccion: 'Sección E', cantidad: 3 };
  const r = e.cesion([suelta, lineaPalet('A', [PALET1])]);
  const ls = lineasDe(e, r.id);
  assert.strictEqual(ls.length, 4);
  assert.deepStrictEqual([ls[0].codigo_lm, ls[0].cantidad, ls[0].sscc || null, ls[0].unidad_medida], ['E', 3, null, 'ud']);
  assert.deepStrictEqual(ls.slice(1).map((l) => l.codigo_lm), ['A', 'B', 'C']);
});

test('una cesión por unidades sueltas sigue igual: sin palet, sin cerrojo y sin comprobar palets', () => {
  const e = entorno();
  const r = e.cesion([{ codigoLm: 'A', designacion: 'Artículo A', ean: 'EAN-A', seccion: 'Sección A', cantidad: 3 }]);
  const ls = lineasDe(e, r.id);
  assert.strictEqual(ls.length, 1);
  assert.deepStrictEqual([ls[0].codigo_lm, ls[0].cantidad, ls[0].unidad_medida], ['A', 3, 'ud']);
  assert.ok(!ls[0].sscc, 'el almacén lo asigna al preparar');
  assert.strictEqual(e.cerrojo.esperas, 0, 'la cesión por unidades no coge el cerrojo');
});

// ——— Comprobaciones antes de crear ———

test('un palet que ya tiene unidades de un pedido cliente no se puede ceder entero, y no se crea nada', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push({ id: 'PED', tipo: 'pedido_cliente', tienda_origen: '014', estado: 'pendiente', creada_en: '2026-10-06T07:00:00.000Z' });
      d.lineas.push({ id: 'L0', peticion_id: 'PED', codigo_lm: 'B', cantidad: 1, unidad_medida: 'ud', sscc: P1 + ' (1ud)', estado_preparacion: 'pendiente' });
    },
  });
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1])]), /No se ha enviado la cesión: ya hay otra petición con unidades de estos palets: 0+1\. Elige otro palet\./);
  assert.strictEqual(e.db.peticiones.length, 1, 'no queda ninguna cabecera nueva');
  assert.strictEqual(e.db.lineas.length, 1);
});

test('un palet que se lleva un refill abierto no se puede ceder entero', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push({ id: 'REF', tipo: 'refill', tienda_origen: '014', estado: 'pendiente', creada_en: '2026-10-06T07:00:00.000Z' });
      d.lineas.push({ id: 'L0', peticion_id: 'REF', codigo_lm: 'A', cantidad: 1, unidad_medida: 'palet', sscc: P2 + ' (4ud)', estado_preparacion: 'pendiente' });
    },
  });
  assert.throws(() => e.cesion([lineaPalet('A', [PALET2])]), /No se ha enviado la cesión: ya hay otra petición con unidades de estos palets/);
});

test('una petición anulada ya no reserva el palet', () => {
  const e = entorno({
    ajustar: (d) => {
      d.peticiones.push({ id: 'REF', tipo: 'refill', tienda_origen: '014', estado: 'anulada', creada_en: '2026-10-06T07:00:00.000Z' });
      d.lineas.push({ id: 'L0', peticion_id: 'REF', codigo_lm: 'A', cantidad: 1, unidad_medida: 'palet', sscc: P2 + ' (4ud)', estado_preparacion: 'pendiente' });
    },
  });
  assert.strictEqual(e.cesion([lineaPalet('A', [PALET2])]).ok, true);
});

test('un palet que ya no está en el almacén (o es de otra tienda) se rechaza', () => {
  const e = entorno();
  const fantasma = { sscc: '00000000000000000077', unidades: 1, ubicacion: 'x' };
  assert.throws(() => e.cesion([lineaPalet('A', [fantasma])]), /No se ha enviado la cesión: el palet 0+77 ya no está en el almacén\. Elige otro palet\./);
  const ajeno = { sscc: P9, unidades: 7, ubicacion: '05-Z-9-9' };
  assert.throws(() => e.cesion([lineaPalet('A', [ajeno])]), /el palet 0+9 ya no está en el almacén/);
  assert.strictEqual(e.db.peticiones.length, 0);
});

test('el mismo palet dos veces en la petición se rechaza', () => {
  const e = entorno();
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1]), lineaPalet('B', [PALET1])]), /el palet 0+1 está repetido en la petición/);
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1, PALET1])]), /está repetido/);
});

test('un palet sin mercancía (todo a cero) no se puede ceder', () => {
  const e = entorno({ ajustar: (d) => { d.stock_fisico.push({ id: 'z', tienda: '014', sscc: '00000000000000000055', codigo_lm: 'A', cantidad: 0, ubicacion: 'u', sincronizado_en: T0 }); } });
  assert.throws(() => e.cesion([lineaPalet('A', [{ sscc: '00000000000000000055', unidades: 0, ubicacion: 'u' }])]),
    /el palet 0+55 ya no tiene mercancía en el almacén/);
});

test('una línea de palet entero sin palet es un error claro', () => {
  const e = entorno();
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1], { sscc: '' })]), /falta el palet de A/);
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1], { sscc: undefined })]), /falta el palet de A/);
});

test('llevarse el palet no puede dejar sin stock a pedidos ya aceptados que aún no tienen palet', () => {
  const e = entorno({
    ajustar: (d) => {
      d.stock_fisico.push({ id: 's20', tienda: '014', sscc: P4, codigo_lm: 'B', cantidad: 1, ubicacion: '05-D-4-4', sincronizado_en: T0 });
      d.peticiones.push({ id: 'PED', tipo: 'pedido_cliente', tienda_origen: '014', estado: 'pendiente', creada_en: '2026-10-06T07:00:00.000Z' });
      // Pide 2 de B sin palet asignado: de las 4 que hay, quedan 2 libres y P1 se llevaría 3.
      d.lineas.push({ id: 'L0', peticion_id: 'PED', codigo_lm: 'B', cantidad: 2, unidad_medida: 'ud', estado_preparacion: 'pendiente' });
    },
  });
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1])]),
    /No se ha enviado la cesión: llevarse esos palets dejaría sin stock a otros pedidos ya aceptados: B \(los palets llevan 3 y solo hay 2 sin comprometer\)\./);
  assert.strictEqual(e.db.peticiones.length, 1);
});

// ——— Después de crear: el palet queda reservado entero ———

test('tras ceder un palet entero nadie más lo puede coger: ni otra cesión, ni un refill, ni se ofrece en el selector', () => {
  const e = entorno();
  e.cesion([lineaPalet('A', [PALET1])]);

  assert.throws(() => e.cesion([lineaPalet('A', [PALET1])]), /ya hay otra petición con unidades de estos palets/);
  assert.throws(
    () => e.crear('refill', { motivo: 'reponer' }, [{ codigoLm: 'B', designacion: 'B', cantidad: 1, sscc: P1 + ' (3ud)', ubicacion: '05-A-1-1' }]),
    /No se ha enviado el refill: ya hay otra petición con unidades de estos palets/);

  // El selector de palets de A solo ofrece el que sigue libre.
  const ofrecidos = JSON.parse(e.ctx.listarSsccDisponibles('100', 'A'));
  assert.deepStrictEqual(ofrecidos.map((p) => p.sscc), [P2]);
  // Y las referencias de ese palet cuentan como comprometidas al 100%.
  const stock = e.ctx._stockDetalleVarios_('014', ['A', 'B', 'C']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stock)), {
    A: { fisico: 9, comprometido: 5, disponible: 4 },
    B: { fisico: 3, comprometido: 3, disponible: 0 },
    C: { fisico: 2, comprometido: 2, disponible: 0 },
  });
});

test('anular la cesión libera el palet', () => {
  const e = entorno();
  const r = e.cesion([lineaPalet('A', [PALET1])]);
  e.db.peticiones.find((p) => p.id === r.id).estado = 'anulada';
  assert.strictEqual(e.cesion([lineaPalet('A', [PALET1])]).ok, true);
});

// ——— El cerrojo y lo que no cambia ———

test('la cesión de palet entero coge el cerrojo y lo suelta, también si falla', () => {
  const e = entorno();
  e.cesion([lineaPalet('A', [PALET1])]);
  assert.deepStrictEqual([e.cerrojo.esperas, e.cerrojo.liberaciones], [1, 1]);
  assert.throws(() => e.cesion([lineaPalet('A', [PALET1])]));
  assert.deepStrictEqual([e.cerrojo.esperas, e.cerrojo.liberaciones], [2, 2]);
});

test('refill sigue como antes: una línea por LM con los palets elegidos y los mismos mensajes', () => {
  const e = entorno();
  const r = e.crear('refill', { motivo: 'reponer' }, [{ codigoLm: 'E', designacion: 'Artículo E', ean: 'EAN-E', seccion: 'Sección E', cantidad: 1, sscc: P3 + ' (10ud)', ubicacion: '05-C-3-3' }]);
  const ls = lineasDe(e, r.id);
  assert.strictEqual(ls.length, 1);
  assert.deepStrictEqual([ls[0].codigo_lm, ls[0].cantidad, ls[0].unidad_medida, ls[0].sscc], ['E', 1, 'palet', P3 + ' (10ud)']);
  assert.deepStrictEqual([e.cerrojo.esperas, e.cerrojo.liberaciones], [1, 1]);

  assert.throws(
    () => e.crear('refill', { motivo: 'x' }, [{ codigoLm: 'A', cantidad: 1, sscc: '00000000000000000077 (1ud)' }]),
    /^Error: No se ha enviado el refill: el palet 0+77 ya no está en el almacén\. Elige otro palet\.$/);
  assert.throws(
    () => e.crear('refill', { motivo: 'x' }, [{ codigoLm: 'A', cantidad: 1, sscc: P2 + ' (4ud)' }, { codigoLm: 'D', cantidad: 1, sscc: P2 + ' (6ud)' }]),
    /^Error: No se ha enviado el refill: el palet 0+2 está repetido en la petición\. Quita la línea duplicada\.$/);
});

test('la marca paletCompleto solo vale en cesión: en un refill no expande nada', () => {
  const e = entorno();
  const r = e.crear('refill', { motivo: 'reponer' }, [lineaPalet('E', [PALET3])]);
  const ls = lineasDe(e, r.id);
  assert.strictEqual(ls.length, 1);
  assert.deepStrictEqual([ls[0].codigo_lm, ls[0].cantidad, ls[0].unidad_medida], ['E', 1, 'palet']);
});
