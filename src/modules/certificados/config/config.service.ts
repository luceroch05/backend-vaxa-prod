import { configRepo } from '../shared/certificados.repository';
import type { UpsertConfigDto } from './config.dto';

export const configService = {
  findByPrograma: (tenantSlug: string, programaId: number)                               => configRepo.findByPrograma(tenantSlug, programaId),
  upsert:         (tenantSlug: string, programaId: number, dto: UpsertConfigDto, uid?: number) => configRepo.upsert(tenantSlug, programaId, dto, uid),
};
