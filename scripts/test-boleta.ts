import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [e] = await pool().query<any[]>("SELECT id FROM empresas WHERE plan_actual_id IS NOT NULL AND tenant_slug<>'vaxa' LIMIT 1");
  const empId = e[0].id;
  // Boleta a una persona con DNI
  const c = await comprobanteRepo.emitir({
    empresaId: empId,
    tipoComprobante: '03',
    cliente: { tipoDoc: '1', numDoc: '12345678', razonSocial: 'JUAN PEREZ PRUEBA' },
    items: [{ descripcion: 'Servicio de prueba boleta', cantidad: 1, valorUnitario: 50, unidad: 'ZZ' }],
  });
  console.log(`Boleta ${c?.numero} · ${c?.estado_nombre}`);
  console.log(`SUNAT: ${c?.sunat_resp_codigo ?? '-'} · ${c?.sunat_resp_desc ?? ''}`);
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
