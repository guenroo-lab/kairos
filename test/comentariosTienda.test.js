// Comentario que la tienda deja en un pedido cliente, una cesión, un refill o una revisión de stock: el operario (y el
// jefe de equipo) lo tienen que ver al preparar.
//   · kairos-operario/Cola.js, Panel.js, Peticion.js y Revisiones.js: el comentario llega al navegador
//   · kairos-operario/ComentariosTiendaUI.html: el recuadro (escapado, recorte en listas, completo en el detalle)
//   · kairos-operario/Index.html: está enganchado en la cola, el detalle, el panel del jefe y las revisiones
//
// Se carga el código REAL y solo se sustituye el transporte HTTP (_supaFetch_) por una base de datos en memoria.
// Uso: node --test (raíz de Kairos). KAIROS_OPERARIO_DIR apunta a otra copia (pruebas de mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { crearBD } = require('./bdMemoria');

const OPERARIO = process.env.KAIROS_OPERARIO_DIR || path.join(__dirname, '..', 'kairos-operario');
const ARCHIVOS = ['Config.js', 'Utils.js', 'Fechas.js', 'Supabase.js', 'StockAsignacion.js', 'Hodos.js', 'Cola.js', 'Panel.js', 'Peticion.js', 'Revisiones.js'];

const COMENTARIO_PC = 'El cliente recoge hoy\nLlamar antes: <b>666</b> & "urgente"';

function semilla() {
  const pet = (id, tipo, extra) => Object.assign({
    id, tipo, tienda_origen: '014', estado: 'pendiente', solicitante_ldap: '100', creada_en: '2026-10-08T07:00:00.000Z',
    visible_desde: '2026-10-01', cola_individual: false, comentario: null,
  }, extra);
  const linea = (id, peticion, extra) => Object.assign({
    id, peticion_id: peticion, codigo_lm: 'A', cantidad: 2, unidad_medida: 'ud', estado_preparacion: 'pendiente',
    sscc: '00000000000000000001 (2ud)', ubicacion: '05-A-1-1', designacion: 'Artículo A',
  }, extra);
  return {
    peticiones: [
      pet('pc1', 'pedido_cliente', { num_pedido: 'PC1', transporte: false, comentario: COMENTARIO_PC }),
      pet('ce1', 'cesion', { num_cesion: 'CE1', tienda_destino: '279', comentario: 'Cesión urgente, la espera el camión de las 12' }),
      pet('rf1', 'refill', { motivo: 'Reposición', comentario: 'Dejar en el pasillo 4' }),
      pet('pc2', 'pedido_cliente', { num_pedido: 'PC2', transporte: true }),
      pet('pc3', 'pedido_cliente', { num_pedido: 'PC3', transporte: false, comentario: '   ' }),
      pet('pc4', 'pedido_cliente', { num_pedido: 'PC4', transporte: false, estado: 'cerrada', cerrada_en: '2026-10-08T08:00:00.000Z', comentario: 'Ya entregado, solo consulta' }),
    ],
    lineas: [
      linea('l1', 'pc1'), linea('l2', 'ce1'), linea('l3', 'rf1'), linea('l4', 'pc2'), linea('l5', 'pc3'), linea('l6', 'pc4', { estado_preparacion: 'preparado', estado_negocio: 'Preparado' }),
    ],
    revisiones_palet: [
      { id: 'r1', tienda_origen: '014', sscc: '00000000000000000001', ubicacion_esperada: '05-A-1-1', estado: 'pendiente', revisar: ['cantidad'],
        contenido_esperado: [{ codigo_lm: 'A', designacion: 'Artículo A', cantidad: 5 }], creada_en: '2026-10-08T08:00:00.000Z', solicitante_ldap: '100',
        comentario: 'Parece que falta una caja' },
      { id: 'r2', tienda_origen: '014', sscc: '00000000000000000002', ubicacion_esperada: '05-B-1-1', estado: 'pendiente', revisar: ['cantidad'],
        contenido_esperado: [], creada_en: '2026-10-08T08:05:00.000Z', solicitante_ldap: '100', comentario: null },
      { id: 'r3', tienda_origen: '279', sscc: '00000000000000000003', ubicacion_esperada: '05-C-1-1', estado: 'en_revision', revisar: ['cantidad'],
        contenido_esperado: [], creada_en: '2026-10-08T08:10:00.000Z', solicitante_ldap: '200', comentario: 'Mijas: mirar el palet de abajo' },
    ],
    catalogo: [{ codigo_lm: 'A', ean: '8412345000011', designacion: 'Artículo A' }],
  };
}

function entorno(opciones) {
  opciones = opciones || {};
  const datos = semilla();
  if (opciones.ajustar) opciones.ajustar(datos);
  const bd = crearBD(datos);
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error, encodeURIComponent, decodeURIComponent,
    Utilities: { formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? '2026-10-08' : '20261008-100000') },
  };
  vm.createContext(ctx);
  ARCHIVOS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(OPERARIO, f), 'utf8'), ctx, { filename: f }));
  ctx._supaFetch_ = (metodo, tabla, query, payload) => {
    if (opciones.fallaSi && opciones.fallaSi(metodo, tabla, query)) throw new Error('Supabase 400: columna inexistente');
    return bd.transporte(metodo, tabla, query, payload);
  };
  const porId = (filas) => Object.fromEntries(filas.map((f) => [f.id, f]));
  return { ctx, bd, porId };
}

// ——— El servidor entrega el comentario ———

test('la cola trae el comentario de pedidos, cesiones y refills (y nada donde la tienda no escribió)', () => {
  const e = entorno();
  const cola = e.porId(JSON.parse(e.ctx.listarCola('014', '')));
  assert.strictEqual(cola.pc1.comentario, COMENTARIO_PC);
  assert.strictEqual(cola.ce1.comentario, 'Cesión urgente, la espera el camión de las 12');
  assert.strictEqual(cola.rf1.comentario, 'Dejar en el pasillo 4');
  assert.ok(!cola.pc2.comentario, 'sin comentario');
  assert.ok(!('pc4' in cola), 'las cerradas no están en la cola');
});

test('si la columna modificada_en aún no existe, la cola (consulta de reserva) sigue trayendo el comentario', () => {
  const e = entorno({ fallaSi: (m, tabla, query) => tabla === 'peticiones' && /modificada_en/.test(query) });
  const cola = e.porId(JSON.parse(e.ctx.listarCola('014', '')));
  assert.strictEqual(cola.pc1.comentario, COMENTARIO_PC);
  assert.strictEqual(cola.rf1.comentario, 'Dejar en el pasillo 4');
});

test('el panel del jefe trae el comentario de las activas y de las cerradas recientes', () => {
  const e = entorno();
  const panel = e.porId(JSON.parse(e.ctx.listarTodasPeticiones()));
  assert.strictEqual(panel.pc1.comentario, COMENTARIO_PC);
  assert.strictEqual(panel.ce1.comentario, 'Cesión urgente, la espera el camión de las 12');
  assert.strictEqual(panel.pc4.comentario, 'Ya entregado, solo consulta');
  assert.ok(!panel.pc2.comentario);
});

test('el detalle del pedido que abre el operario lleva el comentario (y quién lo pide)', () => {
  const e = entorno();
  const d = JSON.parse(e.ctx.obtenerPeticion('pc1', 'Ana'));
  assert.strictEqual(d.peticion.comentario, COMENTARIO_PC);
  assert.strictEqual(d.peticion.solicitante_ldap, '100');
  const r = JSON.parse(e.ctx.obtenerPeticion('rf1', 'Ana'));
  assert.strictEqual(r.peticion.comentario, 'Dejar en el pasillo 4');
});

test('las revisiones de stock llevan el comentario: lista del operario, al abrirla y monitor del jefe', () => {
  const e = entorno();
  const lista = e.porId(JSON.parse(e.ctx.listarRevisionesTienda('014')));
  assert.strictEqual(lista.r1.comentario, 'Parece que falta una caja');
  assert.ok(!lista.r2.comentario);
  assert.ok(!('r3' in lista), 'la de Mijas no sale en Marbella');
  const abierta = JSON.parse(e.ctx.tomarRevision('r1', 'Ana'));
  assert.strictEqual(abierta.comentario, 'Parece que falta una caja');
  const jefe = JSON.parse(e.ctx.listarRevisionesJefe());
  const abiertas = e.porId(jefe.abiertas);
  assert.strictEqual(abiertas.r1.comentario, 'Parece que falta una caja');
  assert.strictEqual(abiertas.r3.comentario, 'Mijas: mirar el palet de abajo');
});

// ——— El recuadro (ComentariosTiendaUI.html) ———

function pantalla(conEscape) {
  const html = fs.readFileSync(path.join(OPERARIO, 'ComentariosTiendaUI.html'), 'utf8');
  const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = { console, String, Object, Array, JSON };
  if (conEscape) ctx.escHtmlSie_ = (s) => '«' + String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) + '»';
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'ComentariosTiendaUI.html' });
  return ctx;
}

test('sin comentario (vacío, solo espacios, null) no se pinta nada', () => {
  const ui = pantalla();
  [undefined, null, '', '   ', '\n\t '].forEach((t) => assert.strictEqual(ui.CTI_html_(t), ''));
  assert.strictEqual(ui.CTI_html_(null, { compacta: true, de: '100' }), '');
});

test('el comentario sale entero en el detalle, con título, quién lo pide y sin HTML colado', () => {
  const ui = pantalla();
  const h = ui.CTI_html_(COMENTARIO_PC, { de: '100' });
  assert.match(h, /^<div class="nota-tienda"><b>💬 Comentario de la tienda · 100<\/b>/);
  assert.ok(h.includes('El cliente recoge hoy\nLlamar antes: &lt;b&gt;666&lt;/b&gt; &amp; &quot;urgente&quot;'));
  assert.ok(!/<b>666/.test(h), 'la etiqueta de la tienda no se interpreta');
  assert.ok(!/compacta/.test(h));
  assert.match(h, /<\/div>$/);
  const nombre = ui.CTI_html_('hola', { de: '<img src=x onerror=alert(1)>' });
  assert.ok(!/<img/.test(nombre), 'el nombre también se escapa');
});

test('los saltos de línea de Windows se guardan como uno solo y el texto se recorta de espacios', () => {
  const ui = pantalla();
  const h = ui.CTI_html_('  uno\r\ndos\rtres  ');
  assert.ok(h.endsWith('</b>uno\ndos\ntres</div>'), h);
});

test('en las listas el comentario es corto: se recorta con «…» pero el detalle nunca', () => {
  const ui = pantalla();
  const largo = 'a'.repeat(280) + 'b'.repeat(220);
  const lista = ui.CTI_html_(largo, { compacta: true });
  assert.match(lista, /^<div class="nota-tienda compacta">/);
  assert.ok(lista.includes('a'.repeat(280) + '…</div>'));
  assert.ok(!lista.includes('bbb'), 'lo que pasa de 280 caracteres no se enseña en la lista');
  assert.ok(ui.CTI_html_('a'.repeat(280), { compacta: true }).endsWith('a'.repeat(280) + '</div>'), '280 justos no se recortan');
  assert.ok(ui.CTI_html_('a'.repeat(281), { compacta: true }).includes('…'));
  assert.ok(ui.CTI_html_(largo).includes(largo), 'el detalle lo trae completo');
  assert.ok(ui.CTI_html_('hola   ' + 'x'.repeat(300), { compacta: true }).includes('hola'));
});

test('el recorte no deja un espacio colgando delante de «…»', () => {
  const ui = pantalla();
  const t = 'a'.repeat(279) + ' ' + 'b'.repeat(40);
  assert.ok(ui.CTI_html_(t, { compacta: true }).includes('a'.repeat(279) + '…</div>'));
});

test('usa el escape de la pantalla cuando existe (escHtmlSie_) y uno propio si no', () => {
  assert.ok(pantalla(true).CTI_html_('x<y', { de: 'z' }).includes('«x&lt;y»'));
  assert.ok(pantalla(true).CTI_html_('x', { de: 'z' }).includes('· «z»'));
  assert.ok(pantalla(false).CTI_html_("x<y'z").includes("x&lt;y&#39;z"));
});

// ——— Enganche en Index.html ———

test('Index.html muestra el comentario en la cola, el detalle, el panel del jefe y las tres vistas de revisión', () => {
  const index = fs.readFileSync(path.join(OPERARIO, 'Index.html'), 'utf8');
  assert.match(index, /<\?!= incluir_\('ComentariosTiendaUI'\) \?>/);
  const usos = index.match(/CTI_html_\([^)]*\)/g) || [];
  assert.deepStrictEqual(usos.sort(), [
    'CTI_html_(p.comentario, { compacta: true })',   // cola
    'CTI_html_(p.comentario, { compacta: true })',   // panel del jefe
    'CTI_html_(p.comentario, { de: p.solicitante_ldap })',   // detalle del pedido
    'CTI_html_(r.comentario)',   // detalle de la revisión
    'CTI_html_(r.comentario, { compacta: true })',   // lista de revisiones del operario
    'CTI_html_(r.comentario, { compacta: true })',   // revisiones pendientes del jefe
  ].sort());
  // Cola: debajo del artículo, antes de la ubicación.
  assert.match(index, /EAN '[^\n]*\n\s*CTI_html_\(p\.comentario, \{ compacta: true \}\) \+\n\s*\(ubicacionesHtml/);
  // Detalle: antes del aviso de «modificado» y de las líneas, para que sea lo primero que lee.
  assert.match(index, /html \+= CTI_html_\(p\.comentario, \{ de: p\.solicitante_ldap \}\);\n\s*const histCambios/);
  // Ya no queda el «Comentario:» pequeño de antes.
  assert.ok(!/'Comentario: '/.test(index));
  assert.ok(!/Comentario: ' \+/.test(index));
});

test('la carga de pantallas no pisa nombres: ningún .js y .html comparten nombre base, y el script no lleva «/*» en una cadena', () => {
  const nombres = fs.readdirSync(OPERARIO).map((f) => f.replace(/\.(js|html)$/, ''));
  assert.strictEqual(new Set(nombres).size, nombres.length, 'hay dos archivos con el mismo nombre base');
  const ui = fs.readFileSync(path.join(OPERARIO, 'ComentariosTiendaUI.html'), 'utf8');
  const script = ui.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(!/(['"`])[^'"`\n]*\/\*[^'"`\n]*\1/.test(script), 'una cadena del script contiene "/" seguido de "*"');
});
