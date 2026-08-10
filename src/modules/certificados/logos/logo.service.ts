import { logosRepo } from '../shared/certificados.repository';
import type { CreateLogoDto, UpdateLogoDto } from './logo.dto';

export const logoService = {
  listAll: (tenantSlug: string)                                    => logosRepo.findAll(tenantSlug),
  create:  (tenantSlug: string, dto: CreateLogoDto, uid?: number)  => logosRepo.create(tenantSlug, dto, uid),
  update:  (tenantSlug: string, id: number, dto: UpdateLogoDto, uid?: number) => logosRepo.update(tenantSlug, id, dto, uid),
  remove:  (tenantSlug: string, id: number, uid?: number)          => logosRepo.remove(tenantSlug, id, uid),
};
