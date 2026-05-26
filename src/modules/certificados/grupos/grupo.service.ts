import { gruposRepo } from '../shared/certificados.repository';
import type { CreateGrupoDto } from './grupo.dto';

export const grupoService = {
  listAll:  (tenantSlug: string)                                       => gruposRepo.findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                           => gruposRepo.findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateGrupoDto, uid?: number)    => gruposRepo.create(tenantSlug, dto, uid),
};
