-- ============================================================================
--  VAXA · Historias Clínicas — REPARAR tildes/ñ mal guardadas en hc_motivos
--  --------------------------------------------------------------------------
--  Al correr el seed con el cliente mysql en latin1, los literales UTF-8 se
--  guardaron DOBLE-codificados: "Sesión" quedó como "SesiÃ³n". La columna es
--  utf8mb4, así que el arreglo es revertir ese doble-encoding a nivel de bytes:
--    utf8mb4 → bytes latin1 → reinterpretar como utf8mb4.
--
--  Solo toca las filas realmente dañadas (las que contienen el byte 0xC3 'Ã'
--  o 0xC2 'Â', marca típica del doble-encoding), así no rompe las correctas.
--
--    mysql -u root -p vaxa < scripts/mysql-fix-tildes-motivos.sql
-- ============================================================================
SET NAMES utf8mb4;

UPDATE hc_motivos
   SET nombre = CONVERT(CAST(CONVERT(nombre USING latin1) AS BINARY) USING utf8mb4)
 WHERE HEX(nombre) LIKE '%C383%'   -- 'Ã' (doble-codificado)
    OR HEX(nombre) LIKE '%C382%';  -- 'Â'

UPDATE hc_motivos
   SET descripcion = CONVERT(CAST(CONVERT(descripcion USING latin1) AS BINARY) USING utf8mb4)
 WHERE descripcion IS NOT NULL
   AND (HEX(descripcion) LIKE '%C383%' OR HEX(descripcion) LIKE '%C382%');

-- Verificación: deberías ver "Sesión individual" bien escrito.
SELECT id, servicio_id, nombre, descripcion FROM hc_motivos ORDER BY id;
