import { findAll, create, cambiarEstado } from './inscripcion.repository';
import type { CreateInscripcionDto, CambiarEstadoDto } from './inscripcion.dto';

export const inscripcionService = {
  listAll:       (tenantSlug: string, grupoId?: number)                             => findAll(tenantSlug, grupoId),
  create:        (tenantSlug: string, dto: CreateInscripcionDto, uid?: number)       => create(tenantSlug, dto, uid),
  cambiarEstado: (tenantSlug: string, id: number, dto: CambiarEstadoDto, uid?: number) => cambiarEstado(tenantSlug, id, dto.estado_id, uid),
};
