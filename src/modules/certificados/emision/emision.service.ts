import { emisionRepo } from '../shared/certificados.repository';

export const emisionService = {
  listAll:       (tenantSlug: string)                                      => emisionRepo.findAll(tenantSlug),
  generar:       (tenantSlug: string, inscripcionId: number, uid?: number) => emisionRepo.generar(tenantSlug, inscripcionId, uid),
  validarPublico:(codigoUnico: string)                                      => emisionRepo.validarPublico(codigoUnico),
  anular:        (tenantSlug: string, id: number, uid?: number)            => emisionRepo.anular(tenantSlug, id, uid),
  eliminar:      (tenantSlug: string, id: number, uid?: number)            => emisionRepo.eliminar(tenantSlug, id, uid),
  regenerarPDF:  (tenantSlug: string, id: number)                          => emisionRepo.regenerarPDF(tenantSlug, id),
};
