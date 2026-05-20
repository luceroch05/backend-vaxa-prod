import { findAll } from './catalogo.repository';

export const catalogoService = {
  getCatalogos: () => findAll(),
};
