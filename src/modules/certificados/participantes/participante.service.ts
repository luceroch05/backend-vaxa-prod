import { participantesRepo } from '../shared/certificados.repository';
import type { CreateParticipanteDto } from './participante.dto';

export const participanteService = {
  listAll:  (tenantSlug: string, incluirInactivos = false)                  => participantesRepo.findAll(tenantSlug, incluirInactivos),
  findById: (tenantSlug: string, id: number)                                => participantesRepo.findById(tenantSlug, id),
  setActivo:(tenantSlug: string, id: number, activo: boolean)               => participantesRepo.setActivo(tenantSlug, id, activo),
  remove:   (tenantSlug: string, id: number)                                => participantesRepo.remove(tenantSlug, id),
  findByDocumento: (tenantSlug: string, doc: string, tipoId?: number)       => participantesRepo.findByDocumento(tenantSlug, doc, tipoId),
  create:   (tenantSlug: string, dto: CreateParticipanteDto, uid?: number)  => participantesRepo.create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: Partial<CreateParticipanteDto>) => participantesRepo.update(tenantSlug, id, dto),
};
