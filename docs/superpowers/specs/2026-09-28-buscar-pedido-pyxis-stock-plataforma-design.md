# Pieza 13: Buscar por pedido + stock en plataforma — Design

## Contexto

Idea del usuario: en la creación de un `pedido_cliente`/`cesión` en
`kairos-portal`, poder buscar directamente por el número de pedido cliente
(en vez de escribir/escanear cada EAN a mano) y ver de un vistazo qué
artículos de ese pedido hay en plataforma, para pedirlos en bloque.

Verificado contra datos reales (no asumido):
- El archivo con esa información es Pyxis, `014.xlsx` (Marbella) /
  `279.xlsx` (Mijas), carpeta de Drive `Inventarios_Plataforma`
  (`1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG` — la misma carpeta donde vive
  `pedidos_totales_2.csv`, que usa INCPC, pero **no** es el mismo archivo).
  Título interno: "Listado Inventario Pedido Cliente". Columnas reales:
  `Dirección, Nº Ped, Sección, Subsección, Ref., Código EAN, Designación,
  Ctd Recep., Código C1, Total línea, Nº Prov., Fecha Entre.` Se
  regenera 1 vez al día (visto: ambos archivos con `modifiedTime`
  07:16–07:17 del mismo día).
- Ya existe en el ecosistema Taisa un importador de este mismo formato:
  `lm_produccion/ImportarPyxis.gs` (app "Última Milla"). Se reutiliza su
  técnica de lectura (conversión xlsx→Sheets) y su regla de deduplicado
  (ver `B.3`), no su lógica de negocio (transportistas, clasificación de
  ubicación de picking/cantilever — eso es propio de Última Milla y no
  aplica a Kairos).
- El "stock en plataforma" ya existe en Kairos: `preparacion.stock_fisico`
  (snapshot diario, `kairos-sync/StockFisicoLoader.js`) + el cálculo de
  remanente de `kairos-operario/StockAsignacion.js`. Pero ese cálculo
  tiene un límite conocido y documentado
  (`Kairos/supabase/README.md:106-113`) que hay que cerrar primero,
  porque la nueva búsqueda va a enseñar ese mismo número al usuario — si
  sigue mal, la nueva pantalla lo hace más visible, no lo tapa.

## Objetivo

Dos partes, en este orden:
- **Parte A**: cerrar el límite conocido del cálculo de remanente cuando un
  refill se lleva un palet entero.
- **Parte B**: nueva opción "buscar por pedido" en la creación de
  pedido cliente/cesión de `kairos-portal`, que añade en bloque los
  artículos del pedido que SÍ hay en plataforma.

No cambia la forma de crear peticiones que ya existe (EAN manual +
escáner) — la nueva búsqueda es una vía más para rellenar el mismo
carrito (`lineas[]`) que ya usa `crearPeticion`.

---

## Parte A — Cierre del límite del refill

### A.1 Causa raíz (confirmada leyendo el código)

En `kairos-operario/StockAsignacion.js`, el remanente de un palet para
OTRAS líneas del mismo código se calcula restando lo "comprometido" desde
el último sync (`_usoComprometidoPorSscc_`), que se saca parseando
`lineas.sscc` con `_parseSsccMulti_`. Ese parser reconoce dos formatos:
- `"sscc1 (Xud) + sscc2 (Yud)"` → usa las cantidades del propio string.
- Un sscc suelto, sin sufijo → cae al *fallback* y usa `linea.cantidad`.

El reparto normal (`_repartirEntreCandidatos_`, pedido_cliente/cesión,
línea 101) **siempre** escribe con sufijo `(Xud)`, incluso para un único
palet — por eso ahí el remanente ya sale bien.

Refill **no** usa ese formato en ninguno de sus dos caminos de escritura:
- Auto (`_asignarSsccSiFalta_`, línea 154):
  `resultado = { sscc: c.sscc, ubicacion: c.ubicacion }` — sin sufijo.
- Manual, "🔄 Cambiar palet" (`cambiarPaletLinea`, línea 207 — confirmado
  que también se usa en refill, comentario `Index.html:794-797`): guarda
  el `sscc` tal cual llega del frontend, también sin sufijo.

En los dos casos, otra línea que calcule remanente para ese mismo código
cae al fallback y resta `linea.cantidad` de la línea de refill — que en
refill no es la cantidad física del palet (refill se lleva el palet
entero, sin preguntar cantidad), así que el remanente calculado queda
muy por encima del real.

### A.2 Fix

Mismo patrón que ya usa el reparto normal, sin campo nuevo ni migración:
escribir siempre `sscc + ' (' + cantidadReal + 'ud)'` cuando la línea es
de refill.

**`_asignarSsccSiFalta_`** (auto) — cambio en el branch de refill:

```js
if (peticion.tipo === 'refill') {
  const c = candidatos.filter(function (x) { return x.cantidad > 0; })[0];
  if (!c) throw new Error('Sin palet disponible para el código ' + linea.codigo_lm + '.');
  resultado = { sscc: c.sscc + ' (' + c.cantidad + 'ud)', ubicacion: c.ubicacion };
}
```

**`cambiarPaletLinea`** (manual) — hoy no sabe qué tipo de petición es la
línea ni la cantidad real del palet elegido; hay que consultarlo antes de
guardar:

```js
function cambiarPaletLinea(lineaId, sscc, ubicacion) {
  sscc = String(sscc || '').trim();
  ubicacion = String(ubicacion || '').trim();
  if (!sscc || !ubicacion) throw new Error('Falta el SSCC o la ubicación del palet elegido.');

  const lineaFilas = supaSelect_('lineas', 'id=eq.' + encodeURIComponent(lineaId) + '&select=id,codigo_lm,peticion_id');
  if (!lineaFilas.length) throw new Error('Línea no encontrada.');
  const linea = lineaFilas[0];

  const peticionFilas = supaSelect_('peticiones', 'id=eq.' + encodeURIComponent(linea.peticion_id) + '&select=tipo,tienda_origen');
  if (!peticionFilas.length) throw new Error('Petición no encontrada.');
  const peticion = peticionFilas[0];

  var ssccGuardar = sscc;
  if (peticion.tipo === 'refill') {
    // Refill se lleva el palet ENTERO: hay que guardar la cantidad real del
    // palet en el propio string de sscc (mismo formato que el reparto
    // normal), si no el cálculo de remanente de otras líneas vuelve a
    // quedarse corto (ver StockAsignacion.js, límite conocido cerrado aquí).
    const candidato = supaSelect_('stock_fisico',
      'tienda=eq.' + encodeURIComponent(peticion.tienda_origen) +
      '&codigo_lm=eq.' + encodeURIComponent(linea.codigo_lm) +
      '&sscc=eq.' + encodeURIComponent(sscc));
    if (!candidato.length) throw new Error('No se pudo verificar la cantidad de ese palet, prueba de nuevo.');
    ssccGuardar = sscc + ' (' + candidato[0].cantidad + 'ud)';
  }

  const filas = supaUpdate_('lineas', 'id=eq.' + encodeURIComponent(lineaId), {
    sscc: ssccGuardar,
    ubicacion: ubicacion,
    sscc_asignado_en: new Date().toISOString(),
  });
  if (!filas.length) throw new Error('Línea no encontrada.');
  return _json_({ ok: true });
}
```

Para pedido_cliente/cesión (reparto ya reparte con sufijo) el
comportamiento no cambia: `sscc` llega bare desde `listarPaletsAlternativos`
en un cambio manual de un único palet, y `linea.cantidad` ya es la
cantidad real pedida en esa línea — el fallback del parser sigue siendo
correcto ahí, no hace falta tocarlo.

### A.3 Testing (manual E2E, mismo patrón que Pieza 4)

1. Refill de un palet con 10 uds del código X (tienda 014). Confirmar que
   `lineas.sscc` queda como `"<sscc> (10ud)"`.
2. El mismo día, crear un pedido_cliente con 1 línea del código X,
   cantidad 3. Confirmar que el remanente calculado para esa línea
   descuenta las 10 uds del palet ya usado por el refill (no debe
   ofrecer ese palet como candidato con remanente falso).
3. Repetir el punto 1 pero usando "🔄 Cambiar palet" en vez del auto —
   mismo resultado esperado.
4. Caso sin regresión: reparto normal entre 2 palets (pedido_cliente,
   cantidad que no cabe en 1 palet) — remanente sigue correcto tras el
   cambio.

---

## Parte B — Buscar por pedido cliente

### B.1 Fuente de datos

`014.xlsx` / `279.xlsx`, carpeta `1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG`
(`Inventarios_Plataforma`). Alcance: solo estas 2 tiendas — coincide con
las únicas 2 tiendas que usa `kairos-portal` hoy (no hace falta más).

Cabecera real (para el matcher de columnas, ver `encontrarColumna` en
`lm_produccion/ImportarPyxis.gs`, se reutiliza el mismo criterio
case-insensitive por `indexOf`): `Dirección, Nº Ped, Sección, Subsección,
Ref., Código EAN, Designación, Ctd Recep., Código C1, Total línea, Nº
Prov., Fecha Entre.` El `Código EAN` puede venir vacío (visto en datos
reales, artículos "sobre pedido genérico").

**Gotcha real ya resuelto en `lm_produccion` (reutilizar, no redescubrir):**
el propio Excel de Pyxis a veces trae la MISMA referencia+dirección
repetida de origen, sin que medie ninguna carrera de escritura. La regla
de deduplicado es colapsar solo cuando **referencia + dirección +
cantidad** coinciden EXACTAS — nunca sumar, nunca colapsar por
referencia+cantidad si la dirección difiere. Ojo con el caso real visto
en el propio `014.xlsx`: la misma `Ref.` puede repetirse con
`Designación` distinta (p.ej. una barra "sobre pedido genérico" cortada a
distintas longitudes) — esas NO son duplicados y deben quedar como líneas
separadas.

### B.2 Esquema nuevo: `preparacion.pedidos_pyxis`

Migración nueva (`0XX_pedidos_pyxis.sql`, numeración siguiente a la
última existente en `Kairos/supabase/migrations/`):

```sql
create table preparacion.pedidos_pyxis (
  id uuid primary key default gen_random_uuid(),
  tienda text not null,
  num_pedido text not null,
  direccion text not null,
  seccion text,
  ref_lm text not null,
  ean text,
  designacion text not null,
  cantidad numeric not null,
  fecha_entrega text,
  sincronizado_en timestamptz not null default now()
);

create index pedidos_pyxis_busqueda_idx
  on preparacion.pedidos_pyxis (tienda, num_pedido);

create index pedidos_pyxis_ref_idx
  on preparacion.pedidos_pyxis (tienda, ref_lm);
```

Sin unicidad declarada a nivel de fila (el reemplazo es siempre completo
por tienda, igual que `stock_fisico` — no hay upsert incremental).
`fecha_entrega` se guarda como texto tal cual viene del Excel
(`dd/mm/yyyy`) — no hace falta parsear a fecha real para este caso de
uso, solo se muestra.

### B.3 Loader: `kairos-sync/PedidosPyxisLoader.js`

Mismo patrón que `StockFisicoLoader.js` (reemplazo completo por tienda,
`LockService`, no tocar el stock de una tienda si falta o falla su
archivo, no vaciar si el archivo da 0 filas y antes había datos).

Config nueva en `kairos-sync/Config.js`:

```js
PEDIDOS_FOLDER_ID: '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG', // Inventarios_Plataforma
PEDIDOS_ARCHIVOS: { '014.xlsx': '014', '279.xlsx': '279' },
```

Lectura del xlsx (técnica ya probada en `lm_produccion/ImportarPyxis.gs:73-94`
— requiere el servicio avanzado **Drive API** habilitado en el proyecto
Apps Script de `kairos-sync`, igual que ya lo tiene `lm_produccion`):

```js
function _leerXlsxComoFilas_(archivo) {
  const blob = archivo.getBlob();
  const recurso = { title: 'temp_pedidos_pyxis_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS };
  const temporal = Drive.Files.insert(recurso, blob);
  try {
    return SpreadsheetApp.openById(temporal.id).getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(temporal.id);
  }
}
```

Parseo + deduplicado (regla de `B.1`, adaptada de
`deduplicarLineasPyxis_` en `lm_produccion`):

```js
function _dedupPedidosPyxis_(filas) {
  const vistos = {};
  const resultado = [];
  filas.forEach(function (f) {
    const clave = f.num_pedido + '|' + f.ref_lm + '|' + f.direccion + '|' + f.cantidad;
    if (vistos[clave]) return;
    vistos[clave] = true;
    resultado.push(f);
  });
  return resultado;
}
```

Trigger diario nuevo (`instalarTriggerPedidosPyxis`, mismo patrón que
`instalarTriggerStockFisico`), a las 08:00 — después de que el archivo de
Pyxis se regenera (visto en real: ~07:16).

### B.4 Cálculo de stock disponible (portal)

`kairos-portal` no tiene hoy acceso al cálculo de remanente (vive en
`kairos-operario/StockAsignacion.js`). Se añade una versión de solo
lectura, más simple porque aquí no hace falta elegir SSCC concretos, solo
un total disponible por código+tienda: `kairos-portal/StockDisponible.js`.

**Duplicación deliberada, documentada:** GAS no comparte código entre
proyectos sin ceremonia extra (librería con su propio deploy). Se
duplica el criterio de parseo del sscc (mismo formato `"sscc (Xud) +
sscc2 (Yud)"` que escribe `StockAsignacion.js` tras el fix de la Parte
A) en vez de simplificar a `sum(lineas.cantidad)` — si se simplificara,
una línea de refill volvería a contarse mal (su `cantidad` no es la
cantidad física), justo el mismo bug que se cierra en la Parte A. Si el
formato del sscc cambia alguna vez en `StockAsignacion.js`, este archivo
hay que actualizarlo a la vez.

```js
function _totalComprometido_(tienda, codigoLm, desde) {
  var q = 'codigo_lm=eq.' + encodeURIComponent(codigoLm) +
    '&sscc=not.is.null&select=sscc,cantidad,peticiones!inner(tienda_origen)' +
    '&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda);
  if (desde) q += '&sscc_asignado_en=gte.' + encodeURIComponent(desde);
  const filas = supaSelect_('lineas', q);
  var total = 0;
  filas.forEach(function (l) {
    const raw = String(l.sscc || '');
    const partes = raw.indexOf(' + ') === -1 ? [raw] : raw.split(' + ');
    partes.forEach(function (p) {
      const m = p.trim().match(/\((\d+(?:[.,]\d+)?)\s*ud\)$/);
      total += m ? Number(m[1].replace(',', '.')) : (partes.length === 1 ? Number(l.cantidad) || 0 : 0);
    });
  });
  return total;
}

function stockDisponible(tienda, codigoLm) {
  const filas = supaSelect_('stock_fisico', 'tienda=eq.' + encodeURIComponent(tienda) + '&codigo_lm=eq.' + encodeURIComponent(codigoLm));
  const totalFisico = filas.reduce(function (s, f) { return s + Number(f.cantidad); }, 0);
  const ultimoSync = filas.length ? filas.reduce(function (max, f) { return f.sincronizado_en > max ? f.sincronizado_en : max; }, '') : null;
  return totalFisico - _totalComprometido_(tienda, codigoLm, ultimoSync);
}
```

**Búsqueda por pedido — función de entrada nueva**
(`kairos-portal/PedidoPyxis.js`):

```js
function buscarPedidoPyxis(ldap, numPedido) {
  const tienda = _tiendaDe_(ldap); // helper real, ya existe en Acceso.js
  const lineas = supaSelect_('pedidos_pyxis',
    'tienda=eq.' + encodeURIComponent(tienda) + '&num_pedido=eq.' + encodeURIComponent(String(numPedido).trim()));
  if (!lineas.length) return _json_({ lineas: [] });

  // Varias líneas del pedido pueden compartir el mismo código (p.ej. una
  // barra "sobre pedido" cortada a varias longitudes, cada una con su
  // propia Designación): el remanente de ese código es un POZO
  // COMPARTIDO, así que hay que descontarlo de forma secuencial dentro de
  // esta misma búsqueda — si se comprobara cada línea contra el mismo
  // total sin descontar, dos líneas del mismo código podrían "verse"
  // ambas con stock aunque juntas no quepan.
  const disponibleRestante = {};
  return _json_({
    lineas: lineas.map(function (l) {
      if (!(l.ref_lm in disponibleRestante)) disponibleRestante[l.ref_lm] = stockDisponible(tienda, l.ref_lm);
      const disponibleAntes = disponibleRestante[l.ref_lm];
      const tomado = Math.min(Math.max(disponibleAntes, 0), l.cantidad);
      disponibleRestante[l.ref_lm] -= tomado;
      return {
        refLm: l.ref_lm, ean: l.ean, designacion: l.designacion, cantidad: l.cantidad,
        disponibleEnPlataforma: Math.max(disponibleAntes, 0),
        stock: tomado >= l.cantidad ? 'ok' : (tomado > 0 ? 'parcial' : 'sin'),
      };
    }),
  });
}
```

### B.5 UI (`kairos-portal/Portal.html`)

Confirmado con mockup visual (Artifact `kairos-buscar-pedido-mockup`,
tema real indigo/ink de Kairos):

- Botón nuevo **"🔎 Buscar artículos de este pedido"** justo debajo del
  campo Nº de pedido (`#inNumPedido`), antes del bloque de búsqueda
  manual por EAN/escáner — separados por un divisor visual, para no
  confundir ambas vías de añadir artículos.
- Solo visible para `tipo === 'pedido_cliente'` o `'cesion'` (no aplica a
  refill ni revisión de palet).
- Al pulsar: llama a `buscarPedidoPyxis(LDAP, numPedido)`, pinta un panel
  con una fila por línea: designación, ref/EAN, cantidad, chip de stock
  (`ok` verde / `parcial` ámbar / `sin` rojo con `disponibleEnPlataforma`
  uds), checkbox marcado por defecto **solo si `stock !== 'sin'`**.
- Botón único **"➕ Añadir N disponibles en plataforma"**: añade de golpe
  todas las líneas marcadas al carrito (`lineas.push(...)`), reutilizando
  el aviso de duplicado ya existente por línea.
- Igual que hoy con la búsqueda manual: **pedido_cliente bloquea** añadir
  una línea `sin` stock (checkbox deshabilitado, sin opción de forzar);
  **cesión solo avisa** — checkbox y botón "Añadir igualmente" quedan
  habilitados para líneas `sin`/`parcial`, mismo patrón que el aviso ya
  existente en la búsqueda manual (`Portal.html:1764-1769`).
- Si `datos.numPedido` está vacío al pulsar "Buscar", se autorrellena con
  el número buscado.
- Estado sin resultados: "No se encontró el pedido `<num>` en Pyxis para
  esta tienda" (puede ser que aún no esté sincronizado ese día, o número
  mal escrito — mensaje no distingue ambos casos, no hace falta más para
  este caso de uso).

### B.6 Testing (manual E2E)

1. Pedido cliente real con varias líneas, alguna sin stock en plataforma:
   buscar, confirmar que el chip y el bloqueo por línea son correctos, y
   que "Añadir N disponibles" solo mete las que tienen stock.
2. Cesión con el mismo pedido: confirmar que las líneas `sin`/`parcial`
   quedan marcables igualmente (con aviso), a diferencia de pedido
   cliente.
3. Pedido con 2 líneas del mismo código (caso real de "barra sobre
   pedido" con longitudes distintas) y stock que solo alcanza para una:
   confirmar que la segunda línea sale `parcial`/`sin` en vez de que
   ambas salgan `ok` por comprobar contra el mismo total sin descontar.
4. Número de pedido inexistente: mensaje claro, sin romper el formulario.
5. `datos.numPedido` se autorrellena tras la búsqueda si estaba vacío.

## Fuera de alcance

- No se toca el flujo de creación existente (EAN manual + escáner
  📷) — sigue exactamente igual, la búsqueda por pedido es una vía más
  hacia el mismo carrito.
- No se sincroniza `pedidos_totales.csv` ni `pedidos_totales_2.csv`
  (los que usa INCPC) — son otra fuente, no se tocan.
- Refill no usa "buscar por pedido" — sigue con su flujo de palet
  completo tal cual.
- No se cambia `stock_fisico` ni su cadencia de sync (sigue como esté
  configurado hoy — pendiente verificar en Apps Script si es el trigger
  diario 11:00 del README o el horario de `instalarTriggerStockFisico`,
  pero eso es investigación aparte, no bloquea esta pieza).
