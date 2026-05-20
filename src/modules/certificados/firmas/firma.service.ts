import { findAll, create, remove } from './firma.repository';
import type { CreateFirmaDto } from './firma.dto';

export const firmaService = {
  listAll: (tenantSlug: string)                                    => findAll(tenantSlug),
  create:  (tenantSlug: string, dto: CreateFirmaDto, uid?: number) => create(tenantSlug, dto, uid),
  remove:  (tenantSlug: string, id: number)                        => remove(tenantSlug, id),
};
