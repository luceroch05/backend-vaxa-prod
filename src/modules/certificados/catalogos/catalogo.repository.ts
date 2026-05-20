import { pool } from '../shared/db.helper';
import { TipoDocumentoEntity, TipoProgramaEntity, ModalidadEntity } from './catalogo.entity';

export async function findAll() {
  const p = pool();
  const [[docs], [progs], [mods]] = await Promise.all([
    p.query<any[]>('SELECT * FROM tipos_documento WHERE activo = 1'),
    p.query<any[]>('SELECT * FROM tipos_programa WHERE activo = 1'),
    p.query<any[]>('SELECT * FROM modalidades WHERE activo = 1'),
  ]);
  return {
    tipos_documento: (docs as any[]).map(TipoDocumentoEntity.fromRow),
    tipos_programa:  (progs as any[]).map(TipoProgramaEntity.fromRow),
    modalidades:     (mods as any[]).map(ModalidadEntity.fromRow),
  };
}
