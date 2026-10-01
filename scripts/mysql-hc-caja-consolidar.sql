-- ─────────────────────────────────────────────────────────────────────────────
-- Consolidar en Caja las ventas con PAGO DIVIDIDO viejas.
--
-- Antes, una venta pagada con varios métodos (efectivo + yape) generaba UN
-- movimiento de caja POR MÉTODO → se veía "separada" (varias líneas por la misma
-- venta). El código nuevo registra UN solo ingreso por venta (el total) y guarda
-- el desglose por método en hc_venta_pagos.
--
-- Este script arregla las ventas YA registradas: por cada venta con >1 ingreso en
-- caja, deja una sola fila con el total (método = 'mixto') y borra las demás.
-- No cambia el saldo total de la caja (solo agrupa). El desglose por método sigue
-- en hc_venta_pagos y se ve en el detalle de la venta.
--
-- SEGURO de re-ejecutar (idempotente): si ya no hay ventas partidas, no hace nada.
-- Correr DESPUÉS de desplegar el backend nuevo. Recomendado hacer respaldo antes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) La fila más antigua de cada venta partida pasa a ser el total, método 'mixto'.
UPDATE hc_caja_mov c
JOIN (
  SELECT venta_id, MIN(id) AS keep_id, SUM(monto) AS total
    FROM hc_caja_mov
   WHERE tipo = 'ingreso' AND venta_id IS NOT NULL
   GROUP BY venta_id
   HAVING COUNT(*) > 1
) g ON g.keep_id = c.id
SET c.monto = g.total,
    c.metodo_pago = 'mixto';

-- 2) Borra las filas sobrantes de esas mismas ventas (todas menos la que quedó).
DELETE c FROM hc_caja_mov c
JOIN (
  SELECT venta_id, MIN(id) AS keep_id
    FROM hc_caja_mov
   WHERE tipo = 'ingreso' AND venta_id IS NOT NULL
   GROUP BY venta_id
   HAVING COUNT(*) > 1
) g ON g.venta_id = c.venta_id
WHERE c.tipo = 'ingreso' AND c.id <> g.keep_id;
