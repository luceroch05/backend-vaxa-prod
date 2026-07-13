/*
 * Regenera TODOS los PDFs de certificados vigentes (no anulados) con el diseño
 * actual del código. Úsalo tras un deploy que cambió el layout del certificado.
 *
 * Los PDFs se guardan como ARCHIVOS al emitir, así que un deploy NO los actualiza
 * solo: hay que regenerarlos. Este script recorre todos y llama regenerarPDF.
 *
 * Uso (desde la RAÍZ del backend, donde está package.json y la carpeta uploads/):
 *   node scripts/regenerar-todos-pdfs.js            -> todos los tenants
 *   node scripts/regenerar-todos-pdfs.js cueto      -> solo ese tenant_slug
 *
 * Requiere que 'dist/' esté compilado (npm run build) y el .env configurado.
 */
require('dotenv').config();
const { getPool } = require('../dist/db/pool.js');
const { emisionRepo } = require('../dist/modules/certificados/shared/certificados.repository.js');

const SLUG = process.argv[2] || null;

(async () => {
  const pool = getPool();
  if (!pool) { console.error('BD no configurada (.env)'); process.exit(1); }

  const [rows] = await pool.query(
    `SELECT c.id, c.codigo_unico, e.tenant_slug
       FROM certificados c
       JOIN empresas e ON e.id = c.empresa_id
      WHERE c.estado_id <> 2
        ${SLUG ? 'AND e.tenant_slug = ?' : ''}
      ORDER BY c.id`,
    SLUG ? [SLUG] : []);

  console.log(`Certificados a regenerar: ${rows.length}${SLUG ? ' (tenant ' + SLUG + ')' : ''}`);
  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      await emisionRepo.regenerarPDF(r.tenant_slug, r.id);
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok} regenerados`);
    } catch (e) {
      fail++;
      console.error(`  ERROR ${r.codigo_unico}:`, e.message);
    }
  }
  console.log(`Listo. OK: ${ok}  |  Fallidos: ${fail}`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
