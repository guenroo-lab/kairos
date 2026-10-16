// Ocupación SIE dentro de Kairos (operario: registrar · jefe de equipo: ver).
//   · kairos-operario/Ocupacion.js          : el servidor que habla con la app «Ocupación Tiendas SIE» (el motor)
//   · kairos-operario/OcupacionSieUI.html   : las pantallas (cálculos, textos, escapado)
//   · kairos-operario/Index.html            : el botón del menú, la pestaña de jefe y el enganche en render()
// Se carga el código REAL; solo se sustituye el transporte (UrlFetchApp, caché, propiedades).
// Uso: node --test test/ocupacionSie.test.js (raíz de Kairos). KAIROS_OPERARIO_DIR apunta a otra copia (mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const OPERARIO = process.env.KAIROS_OPERARIO_DIR || path.join(__dirname, '..', 'kairos-operario');
const leer = (f) => fs.readFileSync(path.join(OPERARIO, f), 'utf8');

// ───────────────────────── Servidor (Ocupacion.js) ─────────────────────────
const URL_MOTOR = 'https://script.google.com/macros/s/AKfycbw1ssfsAFEHBS1mm0ya_pE3nNOJALrqPqfXbK0lmQ9uQVZJVk2OqOF2lzV98VdPcTRZ1g/exec';

function servidor(opciones) {
  opciones = opciones || {};
  const llamadas = [];
  const respuestas = (opciones.respuestas || []).slice();
  const cache = new Map();
  const props = opciones.props || {};
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    ScriptApp: { getOAuthToken: () => 'TOKEN-DE-PRUEBA' },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    UrlFetchApp: {
      fetch: (url, op) => {
        llamadas.push({ url, op });
        const r = respuestas.shift();
        if (r === undefined) throw new Error('Llamada inesperada a ' + url);
        if (r instanceof Error) throw r;
        return { getContentText: () => (typeof r === 'string' ? r : JSON.stringify(r)), getResponseCode: () => (r && r.codigoHttp) || 200 };
      },
    },
  };
  vm.createContext(ctx);
  ['Utils.js', 'Ocupacion.js'].forEach((f) => vm.runInContext(leer(f), ctx, { filename: f }));
  return { ctx, llamadas, cache };
}

const MOTOR_OK = { ok: true, ahora: '16/10/2026 09:00', hoy: '16/10/2026', modoTest: false, config: { totalMijas: 915, totalMarbella: 2106 }, historial: [] };
const j = (texto) => JSON.parse(texto);

test('obtenerOcupacionSie: GET al motor con ?accion=ocupacion y el token de quien ejecuta', () => {
  const s = servidor({ respuestas: [MOTOR_OK] });
  const r = j(s.ctx.obtenerOcupacionSie());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.totalMijas, 915);
  assert.strictEqual(s.llamadas.length, 1);
  assert.strictEqual(s.llamadas[0].url, URL_MOTOR + '?accion=ocupacion');
  assert.strictEqual(s.llamadas[0].op.method, 'get');
  assert.strictEqual(s.llamadas[0].op.headers.Authorization, 'Bearer TOKEN-DE-PRUEBA');
  assert.strictEqual(s.llamadas[0].op.muteHttpExceptions, true);
  assert.strictEqual(s.llamadas[0].op.payload, undefined);
});

test('obtenerOcupacionSie: la caché de 60 s evita llamar dos veces; «forzar» salta la caché', () => {
  const s = servidor({ respuestas: [MOTOR_OK, MOTOR_OK, MOTOR_OK] });
  s.ctx.obtenerOcupacionSie();
  s.ctx.obtenerOcupacionSie(false);
  assert.strictEqual(s.llamadas.length, 1);
  s.ctx.obtenerOcupacionSie(true);
  assert.strictEqual(s.llamadas.length, 2);
});

test('obtenerOcupacionSie: un error del motor NO se guarda en la caché', () => {
  const s = servidor({ respuestas: [{ ok: false, error: 'Hoja no encontrada' }, MOTOR_OK] });
  assert.strictEqual(j(s.ctx.obtenerOcupacionSie()).ok, false);
  assert.strictEqual(j(s.ctx.obtenerOcupacionSie()).ok, true);
  assert.strictEqual(s.llamadas.length, 2);
});

test('obtenerOcupacionSie: si el motor contesta con una página (permiso o despliegue) o la red falla, devuelve un error legible', () => {
  const html = servidor({ respuestas: ['<!DOCTYPE html><html>Inicia sesión</html>'] });
  const a = j(html.ctx.obtenerOcupacionSie());
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /no ha respondido con datos \(código 200\)/);
  assert.doesNotMatch(a.error, /Inicia sesión/, 'no se cuela el HTML en el mensaje');

  const red = servidor({ respuestas: [new Error('Address unavailable')] });
  const b = j(red.ctx.obtenerOcupacionSie());
  assert.strictEqual(b.ok, false);
  assert.match(b.error, /No se pudo hablar con la app de Ocupación: Address unavailable/);

  const nulo = servidor({ respuestas: ['null'] });
  assert.strictEqual(j(nulo.ctx.obtenerOcupacionSie()).ok, false);
});

test('la propiedad OCUPACION_WEBAPP_URL sustituye la URL del motor', () => {
  const s = servidor({ props: { OCUPACION_WEBAPP_URL: '  https://ejemplo.test/exec  ' }, respuestas: [MOTOR_OK] });
  s.ctx.obtenerOcupacionSie();
  assert.strictEqual(s.llamadas[0].url, 'https://ejemplo.test/exec?accion=ocupacion');
});

test('registrarOcupacionSie: POST con los datos limpios y el origen', () => {
  const s = servidor({ respuestas: [{ ok: true, fila: 21 }] });
  const r = j(s.ctx.registrarOcupacionSie('  Ana   Pérez ', '57', 103, 'kabc123def456'));
  assert.deepStrictEqual(r, { ok: true, fila: 21 });
  const l = s.llamadas[0];
  assert.strictEqual(l.url, URL_MOTOR);
  assert.strictEqual(l.op.method, 'post');
  assert.strictEqual(l.op.contentType, 'application/json');
  assert.strictEqual(l.op.headers.Authorization, 'Bearer TOKEN-DE-PRUEBA');
  assert.deepStrictEqual(JSON.parse(l.op.payload), {
    accion: 'registrar', idRegistro: 'kabc123def456', libresMijas: 57, libresMarbella: 103, registradoPor: 'Ana Pérez', origen: 'Kairos operario',
  });
});

test('corregirOcupacionSie usa la acción «corregir» con el mismo id', () => {
  const s = servidor({ respuestas: [{ ok: true, fila: 21 }] });
  s.ctx.corregirOcupacionSie('Ana', 60, 120, 'kabc123def456');
  const p = JSON.parse(s.llamadas[0].op.payload);
  assert.strictEqual(p.accion, 'corregir');
  assert.strictEqual(p.idRegistro, 'kabc123def456');
  assert.strictEqual(p.libresMijas, 60);
});

for (const [nombre, args, texto] of [
  ['negativo', ['Ana', -1, 5, 'kabc123def456'], /enteros/],
  ['decimal', ['Ana', 5.5, 5, 'kabc123def456'], /enteros/],
  ['texto', ['Ana', 'muchos', 5, 'kabc123def456'], /enteros/],
  ['vacío', ['Ana', '', 5, 'kabc123def456'], /enteros/],
  ['nulo', ['Ana', 5, null, 'kabc123def456'], /enteros/],
  ['infinito', ['Ana', Infinity, 5, 'kabc123def456'], /enteros/],
  ['sin id', ['Ana', 5, 5, ''], /identificador/],
  ['id demasiado corto', ['Ana', 5, 5, 'abc'], /identificador/],
  ['id con caracteres raros', ['Ana', 5, 5, 'abc def/ghi'], /identificador/],
  ['sin operario', ['', 5, 5, 'kabc123def456'], /quién eres/],
  ['operario de una letra', ['A', 5, 5, 'kabc123def456'], /quién eres/],
]) {
  test('registrar rechaza ' + nombre + ' sin llamar al motor', () => {
    const s = servidor({ respuestas: [{ ok: true, fila: 1 }] });
    const r = j(s.ctx.registrarOcupacionSie(...args));
    assert.strictEqual(r.ok, false);
    assert.match(r.error, texto);
    assert.strictEqual(s.llamadas.length, 0);
  });
}

test('un registro correcto invalida la caché; uno rechazado por el motor no', () => {
  const s = servidor({ respuestas: [MOTOR_OK, { ok: true, fila: 5 }, MOTOR_OK, { ok: false, error: 'Mijas: no puede haber más de 915 huecos libres.' }, MOTOR_OK] });
  s.ctx.obtenerOcupacionSie();                                         // 1: llena la caché
  assert.strictEqual(s.llamadas.length, 1);
  s.ctx.registrarOcupacionSie('Ana', 5, 5, 'kabc123def456');           // 2: ok → vacía la caché
  s.ctx.obtenerOcupacionSie();                                         // 3: vuelve a leer
  assert.strictEqual(s.llamadas.length, 3);
  const mal = j(s.ctx.registrarOcupacionSie('Ana', 999, 5, 'kabc123def457'));   // 4: el motor lo rechaza
  assert.strictEqual(mal.ok, false);
  assert.match(mal.error, /más de 915/);
  s.ctx.obtenerOcupacionSie();                                         // la caché seguía llena → no llama
  assert.strictEqual(s.llamadas.length, 4);
});

test('el motivo del motor (ya enviado) llega tal cual a la pantalla', () => {
  const s = servidor({ respuestas: [{ ok: false, motivo: 'ya_enviado', error: 'Los informes de ese registro ya se han enviado.' }] });
  const r = j(s.ctx.corregirOcupacionSie('Ana', 5, 5, 'kabc123def456'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'ya_enviado');
});

// ───────────────────────── Pantallas (OcupacionSieUI.html) ─────────────────────────
function pantalla() {
  const html = leer('OcupacionSieUI.html');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'el fichero tiene su <script>');
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, parseInt, RegExp, Error,
    document: { getElementById: () => null },
    VISTA: { nombre: 'ocupacion' }, MODO_JEFE: false, OPERARIO: 'Ana',
    setInterval: () => 1, clearInterval: () => {},
    escHtmlSie_: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    renderBrandHeaderHtml_: () => '', renderTabsBar_: () => '', sincronizarPickers_: () => {}, render: () => {},
    google: { script: { run: {} } },
  };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx, { filename: 'OcupacionSieUI.html' });
  return ctx;
}

function fila(extra) {
  return Object.assign({
    fila: 2, semana: 41, fecha: '13/10/2026', hora: '10:12', ts: 1, libresMijas: 57, libresMarbella: 103,
    ocupadosMijas: 858, ocupadosMarbella: 2003, pctMijas: 93.8, pctMarbella: 95.1, nivelMijas: 'critico', nivelMarbella: 'critico',
    estado: 'ENVIADO', registradoPor: 'Pedro', origen: 'Kairos operario',
  }, extra);
}
function datos(historial, extra) {
  return Object.assign({ ok: true, ahora: '16/10/2026 09:00', hoy: '16/10/2026', modoTest: false, config: { totalMijas: 915, totalMarbella: 2106 }, historial }, extra);
}

test('los niveles de alerta de la pantalla coinciden con los del motor (90 / 70 / 40 sobre el % redondeado)', () => {
  const p = pantalla();
  for (const [pct, nivel] of [[0, 'bajo'], [39.4, 'bajo'], [39.5, 'normal'], [69.4, 'normal'], [69.5, 'alto'], [89.4, 'alto'], [89.5, 'critico'], [100, 'critico']]) {
    assert.strictEqual(p.OCU_nivel_(pct), nivel, pct + ' %');
  }
  const motor = path.join(__dirname, '..', '..', 'OcupacionTiendas', 'Api.js');
  if (fs.existsSync(motor)) {
    const m = vm.createContext({ console });
    vm.runInContext(fs.readFileSync(motor, 'utf8'), m);
    for (let pct = 0; pct <= 100; pct += 0.1) assert.strictEqual(p.OCU_nivel_(pct), m.nivelOcupacion_(pct), 'motor y pantalla coinciden en ' + pct.toFixed(1));
  }
});

test('el % que enseña la vista previa es el que calcula el motor (calcPct)', () => {
  const p = pantalla();
  assert.strictEqual(p.OCU_pct_(915, 57).toFixed(1), '93.8');
  assert.strictEqual(p.OCU_pct_(2106, 103).toFixed(1), '95.1');
  assert.strictEqual(p.OCU_pct_(915, 0), 100);
  assert.strictEqual(p.OCU_pct_(915, 915), 0);
  assert.strictEqual(p.OCU_pct_(915, 2000), 0, 'nunca por debajo de 0');
  assert.strictEqual(p.OCU_pct_(0, 5), 0, 'sin capacidad no divide por cero');
});

test('formatos: porcentaje con coma, miles con punto, diferencia en puntos', () => {
  const p = pantalla();
  assert.strictEqual(p.OCU_fmtPct_(93.84), '93,8 %');
  assert.strictEqual(p.OCU_fmtPct_(100), '100,0 %');
  assert.strictEqual(p.OCU_fmtNum_(2106), '2.106');
  assert.strictEqual(p.OCU_fmtNum_(915), '915');
  assert.strictEqual(p.OCU_fmtNum_(0), '0');
  assert.strictEqual(p.OCU_fmtNum_(1234567), '1.234.567');
  assert.match(p.OCU_fmtPp_(2.64), /class="sube">▲ \+2,6 pp</);
  assert.match(p.OCU_fmtPp_(-1.26), /class="baja">▼ -1,3 pp</);
  assert.match(p.OCU_fmtPp_(0.2), /class="">= \+0,2 pp</);
});

test('días entre fechas dd/MM/yyyy (también entre meses y años) y fechas raras', () => {
  const p = pantalla();
  assert.strictEqual(p.OCU_diasEntre_('13/10/2026', '16/10/2026'), 3);
  assert.strictEqual(p.OCU_diasEntre_('16/10/2026', '16/10/2026'), 0);
  assert.strictEqual(p.OCU_diasEntre_('30/09/2026', '02/10/2026'), 2);
  assert.strictEqual(p.OCU_diasEntre_('30/12/2026', '02/01/2027'), 3);
  assert.strictEqual(p.OCU_diasEntre_('', '16/10/2026'), 0);
  assert.strictEqual(p.OCU_diasEntre_('hoy', 'ayer'), 0);
});

test('«hoy ya hay un registro» solo cuenta los de hoy que siguen vivos (en cola o enviados)', () => {
  const p = pantalla();
  const d = datos([
    fila({ fecha: '15/10/2026', estado: 'ENVIADO' }),
    fila({ fila: 3, fecha: '16/10/2026', hora: '08:00', estado: 'ERROR' }),
    fila({ fila: 4, fecha: '16/10/2026', hora: '08:30', estado: 'CADUCADO' }),
  ]);
  assert.strictEqual(p.OCU_registroDeHoy_(d), null);
  d.historial.push(fila({ fila: 5, fecha: '16/10/2026', hora: '09:10', estado: 'PENDIENTE', registradoPor: 'Luis' }));
  assert.strictEqual(p.OCU_registroDeHoy_(d).registradoPor, 'Luis');
  assert.strictEqual(p.OCU_registroDeHoy_(datos([])), null);
  assert.strictEqual(p.OCU_registroDeHoy_(null), null);
});

test('estados de los informes: textos y colores', () => {
  const p = pantalla();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.OCU_textoEstado_('ENVIADO'))), { txt: 'Informes enviados', cls: 'ok' });
  assert.strictEqual(p.OCU_textoEstado_('PENDIENTE').cls, 'aviso');
  assert.strictEqual(p.OCU_textoEstado_('ERROR').cls, 'peligro');
  assert.strictEqual(p.OCU_textoEstado_('CADUCADO').cls, 'peligro');
  assert.strictEqual(p.OCU_textoEstado_('').txt, '—');
});

test('los ids de registro son válidos para el motor y no se repiten', () => {
  const p = pantalla();
  const vistos = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = p.OCU_nuevoId_();
    assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
    vistos.add(id);
  }
  assert.strictEqual(vistos.size, 2000);
});

test('vista del jefe: tarjetas de las dos tiendas, nivel, variaciones, gráfica y tabla', () => {
  const p = pantalla();
  const h = [
    fila({ fila: 2, fecha: '02/10/2026', pctMijas: 80, pctMarbella: 70, nivelMijas: 'alto', nivelMarbella: 'alto' }),
    fila({ fila: 3, fecha: '06/10/2026', pctMijas: 85, pctMarbella: 72 }),
    fila({ fila: 4, fecha: '09/10/2026', pctMijas: 88, pctMarbella: 71 }),
    fila({ fila: 5, fecha: '13/10/2026', pctMijas: 90, pctMarbella: 69 }),
    fila({ fila: 6, fecha: '16/10/2026', hora: '08:05', pctMijas: 93.8, pctMarbella: 65.5, nivelMarbella: 'normal', estado: 'PENDIENTE', registradoPor: 'Ana Pérez' }),
  ];
  const html = p.OCU_htmlVisor_(datos(h));
  assert.match(html, /Mijas/); assert.match(html, /Marbella/);
  assert.match(html, /93,8 %/); assert.match(html, /65,5 %/);
  assert.match(html, /Crítica/); assert.match(html, /Normal/);
  assert.match(html, /858 ocupados · 57 libres · de 915 huecos/);
  assert.match(html, /2\.003 ocupados · 103 libres · de 2\.106 huecos/);
  assert.match(html, /Frente al registro anterior: <b class="sube">▲ \+3,8 pp/);
  assert.match(html, /Frente a 4 registros atrás: <b class="sube">▲ \+13,8 pp/);
  assert.match(html, /Frente al registro anterior: <b class="baja">▼ -3,5 pp/);
  assert.strictEqual((html.match(/<polyline/g) || []).length, 2, 'una línea por tienda');
  assert.match(html, /En cola · salen en unos minutos/);
  assert.match(html, /Ana Pérez/);
  assert.strictEqual((html.match(/<tr>/g) || []).length, 5 + 1, 'una fila de tabla por registro, más la cabecera');
  const tabla = html.slice(html.indexOf('<table'));
  assert.ok(tabla.indexOf('16/10/2026 08:05') < tabla.indexOf('02/10/2026'), 'la tabla empieza por lo más reciente');
  assert.doesNotMatch(html, /Modo pruebas/);
});

test('vista del jefe: sin registros, un solo registro y modo pruebas', () => {
  const p = pantalla();
  assert.match(p.OCU_htmlVisor_(datos([])), /Todavía no hay registros/);
  const uno = p.OCU_htmlVisor_(datos([fila()], { modoTest: true }));
  assert.match(uno, /Modo pruebas/);
  assert.match(uno, /al menos dos registros/);
  assert.doesNotMatch(uno, /Frente al registro anterior/, 'con un solo registro no hay con qué comparar');
});

test('vista del jefe: el texto que viene de la hoja se escapa (nada de HTML ni scripts)', () => {
  const p = pantalla();
  const html = p.OCU_htmlVisor_(datos([fila({ registradoPor: '<img src=x onerror=alert(1)>', fecha: '"><b>x</b>' })]));
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /"><b>x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(p.OCU_htmlError_('<b>fallo</b>'), /&lt;b&gt;fallo&lt;\/b&gt;/);
});

test('la gráfica solo coge los últimos 26 registros', () => {
  const p = pantalla();
  const h = Array.from({ length: 40 }, (_, i) => fila({ fila: i + 2, fecha: '01/10/2026' }));
  const svg = p.OCU_grafico_(datos(h));
  const puntos = svg.match(/<polyline points="([^"]+)"/)[1].trim().split(' ');
  assert.strictEqual(puntos.length, 26);
});

// ───────────────────────── Enganche en Index.html ─────────────────────────
test('Index.html: botón del menú, pestaña de jefe, rutas de pantalla e include', () => {
  const idx = leer('Index.html');
  assert.match(idx, /boton\('ocupacion', '📊', 'Ocupación SIE', 'flujoOcupacion'\)/);
  assert.match(idx, /getElementById\('flujoOcupacion'\)\.onclick = function \(\) \{ entrarFlujo_\('ocupacion'\); \}/);
  assert.match(idx, /if \(flujo === 'ocupacion'\) \{ OCU_reiniciar_\(\);/);
  assert.match(idx, /\{ nombre: 'ocupacion', label: 'Ocupación SIE' \}/);
  assert.match(idx, /ocupacion: '<svg/, 'icono de la pestaña');
  assert.match(idx, /if \(VISTA\.nombre === 'ocupacion'\) return renderOcupacionJefe\(\);/);
  assert.match(idx, /if \(VISTA\.nombre === 'ocupacion'\) return renderOcupacionOperario\(\);/);
  assert.match(idx, /<\?!= incluir_\('OcupacionSieUI'\) \?>/);
  assert.ok(fs.existsSync(path.join(OPERARIO, 'OcupacionSieUI.html')));
  // la pestaña de jefe va justo detrás de «SIE por ubicar»
  assert.ok(idx.indexOf("nombre: 'sie', label") < idx.indexOf("nombre: 'ocupacion', label"));
  // el rótulo del menú nunca puede romper el resto del menú
  assert.match(idx, /try \{ OCU_contadorMenu_\(\); \} catch/);
});

test('el servidor y la pantalla exponen las funciones que se llaman desde el navegador', () => {
  const ui = leer('OcupacionSieUI.html');
  const srv = leer('Ocupacion.js');
  for (const f of ['obtenerOcupacionSie', 'registrarOcupacionSie', 'corregirOcupacionSie']) {
    assert.match(srv, new RegExp('function ' + f + '\\('), f + ' existe en el servidor');
    assert.match(ui, new RegExp('\\.' + f + '\\('), f + ' se llama desde la pantalla');
  }
});

test('la pantalla no usa diálogos nativos del navegador (confirm / alert / prompt)', () => {
  const ui = leer('OcupacionSieUI.html');
  assert.doesNotMatch(ui, /(^|[^.\w])(confirm|alert|prompt)\s*\(/);
});

test('ningún .js y .html del operario comparten nombre base (Apps Script los confunde)', () => {
  const nombres = fs.readdirSync(OPERARIO);
  const js = new Set(nombres.filter((n) => n.endsWith('.js')).map((n) => n.slice(0, -3)));
  nombres.filter((n) => n.endsWith('.html')).forEach((n) => assert.ok(!js.has(n.slice(0, -5)), n));
});
