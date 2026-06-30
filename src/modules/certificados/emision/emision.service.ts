import { emisionRepo } from '../shared/certificados.repository';

export const emisionService = {
  listAll:       (tenantSlug: string)                                      => emisionRepo.findAll(tenantSlug),
  generar:       (tenantSlug: string, inscripcionId: number, uid?: number) => emisionRepo.generar(tenantSlug, inscripcionId, uid),
  generarLote:   (tenantSlug: string, ids: number[], uid?: number)         => emisionRepo.generarLote(tenantSlug, ids, uid),
  validarPublico:(codigoUnico: string, tenantSlug: string)                 => emisionRepo.validarPublico(codigoUnico, tenantSlug),
  anular:        (tenantSlug: string, id: number, uid?: number)            => emisionRepo.anular(tenantSlug, id, uid),
  eliminar:      (tenantSlug: string, id: number, uid?: number)            => emisionRepo.eliminar(tenantSlug, id, uid),
  regenerarPDF:  (tenantSlug: string, id: number)                          => emisionRepo.regenerarPDF(tenantSlug, id),
  preview:       (tenantSlug: string, inscripcionId: number)               => emisionRepo.previewBuffer(tenantSlug, inscripcionId),
  zipGrupo: (tenantSlug: string, grupoId: number) =>emisionRepo.zipGrupo(tenantSlug, grupoId),
  zipPorIds: (tenantSlug: string, ids: number[]) => emisionRepo.zipPorIds(tenantSlug, ids),
};
