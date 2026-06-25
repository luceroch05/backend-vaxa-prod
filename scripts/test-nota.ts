import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [f] = await pool().query<any[]>("SELECT id, serie, correlativo FROM comprobantes WHERE tipo_comprobante='01' AND estado_id=3 ORDER BY id DESC LIMIT 1");
  if(!f.length){ console.log('No hay factura aceptada para anular.'); process.exit(0); }
  console.log(`Anulando factura ${f[0].serie}-${f[0].correlativo} (id ${f[0].id})`);
  const c = await comprobanteRepo.emitirNota({ comprobanteOrigenId: f[0].id, tipoNota:'07', motivoCodigo:'01', motivoDescripcion:'Anulacion de la operacion' });
  console.log('\n========== NOTA DE CRÉDITO ==========');
  console.log(`Número: ${c?.numero}`);
  console.log(`Estado: ${c?.estado_nombre} (${c?.estado})`);
  console.log(`SUNAT:  ${c?.sunat_resp_codigo ?? '-'} · ${c?.sunat_resp_desc ?? ''}`);
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
