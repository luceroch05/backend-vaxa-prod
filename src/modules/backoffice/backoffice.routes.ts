import { Router } from 'express';
import { getEmpresasList } from './backoffice.service';

const router = Router();

/** Lista de empresas (desde tabla empresas_vaxa si hay MySQL, si no desde config). */
router.get('/empresas', async (_req, res) => {
  try {
    const list = await getEmpresasList();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'Error al listar empresas', message: (e as Error).message });
  }
});

export const backofficeRoutes = router;
