import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { planRepo } from '../src/modules/certificados/planes/plan.repository';
async function main(){
  const [e] = await pool().query<any[]>("SELECT DISTINCT empresa_id FROM pagos LIMIT 1");
  if(!e.length){ console.log('No hay pagos en la BD.'); process.exit(0); }
  const empId = e[0].empresa_id;
  const pagos = await planRepo.listPagos(empId);
  console.log(`Historial de pagos de empresa ${empId}:`);
  console.table(pagos.map(p=>({ id:p.id, concepto:p.concepto, monto:p.monto, estado:p.estado, factura:p.cpe_numero ?? '(sin facturar)', cpe_estado:p.cpe_estado ?? '-' })));
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
