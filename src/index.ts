// En local carga el .env; en producción las env vars las inyecta Passenger
// (SetEnv en .htaccess), así que si dotenv no está instalado, no debe romper.
try { require('dotenv').config(); } catch { /* dotenv ausente en prod: ok */ }
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { initSessionSocket } from './realtime/session-socket';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { jwtMiddleware } from './middleware/jwt.middleware';
import { rateLimit } from './middleware/rate-limit.middleware';
import { tenantMatchMiddleware } from './middleware/tenant-match.middleware';
import { bloqueoVencimientoMiddleware } from './middleware/bloqueo-vencimiento.middleware';
import { requireRootTenant } from './middleware/require-root-tenant.middleware';
import { creditosAdminRoutes } from './modules/admin/creditos.admin.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { cotizacionRoutes } from './modules/cotizaciones/cotizacion.routes';
import { reclamosPublicRoutes } from './modules/reclamaciones/reclamo.public.routes';
import { reclamosAdminRoutes } from './modules/reclamaciones/reclamo.admin.routes';
import { tarifarioRoutes } from './modules/tarifario/tarifario.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { backofficeRoutes } from './modules/backoffice/backoffice.routes';
import { pacientesRoutes } from './modules/pacientes/pacientes.routes';
import { historiasRoutes } from './modules/historias/historias.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { certificadosRoutes } from './modules/certificados/certificados.routes';
import { publicCertificadosRoutes } from './modules/certificados/public/public.routes';
import { validarPublico } from './modules/certificados/emision/emision.controller';
import { sendError } from './shared/errors';

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// En desarrollo permitimos cualquier puerto de localhost (5173, 5174, etc.) para
// no romper por el puerto que Vite elija. En producción solo los orígenes de CORS_ORIGINS.
const IS_PROD = process.env.NODE_ENV === 'production';

// Orígenes para WebSocket (sesión única) derivados de los orígenes HTTP permitidos.
const WS_ORIGINS = ALLOWED_ORIGINS.map((o) => o.replace(/^http/, 'ws'));

/**
 * Cabeceras de seguridad (Helmet). La CSP está afinada para NO romper el SPA:
 *  - scripts/CSS del build de Vite son externos (self), no inline.
 *  - styleSrc permite 'unsafe-inline' por los estilos en línea de React (style={{}}).
 *  - Google Fonts (googleapis/gstatic) van explícitos.
 *  - imágenes/PDFs en data:/blob: (QR, logos embebidos, vista previa de PDF).
 *  - connectSrc incluye la API y el WebSocket.
 * crossOriginResourcePolicy = cross-origin: permite que el frontend (otro origen
 * en dev) cargue los PDFs/imágenes servidos en /uploads.
 */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...ALLOWED_ORIGINS],
      connectSrc: ["'self'", ...ALLOWED_ORIGINS, ...WS_ORIGINS],
      objectSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'", 'blob:'],
      // Forzar https solo en producción (en dev rompería localhost http).
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
}));

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    // Sin Origin (curl, apps móviles, same-origin) → permitir.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // Origen NO permitido: se deniega sin lanzar Error. Lanzar aquí hace que
    // Express loguee todo el stack y responda 500, inundando los logs cuando
    // alguien abre el front local contra esta API. Con `false` simplemente no se
    // envían las cabeceras CORS y el navegador bloquea la petición del lado cliente.
    return callback(null, false);
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
app.get(`${BASE_PATH}/public/certificado/:tenantSlug/:codigo`, publicLimiter,
  (req, res) => validarPublico(req as any, res).catch((e: unknown) => sendError(res, e, 'public/certificado')),
);

/** Libro de Reclamaciones Virtual — registro público (sin JWT ni tenant). */
app.use(`${BASE_PATH}/public/reclamos`, publicLimiter, reclamosPublicRoutes);

/** Certificados: JWT + verificación de que el tenant del token == x-tenant-id */
app.use(`${BASE_PATH}/api/certificados`, jwtMiddleware, tenantMatchMiddleware, bloqueoVencimientoMiddleware, certificadosRoutes);

/** Historias Clínicas (centros terapéuticos): mismo stack que certificados —
 *  JWT + tenant del token == x-tenant-id + bloqueo por vencimiento de pago. */
app.use(`${BASE_PATH}/api/historias`, jwtMiddleware, tenantMatchMiddleware, bloqueoVencimientoMiddleware, historiasRoutes);

/** Administración Vaxa: JWT + solo tenant raíz (créditos, empresas y usuarios de todas las empresas) */
app.use(`${BASE_PATH}/api/admin/creditos`,      jwtMiddleware, requireRootTenant, creditosAdminRoutes);
app.use(`${BASE_PATH}/api/admin/cotizaciones`,  jwtMiddleware, requireRootTenant, cotizacionRoutes);
app.use(`${BASE_PATH}/api/admin/reclamos`,      jwtMiddleware, requireRootTenant, reclamosAdminRoutes);
app.use(`${BASE_PATH}/api/admin/tarifario`,     jwtMiddleware, requireRootTenant, tarifarioRoutes);
app.use(`${BASE_PATH}/api/admin`,               jwtMiddleware, requireRootTenant, adminRoutes);

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

// Servidor HTTP explícito para poder compartirlo con el WebSocket de sesión única.
const server = http.createServer(app);
initSessionSocket(server);

server.listen(PORT, () => {
  console.log(`Vaxa Back escuchando en http://localhost:${PORT}`);
  console.log(`  Auth:    POST ${BASE_PATH}/api/auth/login`);
  console.log(`  Certs:   ${BASE_PATH}/api/certificados (requiere x-tenant-id + JWT)`);
  console.log(`  Público: GET ${BASE_PATH}/public/certificado/:tenantSlug/:codigo`);
});
