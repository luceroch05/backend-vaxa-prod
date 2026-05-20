import { findAll, generar, validarPublico, anular } from './emision.repository';

export const emisionService = {
  listAll:       (tenantSlug: string)                                            => findAll(tenantSlug),
  generar:       (tenantSlug: string, inscripcionId: number, uid?: number)       => generar(tenantSlug, inscripcionId, uid),
  validarPublico:(codigoUnico: string)                                           => validarPublico(codigoUnico),
  anular:        (tenantSlug: string, id: number, uid?: number)                  => anular(tenantSlug, id, uid),
};
