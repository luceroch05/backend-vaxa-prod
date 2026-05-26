import { catalogosRepo } from '../shared/certificados.repository';

export const catalogoService = {
  getCatalogos: () => catalogosRepo.findAll(),
};
