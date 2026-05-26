import { pool, getEmpresaId } from './db.helper';

import { TipoDocumentoEntity, TipoProgramaEntity, ModalidadEntity } from '../catalogos/catalogo.entity';
import { ProgramaEntity }      from '../programas/programa.entity';
import { GrupoEntity }         from '../grupos/grupo.entity';
import { ParticipanteEntity }  from '../participantes/participante.entity';
import { InscripcionEntity }   from '../inscripciones/inscripcion.entity';
import { LogoEntity }          from '../logos/logo.entity';
import { FirmaEntity }         from '../firmas/firma.entity';
import { ConfigCertificadoEntity } from '../config/config.entity';
import { CertificadoEntity, CertificadoPublicoEntity } from '../emision/emision.entity';

import type { CreateProgramaDto, UpdateProgramaDto }   from '../programas/programa.dto';
import type { CreateGrupoDto }                         from '../grupos/grupo.dto';
import type { CreateParticipanteDto }                  from '../participantes/participante.dto';
import type { CreateInscripcionDto }                   from '../inscripciones/inscripcion.dto';
import type { CreateLogoDto }                          from '../logos/logo.dto';
import type { CreateFirmaDto }                         from '../firmas/firma.dto';
import type { UpsertConfigDto }                        from '../config/config.dto';

// ============================================================
// CATALOGOS
// ============================================================
export const catalogosRepo = {
  async findAll() {
    const p = pool();
    const [[docs], [progs], [mods]] = await Promise.all([
      p.query<any[]>('SELECT * FROM tipos_documento WHERE activo = 1'),
      p.query<any[]>('SELECT * FROM tipos_programa WHERE activo = 1'),
      p.query<any[]>('SELECT * FROM modalidades WHERE activo = 1'),
    ]);
    return {
      tipos_documento: (docs as any[]).map(TipoDocumentoEntity.fromRow),
      tipos_programa:  (progs as any[]).map(TipoProgramaEntity.fromRow),
      modalidades:     (mods as any[]).map(ModalidadEntity.fromRow),
    };
  },
};

// ============================================================
// PROGRAMAS
// ============================================================
export const programasRepo = {
  async findAll(tenantSlug: string): Promise<ProgramaEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, tp.nombre AS tipo_programa_nombre
       FROM programas p
       JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
       WHERE p.empresa_id = ? AND p.activo = 1
       ORDER BY p.created_at DESC`,
      [empresaId],
    );
    return (rows as any[]).map(ProgramaEntity.fromRow);
  },

  async findById(tenantSlug: string, id: number): Promise<ProgramaEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, tp.nombre AS tipo_programa_nombre
       FROM programas p
       JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
       WHERE p.id = ? AND p.empresa_id = ? AND p.activo = 1`,
      [id, empresaId],
    );
    return rows[0] ? ProgramaEntity.fromRow(rows[0]) : null;
  },

  async create(tenantSlug: string, dto: CreateProgramaDto, userId?: number): Promise<ProgramaEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO programas (empresa_id, tipo_programa_id, nombre, descripcion, horas_academicas, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.tipo_programa_id, dto.nombre, dto.descripcion ?? null, dto.horas_academicas, userId ?? null],
    );
    return (await programasRepo.findById(tenantSlug, result.insertId))!;
  },

  async update(tenantSlug: string, id: number, dto: UpdateProgramaDto, userId?: number): Promise<ProgramaEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const fields: string[] = [];
    const values: any[]    = [];
    if (dto.nombre           !== undefined) { fields.push('nombre = ?');           values.push(dto.nombre); }
    if (dto.descripcion      !== undefined) { fields.push('descripcion = ?');      values.push(dto.descripcion); }
    if (dto.horas_academicas !== undefined) { fields.push('horas_academicas = ?'); values.push(dto.horas_academicas); }
    if (dto.tipo_programa_id !== undefined) { fields.push('tipo_programa_id = ?'); values.push(dto.tipo_programa_id); }
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
      await pool().query(`UPDATE programas SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    return programasRepo.findById(tenantSlug, id);
  },
};

// ============================================================
// GRUPOS
// ============================================================
export const gruposRepo = {
  async findAll(tenantSlug: string): Promise<GrupoEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT g.*, p.nombre AS programa_nombre, m.nombre AS modalidad_nombre
       FROM grupos_programas g
       JOIN programas p   ON p.id = g.programa_id
       JOIN modalidades m ON m.id = g.modalidad_id
       WHERE g.empresa_id = ? AND g.activo = 1
       ORDER BY g.fecha_inicio DESC`,
      [empresaId],
    );
    return (rows as any[]).map(GrupoEntity.fromRow);
  },

  async findById(tenantSlug: string, id: number): Promise<GrupoEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT g.*, p.nombre AS programa_nombre, m.nombre AS modalidad_nombre
       FROM grupos_programas g
       JOIN programas p   ON p.id = g.programa_id
       JOIN modalidades m ON m.id = g.modalidad_id
       WHERE g.id = ? AND g.empresa_id = ?`,
      [id, empresaId],
    );
    return rows[0] ? GrupoEntity.fromRow(rows[0]) : null;
  },

  async create(tenantSlug: string, dto: CreateGrupoDto, userId?: number): Promise<GrupoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO grupos_programas (empresa_id, programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.programa_id, dto.nombre_grupo, dto.fecha_inicio, dto.fecha_fin, dto.modalidad_id, userId ?? null],
    );
    return (await gruposRepo.findById(tenantSlug, result.insertId))!;
  },
};

// ============================================================
// PARTICIPANTES
// ============================================================
export const participantesRepo = {
  async findAll(tenantSlug: string): Promise<ParticipanteEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
       FROM participantes p
       JOIN tipos_documento td ON td.id = p.tipo_documento_id
       WHERE p.empresa_id = ? AND p.activo = 1
       ORDER BY p.apellidos, p.nombres`,
      [empresaId],
    );
    return (rows as any[]).map(ParticipanteEntity.fromRow);
  },

  async findById(tenantSlug: string, id: number): Promise<ParticipanteEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
       FROM participantes p
       JOIN tipos_documento td ON td.id = p.tipo_documento_id
       WHERE p.id = ? AND p.empresa_id = ?`,
      [id, empresaId],
    );
    return rows[0] ? ParticipanteEntity.fromRow(rows[0]) : null;
  },

  async create(tenantSlug: string, dto: CreateParticipanteDto, userId?: number): Promise<ParticipanteEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO participantes (empresa_id, tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.tipo_documento_id, dto.numero_documento, dto.nombres, dto.apellidos,
       dto.email ?? null, dto.telefono ?? null, userId ?? null],
    );
    return (await participantesRepo.findById(tenantSlug, result.insertId))!;
  },
};

// ============================================================
// INSCRIPCIONES
// ============================================================
export const inscripcionesRepo = {
  async findAll(tenantSlug: string, grupoId?: number): Promise<InscripcionEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const base = `
      SELECT i.*,
             CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
             p.numero_documento, g.nombre_grupo,
             ei.nombre AS estado_nombre
      FROM inscripciones i
      JOIN participantes p       ON p.id  = i.participante_id
      JOIN grupos_programas g    ON g.id  = i.grupo_id
      JOIN estado_inscripcion ei ON ei.id = i.estado_id
      WHERE i.empresa_id = ?`;
    const [rows] = grupoId
      ? await pool().query<any[]>(`${base} AND i.grupo_id = ? ORDER BY p.apellidos`, [empresaId, grupoId])
      : await pool().query<any[]>(`${base} ORDER BY i.created_at DESC`, [empresaId]);
    return (rows as any[]).map(InscripcionEntity.fromRow);
  },

  async create(tenantSlug: string, dto: CreateInscripcionDto, userId?: number): Promise<InscripcionEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO inscripciones (empresa_id, participante_id, grupo_id, estado_id, fecha_inscripcion, user_crea_id)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [empresaId, dto.participante_id, dto.grupo_id, dto.fecha_inscripcion, userId ?? null],
    );
    const [rows] = await pool().query<any[]>(
      `SELECT i.*, ei.nombre AS estado_nombre FROM inscripciones i
       JOIN estado_inscripcion ei ON ei.id = i.estado_id WHERE i.id = ?`,
      [result.insertId],
    );
    return InscripcionEntity.fromRow(rows[0]);
  },

  async cambiarEstado(tenantSlug: string, id: number, estadoId: number, userId?: number): Promise<InscripcionEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [upd] = await pool().query<any>(
      'UPDATE inscripciones SET estado_id = ?, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
      [estadoId, userId ?? null, id, empresaId],
    );
    if (!upd.affectedRows) return null;
    const [rows] = await pool().query<any[]>(
      `SELECT i.*, CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, g.nombre_grupo, ei.nombre AS estado_nombre
       FROM inscripciones i
       JOIN participantes p       ON p.id  = i.participante_id
       JOIN grupos_programas g    ON g.id  = i.grupo_id
       JOIN estado_inscripcion ei ON ei.id = i.estado_id
       WHERE i.id = ?`,
      [id],
    );
    return rows[0] ? InscripcionEntity.fromRow(rows[0]) : null;
  },
};

// ============================================================
// LOGOS
// ============================================================
export const logosRepo = {
  async findAll(tenantSlug: string): Promise<LogoEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      'SELECT * FROM logos WHERE empresa_id = ? AND activo = 1 ORDER BY created_at DESC',
      [empresaId],
    );
    return (rows as any[]).map(LogoEntity.fromRow);
  },

  async create(tenantSlug: string, dto: CreateLogoDto, userId?: number): Promise<LogoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      'INSERT INTO logos (empresa_id, nombre, imagen_logo, user_crea_id) VALUES (?, ?, ?, ?)',
      [empresaId, dto.nombre ?? null, dto.imagen_logo, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM logos WHERE id = ?', [result.insertId]);
    return LogoEntity.fromRow(rows[0]);
  },

  async remove(tenantSlug: string, id: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [r] = await pool().query<any>('UPDATE logos SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    return r.affectedRows > 0;
  },
};

// ============================================================
// FIRMAS
// ============================================================
export const firmasRepo = {
  async findAll(tenantSlug: string): Promise<FirmaEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      'SELECT * FROM firmas WHERE empresa_id = ? AND activo = 1 ORDER BY created_at DESC',
      [empresaId],
    );
    return (rows as any[]).map(FirmaEntity.fromRow);
  },

  async create(tenantSlug: string, dto: CreateFirmaDto, userId?: number): Promise<FirmaEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      'INSERT INTO firmas (empresa_id, nombre_autoridad, cargo, imagen_firma, user_crea_id) VALUES (?, ?, ?, ?, ?)',
      [empresaId, dto.nombre_autoridad, dto.cargo, dto.imagen_firma, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM firmas WHERE id = ?', [result.insertId]);
    return FirmaEntity.fromRow(rows[0]);
  },

  async remove(tenantSlug: string, id: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [r] = await pool().query<any>('UPDATE firmas SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    return r.affectedRows > 0;
  },
};

// ============================================================
// CONFIG
// ============================================================
export const configRepo = {
  async findByPrograma(tenantSlug: string, programaId: number): Promise<ConfigCertificadoEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT cc.*,
              l.imagen_logo, l.nombre AS logo_nombre,
              f1.nombre_autoridad AS firma1_autoridad, f1.cargo AS firma1_cargo, f1.imagen_firma AS firma1_imagen,
              f2.nombre_autoridad AS firma2_autoridad, f2.cargo AS firma2_cargo, f2.imagen_firma AS firma2_imagen
       FROM configuraciones_certificado cc
       LEFT JOIN logos l   ON l.id  = cc.logo_id
       LEFT JOIN firmas f1 ON f1.id = cc.firma_1_id
       LEFT JOIN firmas f2 ON f2.id = cc.firma_2_id
       WHERE cc.empresa_id = ? AND cc.programa_id = ? AND cc.activo = 1`,
      [empresaId, programaId],
    );
    return rows[0] ? ConfigCertificadoEntity.fromRow(rows[0]) : null;
  },

  async upsert(tenantSlug: string, programaId: number, dto: UpsertConfigDto, userId?: number): Promise<ConfigCertificadoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query(
      `INSERT INTO configuraciones_certificado (empresa_id, programa_id, plantilla_url, firma_1_id, firma_2_id, logo_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         plantilla_url = VALUES(plantilla_url),
         firma_1_id    = VALUES(firma_1_id),
         firma_2_id    = VALUES(firma_2_id),
         logo_id       = VALUES(logo_id),
         user_actua_id = ?`,
      [empresaId, programaId, dto.plantilla_url, dto.firma_1_id ?? null,
       dto.firma_2_id ?? null, dto.logo_id ?? null, userId ?? null, userId ?? null],
    );
    return (await configRepo.findByPrograma(tenantSlug, programaId))!;
  },
};

// ============================================================
// EMISION
// ============================================================
function generarCodigo(empresaId: number): string {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CERT-${empresaId}-${ts}-${rnd}`;
}

export const emisionRepo = {
  async findAll(tenantSlug: string): Promise<CertificadoEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, prog.nombre AS programa_nombre,
              g.nombre_grupo, ec.nombre AS estado_nombre
       FROM certificados c
       JOIN inscripciones i       ON i.id   = c.inscripcion_id
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN estado_certificado ec ON ec.id  = c.estado_id
       WHERE c.empresa_id = ?
       ORDER BY c.created_at DESC`,
      [empresaId],
    );
    return (rows as any[]).map(CertificadoEntity.fromRow);
  },

  async generar(tenantSlug: string, inscripcionId: number, userId?: number): Promise<CertificadoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);

    const [insc] = await pool().query<any[]>(
      'SELECT * FROM inscripciones WHERE id = ? AND empresa_id = ? AND estado_id = 3',
      [inscripcionId, empresaId],
    );
    if (!(insc as any[]).length) throw new Error('Inscripción no encontrada o el participante no está aprobado');

    const [dup] = await pool().query<any[]>(
      'SELECT id FROM certificados WHERE inscripcion_id = ? AND estado_id != 2',
      [inscripcionId],
    );
    if ((dup as any[]).length) throw new Error('Ya existe un certificado vigente para esta inscripción');

    const [result] = await pool().query<any>(
      `INSERT INTO certificados (empresa_id, inscripcion_id, codigo_unico, fecha_emision, estado_id, user_crea_id)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [empresaId, inscripcionId, generarCodigo(empresaId), new Date().toISOString().split('T')[0], userId ?? null],
    );
    // Retornar con todos los joins necesarios para el frontend
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, prog.nombre AS programa_nombre,
              g.nombre_grupo, ec.nombre AS estado_nombre
       FROM certificados c
       JOIN inscripciones i       ON i.id   = c.inscripcion_id
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN estado_certificado ec ON ec.id  = c.estado_id
       WHERE c.id = ?`,
      [result.insertId],
    );
    return CertificadoEntity.fromRow((rows as any[])[0]);
  },

  async validarPublico(codigoUnico: string): Promise<CertificadoPublicoEntity | null> {
    const [rows] = await pool().query<any[]>(
      `SELECT c.codigo_unico, c.fecha_emision, c.url,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, td.codigo AS tipo_doc,
              prog.nombre AS programa_nombre, prog.horas_academicas,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              m.nombre AS modalidad, ec.nombre AS estado,
              e.razon_social AS empresa_nombre, e.logo_url AS empresa_logo
       FROM certificados c
       JOIN inscripciones i    ON i.id  = c.inscripcion_id
       JOIN participantes p    ON p.id  = i.participante_id
       JOIN tipos_documento td ON td.id = p.tipo_documento_id
       JOIN grupos_programas g ON g.id  = i.grupo_id
       JOIN programas prog     ON prog.id = g.programa_id
       JOIN modalidades m      ON m.id  = g.modalidad_id
       JOIN estado_certificado ec ON ec.id = c.estado_id
       JOIN empresas e         ON e.id  = c.empresa_id
       WHERE c.codigo_unico = ?`,
      [codigoUnico],
    );
    return rows[0] ? CertificadoPublicoEntity.fromRow(rows[0]) : null;
  },

  async anular(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [r] = await pool().query<any>(
      'UPDATE certificados SET estado_id = 2, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
      [userId ?? null, id, empresaId],
    );
    return r.affectedRows > 0;
  },
};
