import { Router } from 'express';
import { RequestWithTenant } from '../../middleware/tenant.middleware';
import { requireModule } from '../../middleware/module-guard.middleware';
import { dashboardService } from './dashboard.service';

const router = Router();

router.use(requireModule('dashboard'));

/** Config del tenant actual (módulos, nombre). El front puede usar esto para no duplicar config. */
router.get('/config', (req, res) => {
  const tenant = (req as unknown as RequestWithTenant).tenant;
  const data = dashboardService.getConfig(tenant.id, tenant);
  res.json(data);
});

export const dashboardRoutes = router;
