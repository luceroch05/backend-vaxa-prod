import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { planRepo } from '../src/modules/certificados/planes/plan.repository';
import { SinCreditosError } from '../src/modules/certificados/shared/creditos.repository';
async function main(){
  const [e] = await pool().query<any[]>("SELECT id, razon_social FROM empresas WHERE tenant_slug<>'vaxa' LIMIT 1");
  const id = e[0].id;
  await pool().query("UPDATE empresas SET creditos_disponibles=2 WHERE id=?", [id]);
  console.log(`Empresa ${e[0].razon_social}: saldo inicial 2`);
  const consumir = async () => {
    const c = await pool().getConnection();
    try { await c.beginTransaction(); await planRepo.consumirCupo(c, id); await c.commit(); return 'OK'; }
    catch(err){ await c.rollback(); return err instanceof SinCreditosError ? 'BLOQUEADO (sin créditos)' : 'ERR '+(err as Error).message; }
    finally { c.release(); }
  };
  for(let i=1;i<=3;i++){ const r = await consumir(); const [s]=await pool().query<any[]>("SELECT creditos_disponibles FROM empresas WHERE id=?",[id]); console.log(`  Emisión ${i}: ${r} · saldo=${s[0].creditos_disponibles}`); }
  // devolver
  const c = await pool().getConnection();
  try { await c.beginTransaction(); await planRepo.devolverCupo(c, id); await c.commit(); } finally { c.release(); }
  const [s]=await pool().query<any[]>("SELECT creditos_disponibles FROM empresas WHERE id=?",[id]);
  console.log(`  Devolución (eliminar cert): saldo=${s[0].creditos_disponibles}`);
  const [mov]=await pool().query<any[]>("SELECT tipo, cantidad, saldo_resultante FROM creditos_movimientos WHERE empresa_id=? ORDER BY id DESC LIMIT 4",[id]);
  console.log('Últimos movimientos:'); console.table(mov);
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
