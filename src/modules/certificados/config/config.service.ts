import { findByPrograma, upsert } from './config.repository';
import type { UpsertConfigDto } from './config.dto';

export const configService = {
  findByPrograma: (tenantSlug: string, programaId: number)                              => findByPrograma(tenantSlug, programaId),
  upsert:         (tenantSlug: string, programaId: number, dto: UpsertConfigDto, uid?: number) => upsert(tenantSlug, programaId, dto, uid),
};
