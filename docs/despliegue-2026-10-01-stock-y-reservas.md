# Despliegue 2026-10-01 · stock atómico, frecuencia 10 min y reservas

Cambios ya en el repositorio (commits 408da68, 3355798, 19ea709 y 2a17e90; revisados 4 veces con Codex) y **sin desplegar**.
Orden obligatorio: el cargador de stock (kairos-sync) llama a una función SQL
nueva, así que la base de datos va primero.

## 1. Base de datos (Supabase → SQL Editor → New query)

Pegar el contenido de `supabase/migrations/033_reemplazar_stock_fisico.sql` y
ejecutar. Solo añade una función; no toca tablas ni datos.

Comprobar que existe y responde (no modifica nada: falla a propósito antes de
tocar la tabla):

```sql
select preparacion.reemplazar_stock_fisico('036', '[]'::jsonb);
```

Resultado esperado: error `reemplazar_stock_fisico: no hay filas que cargar para la tienda 036`.

## 2. kairos-sync (stock)

```bash
cd C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-sync && clasp push --force
```

Editor de Apps Script de kairos-sync:
1. Ejecutar `cargarStockFisico` una vez. En el registro debe salir `Stock físico: N ubicaciones subidas` (la primera vez recarga las dos tiendas aunque el CSV no sea nuevo, porque las marcas antiguas eran la hora de carga).
2. Ejecutar `instalarTriggerStockFisico` (pasa de cada hora a cada 10 min; solo recarga si hay CSV nuevo).

Comprobar en Supabase:

```sql
select tienda, count(*), max(sincronizado_en) from preparacion.stock_fisico group by tienda;
```

`max(sincronizado_en)` debe ser la hora del CSV menos 15 min (no la hora de carga).

## 3. Operario y portal (cálculo de reservas)

Solo DESPUÉS del paso 2 (usan la marca nueva de `sincronizado_en`).

```bash
cd C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-operario && clasp push --force && clasp deploy -i AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A -d "reservas de palets que sobreviven a la carga de stock"
```

```bash
cd C:\Users\30081048\Desktop\Proyectos\Kairos\kairos-portal && clasp push --force && clasp deploy -i AKfycbx-OUWwyJijJJLFmpSnVDDDCPjgj6YG2SkbGhKny2rlebGUgoiTBohgcgbwVKhfAJyN -d "stock disponible y refill respetan palets reservados"
```

## Qué esperar

- Una ejecución fallida de `cargarStockFisico` en el historial de Apps Script significa: el stock NO se ha tocado (sigue el último bueno) y el mensaje dice por qué (CSV viejo, CSV incompleto, fichero ausente, cantidades ilegibles).
- Si de verdad hay un cambio grande de stock (más del 40 % de filas menos), ejecutar a mano `cargarStockFisicoForzado`.
- Anular un pedido a medio preparar devuelve su stock al cálculo: si ya se cogió mercancía, hay que devolverla a su palet.

## Marcha atrás

El stock antiguo no se pierde nunca (la recarga es atómica). Para volver al código anterior:
`git checkout 0bcf103 -- kairos-sync kairos-operario kairos-portal` y repetir los `clasp push` /
`clasp deploy`. La función SQL puede quedarse (no molesta).
