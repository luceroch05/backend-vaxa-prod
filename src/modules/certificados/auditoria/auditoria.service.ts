import { auditoriaRepo, type AuditFiltro } from './auditoria.repository';

export const auditoriaService = {
  listar: (tenantSlug: string, filtro: AuditFiltro) => auditoriaRepo.listar(tenantSlug, filtro),
};
