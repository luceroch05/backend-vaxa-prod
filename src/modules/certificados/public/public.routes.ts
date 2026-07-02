import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../../../db/pool';
import { pool, getEmpresaId, estaVencidaPorPago, MSG_VENCIDA } from '../shared/db.helper';
import { catalogosRepo } from '../shared/certificados.repository';
import { rateLimit } from '../../../middleware/rate-limit.middleware';

const router = Router({ mergeParams: true });

/** Límite estricto SOLO para la búsqueda por documento: es el vector de scraping
 *  de datos personales (iterar DNIs). 20 búsquedas/min por IP son de sobra para
 *  un alumno real y cortan la enumeración masiva. */
const participanteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Demasiadas búsquedas. Espera un momento antes de reintentar.',
});

/**
 * Enmascara datos de contacto para que el dueño real se reconozca ("¿eres tú?")
 * pero un scraper que itera documentos no obtenga PII utilizable.
 */
const maskEmail = (e?: string | null): string | null =>
  e ? e.replace(/^(.).*?(@.*)$/, '$1***$2') : null;
const maskTel = (t?: string | null): string | null =>
  t ? t.replace(/.(?=.{2})/g, '*') : null;

/**
 * GET /public/certificados/:tenantSlug/existe
 * Indica si el tenant_slug corresponde a una empresa registrada y si está activa.
 * Devolvemos también las empresas DESACTIVADAS (exists=true, activo=false): así la
 * validación pública de certificados sigue funcionando para ellas, mientras el
 * frontend bloquea el login interno y la inscripción a programas.
 */
router.get('/:tenantSlug/existe', async (req: Request, res: Response) => {
  try {
    const slug = req.params.tenantSlug?.toLowerCase().trim();
    const [rows] = await pool().query<any[]>(
      'SELECT id, razon_social, logo_url, activo FROM empresas WHERE tenant_slug = ? LIMIT 1',
      [slug],
    );
    const e = (rows as any[])[0];
    res.json({
      exists: !!e,
      activo: e ? !!e.activo : false,
      razon_social: e?.razon_social ?? null,
      logo_url: e?.logo_url ?? null,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * GET /public/certificados/:tenantSlug/catalogos
 * Catálogos para el formulario público (sin JWT)
 */
router.get('/:tenantSlug/catalogos', async (req: Request, res: Response) => {
  try {
    const catalogos = await catalogosRepo.findAll();
    res.json({
      tipos_documento: catalogos.tipos_documento,
      tipos_programa:  catalogos.tipos_programa,
      modalidades:     catalogos.modalidades,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * GET /public/certificados/:tenantSlug/grupos
 * Grupos activos con info del programa (para que el alumno elija)
 */
router.get('/:tenantSlug/grupos', async (req: Request, res: Response) => {
  try {
    const empresaId = await getEmpresaId(req.params.tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT g.id, g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              g.dias_semana, g.hora_inicio, g.hora_fin,
              g.modalidad_id, m.nombre AS modalidad_nombre,
              g.programa_id, p.nombre AS programa_nombre,
              p.horas_academicas, p.descripcion AS programa_descripcion,
              tp.nombre AS tipo_programa_nombre
       FROM grupos_programas g
       JOIN programas p   ON p.id = g.programa_id
       JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
       JOIN modalidades m ON m.id = g.modalidad_id
       WHERE g.empresa_id = ? AND g.activo = 1 AND p.activo = 1
       ORDER BY g.fecha_inicio DESC`,
      [empresaId]
    );
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * POST /public/certificados/:tenantSlug/registro
 * Registro público de alumno: crea/recupera participante e inscripción.
 * No requiere JWT — es el endpoint que usa el formulario público.
 */
router.get('/:tenantSlug/participante', participanteLimiter, async (req: Request, res: Response) => {
  try {
    const documento = (req.query.documento as string)?.trim();
    if (!documento) { res.status(400).json({ error: 'documento es requerido' }); return; }
    const empresaId = await getEmpresaId(req.params.tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT tipo_documento_id, numero_documento, nombres, apellidos, email, telefono
       FROM participantes
       WHERE empresa_id = ? AND numero_documento = ? AND activo = 1
       LIMIT 1`,
      [empresaId, documento],
    );
    if (!(rows as any[]).length) { res.status(404).json({ error: 'No registrado' }); return; }
    const p = (rows as any[])[0];
    // Devolvemos contacto enmascarado: el alumno se reconoce, pero un scraper
    // que enumera documentos no obtiene email/teléfono reales.
    res.json({
      tipo_documento_id: p.tipo_documento_id,
      numero_documento:  p.numero_documento,
      nombres:           p.nombres,
      apellidos:         p.apellidos,
      email:             maskEmail(p.email),
      telefono:          maskTel(p.telefono),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/:tenantSlug/registro', async (req: Request, res: Response) => {
  const { tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, telefono_pais, grupo_id } = req.body ?? {};

  if (!tipo_documento_id || !numero_documento || !nombres || !apellidos || !grupo_id) {
    res.status(400).json({ error: 'tipo_documento_id, numero_documento, nombres, apellidos y grupo_id son requeridos' });
    return;
  }

  const db = getPool();
  if (!db) { res.status(503).json({ error: 'Base de datos no disponible' }); return; }

  try {
    const empresaId = await getEmpresaId(req.params.tenantSlug);

    // Bloqueo por falta de pago: si el plan venció, no se aceptan nuevas inscripciones.
    if (await estaVencidaPorPago(empresaId)) {
      res.status(403).json({ error: MSG_VENCIDA });
      return;
    }

    // Verificar que el grupo pertenece a esta empresa y está activo
    const [grupoRows] = await db.execute<any[]>(
      'SELECT id FROM grupos_programas WHERE id = ? AND empresa_id = ? AND activo = 1',
      [grupo_id, empresaId]
    );
    if (!(grupoRows as any[]).length) {
      res.status(404).json({ error: 'Grupo no encontrado o no disponible' });
      return;
    }

    // Buscar participante existente o crearlo
    const [existentes] = await db.execute<any[]>(
      'SELECT id FROM participantes WHERE empresa_id = ? AND tipo_documento_id = ? AND numero_documento = ?',
      [empresaId, tipo_documento_id, numero_documento.trim()]
    );

    let participanteId: number;
    if ((existentes as any[]).length > 0) {
      participanteId = (existentes as any[])[0].id;
    } else {
      const [result] = await db.execute<any>(
        `INSERT INTO participantes (empresa_id, tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, telefono_pais)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, tipo_documento_id, numero_documento.trim(), nombres.trim(), apellidos.trim(), email || null, telefono || null, telefono_pais || null]
      );
      participanteId = result.insertId;
    }

    // Verificar inscripción duplicada SOLO en este mismo grupo (no rechazada).
    // Sí se permite reinscribirse al mismo programa en OTRO grupo.
    const [inscExistente] = await db.execute<any[]>(
      `SELECT i.id
       FROM inscripciones i
       WHERE i.empresa_id = ? AND i.participante_id = ? AND i.grupo_id = ? AND i.estado_id <> 6
       LIMIT 1`,
      [empresaId, participanteId, grupo_id]
    );
    if ((inscExistente as any[]).length > 0) {
      res.status(409).json({ error: 'Ya estás inscrito en este grupo.' });
      return;
    }

    // Crear inscripción con estado INSCRITO (1) y fecha de hoy
    const hoy = new Date().toISOString().split('T')[0];
    const [result] = await db.execute<any>(
      `INSERT INTO inscripciones (empresa_id, participante_id, grupo_id, estado_id, fecha_inscripcion)
       VALUES (?, ?, ?, 1, ?)`,
      [empresaId, participanteId, grupo_id, hoy]
    );

    res.status(201).json({ participante_id: participanteId, inscripcion_id: result.insertId });
  } catch (e: unknown) {
    console.error('[public registro]', e);
    res.status(500).json({ error: 'Error al procesar el registro' });
  }
});

export const publicCertificadosRoutes = router;
