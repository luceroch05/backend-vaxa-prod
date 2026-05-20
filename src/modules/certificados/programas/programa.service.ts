import { findAll, findById, create, update } from './programa.repository';
import type { CreateProgramaDto, UpdateProgramaDto } from './programa.dto';

export const programaService = {
  listAll:  (tenantSlug: string)                                    => findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                        => findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateProgramaDto, uid?: number) => create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: UpdateProgramaDto, uid?: number) => update(tenantSlug, id, dto, uid),
};
