import { programasRepo } from '../shared/certificados.repository';
import type { CreateProgramaDto, UpdateProgramaDto } from './programa.dto';

export const programaService = {
  listAll:  (tenantSlug: string, incluirInactivos = false)                => programasRepo.findAll(tenantSlug, incluirInactivos),
  findById: (tenantSlug: string, id: number)                              => programasRepo.findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateProgramaDto, uid?: number)    => programasRepo.create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: UpdateProgramaDto, uid?: number) => programasRepo.update(tenantSlug, id, dto, uid),
  setActivo:(tenantSlug: string, id: number, activo: boolean, uid?: number) => programasRepo.setActivo(tenantSlug, id, activo, uid),
  remove:   (tenantSlug: string, id: number, uid?: number)                => programasRepo.remove(tenantSlug, id, uid),
};
