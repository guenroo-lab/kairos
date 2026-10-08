// "PostgREST" en memoria para las pruebas del operario y del portal: interpreta las consultas reales (filtros
// eq/neq/in/gte/gt/is.null/not.*, select con columnas, cruces peticiones!inner, order por id, limit) y los PATCH.
// Como PostgREST, solo llegan las columnas del select: una consulta que olvide pedir una columna que luego usa se nota.

function predicadoDe(clave, valor) {
  let negar = false;
  let v = valor;
  if (v.startsWith('not.')) { negar = true; v = v.slice(4); }
  let fn;
  if (v === 'is.null') fn = (r) => r[clave] == null;
  else if (v.startsWith('eq.')) { const x = decodeURIComponent(v.slice(3)); fn = (r) => r[clave] != null && String(r[clave]) === x; }
  else if (v.startsWith('neq.')) { const x = decodeURIComponent(v.slice(4)); fn = (r) => r[clave] != null && String(r[clave]) !== x; }
  else if (v.startsWith('in.(')) { const xs = v.slice(4, -1).split(',').map(decodeURIComponent); fn = (r) => r[clave] != null && xs.indexOf(String(r[clave])) !== -1; }
  else if (v.startsWith('gte.')) { const x = decodeURIComponent(v.slice(4)); fn = (r) => r[clave] != null && String(r[clave]) >= x; }
  else if (v.startsWith('gt.')) { const x = decodeURIComponent(v.slice(3)); fn = (r) => r[clave] != null && String(r[clave]) > x; }
  else if (v.startsWith('lte.')) { const x = decodeURIComponent(v.slice(4)); fn = (r) => r[clave] != null && String(r[clave]) <= x; }
  else if (v.startsWith('lt.')) { const x = decodeURIComponent(v.slice(3)); fn = (r) => r[clave] != null && String(r[clave]) < x; }
  else throw new Error('filtro no soportado en la BD de pruebas: ' + clave + '=' + valor);
  return negar ? (r) => !fn(r) : fn;
}

function crearBD(datos) {
  const db = JSON.parse(JSON.stringify(datos));
  const log = { patches: [], consultas: [] };

  function filtrar(tabla, query) {
    const pares = String(query || '').split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; });
    let limite = null, select = '', orden = null;
    const propios = [], embebidos = [];
    pares.forEach(([k, v]) => {
      if (k === 'select') { select = v; return; }
      if (k === 'order') { orden = v; return; }
      if (k === 'limit') { limite = Number(v); return; }
      if (k.startsWith('peticiones.')) embebidos.push(predicadoDe(k.slice('peticiones.'.length), v));
      else propios.push(predicadoDe(k, v));
    });
    const cruce = /peticiones!inner\(([^)]*)\)/.exec(select);
    let filas = (db[tabla] || []).filter((r) => propios.every((f) => f(r)));
    if (cruce || embebidos.length) {
      filas = filas.map((r) => {
        const p = db.peticiones.find((x) => x.id === r.peticion_id);
        if (!p || !embebidos.every((f) => f(p))) return null;
        const incrustada = {};
        (cruce ? cruce[1].split(',') : []).forEach((c) => { incrustada[c] = p[c]; });
        return { fila: r, incrustada, conCruce: !!cruce };
      }).filter(Boolean);
    } else {
      filas = filas.map((r) => ({ fila: r, incrustada: null, conCruce: false }));
    }
    // order=campo.asc|desc (por defecto, por id)
    const [campo, sentido] = orden ? orden.split('.') : ['id', 'asc'];
    filas.sort((a, b) => {
      const x = String(a.fila[campo]), y = String(b.fila[campo]);
      return (x < y ? -1 : x > y ? 1 : 0) * (sentido === 'desc' ? -1 : 1);
    });
    if (limite != null) filas = filas.slice(0, limite);
    return { filas, select };
  }

  function consultar(tabla, query) {
    log.consultas.push({ tabla, query });
    const { filas, select } = filtrar(tabla, query);
    const columnas = select.replace(/peticiones!inner\([^)]*\)/, '').split(',').map((c) => c.trim()).filter(Boolean);
    return JSON.parse(JSON.stringify(filas.map(({ fila, incrustada, conCruce }) => {
      let r = fila;
      if (columnas.length && columnas.indexOf('*') === -1) {
        r = {};
        columnas.forEach((c) => { if (c in fila) r[c] = fila[c]; });
      }
      return conCruce ? Object.assign({}, r, { peticiones: incrustada }) : r;
    })));
  }

  function transporte(metodo, tabla, query, payload) {
    if (metodo === 'GET') return consultar(tabla, query);
    if (metodo === 'PATCH') {
      const { filas } = filtrar(tabla, query);
      filas.forEach(({ fila }) => { Object.assign(fila, JSON.parse(JSON.stringify(payload))); });
      log.patches.push({ tabla, query, payload, filas: filas.length });
      return JSON.parse(JSON.stringify(filas.map((f) => f.fila)));
    }
    if (metodo === 'POST') {
      // Como la BD de verdad: ids y estados por defecto; las filas nuevas se guardan tal cual llegan.
      const lista = Array.isArray(payload) ? payload : [payload];
      const creadas = lista.map((f) => {
        log.contador = (log.contador || 0) + 1;
        const base = tabla === 'peticiones'
          ? { id: 'PET-' + log.contador, estado: 'pendiente', creada_en: new Date().toISOString() }
          : tabla === 'lineas' ? { id: 'LIN-' + String(log.contador).padStart(3, '0'), estado_preparacion: 'pendiente' } : { id: tabla + '-' + log.contador };
        const fila = Object.assign(base, JSON.parse(JSON.stringify(f)));
        (db[tabla] = db[tabla] || []).push(fila);
        return fila;
      });
      log.inserts = (log.inserts || []).concat([{ tabla, filas: creadas }]);
      return JSON.parse(JSON.stringify(creadas));
    }
    if (metodo === 'DELETE') {
      const { filas } = filtrar(tabla, query);
      const ids = filas.map((f) => f.fila.id);
      db[tabla] = db[tabla].filter((r) => ids.indexOf(r.id) === -1);
      return JSON.parse(JSON.stringify(filas.map((f) => f.fila)));
    }
    throw new Error('método no soportado en la BD de pruebas: ' + metodo);
  }
  return { db, log, transporte };
}

module.exports = { crearBD, predicadoDe };
