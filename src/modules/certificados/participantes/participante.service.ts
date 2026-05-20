import { findAll, findById, create } from './participante.repository';
import type { CreateParticipanteDto } from './participante.dto';

export const participanteService = {
  listAll:  (tenantSlug: string)                                          => findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                              => findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateParticipanteDto, uid?: number) => create(tenantSlug, dto, uid),
};
