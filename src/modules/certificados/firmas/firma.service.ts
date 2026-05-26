import { firmasRepo } from '../shared/certificados.repository';
import type { CreateFirmaDto } from './firma.dto';

export const firmaService = {
  listAll: (tenantSlug: string)                                     => firmasRepo.findAll(tenantSlug),
  create:  (tenantSlug: string, dto: CreateFirmaDto, uid?: number)  => firmasRepo.create(tenantSlug, dto, uid),
  remove:  (tenantSlug: string, id: number)                         => firmasRepo.remove(tenantSlug, id),
};
