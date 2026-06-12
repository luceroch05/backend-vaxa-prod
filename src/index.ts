// En local carga el .env; en producción las env vars las inyecta Passenger
// (SetEnv en .htaccess), así que si dotenv no está instalado, no debe romper.
try { require('dotenv').config(); } catch { /* dotenv ausente en prod: ok */ }
import * as path from 'path';
import express from 'express';
import cors from 'cors';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { jwtMiddleware } from './middleware/jwt.middleware';
import { rateLimit } from './middleware/rate-limit.middleware';
import { tenantMatchMiddleware } from './middleware/tenant-match.middleware';
import { requireRootTenant } from './middleware/require-root-tenant.middleware';
import { creditosAdminRoutes } from './modules/admin/creditos.admin.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { backofficeRoutes } from './modules/backoffice/backoffice.routes';
import { pacientesRoutes } from './modules/pacientes/pacientes.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { certificadosRoutes } from './modules/certificados/certificados.routes';
import { publicCertificadosRoutes } from './modules/certificados/public/public.routes';
import { validarPublico } from './modules/certificados/emision/emision.controller';

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// En desarrollo permitimos cualquier puerto de localhost (5173, 5174, etc.) para
// no romper por el puerto que Vite elija. En producción solo los orígenes de CORS_ORIGINS.
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    // Sin Origin (curl, apps móviles, same-origin) → permitir.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
}));
app.use(express.json({ limit: '15mb' }));

const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');

app.get(`${BASE_PATH}/health`, (_req, res) => {
  res.json({ ok: true, service: 'vaxa-back', timestamp: new Date().toISOString() });
});

/** Servir PDFs y archivos subidos estáticamente */
app.use(`${BASE_PATH}/uploads`, express.static(path.join(process.cwd(), 'uploads')));

/** Auth — sin tenant middleware (login es público) */
app.use(`${BASE_PATH}/api/auth`, authRoutes);

/** Endpoints públicos de certificados — sin tenant middleware ni JWT.
 *  Límite general holgado contra abuso (una carga normal hace varias llamadas:
 *  /existe, /catalogos, /grupos). El límite ESTRICTO contra scraping de datos
 *  va aparte, solo en /participante (ver public.routes.ts). */
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 200,            // 200 peticiones/min por IP
  message: 'Demasiadas peticiones. Espera un momento antes de reintentar.',
});
app.use(`${BASE_PATH}/public/certificados`, publicLimiter, publicCertificadosRoutes);
app.get(`${BASE_PATH}/public/certificado/:codigo`, publicLimiter,
  (req, res) => validarPublico(req as any, res).catch((e: Error) => res.status(500).json({ error: e.message })),
);

/** Certificados: JWT + verificación de que el tenant del token == x-tenant-id */
app.use(`${BASE_PATH}/api/certificados`, jwtMiddleware, tenantMatchMiddleware, certificadosRoutes);

/** Administración Vaxa: JWT + solo tenant raíz (créditos, empresas y usuarios de todas las empresas) */
app.use(`${BASE_PATH}/api/admin/creditos`, jwtMiddleware, requireRootTenant, creditosAdminRoutes);
app.use(`${BASE_PATH}/api/admin`,          jwtMiddleware, requireRootTenant, adminRoutes);

/** Rutas antiguas: tenant middleware solo para las rutas que lo necesitan */
app.use(`${BASE_PATH}/api/backoffice`, tenantMiddleware, backofficeRoutes);
app.use(`${BASE_PATH}/api/dashboard`,  tenantMiddleware, dashboardRoutes);
app.use(`${BASE_PATH}/api/pacientes`,  tenantMiddleware, pacientesRoutes);

/** ───────────────────────────────────────────────────────────
 *  Frontend (build de Vite). En producción Passenger monta la app
 *  en "/", así que Express también sirve el frontend estático.
 *  Subir el contenido del dist/ del frontend a: <appRoot>/frontend
 *  (en el server: /home/vaxasysc/vaxa-api/frontend)
 *  ─────────────────────────────────────────────────────────── */
const FRONTEND_DIR = path.join(process.cwd(), 'frontend');
app.use(express.static(FRONTEND_DIR));

/** SPA fallback: GET que no sea API/public/uploads/health → index.html */
const NON_SPA = [`${BASE_PATH}/api`, `${BASE_PATH}/public`, `${BASE_PATH}/uploads`, `${BASE_PATH}/health`];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (NON_SPA.some((p) => req.path.startsWith(p))) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'), (err) => { if (err) next(); });
});

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
