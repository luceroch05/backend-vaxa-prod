import { participantesRepo } from '../shared/certificados.repository';
import type { CreateParticipanteDto } from './participante.dto';

export const participanteService = {
  listAll:  (tenantSlug: string)                                            => participantesRepo.findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                                => participantesRepo.findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateParticipanteDto, uid?: number)  => participantesRepo.create(tenantSlug, dto, uid),
};
