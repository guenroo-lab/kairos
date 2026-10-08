// Unir un pedido cliente nuevo a otro YA ABIERTO con el mismo número (la tienda lo manda a trozos).
//   · kairos-portal/UnirPedidos.js: buscar el abierto y añadirle las líneas (con todas las protecciones)
//   · kairos-portal/Peticiones.js: crear un pedido sigue guardando lo mismo (las líneas se preparan igual en los dos caminos)
//   · kairos-portal/UnirPedidosUI.html: la pregunta a la tienda y el envío
//   · kairos-portal/Portal.html: el botón «Enviar petición» pasa por ahí solo en pedido cliente
//
// Se carga el código REAL del portal y solo se sustituye el transporte HTTP (_supaFetch_) por una base de datos en
// memoria (bdMemoria.js). Uso: node --test (raíz de Kairos). KAIROS_PORTAL_DIR apunta a otra copia (mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { crearBD } = require('./bdMemoria');

const PORTAL = process.env.KAIROS_PORTAL_DIR || path.join(__dirname, '..', 'kairos-portal');
const ARCHIVOS = ['Config.js', 'Utils.js', 'Supabase.js', 'Acceso.js', 'Ajustes.js', 'Reservas.js', 'Peticiones.js', 'Edicion.js', 'UnirPedidos.js'];

const T0 = '2026-10-08T06:00:00.000Z';   // marca del último stock cargado
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

function semilla() {
  const stock = (id, tienda, sscc, codigo, cantidad, ubicacion) => ({ id, tienda, sscc, codigo_lm: codigo, cantidad, ubicacion, sincronizado_en: T0 });
  const pet = (id, extra) => Object.assign({
    id, tipo: 'pedido_cliente', tienda_origen: '014', num_pedido: '986436', transporte: false, estado: 'pendiente', solicitante_ldap: '100',
    creada_en: hace(30), comentario: null, cola_individual: true, en_curso_por: null, en_curso_desde: null,
    historial_cambios: [], modificada_en: null, modificada_por: null,
  }, extra);
  const lin = (id, peticion, codigo, cantidad, extra) => Object.assign({
    id, peticion_id: peticion, codigo_lm: codigo, cantidad, unidad_medida: 'ud', estado_preparacion: 'pendiente', designacion: 'Artículo ' + codigo,
  }, extra);
  return {
    usuarios_tienda: [
      { ldap: '100', tienda: '014', rol: 'gestor', aprobado: true },
      { ldap: '101', tienda: '014', rol: 'vendedor', aprobado: true },
      { ldap: '102', tienda: '014', rol: 'logistico', aprobado: true },
      { ldap: '200', tienda: '279', rol: 'gestor', aprobado: true },
    ],
    stock_fisico: [
      stock('s1', '014', '00000000000000000001', 'A', 50, '05-A-1-1'),
      stock('s2', '014', '00000000000000000002', 'B', 50, '05-B-2-2'),
      stock('s3', '014', '00000000000000000003', 'C', 100, '05-C-3-3'),
      stock('s4', '279', '00000000000000000009', 'A', 7, '05-Z-9-9'),
      stock('s5', '014', '00000000000000000005', 'D', 5, '05-D-5-5'),
    ],
    catalogo: ['A', 'B', 'C', 'D'].map((c) => ({ codigo_lm: c, ean: 'EAN-' + c, designacion: 'Artículo ' + c, seccion: 'Sección ' + c })),
    peticiones: [
      pet('pc1', { comentario: 'Recoge hoy' }),
      pet('otraTienda', { tienda_origen: '279' }),
      pet('cerrada', { num_pedido: '555', estado: 'cerrada' }),
      pet('anulada', { num_pedido: '556', estado: 'anulada' }),
      pet('aTransporte', { num_pedido: '557', transporte: true }),
      pet('aUbicar', { num_pedido: '558', estado: 'a_ubicar', transporte: true }),
    ],
    lineas: [
      lin('L1', 'pc1', 'A', 2),
      lin('L2', 'otraTienda', 'A', 1),
      lin('L3', 'aTransporte', 'C', 4),
    ],
    ajustes: [],
  };
}

function entorno(opciones) {
  opciones = opciones || {};
  const datos = semilla();
  if (opciones.ajustar) opciones.ajustar(datos);
  const bd = crearBD(datos);
  const cerrojo = { esperas: 0, liberaciones: 0 };
  const pesos = { llamadas: [], ligero: true };
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error, encodeURIComponent, decodeURIComponent,
    LockService: { getScriptLock: () => ({ waitLock: () => { cerrojo.esperas++; }, releaseLock: () => { cerrojo.liberaciones++; } }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PESO_LIMITE_EQUIPO_KG_: 20,
    _calcularColaIndividualPorPeso_: (tienda, codigos) => { pesos.llamadas.push(codigos.slice()); return pesos.ligero; },
  };
  vm.createContext(ctx);
  ARCHIVOS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(PORTAL, f), 'utf8'), ctx, { filename: f }));
  ctx._supaFetch_ = (metodo, tabla, query, payload) => {
    if (opciones.fallaSi && opciones.fallaSi(metodo, tabla, query, payload)) throw new Error('Supabase 500: fallo simulado');
    return bd.transporte(metodo, tabla, query, payload);
  };
  const buscar = (ldap, num, transporte) => JSON.parse(ctx.buscarPedidoAbiertoMismoNumero(ldap, num, transporte));
  const unir = (ldap, id, datosUnir, lineas) => JSON.parse(ctx.anadirLineasAPedido(ldap, id, datosUnir, lineas));
  const falla = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  const lineasDe = (id) => bd.db.lineas.filter((l) => l.peticion_id === id);
  const pedido = (id) => bd.db.peticiones.find((p) => p.id === id);
  return { ctx, bd, db: bd.db, cerrojo, pesos, buscar, unir, falla, lineasDe, pedido };
}

const NUEVA_B = { codigoLm: 'B', cantidad: 3, designacion: 'Artículo B', ean: 'EAN-B', seccion: 'Sección B' };
const DATOS = (extra) => Object.assign({ numPedido: '986436', transporte: false, comentario: null }, extra);

// ——— Buscar el pedido abierto ———

test('encuentra el pedido abierto con el mismo número, con sus líneas, y dice que se puede unir', () => {
  const e = entorno();
  const r = e.buscar('100', '986436', false);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, 'pc1');
  assert.strictEqual(r[0].estadoTexto, 'Solicitado', 'con el nombre que el portal da a «pendiente»');
  assert.strictEqual(r[0].solicitante_ldap, '100');
  assert.strictEqual(r[0].comentario, 'Recoge hoy');
  assert.deepStrictEqual(r[0].lineas, [{ codigo_lm: 'A', designacion: 'Artículo A', cantidad: 2, unidad_medida: 'ud', preparada: false }]);
  assert.strictEqual(r[0].puedeUnirse, true);
  assert.strictEqual(r[0].motivo, null);
});

test('no cuenta como coincidencia: otra tienda, pedidos cerrados, anulados o por ubicar, ni otro número', () => {
  const e = entorno();
  assert.deepStrictEqual(e.buscar('100', '555', false), [], 'cerrado');
  assert.deepStrictEqual(e.buscar('100', '556', false), [], 'anulado');
  assert.deepStrictEqual(e.buscar('100', '558', true), [], 'ya preparado, esperando ubicación');
  assert.deepStrictEqual(e.buscar('100', '999', false), []);
  assert.strictEqual(e.buscar('200', '986436', false).length, 1, 'Mijas solo ve el suyo');
  assert.strictEqual(e.buscar('200', '986436', false)[0].id, 'otraTienda');
  assert.deepStrictEqual(e.buscar('100', '', false), []);
  assert.deepStrictEqual(e.buscar('100', null, false), []);
});

test('solo cuentan los pedidos cliente: una cesión o un refill con ese número no son coincidencia ni se les puede añadir', () => {
  const e = entorno({ ajustar: (d) => {
    d.peticiones.push(
      { id: 'cesion1', tipo: 'cesion', tienda_origen: '014', num_pedido: '986436', num_cesion: 'C1', tienda_destino: '279', estado: 'pendiente', solicitante_ldap: '100', creada_en: hace(50) },
      { id: 'refill1', tipo: 'refill', tienda_origen: '014', num_pedido: '986436', motivo: 'm', estado: 'pendiente', solicitante_ldap: '100', creada_en: hace(40) });
  } });
  assert.deepStrictEqual(e.buscar('100', '986436', false).map((x) => x.id), ['pc1']);
  const antes = e.lineasDe('cesion1').length;
  assert.match(e.falla(() => e.unir('100', 'cesion1', DATOS(), [NUEVA_B])) || '(no falló)', /ya no existe/);
  assert.match(e.falla(() => e.unir('100', 'refill1', DATOS(), [NUEVA_B])) || '(no falló)', /ya no existe/);
  assert.strictEqual(e.lineasDe('cesion1').length, antes);
});

test('el número se compara sin espacios, y un vendedor (que no pide pedidos) no recibe nada', () => {
  const e = entorno();
  assert.strictEqual(e.buscar('100', '  986436 ', false).length, 1);
  assert.deepStrictEqual(e.buscar('101', '986436', false), []);
});

test('un transporte distinto o un operario con el pedido abierto ahora mismo impiden unir, y se explica por qué', () => {
  const e = entorno({ ajustar: (d) => {
    Object.assign(d.peticiones.find((p) => p.id === 'pc1'), { en_curso_por: 'Ana', en_curso_desde: hace(2) });
  } });
  const activo = e.buscar('100', '986436', false)[0];
  assert.strictEqual(activo.puedeUnirse, false);
  assert.match(activo.motivo, /^Ana lo tiene abierto en almacén ahora mismo \(hace 2 min\)$/);
  const transporte = e.buscar('100', '986436', true)[0];
  assert.strictEqual(transporte.puedeUnirse, false);
  assert.match(transporte.motivo, /transporte en «No» y este lo has marcado en «Sí»/);
  const sinDato = e.buscar('100', '986436', undefined)[0];
  assert.match(sinDato.motivo, /Ana/, 'sin transporte conocido solo cuenta el operario');
});

test('si lo tiene abierto un equipo («Ana + Luis») el motivo habla en plural', () => {
  const e = entorno({ ajustar: (d) => { Object.assign(d.peticiones.find((p) => p.id === 'pc1'), { en_curso_por: 'Ana + Luis', en_curso_desde: hace(4) }); } });
  assert.strictEqual(e.buscar('100', '986436', false)[0].motivo, 'Ana + Luis lo tienen abierto en almacén ahora mismo (hace 4 min)');
});

test('un operario que abrió el pedido hace más de 10 minutos ya no lo bloquea', () => {
  const e = entorno({ ajustar: (d) => { Object.assign(d.peticiones.find((p) => p.id === 'pc1'), { en_curso_por: 'Ana', en_curso_desde: hace(11) }); } });
  assert.strictEqual(e.buscar('100', '986436', false)[0].puedeUnirse, true);
});

test('varios abiertos con el mismo número salen del más antiguo al más nuevo, y uno en preparación también cuenta', () => {
  const e = entorno({ ajustar: (d) => {
    d.peticiones.push(
      { id: 'viejo', tipo: 'pedido_cliente', tienda_origen: '014', num_pedido: '986436', transporte: false, estado: 'en_preparacion', solicitante_ldap: '100', creada_en: hace(90), comentario: null },
      { id: 'nuevo', tipo: 'pedido_cliente', tienda_origen: '014', num_pedido: '986436', transporte: false, estado: 'pendiente', solicitante_ldap: '102', creada_en: hace(5), comentario: null });
    d.lineas.push({ id: 'L9', peticion_id: 'viejo', codigo_lm: 'B', cantidad: 1, unidad_medida: 'ud', estado_preparacion: 'preparado', designacion: 'Artículo B' });
  } });
  const r = e.buscar('100', '986436', false);
  assert.deepStrictEqual(r.map((x) => x.id), ['viejo', 'pc1', 'nuevo']);
  assert.strictEqual(r[0].estadoTexto, 'En preparación');
  assert.strictEqual(r[0].lineas[0].preparada, true);
});

// ——— Unir ———

test('unir añade las líneas al pedido abierto, sin crear otro, con los mismos datos que al crear (palet elegido incluido)', () => {
  const e = entorno();
  const antes = e.db.peticiones.length;
  const palet = { codigoLm: 'C', cantidad: 4, designacion: 'Artículo C', ean: 'EAN-C', seccion: 'Sección C', sscc: '00000000000000000003', ubicacion: '05-C-3-3' };
  const r = e.unir('100', 'pc1', DATOS(), [NUEVA_B, palet]);
  assert.deepStrictEqual([r.ok, r.id, r.numPedido, r.anadidas, r.totalLineas, r.aviso], [true, 'pc1', '986436', 2, 3, null]);
  assert.strictEqual(e.db.peticiones.length, antes, 'no se crea ningún pedido');
  const nuevas = e.lineasDe('pc1').filter((l) => l.id !== 'L1');
  assert.deepStrictEqual(nuevas.map((l) => [l.codigo_lm, l.cantidad, l.unidad_medida, l.ean, l.designacion, l.seccion, l.estado_preparacion]),
    [['B', 3, 'ud', 'EAN-B', 'Artículo B', 'Sección B', 'pendiente'], ['C', 4, 'ud', 'EAN-C', 'Artículo C', 'Sección C', 'pendiente']]);
  assert.strictEqual(nuevas[1].sscc, '00000000000000000003');
  assert.strictEqual(nuevas[1].ubicacion, '05-C-3-3');
  assert.ok(nuevas[1].sscc_asignado_en);
  assert.ok(!('sscc' in nuevas[0]), 'sin palet elegido, lo asigna el almacén');
  assert.strictEqual(e.lineasDe('pc1').find((l) => l.id === 'L1').cantidad, 2, 'lo que ya había no se toca');
});

test('queda anotado para almacén: historial, quién y cuándo (así sale «Modificado» en su cola)', () => {
  const e = entorno();
  e.unir('102', 'pc1', DATOS(), [NUEVA_B]);
  const p = e.pedido('pc1');
  assert.strictEqual(p.modificada_por, '102');
  assert.ok(Date.now() - Date.parse(p.modificada_en) < 5000);
  assert.strictEqual(p.historial_cambios.length, 1);
  assert.strictEqual(p.historial_cambios[0].por, '102');
  assert.deepStrictEqual(p.historial_cambios[0].cambios, [
    'Líneas unidas desde un segundo envío con el mismo nº de pedido',
    'Línea añadida: B (Artículo B) × 3',
  ]);
});

test('el historial conserva lo anterior y no pasa de 30 entradas', () => {
  const e = entorno({ ajustar: (d) => {
    d.peticiones.find((p) => p.id === 'pc1').historial_cambios = Array.from({ length: 30 }, (_, i) => ({ en: hace(1000 + i), por: '100', cambios: ['c' + i] }));
  } });
  e.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  const h = e.pedido('pc1').historial_cambios;
  assert.strictEqual(h.length, 30);
  assert.deepStrictEqual(h[0].cambios, ['c1']);
  assert.strictEqual(h[29].por, '100');
});

test('el comentario nuevo se suma al que ya tenía; repetirlo no lo duplica; sin comentario no cambia', () => {
  const e = entorno();
  e.unir('100', 'pc1', DATOS({ comentario: 'Llamar antes' }), [NUEVA_B]);
  assert.strictEqual(e.pedido('pc1').comentario, 'Recoge hoy\nLlamar antes');
  assert.ok(e.pedido('pc1').historial_cambios[0].cambios.indexOf('Comentario ampliado') !== -1);
  e.unir('100', 'pc1', DATOS({ comentario: 'Recoge hoy' }), [{ codigoLm: 'C', cantidad: 1 }]);
  assert.strictEqual(e.pedido('pc1').comentario, 'Recoge hoy\nLlamar antes', 'ya estaba');
  e.unir('100', 'pc1', DATOS({ comentario: '   ' }), [{ codigoLm: 'C', cantidad: 2 }]);
  assert.strictEqual(e.pedido('pc1').comentario, 'Recoge hoy\nLlamar antes');
  const sin = entorno({ ajustar: (d) => { d.peticiones.find((p) => p.id === 'pc1').comentario = null; } });
  sin.unir('100', 'pc1', DATOS({ comentario: 'Solo este' }), [NUEVA_B]);
  assert.strictEqual(sin.pedido('pc1').comentario, 'Solo este');
});

test('un comentario que pasaría de 500 caracteres se rechaza ANTES de guardar nada', () => {
  const e = entorno({ ajustar: (d) => { d.peticiones.find((p) => p.id === 'pc1').comentario = 'x'.repeat(450); } });
  const msg = e.falla(() => e.unir('100', 'pc1', DATOS({ comentario: 'y'.repeat(60) }), [NUEVA_B]));
  assert.match(msg, /suman más de 500 caracteres/);
  assert.strictEqual(e.lineasDe('pc1').length, 1);
  assert.strictEqual(e.pedido('pc1').historial_cambios.length, 0);
  e.unir('100', 'pc1', DATOS({ comentario: 'y'.repeat(49) }), [NUEVA_B]);   // 450 + salto + 49 = 500 justos
  assert.strictEqual(e.pedido('pc1').comentario.length, 500);
});

test('solo se une a un pedido propio, abierto, con el mismo número y transporte, que nadie tenga abierto ahora', () => {
  const e = entorno({ ajustar: (d) => { Object.assign(d.peticiones.find((p) => p.id === 'aTransporte'), { en_curso_por: 'Luis', en_curso_desde: hace(1) }); } });
  const casos = [
    ['pedido de otra tienda', () => e.unir('100', 'otraTienda', DATOS(), [NUEVA_B]), /ya no existe/],
    ['pedido que no existe', () => e.unir('100', 'nada', DATOS(), [NUEVA_B]), /ya no existe/],
    ['pedido cerrado', () => e.unir('100', 'cerrada', DATOS({ numPedido: '555' }), [NUEVA_B]), /ya no admite más líneas \(Completada\)/],
    ['pedido por ubicar', () => e.unir('100', 'aUbicar', DATOS({ numPedido: '558', transporte: true }), [NUEVA_B]), /ya no admite más líneas/],
    ['otro número', () => e.unir('100', 'pc1', DATOS({ numPedido: '1' }), [NUEVA_B]), /no coincide/],
    ['sin número', () => e.unir('100', 'pc1', DATOS({ numPedido: '' }), [NUEVA_B]), /no coincide/],
    ['transporte distinto', () => e.unir('100', 'pc1', DATOS({ transporte: true }), [NUEVA_B]), /transporte en «No»/],
    ['transporte sin indicar', () => e.unir('100', 'pc1', DATOS({ transporte: undefined }), [NUEVA_B]), /Falta indicar transporte/],
    ['operario con el pedido abierto', () => e.unir('100', 'aTransporte', DATOS({ numPedido: '557', transporte: true }), [NUEVA_B]), /Luis lo tiene abierto en almacén/],
    ['vendedor', () => e.unir('101', 'pc1', DATOS(), [NUEVA_B]), /Vendedor/],
    ['sin líneas', () => e.unir('100', 'pc1', DATOS(), []), /al menos una línea/],
    ['usuario desconocido', () => e.unir('999', 'pc1', DATOS(), [NUEVA_B]), /no autorizado/],
  ];
  const antes = JSON.stringify(e.db);
  casos.forEach(([nombre, fn, esperado]) => assert.match(e.falla(fn) || '(no falló)', esperado, nombre));
  assert.strictEqual(JSON.stringify(e.db), antes, 'ningún rechazo escribe nada');
});

test('una línea incompleta se rechaza sin guardar ninguna de las otras', () => {
  const e = entorno();
  const antes = JSON.stringify(e.db);
  assert.match(e.falla(() => e.unir('100', 'pc1', DATOS(), [NUEVA_B, { codigoLm: 'C' }])) || '', /Línea incompleta/);
  assert.match(e.falla(() => e.unir('100', 'pc1', DATOS(), [{ codigoLm: '', cantidad: 2 }])) || '', /Línea incompleta/);
  assert.strictEqual(JSON.stringify(e.db), antes);
});

test('lo que se añade necesita stock como cualquier pedido nuevo (descontando lo que ya lleva el pedido abierto)', () => {
  const e = entorno();
  // A: 50 en almacén, 2 ya en este pedido y 1 en el de Mijas (otra tienda, no cuenta) → quedan 48.
  const msg = e.falla(() => e.unir('100', 'pc1', DATOS(), [{ codigoLm: 'A', cantidad: 49, designacion: 'Artículo A' }]));
  assert.match(msg, /falta stock/);
  assert.match(msg, /Solo quedan 48 unidades de A/);
  assert.strictEqual(e.lineasDe('pc1').length, 1, 'no se guarda nada');
  e.unir('100', 'pc1', DATOS(), [{ codigoLm: 'A', cantidad: 48 }]);
  assert.strictEqual(e.lineasDe('pc1').length, 2);
  // Se suma lo de las dos líneas del mismo envío (D: 5 en almacén).
  const e2 = entorno();
  assert.match(e2.falla(() => e2.unir('100', 'pc1', DATOS(), [{ codigoLm: 'D', cantidad: 3 }, { codigoLm: 'D', cantidad: 3 }])) || '', /Solo quedan 5 unidades de D/);
  e2.unir('100', 'pc1', DATOS(), [{ codigoLm: 'D', cantidad: 3 }, { codigoLm: 'D', cantidad: 2 }]);
  assert.strictEqual(e2.lineasDe('pc1').length, 3);
});

test('un artículo pesado pasa el pedido a la cola de equipo (nunca al revés)', () => {
  const pesado = entorno();
  pesado.pesos.ligero = false;
  pesado.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(pesado.pedido('pc1').cola_individual, false);
  assert.deepStrictEqual(pesado.pesos.llamadas, [['B']], 'solo se pesan los artículos nuevos');
  assert.ok(pesado.pedido('pc1').historial_cambios[0].cambios.some((c) => /Pasa a la cola de equipo \(artículo de más de 20 kg\)/.test(c)));

  const ligero = entorno();
  ligero.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(ligero.pedido('pc1').cola_individual, true);

  const yaEquipo = entorno({ ajustar: (d) => { d.peticiones.find((p) => p.id === 'pc1').cola_individual = false; } });
  yaEquipo.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(yaEquipo.pedido('pc1').cola_individual, false);
  assert.strictEqual(yaEquipo.pesos.llamadas.length, 0, 'ya en equipo: no hace falta pesar');

  const falloPeso = entorno();
  falloPeso.ctx._calcularColaIndividualPorPeso_ = () => { throw new Error('CSV de pesos caído'); };
  falloPeso.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(falloPeso.lineasDe('pc1').length, 2, 'si el CSV falla no bloquea');
  assert.strictEqual(falloPeso.pedido('pc1').cola_individual, true);
});

test('doble clic: las mismas líneas unidas dos veces seguidas por la misma persona se rechazan; otras líneas no', () => {
  const e = entorno();
  e.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.match(e.falla(() => e.unir('100', 'pc1', DATOS(), [NUEVA_B])) || '', /hace unos segundos/);
  assert.strictEqual(e.lineasDe('pc1').length, 2);
  e.unir('100', 'pc1', DATOS(), [{ codigoLm: 'C', cantidad: 1, designacion: 'Artículo C' }]);
  assert.strictEqual(e.lineasDe('pc1').length, 3);
  // Otra persona, o pasados 30 s, no cuenta como doble clic.
  const otra = entorno();
  otra.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  otra.unir('102', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(otra.lineasDe('pc1').length, 3);
  const vieja = entorno();
  vieja.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  vieja.pedido('pc1').historial_cambios[0].en = hace(2);
  vieja.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(vieja.lineasDe('pc1').length, 3);
});

test('se serializa con el cerrojo del script y siempre se suelta, también si falla', () => {
  const e = entorno();
  e.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  e.falla(() => e.unir('100', 'pc1', DATOS({ numPedido: '1' }), [NUEVA_B]));
  assert.deepStrictEqual([e.cerrojo.esperas, e.cerrojo.liberaciones], [2, 2]);
  const ocupado = entorno();
  ocupado.ctx.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout'); }, releaseLock: () => {} }) };
  assert.match(ocupado.falla(() => ocupado.unir('100', 'pc1', DATOS(), [NUEVA_B])) || '', /sistema está ocupado/);
  assert.strictEqual(ocupado.lineasDe('pc1').length, 1);
});

test('sin la migración del historial (columna ausente) las líneas se añaden igual', () => {
  const e = entorno({ ajustar: (d) => {
    const p = d.peticiones.find((x) => x.id === 'pc1');
    delete p.historial_cambios; delete p.modificada_en; delete p.modificada_por;
  } });
  const r = e.unir('100', 'pc1', DATOS({ comentario: 'Otro' }), [NUEVA_B]);
  assert.strictEqual(r.anadidas, 1);
  assert.strictEqual(e.pedido('pc1').comentario, 'Recoge hoy\nOtro');
  assert.ok(!('historial_cambios' in e.pedido('pc1')));
});

test('si no se puede anotar el cambio en el pedido, las líneas ya están guardadas y se avisa (sin error que invite a reenviar)', () => {
  const e = entorno({ fallaSi: (metodo, tabla) => metodo === 'PATCH' && tabla === 'peticiones' });
  const r = e.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.strictEqual(r.ok, true);
  assert.match(r.aviso, /No las vuelvas a enviar/);
  assert.strictEqual(e.lineasDe('pc1').length, 2);
});

test('si el pedido deja de estar abierto justo al anotar el cambio, se avisa de que lo revise', () => {
  const e = entorno();
  const real = e.ctx._supaFetch_;
  e.ctx._supaFetch_ = (metodo, tabla, query, payload) => {
    if (metodo === 'PATCH' && tabla === 'peticiones') e.pedido('pc1').estado = 'anulada';
    return real(metodo, tabla, query, payload);
  };
  const r = e.unir('100', 'pc1', DATOS(), [NUEVA_B]);
  assert.match(r.aviso, /ha cambiado de estado/);
});

test('si falla guardar las líneas, no se toca el pedido', () => {
  const e = entorno({ fallaSi: (metodo, tabla) => metodo === 'POST' && tabla === 'lineas' });
  assert.match(e.falla(() => e.unir('100', 'pc1', DATOS({ comentario: 'Otro' }), [NUEVA_B])) || '', /fallo simulado/);
  assert.strictEqual(e.pedido('pc1').comentario, 'Recoge hoy');
  assert.strictEqual(e.pedido('pc1').historial_cambios.length, 0);
  assert.strictEqual(e.lineasDe('pc1').length, 1);
});

// ——— Crear un pedido sigue igual (el refactor de _lineasParaGuardar_) ———

test('crear un pedido cliente guarda cabecera y líneas como siempre (palet elegido incluido) y una línea mala no deja cabecera', () => {
  const e = entorno();
  const r = JSON.parse(e.ctx.crearPeticion('100', 'pedido_cliente', { numPedido: ' 777 ', transporte: false, comentario: 'Hola' },
    [NUEVA_B, { codigoLm: 'C', cantidad: 4, designacion: 'Artículo C', sscc: '00000000000000000003', ubicacion: '05-C-3-3' }]));
  assert.strictEqual(r.ok, true);
  const cab = e.pedido(r.id);
  assert.deepStrictEqual([cab.tipo, cab.tienda_origen, cab.solicitante_ldap, cab.num_pedido, cab.transporte, cab.comentario, cab.cola_individual],
    ['pedido_cliente', '014', '100', '777', false, 'Hola', true]);
  const l = e.lineasDe(r.id);
  assert.deepStrictEqual(l.map((x) => [x.codigo_lm, x.cantidad, x.unidad_medida, x.ean || null, x.sscc || null]),
    [['B', 3, 'ud', 'EAN-B', null], ['C', 4, 'ud', null, '00000000000000000003']]);
  assert.ok(l[1].sscc_asignado_en);

  const antes = e.db.peticiones.length;
  assert.match(e.falla(() => e.ctx.crearPeticion('100', 'pedido_cliente', { numPedido: '778', transporte: false }, [NUEVA_B, { codigoLm: 'C' }])) || '', /Línea incompleta/);
  assert.strictEqual(e.db.peticiones.length, antes);
});

test('crear un refill guarda sus líneas en palets', () => {
  const e = entorno({ ajustar: (d) => { d.ajustes.push({ clave: 'refill_habilitado', valor: 'true' }); } });
  const lineas = e.ctx._lineasParaGuardar_([{ codigoLm: 'A', cantidad: 1, sscc: '00000000000000000001', ubicacion: '05-A-1-1' }], 'palet');
  assert.deepStrictEqual([lineas[0].unidad_medida, lineas[0].sscc, lineas[0].ubicacion, lineas[0].codigo_lm], ['palet', '00000000000000000001', '05-A-1-1', 'A']);
});

// ——— La pregunta a la tienda (UnirPedidosUI.html) ———

function pantalla(opciones) {
  opciones = opciones || {};
  const html = fs.readFileSync(path.join(PORTAL, 'UnirPedidosUI.html'), 'utf8');
  const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const cuerpo = { hijos: [], appendChild(n) { this.hijos.push(n); }, removeChild(n) { this.hijos.splice(this.hijos.indexOf(n), 1); } };
  const botones = {};
  const trazas = { gas: [], alertas: [], colas: 0, aparte: 0, preguntas: 0 };
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, Date, isFinite, Promise,
    LDAP: '100',
    document: {
      body: cuerpo,
      createElement: () => ({
        className: '', innerHTML: '',
        querySelector(sel) {
          const id = sel.slice(1);
          if (!this.innerHTML.includes('id="' + id + '"')) return null;
          return botones[id] || (botones[id] = { id, onclick: null, focus() { this.enfocado = true; } });
        },
      }),
    },
    gas: (...args) => { trazas.gas.push(args); return opciones.gas ? opciones.gas(...args) : Promise.resolve([]); },
    kAlerta: (m) => { trazas.alertas.push(m); return Promise.resolve(true); },
    renderCola: () => { trazas.colas++; },
  };
  if (opciones.conEscape) ctx.escHtml = (s) => '«' + String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) + '»';
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'UnirPedidosUI.html' });
  return { ctx, cuerpo, botones, trazas };
}

const ABIERTO = (extra) => Object.assign({
  id: 'pc1', estado: 'pendiente', estadoTexto: 'Pendiente', creada_en: new Date(2026, 9, 8, 22, 49).toISOString(), solicitante_ldap: '30081048',
  transporte: false, comentario: null, puedeUnirse: true, motivo: null,
  lineas: [{ codigo_lm: 'A', designacion: 'Pintura <blanca>', cantidad: 2, unidad_medida: 'ud', preparada: false }],
}, extra);
const NUEVAS = [{ codigoLm: 'B', cantidad: 3, designacion: 'Broca "8"' }];
const AHORA = new Date(2026, 9, 8, 23, 10);

test('pantalla: elige el más antiguo que admite unir; si ninguno admite, ninguno', () => {
  const { ctx } = pantalla();
  const a = ABIERTO({ id: 'a', puedeUnirse: false, motivo: 'x' });
  const b = ABIERTO({ id: 'b' });
  const c = ABIERTO({ id: 'c' });
  assert.strictEqual(ctx.UNI_elegido_([a, b, c]).id, 'b');
  assert.strictEqual(ctx.UNI_elegido_([a]), null);
  assert.strictEqual(ctx.UNI_elegido_([]), null);
});

test('pantalla: detecta los artículos que ya están en el pedido abierto (una vez cada uno, con lo que ya lleva)', () => {
  const { ctx } = pantalla();
  const ab = ABIERTO({ lineas: [{ codigo_lm: 'A', cantidad: 2 }, { codigo_lm: 'A', cantidad: 3 }, { codigo_lm: 'C', cantidad: 1 }] });
  const r = ctx.UNI_repetidos_(ab, [{ codigoLm: ' A ', cantidad: 1 }, { codigoLm: 'B', cantidad: 1 }, { codigoLm: 'C', cantidad: 1 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [{ codigo: 'A', enPedido: 5 }, { codigo: 'C', enPedido: 1 }], 'los espacios no impiden reconocerlo');
  const dos = ctx.UNI_repetidos_(ab, [{ codigoLm: 'A', cantidad: 1 }, { codigoLm: 'A', cantidad: 9 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(dos)), [{ codigo: 'A', enPedido: 5 }], 'una sola vez aunque venga en dos líneas');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.UNI_repetidos_(ab, [{ codigoLm: 'Z' }]))), []);
});

test('pantalla: «hoy a las…» o «el dd/mm a las…»', () => {
  const { ctx } = pantalla();
  assert.strictEqual(ctx.UNI_cuando_(new Date(2026, 9, 8, 22, 49).toISOString(), AHORA), 'hoy a las 22:49');
  assert.strictEqual(ctx.UNI_cuando_(new Date(2026, 9, 7, 9, 5).toISOString(), AHORA), 'el 07/10 a las 09:05');
  assert.strictEqual(ctx.UNI_cuando_(new Date(2026, 8, 8, 22, 49).toISOString(), AHORA), 'el 08/09 a las 22:49', 'mismo día del mes, otro mes');
  assert.strictEqual(ctx.UNI_cuando_(new Date(2025, 9, 8, 22, 49).toISOString(), AHORA), 'el 08/10 a las 22:49', 'mismo día y mes, otro año');
  assert.strictEqual(ctx.UNI_cuando_('no es una fecha', AHORA), '');
});

test('pantalla: la pregunta enseña lo que ya lleva y lo que se envía, escapado, y ofrece añadir', () => {
  const { ctx } = pantalla();
  const v = ctx.UNI_html_([ABIERTO()], NUEVAS, '98<6>', AHORA);
  assert.strictEqual(v.elegidoId, 'pc1');
  assert.match(v.html, /Ya hay un pedido abierto con el nº 98&lt;6&gt;/);
  assert.match(v.html, /Enviado hoy a las 22:49 por 30081048 · Pendiente/);
  assert.match(v.html, /Ya lleva 1 línea<\/b>.*<strong>A<\/strong> · Pintura &lt;blanca&gt; × 2 ud/);
  assert.match(v.html, /Ahora envías 1 línea<\/b>.*<strong>B<\/strong> · Broca &quot;8&quot; × 3 ud/);
  assert.ok(v.html.includes('id="uniUnir"') && v.html.includes('id="uniAparte"') && v.html.includes('id="uniCancelar"'));
  assert.ok(!/uni-alerta/.test(v.html), 'sin repetidos ni problemas, sin alertas');
  assert.match(v.html, /almacén verá un solo pedido/);
  assert.ok(!/<script|onerror/.test(v.html));
});

test('pantalla: avisa si lo que se envía ya está en el pedido abierto (puede ser un error de pedir dos veces)', () => {
  const { ctx } = pantalla();
  const v = ctx.UNI_html_([ABIERTO()], [{ codigoLm: 'A', cantidad: 1 }, { codigoLm: 'B', cantidad: 1 }], '1', AHORA);
  assert.match(v.html, /uni-alerta">⚠ Ya está en el pedido abierto: A \(2 ud\)\. Si lo añades, quedará como otra línea/);
});

test('pantalla: si no se puede unir lo explica y solo deja crear aparte o cancelar', () => {
  const { ctx } = pantalla();
  const v = ctx.UNI_html_([ABIERTO({ puedeUnirse: false, motivo: 'Ana lo tiene abierto en almacén ahora mismo (hace 2 min)' })], NUEVAS, '1', AHORA);
  assert.strictEqual(v.elegidoId, null);
  assert.match(v.html, /No se pueden añadir a ese pedido porque Ana lo tiene abierto/);
  assert.ok(ctx.UNI_html_([ABIERTO({ puedeUnirse: false, motivo: 'Ana <i>' })], NUEVAS, '1', AHORA).html.includes('Ana &lt;i&gt;'), 'el motivo también se escapa');
  assert.ok(!v.html.includes('id="uniUnir"'));
  assert.ok(v.html.includes('id="uniAparte"') && v.html.includes('id="uniCancelar"'));
  assert.ok(!/almacén verá un solo pedido/.test(v.html));
});

test('pantalla: con varios abiertos cuenta los otros y dice a cuál se añade', () => {
  const { ctx } = pantalla();
  const dos = ctx.UNI_html_([ABIERTO({ id: 'a' }), ABIERTO({ id: 'b' })], NUEVAS, '1', AHORA);
  assert.match(dos.html, /Hay 1 otro pedido abierto con este número; se añade al más antiguo\./);
  const tres = ctx.UNI_html_([ABIERTO({ id: 'a' }), ABIERTO({ id: 'b' }), ABIERTO({ id: 'c' })], NUEVAS, '1', AHORA);
  assert.match(tres.html, /Hay 2 otros pedidos abiertos con este número; se añade al más antiguo\./);
  const sinElegido = ctx.UNI_html_([ABIERTO({ puedeUnirse: false, motivo: 'x' }), ABIERTO({ id: 'b', puedeUnirse: false, motivo: 'y' })], NUEVAS, '1', AHORA);
  assert.match(sinElegido.html, /Hay 1 otro pedido abierto con este número\./);
  assert.ok(!/Hay .* otros?.*se añade/.test(ctx.UNI_html_([ABIERTO()], NUEVAS, '1', AHORA).html));
});

test('pantalla: singular y plural de las líneas', () => {
  const { ctx } = pantalla();
  const ab = ABIERTO({ lineas: [{ codigo_lm: 'A', cantidad: 1, unidad_medida: 'ud' }, { codigo_lm: 'C', cantidad: 2, unidad_medida: 'ud' }] });
  const v = ctx.UNI_html_([ab], [{ codigoLm: 'B', cantidad: 1 }, { codigoLm: 'D', cantidad: 1 }], '1', AHORA);
  assert.match(v.html, /Ya lleva 2 líneas/);
  assert.match(v.html, /Ahora envías 2 líneas/);
});

test('pantalla: usa el escape de la página cuando existe y uno propio si no', () => {
  assert.ok(pantalla({ conEscape: true }).ctx.UNI_html_([ABIERTO()], NUEVAS, '7', AHORA).html.includes('nº «7»'));
  assert.ok(pantalla().ctx.UNI_html_([ABIERTO()], [{ codigoLm: "B'", cantidad: 1 }], '7', AHORA).html.includes('B&#39;'));
});

test('pantalla: cada botón de la pregunta resuelve lo suyo y la quita de la pantalla', async () => {
  for (const [boton, esperado] of [['uniUnir', 'unir'], ['uniAparte', 'aparte'], ['uniCancelar', null]]) {
    const p = pantalla();
    const promesa = p.ctx.UNI_pregunta_([ABIERTO({ id: 'xx' })], NUEVAS, '1');
    assert.strictEqual(p.cuerpo.hijos.length, 1);
    assert.strictEqual(p.cuerpo.hijos[0].className, 'koverlay');
    assert.strictEqual(p.botones.uniUnir.enfocado, true, 'el foco va al botón principal');
    p.botones[boton].onclick();
    const r = await promesa;
    assert.strictEqual(r.accion, esperado, boton);
    assert.strictEqual(r.id, 'xx');
    assert.strictEqual(p.cuerpo.hijos.length, 0);
  }
  const sin = pantalla();
  const promesa = sin.ctx.UNI_pregunta_([ABIERTO({ puedeUnirse: false, motivo: 'x' })], NUEVAS, '1');
  assert.ok(!sin.botones.uniUnir);
  assert.strictEqual(sin.botones.uniAparte.enfocado, true);
  sin.botones.uniAparte.onclick();
  assert.strictEqual((await promesa).accion, 'aparte');
});

const REPETIDAS = [{ codigoLm: 'A', cantidad: 1, designacion: 'Pintura' }];   // A ya está en ABIERTO()

function envio(p, abiertos, eleccion, opciones) {
  opciones = opciones || {};
  const trazas = p.trazas;
  p.ctx.gas = (fn, ...args) => {
    trazas.gas.push([fn, ...args]);
    if (fn === 'buscarPedidoAbiertoMismoNumero') return opciones.falloBusqueda ? Promise.reject(new Error('sin conexión')) : Promise.resolve(abiertos);
    if (fn === 'anadirLineasAPedido') return opciones.falloUnir ? Promise.reject(new Error(opciones.falloUnir)) : Promise.resolve({ ok: true, numPedido: '986436', anadidas: 1, totalLineas: 2, aviso: null });
    throw new Error('llamada inesperada ' + fn);
  };
  p.ctx.UNI_pregunta_ = () => { trazas.preguntas++; return Promise.resolve({ accion: eleccion, id: 'pc1' }); };
  const crearAparte = () => { trazas.aparte++; return Promise.resolve('creado'); };
  return p.ctx.UNI_enviarPedidoCliente_({ numPedido: '986436', transporte: true, comentario: 'c' }, opciones.lineas || NUEVAS, crearAparte);
}

const sinUnir = (p) => !p.trazas.gas.some((g) => g[0] === 'anadirLineasAPedido');

test('envío: sin otro pedido abierto se crea como siempre, sin preguntar', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [], null), 'creado');
  assert.strictEqual(p.trazas.aparte, 1);
  assert.strictEqual(p.trazas.preguntas, 0);
  assert.deepStrictEqual(p.trazas.gas, [['buscarPedidoAbiertoMismoNumero', '100', '986436', true]]);
  assert.strictEqual(p.trazas.alertas.length, 0);
});

test('envío: si la búsqueda falla, se crea como siempre (la búsqueda solo avisa)', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [], null, { falloBusqueda: true }), 'creado');
  assert.strictEqual(p.trazas.aparte, 1);
});

test('envío: un trozo más del mismo pedido (artículos distintos) se une SOLO, sin preguntar, y se confirma', async () => {
  const p = pantalla();
  await envio(p, [ABIERTO()], null);
  assert.strictEqual(p.trazas.preguntas, 0, 'no pregunta');
  const unir = p.trazas.gas.find((g) => g[0] === 'anadirLineasAPedido');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(unir)), ['anadirLineasAPedido', '100', 'pc1', { numPedido: '986436', transporte: true, comentario: 'c' }, NUEVAS]);
  assert.strictEqual(p.trazas.aparte, 0, 'no se crea otro pedido');
  assert.strictEqual(p.trazas.alertas.length, 1);
  assert.strictEqual(p.trazas.alertas[0], 'El pedido 986436 ya estaba abierto, así que se ha añadido a él 1 línea y ahora tiene 2 líneas. Almacén lo verá marcado como modificado.');
  assert.strictEqual(p.trazas.colas, 1, 'vuelve a la lista');
});

test('envío: con varios abiertos se une solo al más antiguo que lo admite', async () => {
  const p = pantalla();
  await envio(p, [ABIERTO({ id: 'a', puedeUnirse: false, motivo: 'x' }), ABIERTO({ id: 'b' }), ABIERTO({ id: 'c' })], null);
  assert.strictEqual(p.trazas.preguntas, 0);
  assert.strictEqual(p.trazas.gas.find((g) => g[0] === 'anadirLineasAPedido')[2], 'b');
});

test('envío: si lo que se envía repite un artículo del pedido abierto, pregunta (¿se pide dos veces?) y no une todavía', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [ABIERTO()], null, { lineas: REPETIDAS }), 'cancelado');
  assert.strictEqual(p.trazas.preguntas, 1);
  assert.ok(sinUnir(p));
  assert.strictEqual(p.trazas.aparte, 0);
  assert.strictEqual(p.trazas.colas, 0);
});

test('envío: si el pedido abierto no admite más líneas, pregunta; crear aparte crea el pedido', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [ABIERTO({ puedeUnirse: false, motivo: 'Ana lo tiene abierto' })], 'aparte'), 'creado');
  assert.strictEqual(p.trazas.preguntas, 1);
  assert.strictEqual(p.trazas.aparte, 1);
  assert.ok(sinUnir(p));
});

test('envío: «crear aparte» desde la pregunta crea el pedido sin tocar el abierto', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [ABIERTO()], 'aparte', { lineas: REPETIDAS }), 'creado');
  assert.strictEqual(p.trazas.aparte, 1);
  assert.ok(sinUnir(p));
});

test('envío: cancelar la pregunta no hace nada', async () => {
  const p = pantalla();
  assert.strictEqual(await envio(p, [ABIERTO({ puedeUnirse: false, motivo: 'x' })], null), 'cancelado');
  assert.strictEqual(p.trazas.aparte, 0);
  assert.strictEqual(p.trazas.colas, 0);
  assert.ok(sinUnir(p));
});

test('envío: añadir desde la pregunta manda el pedido elegido y lo confirma con «Hecho»', async () => {
  const p = pantalla();
  await envio(p, [ABIERTO()], 'unir', { lineas: REPETIDAS });
  assert.strictEqual(p.trazas.preguntas, 1);
  const unir = p.trazas.gas.find((g) => g[0] === 'anadirLineasAPedido');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(unir)), ['anadirLineasAPedido', '100', 'pc1', { numPedido: '986436', transporte: true, comentario: 'c' }, REPETIDAS]);
  assert.strictEqual(p.trazas.aparte, 0);
  assert.match(p.trazas.alertas[0], /^Hecho: 1 línea añadida al pedido 986436, que ahora tiene 2 líneas\. Almacén lo verá marcado como modificado\.$/);
  assert.strictEqual(p.trazas.colas, 1);
});

test('envío: si el servidor rechaza añadir (solo o desde la pregunta), el error llega al formulario y no se crea nada', async () => {
  for (const [opciones, eleccion] of [[{ falloUnir: 'Ana lo tiene abierto en almacén' }, null], [{ falloUnir: 'Ana lo tiene abierto en almacén', lineas: REPETIDAS }, 'unir']]) {
    const p = pantalla();
    await assert.rejects(envio(p, [ABIERTO()], eleccion, opciones), /Ana lo tiene abierto/);
    assert.strictEqual(p.trazas.aparte, 0);
    assert.strictEqual(p.trazas.colas, 0);
    assert.strictEqual(p.trazas.alertas.length, 0);
  }
});

test('mensaje de «hecho»: singular, plural, aviso del servidor y todo escapado', () => {
  const { ctx } = pantalla();
  assert.strictEqual(ctx.UNI_mensajeHecho_({ anadidas: 3, numPedido: '<9>', totalLineas: 4, aviso: null }, false),
    'Hecho: 3 líneas añadidas al pedido &lt;9&gt;, que ahora tiene 4 líneas. Almacén lo verá marcado como modificado.');
  assert.strictEqual(ctx.UNI_mensajeHecho_({ anadidas: 3, numPedido: '<9>', totalLineas: 4, aviso: null }, true),
    'El pedido &lt;9&gt; ya estaba abierto, así que se han añadido a él 3 líneas y ahora tiene 4 líneas. Almacén lo verá marcado como modificado.');
  assert.match(ctx.UNI_mensajeHecho_({ anadidas: 1, numPedido: '9', totalLineas: 1, aviso: 'Ojo <b>' }, false), /1 línea añadida.*1 línea\. .*<br><br>Ojo &lt;b&gt;$/);
  assert.match(ctx.UNI_mensajeHecho_({ anadidas: 1, numPedido: '9', totalLineas: 1, aviso: 'Ojo <b>' }, true), /se ha añadido a él 1 línea y ahora tiene 1 línea\. .*<br><br>Ojo &lt;b&gt;$/);
  assert.doesNotMatch(ctx.UNI_mensajeHecho_({ anadidas: 1, numPedido: '9' }, false), /que ahora tiene/);
  assert.doesNotMatch(ctx.UNI_mensajeHecho_({ anadidas: 1, numPedido: '9' }, true), /ahora tiene/);
});

// ——— Enganche en el portal ———

test('Portal.html: solo el pedido cliente pasa por la pregunta; cancelar deja el botón listo; el archivo se incluye', () => {
  const portal = fs.readFileSync(path.join(PORTAL, 'Portal.html'), 'utf8');
  assert.match(portal, /<\?!= incluir_\('UnirPedidosUI'\) \?>/);
  assert.match(portal, /\(tipo === 'pedido_cliente' \? UNI_enviarPedidoCliente_\(datos, lineas, crearAparte\) : crearAparte\(\)\)\.then\(function \(r\) \{\s*if \(r === 'cancelado'\) \{ btnEnviar\.disabled = false; btnEnviar\.textContent = 'Enviar petición'; \}/);
  assert.match(portal, /function crearAparte\(\) \{\s*return gas\('crearPeticion', LDAP, tipo, datos, lineas\)\.then\(function \(\) \{\s*renderCola\(\);/);
  assert.strictEqual((portal.match(/gas\('crearPeticion'/g) || []).length, 1, 'un solo sitio crea peticiones');
  const codigo = fs.readFileSync(path.join(PORTAL, 'Codigo.js'), 'utf8');
  assert.match(codigo, /function incluir_\(nombre\) \{\s*return HtmlService\.createHtmlOutputFromFile\(nombre\)\.getContent\(\);/);
});

test('portal: ningún .js y .html comparten nombre base, y el script no lleva «/*» en una cadena', () => {
  const nombres = fs.readdirSync(PORTAL).map((f) => f.replace(/\.(js|html)$/, ''));
  assert.strictEqual(new Set(nombres).size, nombres.length, 'hay dos archivos con el mismo nombre base');
  const ui = fs.readFileSync(path.join(PORTAL, 'UnirPedidosUI.html'), 'utf8');
  const script = ui.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(!/(['"`])[^'"`\n]*\/\*[^'"`\n]*\1/.test(script), 'una cadena del script contiene "/" seguido de "*"');
});
