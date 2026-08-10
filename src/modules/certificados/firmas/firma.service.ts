import { firmasRepo } from '../shared/certificados.repository';
import type { CreateFirmaDto, UpdateFirmaDto } from './firma.dto';

export const firmaService = {
  listAll: (tenantSlug: string)                                     => firmasRepo.findAll(tenantSlug),
  create:  (tenantSlug: string, dto: CreateFirmaDto, uid?: number)  => firmasRepo.create(tenantSlug, dto, uid),
  update:  (tenantSlug: string, id: number, dto: UpdateFirmaDto, uid?: number) => firmasRepo.update(tenantSlug, id, dto, uid),
  remove:  (tenantSlug: string, id: number, uid?: number)           => firmasRepo.remove(tenantSlug, id, uid),
};
