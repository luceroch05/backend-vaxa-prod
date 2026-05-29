import { unidadesRepo } from '../shared/certificados.repository';
import type { CreateUnidadDto, UpdateUnidadDto } from './unidad.dto';

export const unidadService = {
  listByPrograma: (tenantSlug: string, programaId: number)              => unidadesRepo.findByPrograma(tenantSlug, programaId),
  create:         (tenantSlug: string, dto: CreateUnidadDto, uid?: number) => unidadesRepo.create(tenantSlug, dto, uid),
  update:         (tenantSlug: string, id: number, dto: UpdateUnidadDto, uid?: number) => unidadesRepo.update(tenantSlug, id, dto, uid),
  remove:         (tenantSlug: string, id: number)                       => unidadesRepo.remove(tenantSlug, id),
};
