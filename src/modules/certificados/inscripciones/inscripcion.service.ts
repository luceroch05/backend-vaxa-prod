import { inscripcionesRepo } from '../shared/certificados.repository';
import type { CreateInscripcionDto, CambiarEstadoDto, InscribirDto } from './inscripcion.dto';

export const inscripcionService = {
  listAll:       (tenantSlug: string, grupoId?: number)                              => inscripcionesRepo.findAll(tenantSlug, grupoId),
  create:        (tenantSlug: string, dto: CreateInscripcionDto, uid?: number)        => inscripcionesRepo.create(tenantSlug, dto, uid),
  inscribir:     (tenantSlug: string, dto: InscribirDto, uid?: number)               => inscripcionesRepo.inscribir(tenantSlug, dto, uid),
  cambiarEstado: (tenantSlug: string, id: number, dto: CambiarEstadoDto, uid?: number) => inscripcionesRepo.cambiarEstado(tenantSlug, id, dto.estado_id, uid),
  cambiarEstadoMasivo: (tenantSlug: string, ids: number[], estadoId: number, uid?: number) => inscripcionesRepo.cambiarEstadoMasivo(tenantSlug, ids, estadoId, uid),
  importarMasivo: (
    tenantSlug: string,
    grupoId: number,
    filas: Array<{ tipo_documento_id: number; numero_documento: string; nombres: string; apellidos: string; email?: string; telefono?: string }>,
    emitir: boolean,
    uid?: number,
  ) => inscripcionesRepo.importarMasivo(tenantSlug, grupoId, filas, emitir, uid),
  remove:        (tenantSlug: string, id: number)                                    => inscripcionesRepo.remove(tenantSlug, id),
};
