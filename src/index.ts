import 'dotenv/config';
import * as path from 'path';
import express from 'express';
import cors from 'cors';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { jwtMiddleware } from './middleware/jwt.middleware';
import { authRoutes } from './modules/auth/auth.routes';
import { backofficeRoutes } from './modules/backoffice/backoffice.routes';
import { pacientesRoutes } from './modules/pacientes/pacientes.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { certificadosRoutes } from './modules/certificados/certificados.routes';
import { publicCertificadosRoutes } from './modules/certificados/public/public.routes';
import { validarPublico } from './modules/certificados/emision/emision.controller';

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '15mb' }));

const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');

app.get(`${BASE_PATH}/health`, (_req, res) => {
  res.json({ ok: true, service: 'vaxa-back', timestamp: new Date().toISOString() });
});

/** Servir PDFs y archivos subidos estáticamente */
app.use(`${BASE_PATH}/uploads`, express.static(path.join(process.cwd(), 'uploads')));

/** Auth — sin tenant middleware (login es público) */
app.use(`${BASE_PATH}/api/auth`, authRoutes);

/** Endpoints públicos de certificados — sin tenant middleware ni JWT */
app.use(`${BASE_PATH}/public/certificados`, publicCertificadosRoutes);
app.get(`${BASE_PATH}/public/certificado/:codigo`,
  (req, res) => validarPublico(req as any, res).catch((e: Error) => res.status(500).json({ error: e.message })),
);

/** Certificados: JWT + x-tenant-id, sin tenant middleware de config */
app.use(`${BASE_PATH}/api/certificados`, jwtMiddleware, certificadosRoutes);

/** Rutas antiguas: tenant middleware solo para las rutas que lo necesitan */
app.use(`${BASE_PATH}/api/backoffice`, tenantMiddleware, backofficeRoutes);
app.use(`${BASE_PATH}/api/dashboard`,  tenantMiddleware, dashboardRoutes);
app.use(`${BASE_PATH}/api/pacientes`,  tenantMiddleware, pacientesRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found', service: 'vaxa-back' });
});

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`Vaxa Back escuchando en http://localhost:${PORT}`);
  console.log(`  Auth:    POST ${BASE_PATH}/api/auth/login`);
  console.log(`  Certs:   ${BASE_PATH}/api/certificados (requiere x-tenant-id + JWT)`);
  console.log(`  Público: GET ${BASE_PATH}/public/certificado/:codigo`);
});
