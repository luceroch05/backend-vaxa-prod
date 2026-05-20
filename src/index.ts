import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { backofficeRoutes } from './modules/backoffice/backoffice.routes';
import { pacientesRoutes } from './modules/pacientes/pacientes.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { certificadosRoutes } from './modules/certificados/certificados.routes';
import { validarPublico } from './modules/certificados/emision/emision.controller';

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

/** Base path para cPanel (ej: /backend_vaxa). En local queda vacío. */
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');

/** Health sin tenant (para load balancers / monitoreo). */
app.get(`${BASE_PATH}/health`, (_req, res) => {
  res.json({ ok: true, service: 'vaxa-back', timestamp: new Date().toISOString() });
});

/** Rutas que requieren tenant: middleware resuelve req.tenant. El front envía x-tenant-id en todas (incl. backoffice). */
app.use(BASE_PATH, tenantMiddleware);

app.use(`${BASE_PATH}/api/backoffice`, backofficeRoutes);
app.use(`${BASE_PATH}/api/dashboard`, dashboardRoutes);
app.use(`${BASE_PATH}/api/pacientes`, pacientesRoutes);
app.use(`${BASE_PATH}/api/certificados`, certificadosRoutes);

/** Validación pública — sin tenant middleware */
app.get(`${BASE_PATH}/public/certificado/:codigo`,
  (req, res) => validarPublico(req as any, res).catch((e: Error) => res.status(500).json({ error: e.message })),
);

/** 404 desde Express (JSON). Si ves HTML 404, la petición no está llegando a Node. */
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found', service: 'vaxa-back' });
});

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  const base = BASE_PATH || '(raíz)';
  console.log(`Vaxa Back escuchando en http://localhost:${PORT}`);
  console.log(`  Base path: ${base}`);
  console.log(`  Health: GET ${BASE_PATH}/health (sin tenant)`);
  console.log('  Con header x-tenant-id: .../api/backoffice/empresas, .../api/dashboard/config, .../api/pacientes');
});
