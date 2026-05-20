import { findAll, findById, create } from './grupo.repository';
import type { CreateGrupoDto } from './grupo.dto';

export const grupoService = {
  listAll:  (tenantSlug: string)                                    => findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                        => findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateGrupoDto, uid?: number) => create(tenantSlug, dto, uid),
};
