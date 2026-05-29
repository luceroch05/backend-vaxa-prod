import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../../../db/pool';
import { pool, getEmpresaId } from '../shared/db.helper';
import { catalogosRepo } from '../shared/certificados.repository';

const router = Router({ mergeParams: true });

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
router.get('/:tenantSlug/participante', async (req: Request, res: Response) => {
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
    res.json((rows as any[])[0]);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/:tenantSlug/registro', async (req: Request, res: Response) => {
  const { tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, grupo_id } = req.body ?? {};

  if (!tipo_documento_id || !numero_documento || !nombres || !apellidos || !grupo_id) {
    res.status(400).json({ error: 'tipo_documento_id, numero_documento, nombres, apellidos y grupo_id son requeridos' });
    return;
  }

  const db = getPool();
  if (!db) { res.status(503).json({ error: 'Base de datos no disponible' }); return; }

  try {
    const empresaId = await getEmpresaId(req.params.tenantSlug);

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
        `INSERT INTO participantes (empresa_id, tipo_documento_id, numero_documento, nombres, apellidos, email, telefono)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, tipo_documento_id, numero_documento.trim(), nombres.trim(), apellidos.trim(), email || null, telefono || null]
      );
      participanteId = result.insertId;
    }

    // Verificar inscripción duplicada en el mismo PROGRAMA (cualquier grupo, no rechazada)
    const [inscExistente] = await db.execute<any[]>(
      `SELECT g2.nombre_grupo
       FROM grupos_programas g
       JOIN grupos_programas g2 ON g2.programa_id = g.programa_id
       JOIN inscripciones i     ON i.grupo_id = g2.id
       WHERE g.id = ? AND i.empresa_id = ? AND i.participante_id = ? AND i.estado_id <> 6
       LIMIT 1`,
      [grupo_id, empresaId, participanteId]
    );
    if ((inscExistente as any[]).length > 0) {
      const g = (inscExistente as any[])[0].nombre_grupo;
      res.status(409).json({ error: `Ya estás inscrito en este programa (grupo "${g}").` });
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
