import { configRepo } from '../shared/certificados.repository';
import type { UpsertConfigDto } from './config.dto';

export const configService = {
  findByPrograma:      (tenantSlug: string, programaId: number, grupoId: number = 0) =>
                          configRepo.findByPrograma(tenantSlug, programaId, grupoId),

  upsert:              (tenantSlug: string, programaId: number, dto: UpsertConfigDto, uid?: number) =>
                          configRepo.upsert(tenantSlug, programaId, dto, uid),

  listGruposConConfig: (tenantSlug: string, programaId: number) =>
                          configRepo.listGruposConConfig(tenantSlug, programaId),

  congelarGrupo:       (tenantSlug: string, programaId: number, grupoId: number, uid?: number) =>
                          configRepo.congelarGrupo(tenantSlug, programaId, grupoId, uid),

  eliminarConfigGrupo: (tenantSlug: string, programaId: number, grupoId: number, uid?: number) =>
                          configRepo.eliminarConfigGrupo(tenantSlug, programaId, grupoId, uid),
};
