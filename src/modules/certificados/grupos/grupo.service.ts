import { gruposRepo } from '../shared/certificados.repository';
import type { CreateGrupoDto } from './grupo.dto';

export const grupoService = {
  listAll:  (tenantSlug: string, incluirInactivos = false)             => gruposRepo.findAll(tenantSlug, incluirInactivos),
  findById: (tenantSlug: string, id: number)                           => gruposRepo.findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateGrupoDto, uid?: number)    => gruposRepo.create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: CreateGrupoDto, uid?: number) => gruposRepo.update(tenantSlug, id, dto, uid),
  setActivo:(tenantSlug: string, id: number, activo: boolean, uid?: number) => gruposRepo.setActivo(tenantSlug, id, activo, uid),
  remove:   (tenantSlug: string, id: number, uid?: number)             => gruposRepo.remove(tenantSlug, id, uid),
};
