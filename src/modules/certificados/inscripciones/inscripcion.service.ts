import { inscripcionesRepo } from '../shared/certificados.repository';
import type { CreateInscripcionDto, CambiarEstadoDto } from './inscripcion.dto';

export const inscripcionService = {
  listAll:       (tenantSlug: string, grupoId?: number)                              => inscripcionesRepo.findAll(tenantSlug, grupoId),
  create:        (tenantSlug: string, dto: CreateInscripcionDto, uid?: number)        => inscripcionesRepo.create(tenantSlug, dto, uid),
  cambiarEstado: (tenantSlug: string, id: number, dto: CambiarEstadoDto, uid?: number) => inscripcionesRepo.cambiarEstado(tenantSlug, id, dto.estado_id, uid),
};
