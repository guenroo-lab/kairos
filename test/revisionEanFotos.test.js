// Revisión de stock: EAN del artículo y fotos para que tienda lo revise.
//   · kairos-operario/Revisiones.js (EAN desde el catálogo, subir/quitar/guardar/leer fotos) y RevisionesUI en Index.html
//   · kairos-operario/FotosRevisionUI.html (reducir, subir, reintentar, quitar, ver)
//   · kairos-portal/Revisiones.js (la tienda ve las fotos de SUS revisiones)
//
// Se carga el código REAL y solo se sustituyen el transporte HTTP (_supaFetch_) por una base de datos en memoria y
// DriveApp / Utilities por una carpeta de Drive en memoria. Uso: node --test (raíz de Kairos).
// KAIROS_OPERARIO_DIR / KAIROS_PORTAL_DIR apuntan a otras copias (pruebas de mutaciones).

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { crearBD } = require('./bdMemoria');

const OPERARIO = process.env.KAIROS_OPERARIO_DIR || path.join(__dirname, '..', 'kairos-operario');
const PORTAL = process.env.KAIROS_PORTAL_DIR || path.join(__dirname, '..', 'kairos-portal');
const CARPETA = '1enNoKd-PkVOHM2cBPtjsOeDkJb4oQH6x';
const OTRA_CARPETA = '1OtraCarpetaQueNoEsLaDeFotos000';

const FOTO1 = 'FOTO00000000000000000001';
const FOTO2 = 'FOTO00000000000000000002';

function semilla() {
  return {
    catalogo: [
      { codigo_lm: 'A', ean: '8412345000011', designacion: 'Artículo A' },
      { codigo_lm: 'B', ean: null, designacion: 'Artículo B' },
      { codigo_lm: 'C', ean: '8412345000033', designacion: 'Artículo C' },
    ],
    usuarios_tienda: [
      { ldap: '100', tienda: '014', rol: 'gestor', aprobado: true },
      { ldap: '101', tienda: '014', rol: 'vendedor', aprobado: true },
      { ldap: '200', tienda: '279', rol: 'gestor', aprobado: true },
      { ldap: '300', tienda: '014', rol: 'gestor', aprobado: false },
    ],
    revisiones_palet: [
      { id: 'r1', tienda_origen: '014', sscc: '00000000000000000001', ubicacion_esperada: '05-A-1-1', estado: 'pendiente', revisar: ['cantidad', 'referencias', 'ubicacion'],
        contenido_esperado: [{ codigo_lm: 'A', designacion: 'Artículo A', cantidad: 5 }, { codigo_lm: 'B', designacion: 'Artículo B', cantidad: 3 }], creada_en: '2026-10-07T08:00:00.000Z', solicitante_ldap: '100' },
      { id: 'r2', tienda_origen: '014', sscc: null, ubicacion_esperada: null, estado: 'en_revision', revisar: ['cantidad', 'referencias', 'ubicacion'],
        contenido_esperado: [{ codigo_lm: 'C', designacion: 'Artículo C', cantidad: null }], creada_en: '2026-10-07T08:05:00.000Z', solicitante_ldap: '100' },
      { id: 'r3', tienda_origen: '014', sscc: '00000000000000000003', ubicacion_esperada: '05-C-3-3', estado: 'revisada', conforme: false, revisar: ['cantidad'],
        contenido_esperado: [{ codigo_lm: 'A', designacion: 'Artículo A', cantidad: 2 }], creada_en: '2026-10-06T08:00:00.000Z', revisada_en: '2026-10-06T10:00:00.000Z', solicitante_ldap: '100',
        resultado: { localizado: true, fotos: [{ id: FOTO1, nombre: 'Revision_014_foto1.jpg' }, { id: FOTO2, nombre: 'Revision_014_foto2.jpg' }] } },
      { id: 'r4', tienda_origen: '279', sscc: '00000000000000000004', estado: 'revisada', conforme: false, revisar: ['cantidad'], contenido_esperado: [], creada_en: '2026-10-06T08:00:00.000Z',
        resultado: { localizado: true, fotos: [{ id: FOTO1, nombre: 'Revision_279_foto.jpg' }] } },
    ],
  };
}

// ——— Drive en memoria: una carpeta de fotos y otra cualquiera ———
function crearDrive() {
  const archivos = {};
  let n = 0;
  const bytesDe = (s) => Array.from(Buffer.from(s, 'base64'));
  function carpeta(id) {
    return {
      getId: () => id,
      createFile: (blob) => {
        n++;
        const fid = 'NUEVA' + String(n).padStart(19, '0');
        archivos[fid] = { id: fid, nombre: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes(), descripcion: '', papelera: false, padres: [id] };
        return archivo(fid);
      },
    };
  }
  function archivo(fid) {
    const a = archivos[fid];
    return {
      getId: () => a.id, getName: () => a.nombre, getDescription: () => a.descripcion, setDescription: (d) => { a.descripcion = d; },
      setTrashed: (v) => { a.papelera = !!v; },
      getParents: () => { let i = 0; return { hasNext: () => i < a.padres.length, next: () => carpeta(a.padres[i++]) }; },
      getBlob: () => ({ getContentType: () => a.mime, getBytes: () => a.bytes }),
    };
  }
  const drive = {
    decodificadas: 0,
    DriveApp: {
      getFolderById: (id) => { if (id !== CARPETA && id !== OTRA_CARPETA) throw new Error('Carpeta no encontrada'); return carpeta(id); },
      getFileById: (id) => { if (!archivos[id]) throw new Error('No se encontró el archivo: ' + id); return archivo(id); },
    },
    Utilities: {
      base64Decode: (s) => { drive.decodificadas++; return bytesDe(s); },
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, nombre) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => nombre }),
      formatDate: () => '20261007-103000',
    },
  };
  // Fotos que ya existen (las de las revisiones r3 y r4), una en la carpeta de fotos y otra cualquiera.
  const sembrar = (id, padre, bytes) => { archivos[id] = { id, nombre: 'ya-estaba-' + id + '.jpg', mime: 'image/jpeg', bytes: bytes || [1, 2, 3], descripcion: '', papelera: false, padres: [padre] }; };
  sembrar(FOTO1, CARPETA, [255, 216, 255, 1]);
  sembrar(FOTO2, CARPETA, [255, 216, 255, 2]);
  return { drive, archivos, sembrar };
}

function entorno(opciones) {
  opciones = opciones || {};
  const datos = semilla();
  if (opciones.ajustar) opciones.ajustar(datos);
  const bd = crearBD(datos);
  const d = crearDrive();
  const ctxBase = { console, JSON, Date, Math, Number, String, Object, Array, Buffer, isFinite, Error, encodeURIComponent, decodeURIComponent, DriveApp: d.drive.DriveApp, Utilities: d.drive.Utilities };
  function cargar(dir, archivos) {
    const ctx = Object.assign({}, ctxBase);
    vm.createContext(ctx);
    archivos.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
    ctx._supaFetch_ = (metodo, tabla, query, payload) => bd.transporte(metodo, tabla, query, payload);
    return ctx;
  }
  const op = cargar(OPERARIO, ['Config.js', 'Utils.js', 'Supabase.js', 'Revisiones.js']);
  const portal = cargar(PORTAL, ['Config.js', 'Utils.js', 'Supabase.js', 'Acceso.js', 'Revisiones.js']);
  const rev = (id) => bd.db.revisiones_palet.find((r) => r.id === id);
  const falla = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  return { op, portal, bd, db: bd.db, drive: d, rev, falla };
}

// Una foto "pequeña" cualquiera, en base64.
const FOTO_B64 = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]).toString('base64');

// ——— EAN ———

test('el operario ve el EAN de cada artículo esperado (sale del catálogo)', () => {
  const e = entorno();
  const filas = JSON.parse(e.op.listarRevisionesTienda('014'));
  const r1 = filas.find((r) => r.id === 'r1');
  assert.deepStrictEqual(r1.contenido_esperado.map((c) => [c.codigo_lm, c.ean || null]), [['A', '8412345000011'], ['B', null]]);
  const r2 = filas.find((r) => r.id === 'r2');
  assert.strictEqual(r2.contenido_esperado[0].ean, '8412345000033', 'también en una búsqueda de artículo sin SSCC');
  assert.ok(!filas.some((r) => r.estado === 'revisada'), 'solo pendientes y en curso');
});

test('una sola consulta al catálogo por pantalla, aunque haya varias revisiones y códigos repetidos', () => {
  const e = entorno();
  e.op.listarRevisionesTienda('014');
  const consultas = e.bd.log.consultas.filter((c) => c.tabla === 'catalogo');
  assert.strictEqual(consultas.length, 1);
  assert.match(consultas[0].query, /select=codigo_lm,ean/);
  assert.ok(!/ean=/.test(consultas[0].query.replace('select=codigo_lm,ean', '')));
});

test('un EAN que ya trae la revisión no se pisa', () => {
  const e = entorno({ ajustar: (d) => { d.revisiones_palet[0].contenido_esperado[0].ean = 'EAN-DE-LA-REVISION'; } });
  const r1 = JSON.parse(e.op.listarRevisionesTienda('014')).find((r) => r.id === 'r1');
  assert.strictEqual(r1.contenido_esperado[0].ean, 'EAN-DE-LA-REVISION');
});

test('si falla el catálogo, la revisión sigue funcionando sin EAN', () => {
  const e = entorno();
  const original = e.op._supaFetch_;
  e.op._supaFetch_ = (metodo, tabla, query, payload) => { if (tabla === 'catalogo') throw new Error('Supabase caído'); return original(metodo, tabla, query, payload); };
  const filas = JSON.parse(e.op.listarRevisionesTienda('014'));
  assert.strictEqual(filas.length, 2);
  assert.ok(filas.every((r) => r.contenido_esperado.every((c) => !c.ean)));
});

test('al tomar una revisión también llega el EAN, y el jefe lo ve en abiertas y diferencias', () => {
  const e = entorno();
  const r = JSON.parse(e.op.tomarRevision('r1', 'Ana'));
  assert.strictEqual(r.contenido_esperado[0].ean, '8412345000011');
  assert.strictEqual(r.estado, 'en_revision');
  const jefe = JSON.parse(e.op.listarRevisionesJefe());
  const abierta = jefe.abiertas.find((x) => x.id === 'r1');
  assert.strictEqual(abierta.contenido_esperado[0].ean, '8412345000011');
  const dif = jefe.diferencias.find((x) => x.id === 'r3');
  assert.strictEqual(dif.contenido_esperado[0].ean, '8412345000011');
});

test('una revisión sin contenido esperado no consulta el catálogo', () => {
  const e = entorno({ ajustar: (d) => { d.revisiones_palet = d.revisiones_palet.filter((r) => r.id === 'r4').map((r) => Object.assign(r, { estado: 'pendiente' })); } });
  e.op.listarRevisionesTienda('279');
  assert.strictEqual(e.bd.log.consultas.filter((c) => c.tabla === 'catalogo').length, 0);
});

// ——— Subir fotos ———

test('subir una foto la guarda en la carpeta de Drive con un nombre que dice dónde y cuándo', () => {
  const e = entorno();
  const r = JSON.parse(e.op.subirFotoRevision('r1', 'Ana López', 'data:image/jpeg;base64,' + FOTO_B64, 'image/jpeg'));
  const f = e.drive.archivos[r.id];
  assert.ok(f, 'el archivo existe');
  assert.deepStrictEqual(f.padres, [CARPETA], 'en la carpeta FotosRevisionStock');
  assert.match(r.nombre, /^Revision_014_SSCC-00000000000000000001_20261007-103000_Ana-Lopez_[0-9a-z]{4}\.jpg$/);
  assert.strictEqual(f.nombre, r.nombre);
  assert.strictEqual(f.mime, 'image/jpeg');
  assert.deepStrictEqual(f.bytes, Array.from(Buffer.from(FOTO_B64, 'base64')), 'se guardan los bytes tal cual');
  assert.strictEqual(f.descripcion, 'rev:r1 · Ana López');
});

test('en una búsqueda de artículo (sin SSCC) el nombre lleva el código LM', () => {
  const e = entorno();
  const r = JSON.parse(e.op.subirFotoRevision('r2', 'Pedro.S', FOTO_B64, 'image/png'));
  assert.match(r.nombre, /^Revision_014_LM-C_20261007-103000_Pedro.S_[0-9a-z]{4}\.png$/);
});

test('subir fotos: se rechazan formato raro, foto vacía, demasiado grande, sin nombre, revisión inexistente o ya terminada', () => {
  const e = entorno();
  const sube = (id, op, b64, mime) => e.falla(() => e.op.subirFotoRevision(id, op, b64, mime));
  assert.match(sube('r1', 'Ana', FOTO_B64, 'application/pdf'), /Formato de imagen no válido/);
  assert.match(sube('r1', 'Ana', FOTO_B64, ''), /Formato de imagen no válido/);
  assert.match(sube('r1', 'Ana', '', 'image/jpeg'), /vacía/);
  assert.match(sube('r1', 'Ana', 'data:image/jpeg;base64,', 'image/jpeg'), /vacía/);
  assert.match(sube('r1', '', FOTO_B64, 'image/jpeg'), /Selecciona tu nombre/);
  assert.match(sube('r1', '   ', FOTO_B64, 'image/jpeg'), /Selecciona tu nombre/);
  e.drive.drive.decodificadas = 0;
  assert.match(sube('r1', 'Ana', 'A'.repeat(9 * 1024 * 1024), 'image/jpeg'), /demasiado grande/);
  assert.strictEqual(e.drive.drive.decodificadas, 0, 'una foto enorme se rechaza antes de decodificarla');
  assert.match(sube('NO-EXISTE', 'Ana', FOTO_B64, 'image/jpeg'), /Revisión no encontrada/);
  assert.match(sube('r3', 'Ana', FOTO_B64, 'image/jpeg'), /ya está terminada/);
  assert.ok(!Object.keys(e.drive.archivos).some((k) => k.startsWith('NUEVA')), 'ninguna creó archivo');
});

test('quitar una foto recién subida la manda a la papelera, solo si es de esa revisión y sigue abierta', () => {
  const e = entorno();
  const f = JSON.parse(e.op.subirFotoRevision('r1', 'Ana', FOTO_B64, 'image/jpeg'));
  assert.strictEqual(JSON.parse(e.op.quitarFotoRevision('r2', f.id)).ok, false, 'de otra revisión: no');
  assert.strictEqual(e.drive.archivos[f.id].papelera, false);
  assert.strictEqual(JSON.parse(e.op.quitarFotoRevision('r1', f.id)).ok, true);
  assert.strictEqual(e.drive.archivos[f.id].papelera, true);
  // una foto ajena a las revisiones (sin la marca) o de una revisión terminada no se toca
  assert.strictEqual(JSON.parse(e.op.quitarFotoRevision('r3', FOTO1)).ok, false);
  assert.strictEqual(e.drive.archivos[FOTO1].papelera, false);
  assert.strictEqual(JSON.parse(e.op.quitarFotoRevision('r1', FOTO1)).ok, false, 'sin la marca de r1 en la descripción');
  assert.strictEqual(e.drive.archivos[FOTO1].papelera, false);
  // aunque lleve la marca de su revisión, si la revisión ya se terminó la foto es parte del resultado: no se toca
  e.drive.archivos[FOTO2].descripcion = 'rev:r3 · Ana';
  assert.strictEqual(JSON.parse(e.op.quitarFotoRevision('r3', FOTO2)).ok, false);
  assert.strictEqual(e.drive.archivos[FOTO2].papelera, false);
});

// ——— Guardar las fotos al terminar la revisión ———

const COMPLETA_R1 = (extra) => Object.assign({ localizado: true, ubicacionOk: true, lineas: [{ codigo_lm: 'A', contada: 5 }, { codigo_lm: 'B', contada: 3 }] }, extra || {});

test('al terminar la revisión las fotos se guardan en el resultado (id y nombre)', () => {
  const e = entorno();
  const f1 = JSON.parse(e.op.subirFotoRevision('r1', 'Ana', FOTO_B64, 'image/jpeg'));
  const f2 = JSON.parse(e.op.subirFotoRevision('r1', 'Ana', FOTO_B64, 'image/jpeg'));
  const res = JSON.parse(e.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1({ fotos: [f1.id, f2.id] })));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.conforme, true);
  const guardado = e.rev('r1').resultado;
  assert.deepStrictEqual(guardado.fotos, [{ id: f1.id, nombre: f1.nombre }, { id: f2.id, nombre: f2.nombre }]);
});

test('también se guardan cuando el palet no se localiza', () => {
  const e = entorno();
  const f = JSON.parse(e.op.subirFotoRevision('r1', 'Ana', FOTO_B64, 'image/jpeg'));
  e.op.completarRevisionPalet('r1', 'Ana', { localizado: false, motivo: 'no_en_plataforma', fotos: [f.id] });
  assert.strictEqual(e.rev('r1').resultado.localizado, false);
  assert.deepStrictEqual(e.rev('r1').resultado.fotos.map((x) => x.id), [f.id]);
});

test('sin fotos el resultado queda como siempre (sin la clave fotos)', () => {
  const e = entorno();
  e.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1());
  assert.ok(!('fotos' in e.rev('r1').resultado));
  const e2 = entorno();
  e2.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1({ fotos: [] }));
  assert.ok(!('fotos' in e2.rev('r1').resultado));
  const e3 = entorno();
  e3.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1({ fotos: 'no-es-una-lista' }));
  assert.ok(!('fotos' in e3.rev('r1').resultado));
});

test('no vale un id que no sea de la carpeta de fotos, ni mal formado, ni inexistente', () => {
  const e = entorno();
  e.drive.sembrar('AJENA00000000000000000001', OTRA_CARPETA);
  const completa = (fotos) => e.falla(() => e.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1({ fotos: fotos })));
  assert.match(completa(['AJENA00000000000000000001']), /no es válida/);
  assert.match(completa(['corto']), /no es válida/);
  assert.match(completa(['../../etc/passwd-passwd-passwd']), /no es válida/);
  assert.match(completa(['']), /no es válida/);
  assert.match(completa(['NOEXISTE00000000000000001']), /No se ha podido comprobar/);
  assert.strictEqual(e.rev('r1').estado, 'pendiente', 'la revisión no se terminó con fotos dudosas');
  assert.ok(!e.bd.log.patches.some((p) => p.tabla === 'revisiones_palet'));
});

test('máximo 3 fotos y sin repetir', () => {
  const e = entorno();
  const ids = [1, 2, 3, 4].map(() => JSON.parse(e.op.subirFotoRevision('r1', 'Ana', FOTO_B64, 'image/jpeg')).id);
  e.op.completarRevisionPalet('r1', 'Ana', COMPLETA_R1({ fotos: [ids[0], ids[0], ids[1], ids[2], ids[3]] }));
  const guardadas = e.rev('r1').resultado.fotos.map((f) => f.id);
  assert.deepStrictEqual(guardadas, [ids[0], ids[1]], 'se recorta a 3 ANTES de quitar repetidos: [0,0,1] -> [0,1]');
});

// ——— Leer las fotos ———

test('el jefe de equipo carga una foto con el id guardado en la base de datos, nunca el que mande el cliente', () => {
  const e = entorno();
  const r = JSON.parse(e.op.obtenerFotoRevision('r3', 1));
  assert.strictEqual(r.mime, 'image/jpeg');
  assert.strictEqual(r.datos, Buffer.from([255, 216, 255, 2]).toString('base64'), 'la segunda foto de r3');
  assert.strictEqual(r.nombre, 'Revision_014_foto2.jpg');
  assert.match(e.falla(() => e.op.obtenerFotoRevision('r3', 5)), /no existe/);
  assert.match(e.falla(() => e.op.obtenerFotoRevision('r3', 'abc')), /no existe/);
  assert.match(e.falla(() => e.op.obtenerFotoRevision('NO-EXISTE', 0)), /no encontrada/);
  assert.match(e.falla(() => e.op.obtenerFotoRevision('r1', 0)), /no existe/, 'una revisión sin fotos');
});

test('tienda ve las fotos de SUS revisiones y de ninguna otra', () => {
  const e = entorno();
  const r = JSON.parse(e.portal.obtenerFotoRevision('100', 'r3', 0));
  assert.strictEqual(r.datos, Buffer.from([255, 216, 255, 1]).toString('base64'));
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('100', 'r4', 0)), /Revisión no encontrada/, 'r4 es de la tienda 279');
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('200', 'r3', 0)), /Revisión no encontrada/, 'y r3 de la 014');
  assert.strictEqual(JSON.parse(e.portal.obtenerFotoRevision('200', 'r4', 0)).nombre, 'Revision_279_foto.jpg');
});

test('tienda: el vendedor, un usuario sin aprobar o desconocido y una foto inexistente se rechazan', () => {
  const e = entorno();
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('101', 'r3', 0)), /Vendedor/);
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('300', 'r3', 0)), /no autorizado/);
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('999', 'r3', 0)), /no autorizado/);
  assert.match(e.falla(() => e.portal.obtenerFotoRevision('100', 'r3', 7)), /no existe/);
});

test('el portal sigue mandando el resultado con las fotos a su lista de revisiones', () => {
  const e = entorno();
  const filas = JSON.parse(e.portal.listarMisRevisiones('100'));
  const r3 = filas.find((r) => r.id === 'r3');
  assert.strictEqual(r3.resultado.fotos.length, 2);
  assert.ok(!filas.some((r) => r.id === 'r4'));
});

// ——— Pantalla del operario: fotos ———

function pantalla() {
  const html = fs.readFileSync(path.join(OPERARIO, 'FotosRevisionUI.html'), 'utf8');
  const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elementos = {};
  const llamadas = [];
  const el = (id) => elementos[id] || (elementos[id] = { id, innerHTML: '', textContent: '', disabled: false, onclick: null, onchange: null, files: [], value: '', clicks: 0, click() { this.clicks++; } });
  const lienzos = [];
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, Error, isFinite,
    OPERARIO: 'Ana',
    document: {
      getElementById: (id) => el(id),
      createElement: (t) => {
        const c = { tag: t, width: 0, height: 0, getContext: () => ({ drawImage: (img, x, y, w, h) => { c.dibujado = [w, h]; } }), toDataURL: (tipo, q) => 'data:' + tipo + ';base64,' + (c.width >= 1000 ? 'GRANDE' : 'CHICA') + c.width + 'x' + c.height + 'q' + q };
        lienzos.push(c);
        return c;
      },
    },
    FileReader: function () { this.readAsDataURL = (f) => { if (f.corrupto) { this.onerror(); return; } this.result = 'data:image/jpeg;base64,ORIGINAL'; this.onload(); }; },
    Image: function () { const self = this; Object.defineProperty(this, 'src', { set(v) { if (ctx.__imagenMala) self.onerror(); else { self.naturalWidth = ctx.__ancho; self.naturalHeight = ctx.__alto; self.onload(); } } }); },
    kAlerta: (m) => { ctx.__alertas.push(m); },
    __alertas: [], __ancho: 4032, __alto: 3024, __imagenMala: false,
  };
  const make = (okf, failf) => new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (f) => make(f, failf);
    if (name === 'withFailureHandler') return (f) => make(okf, f);
    return (...args) => { llamadas.push({ name, args, ok: okf, fail: failf }); };
  } });
  ctx.google = { script: { run: make(null, null) } };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'FotosRevisionUI.html' });
  ctx.FOT_conectar_('r1');
  return { ctx, llamadas, el, lienzos };
}
const copia = (x) => JSON.parse(JSON.stringify(x));

test('pantalla: la foto se reduce a 1600 px de lado mayor (sin ampliar nunca) y se manda como JPEG', () => {
  const { ctx } = pantalla();
  assert.deepStrictEqual(copia(ctx.FOT_dimensiones_(4032, 3024, 1600)), { ancho: 1600, alto: 1200 });
  assert.deepStrictEqual(copia(ctx.FOT_dimensiones_(3024, 4032, 1600)), { ancho: 1200, alto: 1600 }, 'vertical');
  assert.deepStrictEqual(copia(ctx.FOT_dimensiones_(800, 600, 1600)), { ancho: 800, alto: 600 }, 'una foto pequeña no se amplía');
  assert.deepStrictEqual(copia(ctx.FOT_dimensiones_(0, 0, 1600)), { ancho: 1, alto: 1 }, 'sin romper con una imagen sin tamaño');
  const { ctx: c2, llamadas } = pantalla();
  c2.FOT_alElegir_({ name: 'f.jpg' }, 'r1');
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].name, 'subirFotoRevision');
  assert.deepStrictEqual([llamadas[0].args[0], llamadas[0].args[1], llamadas[0].args[3]], ['r1', 'Ana', 'image/jpeg']);
  assert.strictEqual(llamadas[0].args[2], 'GRANDE1600x1200q0.72', 'JPEG de 1600x1200 a calidad 0,72, sin la cabecera data:');
});

test('pantalla: elegir foto la sube al momento; al terminar queda subida con su id', () => {
  const { ctx, llamadas, el } = pantalla();
  ctx.FOT_alElegir_({ name: 'f.jpg' }, 'r1');
  assert.strictEqual(ctx.REVISION_FOTOS_[0].estado, 'subiendo');
  assert.match(el('fotosRevLista').innerHTML, /Subiendo…/);
  assert.match(ctx.FOT_motivoNoTerminar_(), /Espera a que termine/);
  llamadas[0].ok(JSON.stringify({ id: 'FOTO0000000000000000AAAA', nombre: 'x.jpg' }));
  assert.strictEqual(ctx.REVISION_FOTOS_[0].estado, 'ok');
  assert.strictEqual(ctx.REVISION_FOTOS_[0].datos, null, 'se libera la foto grande de memoria');
  assert.match(el('fotosRevLista').innerHTML, /✓ Subida/);
  assert.strictEqual(ctx.FOT_motivoNoTerminar_(), null);
  assert.deepStrictEqual(copia(ctx.FOT_ids_()), ['FOTO0000000000000000AAAA']);
});

test('pantalla: si la subida falla se puede reintentar sin volver a hacer la foto, y mientras no se resuelva no se termina', () => {
  const { ctx, llamadas, el } = pantalla();
  ctx.FOT_alElegir_({ name: 'f.jpg' }, 'r1');
  llamadas[0].fail({ message: 'Sin cobertura' });
  assert.strictEqual(ctx.REVISION_FOTOS_[0].estado, 'error');
  assert.match(el('fotosRevLista').innerHTML, /No se subió/);
  assert.match(el('fotosRevLista').innerHTML, /data-fot-reintentar/);
  assert.match(ctx.FOT_motivoNoTerminar_(), /no se ha subido/);
  assert.deepStrictEqual(copia(ctx.FOT_ids_()), []);
  // reintentar manda LA MISMA foto
  const n = ctx.REVISION_FOTOS_[0].n;
  el('fotosRevLista').onclick({ target: { getAttribute: (a) => (a === 'data-fot-reintentar' ? String(n) : null) } });
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[1].args[2], llamadas[0].args[2]);
  llamadas[1].ok(JSON.stringify({ id: 'FOTO0000000000000000BBBB', nombre: 'x.jpg' }));
  assert.deepStrictEqual(copia(ctx.FOT_ids_()), ['FOTO0000000000000000BBBB']);
  assert.strictEqual(ctx.FOT_motivoNoTerminar_(), null);
});

test('pantalla: máximo 3 fotos; con 3 el botón se apaga y una cuarta se ignora', () => {
  const { ctx, llamadas, el } = pantalla();
  for (let i = 0; i < 4; i++) ctx.FOT_alElegir_({ name: 'f' + i + '.jpg' }, 'r1');
  assert.strictEqual(ctx.REVISION_FOTOS_.length, 3);
  assert.strictEqual(llamadas.length, 3);
  assert.strictEqual(el('fotoRevBoton').disabled, true);
  assert.match(el('fotoRevMensaje').textContent, /Ya tienes 3 fotos/);
});

test('pantalla: quitar una foto subida la manda a la papelera; una que aún sube o falló no llama al servidor', () => {
  const { ctx, llamadas, el } = pantalla();
  ctx.FOT_alElegir_({ name: 'a.jpg' }, 'r1'); ctx.FOT_alElegir_({ name: 'b.jpg' }, 'r1'); ctx.FOT_alElegir_({ name: 'c.jpg' }, 'r1');
  llamadas[0].ok(JSON.stringify({ id: 'FOTO0000000000000000AAAA' }));
  llamadas[1].fail({ message: 'x' });
  const [a, b, c] = ctx.REVISION_FOTOS_.map((f) => f.n);
  const quitar = (n) => el('fotosRevLista').onclick({ target: { getAttribute: (x) => (x === 'data-fot-quitar' ? String(n) : null) } });
  quitar(c);                       // aún subiendo: no se puede quitar
  assert.strictEqual(ctx.REVISION_FOTOS_.length, 3);
  quitar(b);                       // con error: se quita sin avisar al servidor
  assert.strictEqual(ctx.REVISION_FOTOS_.length, 2);
  assert.ok(!llamadas.some((l) => l.name === 'quitarFotoRevision'));
  quitar(a);                       // subida: a la papelera
  const q = llamadas.find((l) => l.name === 'quitarFotoRevision');
  assert.deepStrictEqual([q.args[0], q.args[1]], ['r1', 'FOTO0000000000000000AAAA']);
  assert.strictEqual(ctx.REVISION_FOTOS_.length, 1);
  assert.strictEqual(el('fotoRevBoton').disabled, false);
});

test('pantalla: una foto que no se puede leer o abrir se avisa y no deja nada a medias', () => {
  const a = pantalla();
  a.ctx.FOT_alElegir_({ name: 'rota.jpg', corrupto: true }, 'r1');
  assert.strictEqual(a.ctx.REVISION_FOTOS_.length, 0);
  assert.match(a.ctx.__alertas[0], /No se ha podido leer/);
  const b = pantalla();
  b.ctx.__imagenMala = true;
  b.ctx.FOT_alElegir_({ name: 'rara.heic' }, 'r1');
  assert.strictEqual(b.ctx.REVISION_FOTOS_.length, 0);
  assert.match(b.ctx.__alertas[0], /no se puede abrir/);
  assert.strictEqual(b.llamadas.length, 0, 'no se sube nada');
});

test('pantalla: el selector de archivos no se queda con la foto anterior (así se puede elegir la misma otra vez)', () => {
  const { ctx, el, llamadas } = pantalla();
  const campo = el('fotoRevInput');
  campo.files = [{ name: 'x.jpg' }]; campo.value = 'C:\\fakepath\\x.jpg';
  campo.onchange();
  assert.strictEqual(campo.value, '');
  assert.strictEqual(llamadas.length, 1);
  el('fotoRevBoton').onclick();
  assert.strictEqual(campo.clicks, 1);
  campo.files = []; campo.onchange();
  assert.strictEqual(llamadas.length, 1, 'sin archivo no hace nada');
});

test('pantalla: el bloque de fotos usa un selector de imágenes sin la barra y el asterisco que cortan la página', () => {
  const { ctx } = pantalla();
  const h = ctx.FOT_bloqueHtml_();
  assert.match(h, /type="file" id="fotoRevInput" accept="image\/&#42;"/);
  assert.ok(!h.includes('/*'));
  const html = fs.readFileSync(path.join(OPERARIO, 'FotosRevisionUI.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(!/(['"`])[^'"`\n]*\/\*[^'"`\n]*\1/.test(script), 'una cadena del script contiene "/" seguido de "*"');
});

test('pantalla: ver las fotos de una revisión terminada las carga de una en una al pedirlo', () => {
  const { ctx, llamadas } = pantalla();
  const contenedor = { innerHTML: '', datos: {}, setAttribute(k, v) { this.datos[k] = v; }, insertAdjacentHTML(_, h) { this.innerHTML += h; } };
  const boton = { disabled: false, attrs: {}, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, parentNode: { querySelector: () => contenedor } };
  ctx.FOT_verFotos_('r3', 2, boton);
  assert.strictEqual(llamadas.length, 1, 'solo pide la primera');
  assert.deepStrictEqual([llamadas[0].name, llamadas[0].args[0], llamadas[0].args[1]], ['obtenerFotoRevision', 'r3', 0]);
  ctx.FOT_verFotos_('r3', 2, boton);
  assert.strictEqual(llamadas.length, 1, 'un segundo clic no repite');
  llamadas[0].ok(JSON.stringify({ mime: 'image/jpeg', datos: 'AAAA', nombre: 'x' }));
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[1].args[1], 1);
  llamadas[1].fail({ message: 'Drive caído' });
  assert.match(contenedor.innerHTML, /<img alt="Foto 1" src="data:image\/jpeg;base64,AAAA">/);
  assert.match(contenedor.innerHTML, /No se ha podido cargar la foto 2: Drive caído/);
  assert.strictEqual(boton.disabled, true);
});

// ——— Enganche en Index.html y Portal.html ———

test('Index.html: EAN en la lista y el detalle, bloque de fotos, bloqueo al terminar y fotos al jefe', () => {
  const index = fs.readFileSync(path.join(OPERARIO, 'Index.html'), 'utf8');
  assert.match(index, /<\?!= incluir_\('FotosRevisionUI'\) \?>/);
  assert.match(index, /c\.ean \? '<br><span class="rev-ean">EAN <b>'/, 'lista de revisiones');
  assert.match(index, /c\.ean \? '<div class="rev-ean">EAN <b>'.*Sin EAN en el catálogo/, 'detalle');
  assert.match(index, /FOT_bloqueHtml_\(\) \+\s*'<h3>Nota<\/h3>'/);
  assert.match(index, /FOT_conectar_\(r\.id\);/);
  assert.match(index, /const motivoFoto = FOT_motivoNoTerminar_\(\);\s*if \(motivoFoto\) \{ kAlerta\(motivoFoto\); return; \}/);
  assert.match(index, /resultado\.fotos = FOT_ids_\(\);/);
  assert.strictEqual((index.match(/FOT_reiniciar_\(\);/g) || []).length, 2, 'al abrir una revisión y al terminarla');
  assert.match(index, /return h \+ fotosResumenHtml_\(r\);/, 'las fotos también salen en un palet no localizado');
  assert.match(index, /h \+= fotosResumenHtml_\(r\);\s*return h;/);
  const nombres = fs.readdirSync(OPERARIO).map((f) => f.replace(/\.(js|html)$/, ''));
  assert.strictEqual(new Set(nombres).size, nombres.length, 'dos archivos con el mismo nombre base');
});

test('Portal.html: el detalle de la revisión carga las fotos del operario al abrirlo', () => {
  const portal = fs.readFileSync(path.join(PORTAL, 'Portal.html'), 'utf8');
  assert.match(portal, /kAlerta\(detalleRevisionHtml_\(r\)\); cargarFotosRevision_\(r\);/);
  assert.match(portal, /gas\('obtenerFotoRevision', LDAP, r\.id, n\)/);
  assert.strictEqual((portal.match(/\+ fotosRevisionHtml_\(r\)/g) || []).length, 2, 'en el resultado normal y en el de no localizado');
});
