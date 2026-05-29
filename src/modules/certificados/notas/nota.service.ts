import { notasRepo } from '../shared/certificados.repository';
import type { NotaInput } from './nota.dto';

export const notaService = {
  matrizGrupo: (tenantSlug: string, grupoId: number) => notasRepo.matrizGrupo(tenantSlug, grupoId),

  guardar: (tenantSlug: string, inscripcionId: number, notas: NotaInput[], uid?: number) =>
    notasRepo.guardarNotas(tenantSlug, inscripcionId, notas, uid),
};
