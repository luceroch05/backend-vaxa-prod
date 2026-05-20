import { findAll, create, remove } from './logo.repository';
import type { CreateLogoDto } from './logo.dto';

export const logoService = {
  listAll: (tenantSlug: string)                                   => findAll(tenantSlug),
  create:  (tenantSlug: string, dto: CreateLogoDto, uid?: number) => create(tenantSlug, dto, uid),
  remove:  (tenantSlug: string, id: number)                       => remove(tenantSlug, id),
};
