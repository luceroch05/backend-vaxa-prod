import { Router } from 'express';
import { RequestWithTenant } from '../../middleware/tenant.middleware';
import { requireModule } from '../../middleware/module-guard.middleware';
import { pacientesService } from './pacientes.service';

const router = Router();

/** Todas las rutas de pacientes requieren el módulo "pacientes" habilitado para el tenant. */
router.use(requireModule('pacientes'));

router.get('/', (req, res) => {
  const tenantId = (req as unknown as RequestWithTenant).tenant.id;
  const list = pacientesService.list(tenantId);
  res.json(list);
});

router.get('/:id', (req, res) => {
  const tenantId = (req as unknown as RequestWithTenant).tenant.id;
  const paciente = pacientesService.getById(tenantId, req.params.id);
  if (!paciente) {
    res.status(404).json({ error: 'Paciente no encontrado', id: req.params.id });
    return;
  }
  res.json(paciente);
});

router.post('/', (req, res) => {
  const tenantId = (req as unknown as RequestWithTenant).tenant.id;
  const { nombre, email, telefono } = req.body ?? {};
  if (!nombre || typeof nombre !== 'string') {
    res.status(400).json({ error: 'nombre es requerido' });
    return;
  }
  const created = pacientesService.create(tenantId, { nombre, email, telefono });
  res.status(201).json(created);
});

router.patch('/:id', (req, res) => {
  const tenantId = (req as unknown as RequestWithTenant).tenant.id;
  const updated = pacientesService.update(tenantId, req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: 'Paciente no encontrado', id: req.params.id });
    return;
  }
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const tenantId = (req as unknown as RequestWithTenant).tenant.id;
  const deleted = pacientesService.remove(tenantId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Paciente no encontrado', id: req.params.id });
    return;
  }
  res.status(204).send();
});

export const pacientesRoutes = router;
