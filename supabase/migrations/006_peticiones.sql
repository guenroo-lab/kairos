-- 006 · Cabecera de peticion. Un tipo por peticion. CHECKs de integridad
-- por tipo. num_pedido NO es unico (un mismo Nº PC llega varias veces al dia
-- en expediciones distintas).

create table if not exists preparacion.peticiones (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    text not null check (tipo in ('pedido_cliente','cesion','refill')),
  tienda_origen           text not null references preparacion.tiendas(codigo),
  solicitante_ldap        text not null,
  creada_en               timestamptz not null default now(),
  num_pedido              text,
  transporte              boolean,
  tienda_destino          text references preparacion.tiendas(codigo),
  motivo                  text,
  comentario              text,
  ubicacion_consolidacion text,
  estado                  text not null default 'pendiente'
                            check (estado in ('pendiente','en_preparacion','a_ubicar','cerrada')),
  cerrada_en              timestamptz,

  constraint pc_tiene_num_y_transporte check (
    tipo <> 'pedido_cliente' or (num_pedido is not null and transporte is not null)),
  constraint solo_pc_tiene_num_y_transporte check (
    tipo = 'pedido_cliente' or (num_pedido is null and transporte is null)),
  constraint cesion_tiene_destino check (
    tipo <> 'cesion' or tienda_destino is not null),
  constraint solo_cesion_tiene_destino check (
    tipo = 'cesion' or tienda_destino is null),
  constraint refill_tiene_motivo check (
    tipo <> 'refill' or motivo is not null),
  constraint solo_refill_tiene_motivo check (
    tipo = 'refill' or motivo is null)
);

create index if not exists peticiones_tienda_estado_idx
  on preparacion.peticiones (tienda_origen, estado);
create index if not exists peticiones_num_pedido_idx
  on preparacion.peticiones (num_pedido) where num_pedido is not null;
