import 'dotenv/config';
import { writeFileSync } from 'fs';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
import { generarPdf } from '../src/modules/facturacion/pdf.service';
async function main(){
  const [r] = await pool().query<any[]>("SELECT id FROM comprobantes ORDER BY id DESC LIMIT 1");
  const c = await comprobanteRepo.getById(r[0].id);
  const pdf = await generarPdf(c);
  writeFileSync('secrets/out/comprobante.pdf', pdf);
  console.log(`PDF generado: ${(pdf.length/1024).toFixed(1)} KB para ${c?.numero} -> secrets/out/comprobante.pdf`);
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
