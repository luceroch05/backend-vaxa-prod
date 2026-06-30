import { participantesRepo } from '../shared/certificados.repository';
import type { CreateParticipanteDto } from './participante.dto';

export const participanteService = {
  listAll:  (tenantSlug: string, incluirInactivos = false)                  => participantesRepo.findAll(tenantSlug, incluirInactivos),
  findById: (tenantSlug: string, id: number)                                => participantesRepo.findById(tenantSlug, id),
  setActivo:(tenantSlug: string, id: number, activo: boolean, uid?: number) => participantesRepo.setActivo(tenantSlug, id, activo, uid),
  remove:   (tenantSlug: string, id: number, uid?: number)                  => participantesRepo.remove(tenantSlug, id, uid),
  findByDocumento: (tenantSlug: string, doc: string, tipoId?: number)       => participantesRepo.findByDocumento(tenantSlug, doc, tipoId),
  create:   (tenantSlug: string, dto: CreateParticipanteDto, uid?: number)  => participantesRepo.create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: Partial<CreateParticipanteDto>, uid?: number) => participantesRepo.update(tenantSlug, id, dto, uid),
};
