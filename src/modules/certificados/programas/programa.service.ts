import { programasRepo } from '../shared/certificados.repository';
import type { CreateProgramaDto, UpdateProgramaDto } from './programa.dto';

export const programaService = {
  listAll:  (tenantSlug: string)                                          => programasRepo.findAll(tenantSlug),
  findById: (tenantSlug: string, id: number)                              => programasRepo.findById(tenantSlug, id),
  create:   (tenantSlug: string, dto: CreateProgramaDto, uid?: number)    => programasRepo.create(tenantSlug, dto, uid),
  update:   (tenantSlug: string, id: number, dto: UpdateProgramaDto, uid?: number) => programasRepo.update(tenantSlug, id, dto, uid),
};
