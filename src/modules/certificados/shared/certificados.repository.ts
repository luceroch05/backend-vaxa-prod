import * as path from 'path';
import * as fs from 'fs';
import { pool, getEmpresaId } from './db.helper';
import { planRepo } from '../planes/plan.repository';
import { aTituloNombre } from '../../../shared/text';
import { pdfService, type PdfDatos } from '../pdf/pdf.service';

import { TipoDocumentoEntity, TipoProgramaEntity, ModalidadEntity } from '../catalogos/catalogo.entity';
import { ProgramaEntity }      from '../programas/programa.entity';
import { GrupoEntity }         from '../grupos/grupo.entity';
import { ParticipanteEntity }  from '../participantes/participante.entity';
import { InscripcionEntity }   from '../inscripciones/inscripcion.entity';
import { LogoEntity }          from '../logos/logo.entity';
import { FirmaEntity }         from '../firmas/firma.entity';
import { ConfigCertificadoEntity } from '../config/config.entity';
import { CertificadoEntity, CertificadoPublicoEntity } from '../emision/emision.entity';
import { UnidadEntity } from '../unidades/unidad.entity';

import type { CreateProgramaDto, UpdateProgramaDto }   from '../programas/programa.dto';
import type { CreateGrupoDto }                         from '../grupos/grupo.dto';
import type { CreateParticipanteDto }                  from '../participantes/participante.dto';
import type { CreateInscripcionDto, InscribirDto }      from '../inscripciones/inscripcion.dto';
import type { CreateLogoDto }                          from '../logos/logo.dto';
import type { CreateFirmaDto }                         from '../firmas/firma.dto';
import type { UpsertConfigDto }                        from '../config/config.dto';
import type { CreateUnidadDto, UpdateUnidadDto }        from '../unidades/unidad.dto';
import type { NotaInput }                               from '../notas/nota.dto';
import archiver = require('archiver');
import { PassThrough } from 'stream';
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
      `INSERT INTO programas (empresa_id, tipo_programa_id, nombre, descripcion, horas_academicas, unidad_label, nota_minima, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.tipo_programa_id, dto.nombre, dto.descripcion ?? null, dto.horas_academicas,
       dto.unidad_label || 'Unidad', dto.nota_minima ?? 11, userId ?? null],
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
    if (dto.unidad_label     !== undefined) { fields.push('unidad_label = ?');     values.push(dto.unidad_label || 'Unidad'); }
    if (dto.nota_minima      !== undefined) { fields.push('nota_minima = ?');       values.push(dto.nota_minima); }
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
      await pool().query(`UPDATE programas SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    return programasRepo.findById(tenantSlug, id);
  },
};

// ============================================================
// UNIDADES (plan del programa)
// ============================================================
export const unidadesRepo = {
  async findByPrograma(tenantSlug: string, programaId: number): Promise<UnidadEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT * FROM unidades WHERE empresa_id = ? AND programa_id = ? AND activo = 1 ORDER BY orden, id`,
      [empresaId, programaId],
    );
    return (rows as any[]).map(UnidadEntity.fromRow);
  },

  async create(tenantSlug: string, dto: CreateUnidadDto, userId?: number): Promise<UnidadEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO unidades (empresa_id, programa_id, nombre, orden, user_crea_id) VALUES (?, ?, ?, ?, ?)`,
      [empresaId, dto.programa_id, dto.nombre, dto.orden ?? 1, userId ?? null],
    );
    const [rows] = await pool().query<any[]>(`SELECT * FROM unidades WHERE id = ?`, [result.insertId]);
    return UnidadEntity.fromRow(rows[0]);
  },

  async update(tenantSlug: string, id: number, dto: UpdateUnidadDto, userId?: number): Promise<UnidadEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const fields: string[] = [];
    const values: any[]    = [];
    if (dto.nombre !== undefined) { fields.push('nombre = ?'); values.push(dto.nombre); }
    if (dto.orden  !== undefined) { fields.push('orden = ?');  values.push(dto.orden); }
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
      await pool().query(`UPDATE unidades SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    const [rows] = await pool().query<any[]>(`SELECT * FROM unidades WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
    return rows[0] ? UnidadEntity.fromRow(rows[0]) : null;
  },

  async remove(tenantSlug: string, id: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    // El borrado de unidad arrastra sus notas (ON DELETE CASCADE).
    const [r] = await pool().query<any>(`DELETE FROM unidades WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
    return r.affectedRows > 0;
  },
};

// ============================================================
// NOTAS (por alumno / unidad) + aprobación
// ============================================================

/** Recalcula el estado de la inscripción según el promedio simple de sus notas. */
async function recomputarEstadoInscripcion(empresaId: number, inscripcionId: number, userId?: number): Promise<void> {
  const [pr] = await pool().query<any[]>(
    `SELECT prog.id AS programa_id, prog.nota_minima, i.estado_id
     FROM inscripciones i
     JOIN grupos_programas g ON g.id = i.grupo_id
     JOIN programas prog     ON prog.id = g.programa_id
     WHERE i.id = ? AND i.empresa_id = ?`,
    [inscripcionId, empresaId],
  );
  if (!pr[0]) return;
  const { programa_id, nota_minima, estado_id } = pr[0];
  // No tocar RETIRADO (5) ni RECHAZADO (6).
  if (estado_id === 5 || estado_id === 6) return;

  const [uni] = await pool().query<any[]>(
    `SELECT COUNT(*) AS total FROM unidades WHERE programa_id = ? AND activo = 1`,
    [programa_id],
  );
  const totalUnidades = Number((uni as any[])[0]?.total ?? 0);
  if (totalUnidades === 0) return; // Programa sin unidades: la aprobación se maneja manual.

  const [nt] = await pool().query<any[]>(
    `SELECT n.nota FROM notas n
     JOIN unidades u ON u.id = n.unidad_id AND u.activo = 1
     WHERE n.inscripcion_id = ?`,
    [inscripcionId],
  );
  const notas = (nt as any[]).map(r => Number(r.nota));
  // Solo decidir aprobación cuando estén todas las unidades calificadas.
  if (notas.length < totalUnidades) return;

  const promedio = notas.reduce((a, b) => a + b, 0) / notas.length;
  const nuevoEstado = promedio >= Number(nota_minima) ? 3 : 4; // APROBADO / DESAPROBADO
  await pool().query(
    `UPDATE inscripciones SET estado_id = ?, user_actua_id = ? WHERE id = ? AND empresa_id = ?`,
    [nuevoEstado, userId ?? null, inscripcionId, empresaId],
  );
}

function resumenFila(notasPorUnidad: Map<number, number>, totalUnidades: number, notaMinima: number) {
  const valores = [...notasPorUnidad.values()];
  const completo = totalUnidades > 0 && valores.length >= totalUnidades;
  const promedio = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
  const aprobado = completo && promedio !== null ? promedio >= notaMinima : null;
  return { promedio, completo, aprobado };
}

export const notasRepo = {
  /** Matriz de notas de un grupo: unidades del programa + una fila por alumno. */
  async matrizGrupo(tenantSlug: string, grupoId: number) {
    const empresaId = await getEmpresaId(tenantSlug);

    const [gr] = await pool().query<any[]>(
      `SELECT g.id, g.nombre_grupo, prog.id AS programa_id, prog.nombre AS programa_nombre,
              prog.unidad_label, prog.nota_minima
       FROM grupos_programas g
       JOIN programas prog ON prog.id = g.programa_id
       WHERE g.id = ? AND g.empresa_id = ?`,
      [grupoId, empresaId],
    );
    if (!gr[0]) return null;
    const programa = gr[0];
    const notaMinima = Number(programa.nota_minima);

    const unidades = await unidadesRepo.findByPrograma(tenantSlug, programa.programa_id);

    const [insc] = await pool().query<any[]>(
      `SELECT i.id AS inscripcion_id, i.estado_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, ei.nombre AS estado_nombre
       FROM inscripciones i
       JOIN participantes p       ON p.id = i.participante_id
       JOIN estado_inscripcion ei ON ei.id = i.estado_id
       WHERE i.grupo_id = ? AND i.empresa_id = ?
       ORDER BY p.apellidos, p.nombres`,
      [grupoId, empresaId],
    );

    const inscripcionIds = (insc as any[]).map(r => r.inscripcion_id);
    let notasRows: any[] = [];
    if (inscripcionIds.length) {
      const [nr] = await pool().query<any[]>(
        `SELECT inscripcion_id, unidad_id, nota FROM notas WHERE inscripcion_id IN (?)`,
        [inscripcionIds],
      );
      notasRows = nr as any[];
    }

    const filas = (insc as any[]).map(row => {
      const mapa = new Map<number, number>();
      notasRows
        .filter(n => n.inscripcion_id === row.inscripcion_id)
        .forEach(n => mapa.set(n.unidad_id, Number(n.nota)));
      const { promedio, completo, aprobado } = resumenFila(mapa, unidades.length, notaMinima);
      return {
        inscripcion_id:      row.inscripcion_id,
        participante_nombre: row.participante_nombre,
        numero_documento:    row.numero_documento,
        estado_id:           row.estado_id,
        estado_nombre:       row.estado_nombre,
        notas:               Object.fromEntries(mapa),  // { unidad_id: nota }
        promedio,
        completo,
        aprobado,
      };
    });

    return {
      grupo_id:        programa.id,
      nombre_grupo:    programa.nombre_grupo,
      programa_id:     programa.programa_id,
      programa_nombre: programa.programa_nombre,
      unidad_label:    programa.unidad_label,
      nota_minima:     notaMinima,
      unidades:        unidades.map(u => ({ id: u.id, nombre: u.nombre, orden: u.orden })),
      filas,
    };
  },

  /** Guarda (upsert) las notas de un alumno y recalcula su estado. */
  async guardarNotas(tenantSlug: string, inscripcionId: number, notas: NotaInput[], userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);

    for (const n of notas) {
      await pool().query(
        `INSERT INTO notas (empresa_id, inscripcion_id, unidad_id, nota, user_crea_id)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nota = VALUES(nota), user_actua_id = ?`,
        [empresaId, inscripcionId, n.unidad_id, n.nota, userId ?? null, userId ?? null],
      );
    }

    await recomputarEstadoInscripcion(empresaId, inscripcionId, userId);

    const [row] = await pool().query<any[]>(
      `SELECT i.estado_id, ei.nombre AS estado_nombre
       FROM inscripciones i JOIN estado_inscripcion ei ON ei.id = i.estado_id
       WHERE i.id = ? AND i.empresa_id = ?`,
      [inscripcionId, empresaId],
    );
    return row[0] ?? null;
  },

  /** Datos completos para el acta de notas de un alumno. */
  async actaData(tenantSlug: string, inscripcionId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT i.id AS inscripcion_id, i.empresa_id, i.estado_id, ei.nombre AS estado_nombre,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre, p.numero_documento,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              prog.id AS programa_id, prog.nombre AS programa_nombre,
              prog.unidad_label, prog.nota_minima, prog.horas_academicas,
              e.razon_social AS empresa_nombre, e.tenant_slug
       FROM inscripciones i
       JOIN participantes p       ON p.id = i.participante_id
       JOIN grupos_programas g    ON g.id = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN estado_inscripcion ei ON ei.id = i.estado_id
       JOIN empresas e            ON e.id = i.empresa_id
       WHERE i.id = ? AND i.empresa_id = ?`,
      [inscripcionId, empresaId],
    );
    if (!rows[0]) return null;
    const info = rows[0];

    const unidades = await unidadesRepo.findByPrograma(tenantSlug, info.programa_id);
    const [nr] = await pool().query<any[]>(
      `SELECT unidad_id, nota FROM notas WHERE inscripcion_id = ?`,
      [inscripcionId],
    );
    const mapa = new Map<number, number>();
    (nr as any[]).forEach(n => mapa.set(n.unidad_id, Number(n.nota)));
    const { promedio, completo, aprobado } = resumenFila(mapa, unidades.length, Number(info.nota_minima));

    return {
      ...info,
      nota_minima: Number(info.nota_minima),
      unidades: unidades.map(u => ({ id: u.id, nombre: u.nombre, orden: u.orden, nota: mapa.get(u.id) ?? null })),
      promedio,
      completo,
      aprobado,
    };
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
      `INSERT INTO grupos_programas (empresa_id, programa_id, nombre_grupo, fecha_inicio, fecha_fin, dias_semana, hora_inicio, hora_fin, modalidad_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.programa_id, dto.nombre_grupo, dto.fecha_inicio, dto.fecha_fin,
       dto.dias_semana ?? null, dto.hora_inicio ?? null, dto.hora_fin ?? null,
       dto.modalidad_id, userId ?? null],
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

  /** Busca un participante por su número de documento (para autocompletar al inscribir). */
  async findByDocumento(tenantSlug: string, numeroDocumento: string, tipoDocumentoId?: number): Promise<ParticipanteEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const params: any[] = [empresaId, numeroDocumento.trim()];
    let sql = `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
               FROM participantes p
               JOIN tipos_documento td ON td.id = p.tipo_documento_id
               WHERE p.empresa_id = ? AND p.numero_documento = ? AND p.activo = 1`;
    if (tipoDocumentoId) { sql += ' AND p.tipo_documento_id = ?'; params.push(tipoDocumentoId); }
    sql += ' LIMIT 1';
    const [rows] = await pool().query<any[]>(sql, params);
    return rows[0] ? ParticipanteEntity.fromRow(rows[0]) : null;
  },

  async create(tenantSlug: string, dto: CreateParticipanteDto, userId?: number): Promise<ParticipanteEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO participantes (empresa_id, tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.tipo_documento_id, dto.numero_documento,
       aTituloNombre(dto.nombres), aTituloNombre(dto.apellidos),
       dto.email ?? null, dto.telefono ?? null, userId ?? null],
    );
    return (await participantesRepo.findById(tenantSlug, result.insertId))!;
  },
};

/** ¿El participante ya tiene una inscripción (no rechazada) en el MISMO programa del grupo dado? */
async function inscripcionDuplicadaEnGrupo(
  empresaId: number, participanteId: number, grupoId: number,
): Promise<boolean> {
  // Solo bloquea si ya está inscrito EN ESE MISMO grupo (no rechazada).
  // Se permite reinscribirse al mismo programa en OTRO grupo.
  const [rows] = await pool().query<any[]>(
    `SELECT i.id
     FROM inscripciones i
     WHERE i.grupo_id = ? AND i.participante_id = ? AND i.empresa_id = ? AND i.estado_id <> 6
     LIMIT 1`,
    [grupoId, participanteId, empresaId],
  );
  return (rows as any[]).length > 0;
}

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

    // Evitar doble inscripción en el MISMO grupo (sí se permite otro grupo del mismo programa).
    const dup = await inscripcionDuplicadaEnGrupo(empresaId, dto.participante_id, dto.grupo_id);
    if (dup) throw new Error('El estudiante ya está inscrito en este grupo.');

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

  /**
   * Inscribe a un estudiante: si el documento ya existe lo reutiliza (autocompletado),
   * si no, crea el participante. Valida que no esté ya inscrito en el programa.
   */
  async inscribir(tenantSlug: string, dto: InscribirDto, userId?: number) {
    let participante = await participantesRepo.findByDocumento(tenantSlug, dto.numero_documento, dto.tipo_documento_id);
    if (!participante) {
      participante = await participantesRepo.create(tenantSlug, {
        tipo_documento_id: dto.tipo_documento_id,
        numero_documento:  dto.numero_documento.trim(),
        nombres:           dto.nombres,
        apellidos:         dto.apellidos,
        email:             dto.email,
        telefono:          dto.telefono,
      }, userId);
    }
    // create() valida el duplicado en el programa y lanza el mensaje correspondiente.
    const inscripcion = await inscripcionesRepo.create(tenantSlug, {
      participante_id:   participante.id,
      grupo_id:          dto.grupo_id,
      fecha_inscripcion: dto.fecha_inscripcion ?? new Date().toISOString().split('T')[0],
    }, userId);
    return { participante, inscripcion };
  },

  async cambiarEstado(tenantSlug: string, id: number, estadoId: number, userId?: number): Promise<InscripcionEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);

    // Aprobado(3)/Desaprobado(4) NO se pueden poner a mano si el programa tiene unidades:
    // esa decisión la define el promedio de notas. Para programas sin unidades, sí es manual.
    if (estadoId === 3 || estadoId === 4) {
      const [u] = await pool().query<any[]>(
        `SELECT COUNT(*) AS total
         FROM unidades un
         JOIN grupos_programas g ON g.programa_id = un.programa_id
         JOIN inscripciones i    ON i.grupo_id = g.id
         WHERE i.id = ? AND i.empresa_id = ? AND un.activo = 1`,
        [id, empresaId],
      );
      if (Number((u as any[])[0]?.total ?? 0) > 0) {
        throw new Error('Este programa usa notas: la aprobación se define al registrar las notas, no manualmente.');
      }
    }

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
  /**
   * Devuelve la configuración aplicable.
   * Si se pasa grupoId, busca primero la config específica de ese grupo,
   * si no existe, cae a la config base del programa (grupo_id = 0).
   */
  async findByPrograma(
    tenantSlug: string,
    programaId: number,
    grupoId: number = 0,
  ): Promise<ConfigCertificadoEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);

    // 1. Intento exacto (grupo_id pedido). Para la config base (0) también tomamos
    //    filas legadas con grupo_id NULL (anteriores a la migración de grupo_id).
    const baseCond = grupoId === 0 ? '(grupo_id = 0 OR grupo_id IS NULL)' : 'grupo_id = ?';
    const baseParams = grupoId === 0 ? [empresaId, programaId] : [empresaId, programaId, grupoId];
    let [rows] = await pool().query<any[]>(
      `SELECT * FROM configuraciones_certificado
       WHERE empresa_id = ? AND programa_id = ? AND ${baseCond} AND activo = 1 LIMIT 1`,
      baseParams,
    );

    // 2. Fallback: si pedí config de un grupo y no existe, uso la del programa (grupo_id=0 o NULL)
    if (!rows[0] && grupoId !== 0) {
      [rows] = await pool().query<any[]>(
        `SELECT * FROM configuraciones_certificado
         WHERE empresa_id = ? AND programa_id = ? AND (grupo_id = 0 OR grupo_id IS NULL) AND activo = 1 LIMIT 1`,
        [empresaId, programaId],
      );
    }

    if (!rows[0]) return null;

    const configId = rows[0].id;

    const [logoRows] = await pool().query<any[]>(
      `SELECT l.id, l.imagen_logo, l.nombre, cl.orden
       FROM config_logos cl
       JOIN logos l ON l.id = cl.logo_id
       WHERE cl.config_id = ? ORDER BY cl.orden`,
      [configId],
    );

    const [firmaRows] = await pool().query<any[]>(
      `SELECT f.id, f.nombre_autoridad, f.cargo, f.imagen_firma, cf.orden
       FROM config_firmas cf
       JOIN firmas f ON f.id = cf.firma_id
       WHERE cf.config_id = ? ORDER BY cf.orden`,
      [configId],
    );

    return ConfigCertificadoEntity.fromRow(rows[0], logoRows as any, firmaRows as any);
  },

  async upsert(tenantSlug: string, programaId: number, dto: UpsertConfigDto, userId?: number): Promise<ConfigCertificadoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const grupoId = dto.grupo_id ?? 0;

    await pool().query(
      `INSERT INTO configuraciones_certificado
         (empresa_id, programa_id, grupo_id, plantilla_url, texto_personalizado, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         plantilla_url       = VALUES(plantilla_url),
         texto_personalizado = VALUES(texto_personalizado),
         user_actua_id       = ?`,
      [empresaId, programaId, grupoId, dto.plantilla_url ?? null, dto.texto_personalizado ?? null, userId ?? null, userId ?? null],
    );

    const [rows] = await pool().query<any[]>(
      `SELECT id FROM configuraciones_certificado
       WHERE empresa_id = ? AND programa_id = ? AND grupo_id = ?`,
      [empresaId, programaId, grupoId],
    );
    const configId = rows[0].id;

    // Reemplazar logos
    await pool().query(`DELETE FROM config_logos WHERE config_id = ?`, [configId]);
    if (dto.logo_ids?.length) {
      const vals = dto.logo_ids.map((id, i) => [configId, id, i + 1]);
      await pool().query(`INSERT INTO config_logos (config_id, logo_id, orden) VALUES ?`, [vals]);
    }

    // Reemplazar firmas
    await pool().query(`DELETE FROM config_firmas WHERE config_id = ?`, [configId]);
    if (dto.firma_ids?.length) {
      const vals = dto.firma_ids.map((id, i) => [configId, id, i + 1]);
      await pool().query(`INSERT INTO config_firmas (config_id, firma_id, orden) VALUES ?`, [vals]);
    }

    return (await configRepo.findByPrograma(tenantSlug, programaId, grupoId))!;
  },

  /** Lista todas las configs específicas por grupo (excluye la base del programa). */
  async listGruposConConfig(tenantSlug: string, programaId: number): Promise<number[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT grupo_id FROM configuraciones_certificado
       WHERE empresa_id = ? AND programa_id = ? AND grupo_id != 0 AND activo = 1`,
      [empresaId, programaId],
    );
    return rows.map(r => r.grupo_id);
  },

  /**
   * "Congela" la config base del programa para un grupo:
   * copia la config actual del programa a una config específica del grupo.
   * Útil cuando vas a cambiar la config del programa pero quieres que un grupo
   * siga emitiendo certificados con la config anterior.
   */
  async congelarGrupo(tenantSlug: string, programaId: number, grupoId: number, userId?: number): Promise<ConfigCertificadoEntity | null> {
    const base = await configRepo.findByPrograma(tenantSlug, programaId, 0);
    if (!base) return null;
    return configRepo.upsert(tenantSlug, programaId, {
      grupo_id:           grupoId,
      plantilla_url:      base.plantilla_url,
      texto_personalizado: (base as any).texto_personalizado ?? null,
      logo_ids:           base.logos.map(l => l.id),
      firma_ids:          base.firmas.map(f => f.id),
    }, userId);
  },

  /** Elimina la config específica de un grupo → vuelve a heredar del programa */
  async eliminarConfigGrupo(tenantSlug: string, programaId: number, grupoId: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id FROM configuraciones_certificado
       WHERE empresa_id = ? AND programa_id = ? AND grupo_id = ?`,
      [empresaId, programaId, grupoId],
    );
    if (!rows[0]) return false;
    const configId = rows[0].id;
    await pool().query(`DELETE FROM config_logos  WHERE config_id = ?`, [configId]);
    await pool().query(`DELETE FROM config_firmas WHERE config_id = ?`, [configId]);
    await pool().query(`DELETE FROM configuraciones_certificado WHERE id = ?`, [configId]);
    return true;
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
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas,
              tp.nombre AS tipo_programa_nombre,
              g.id AS grupo_id, g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              m.nombre AS modalidad_nombre,
              ec.nombre AS estado_nombre
       FROM certificados c
       JOIN inscripciones i       ON i.id   = c.inscripcion_id
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN tipos_programa tp     ON tp.id  = prog.tipo_programa_id
       JOIN modalidades m         ON m.id   = g.modalidad_id
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

    // Bloquear emisión si el programa/grupo no tiene diseño configurado.
    const grupoId = (insc as any[])[0].grupo_id;
    const [progRows] = await pool().query<any[]>('SELECT programa_id FROM grupos_programas WHERE id = ?', [grupoId]);
    const programaId = (progRows as any[])[0]?.programa_id;
    const config = await configRepo.findByPrograma(tenantSlug, programaId, grupoId);
    const sinDiseno = !config || (!config.plantilla_url && (config.logos?.length ?? 0) === 0 && (config.firmas?.length ?? 0) === 0);
    if (sinDiseno) {
      throw new Error('FALTA_CONFIG: Falta configurar el diseño del certificado de este programa. Ve a Configuración y agrega al menos el fondo, un logo o una firma.');
    }

    const codigo = generarCodigo(empresaId);

    // Transacción: insertar el certificado y consumir 1 del cupo del plan de forma atómica.
    // `consumirCupo` bloquea la fila de consumo del mes (FOR UPDATE) y lanza SinPlanError
    // si la empresa no tiene suscripción vigente; en ese caso el rollback deshace el INSERT.
    // Si ya superó el cupo, igual emite pero lo cuenta como excedente (se cobra aparte).
    const conn = await pool().getConnection();
    let certId: number;
    try {
      await conn.beginTransaction();
      const [result] = await conn.query<any>(
        `INSERT INTO certificados (empresa_id, inscripcion_id, codigo_unico, fecha_emision, estado_id, user_crea_id)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [empresaId, inscripcionId, codigo, new Date().toISOString().split('T')[0], userId ?? null],
      );
      certId = result.insertId;
      await planRepo.consumirCupo(conn, empresaId);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Recuperar todos los datos del certificado recién creado
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              m.nombre AS modalidad_nombre,
              ec.nombre AS estado_nombre,
              e.razon_social AS empresa_nombre, e.tenant_slug
       FROM certificados c
       JOIN inscripciones i       ON i.id   = c.inscripcion_id
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN tipos_programa tp     ON tp.id  = prog.tipo_programa_id
       JOIN modalidades m         ON m.id   = g.modalidad_id
       JOIN estado_certificado ec ON ec.id  = c.estado_id
       JOIN empresas e            ON e.id   = c.empresa_id
       WHERE c.id = ?`,
      [certId],
    );
    const cert = (rows as any[])[0];

    // Generar el PDF en segundo plano (no bloquea la respuesta al frontend)
    setImmediate(() => generarPdfYGuardar(cert, tenantSlug).catch(err =>
      console.error(`[PDF] Error generando ${codigo}:`, err.message),
    ));

    return CertificadoEntity.fromRow(cert);
  },

  /** Regenera el PDF de un certificado existente (si cambias diseño, etc) */
  async regenerarPDF(tenantSlug: string, id: number): Promise<string | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              m.nombre AS modalidad_nombre,
              e.razon_social AS empresa_nombre, e.tenant_slug
       FROM certificados c
       JOIN inscripciones i       ON i.id   = c.inscripcion_id
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN tipos_programa tp     ON tp.id  = prog.tipo_programa_id
       JOIN modalidades m         ON m.id   = g.modalidad_id
       JOIN empresas e            ON e.id   = c.empresa_id
       WHERE c.id = ? AND c.empresa_id = ?`,
      [id, empresaId],
    );
    if (!rows[0]) return null;
    return generarPdfYGuardar(rows[0], tenantSlug);
  },

  /** Genera en memoria una VISTA PREVIA del certificado de una inscripción,
   *  con sus datos reales pero código "MUESTRA". No inserta nada ni gasta crédito.
   *  Usa el mismo motor que la emisión, así el preview es idéntico al PDF final. */
  async previewBuffer(tenantSlug: string, inscripcionId: number): Promise<Buffer | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT i.id AS inscripcion_id, i.empresa_id, i.grupo_id,
              prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
              m.nombre AS modalidad_nombre,
              e.razon_social AS empresa_nombre, e.tenant_slug
       FROM inscripciones i
       JOIN participantes p       ON p.id   = i.participante_id
       JOIN grupos_programas g    ON g.id   = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN tipos_programa tp     ON tp.id  = prog.tipo_programa_id
       JOIN modalidades m         ON m.id   = g.modalidad_id
       JOIN empresas e            ON e.id   = i.empresa_id
       WHERE i.id = ? AND i.empresa_id = ?`,
      [inscripcionId, empresaId],
    );
    const cert = (rows as any[])[0];
    if (!cert) return null;

    // Bloquear preview si el programa/grupo no tiene diseño configurado (mismo criterio que emitir).
    const config = await configRepo.findByPrograma(tenantSlug, cert.programa_id, cert.grupo_id ?? 0);
    const sinDiseno = !config || (!config.plantilla_url && (config.logos?.length ?? 0) === 0 && (config.firmas?.length ?? 0) === 0);
    if (sinDiseno) {
      throw new Error('FALTA_CONFIG: Falta configurar el diseño del certificado de este programa. Ve a Configuración y agrega al menos el fondo, un logo o una firma.');
    }

    cert.codigo_unico  = 'MUESTRA';
    cert.fecha_emision = new Date().toISOString().split('T')[0];

    const datos = await construirPdfDatos(cert, tenantSlug);
    return pdfService.generarBuffer(datos);
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

  /**
   * Elimina el certificado por completo y DEVUELVE 1 al cupo del mes.
   * (Anular solo desactiva; eliminar libera el cupo). Borra también el PDF físico.
   */
  async eliminar(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      // Recuperar la URL del PDF antes de borrar, para limpiar el archivo después.
      const [rows] = await conn.query<any[]>(
        'SELECT url FROM certificados WHERE id = ? AND empresa_id = ? FOR UPDATE',
        [id, empresaId],
      );
      if (!(rows as any[]).length) { await conn.rollback(); return false; }
      const urlRel: string | null = (rows as any[])[0].url ?? null;

      await conn.query('DELETE FROM certificados WHERE id = ? AND empresa_id = ?', [id, empresaId]);
      await planRepo.devolverCupo(conn, empresaId);
      await conn.commit();

      // Borrar el PDF del disco (fuera de la transacción; si falla no afecta el saldo).
      if (urlRel) {
        const abs = path.join(process.cwd(), urlRel.replace(/^\/+/, ''));
        fs.promises.unlink(abs).catch(() => { /* archivo ya no existe, ignorar */ });
      }
      return true;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async zipGrupo(
  tenantSlug: string,
  grupoId: number,
): Promise<Buffer | null> {

  const empresaId = await getEmpresaId(tenantSlug);

  const [rows] = await pool().query<any[]>(
    `SELECT
        c.url,
        c.codigo_unico,
        CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre
     FROM certificados c
     INNER JOIN inscripciones i
        ON i.id = c.inscripcion_id
     INNER JOIN participantes p
        ON p.id = i.participante_id
     WHERE i.grupo_id = ?
       AND c.empresa_id = ?
       AND c.estado_id = 1
       AND c.url IS NOT NULL`,
    [grupoId, empresaId],
  );

  if (!rows.length) {
    return null;
  }

  return new Promise((resolve, reject) => {

    // archiver v8 es ESM y cambió la API: ya no es archiver('zip', …) sino la clase ZipArchive.
    const archive = new (archiver as any).ZipArchive({
      zlib: { level: 9 },
    });

    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    stream.on('error', reject);
    archive.on('error', reject);

    archive.pipe(stream);

    for (const cert of rows) {

      const pdfPath = path.join(
        process.cwd(),
        cert.url.replace(/^\/+/, ''),
      );

      if (!fs.existsSync(pdfPath)) {
        continue;
      }

      const nombreArchivo =
        `${cert.participante_nombre}`
          .replace(/[\\/:*?"<>|]/g, '_')
          .trim() + '.pdf';

      archive.file(pdfPath, {
        name: nombreArchivo,
      });
    }

    archive.finalize();
  });
}

};

/* ── Helper: genera el PDF y guarda la URL en BD ────────────── */
/** Arma el objeto PdfDatos a partir de una fila enriquecida (cert o inscripción).
 *  Lo usan tanto la emisión real como la previsualización, para que el preview
 *  salga idéntico al PDF final. NO escribe en BD ni en disco. */
async function construirPdfDatos(cert: any, tenantSlug: string): Promise<PdfDatos> {
  // Obtener grupo_id de la inscripción (para buscar config específica del grupo)
  let grupoId = 0;
    if (cert.inscripcion_id) {
      const [insRows] = await pool().query<any[]>(
        'SELECT grupo_id FROM inscripciones WHERE id = ? LIMIT 1',
        [cert.inscripcion_id],
      );
      grupoId = (insRows as any[])[0]?.grupo_id ?? 0;
    }

    // Buscar config: primero la del grupo, fallback a la del programa
    const config = await configRepo.findByPrograma(tenantSlug, cert.programa_id, grupoId);

    const fechaEmision = typeof cert.fecha_emision === 'string'
      ? cert.fecha_emision
      : new Date(cert.fecha_emision).toISOString().substring(0, 10);
    const fechaInicio = cert.fecha_inicio
      ? (typeof cert.fecha_inicio === 'string' ? cert.fecha_inicio : new Date(cert.fecha_inicio).toISOString().substring(0, 10))
      : undefined;
    const fechaFin = cert.fecha_fin
      ? (typeof cert.fecha_fin === 'string' ? cert.fecha_fin : new Date(cert.fecha_fin).toISOString().substring(0, 10))
      : undefined;

    // Acta de notas (2ª página) — solo si el programa tiene unidades configuradas.
    let acta: any = null;
    if (cert.inscripcion_id) {
      const ad: any = await notasRepo.actaData(tenantSlug, cert.inscripcion_id);
      if (ad && ad.unidades.length > 0) {
        acta = {
          inscripcion_id:      ad.inscripcion_id,
          participante_nombre: ad.participante_nombre,
          numero_documento:    ad.numero_documento,
          programa_nombre:     ad.programa_nombre,
          nombre_grupo:        ad.nombre_grupo,
          unidad_label:        ad.unidad_label,
          nota_minima:         Number(ad.nota_minima),
          fecha_inicio:        fechaInicio,
          fecha_fin:           fechaFin,
          empresa_nombre:      cert.tenant_slug ?? tenantSlug,
          unidades:            ad.unidades,
          promedio:            ad.promedio,
          completo:            ad.completo,
          aprobado:            ad.aprobado,
        };
      }
    }

    return {
      participante_nombre:  cert.participante_nombre,
      programa_nombre:      cert.programa_nombre,
      tipo_programa:        cert.tipo_programa_nombre ?? 'Certificado',
      horas_academicas:     cert.horas_academicas ?? 0,
      fecha_inicio:         fechaInicio,
      fecha_fin:            fechaFin,
      modalidad:            cert.modalidad_nombre,
      fecha_emision:        fechaEmision,
      codigo_unico:         cert.codigo_unico,
      empresa_nombre:       cert.tenant_slug ?? tenantSlug,
      texto_personalizado:  (config as any)?.texto_personalizado ?? null,
      plantilla_url:        config?.plantilla_url ?? null,
      logos: (config?.logos ?? []).map((l: any) => ({
        imagen: l.imagen_logo, nombre: l.nombre, orden: l.orden,
      })),
      firmas: (config?.firmas ?? []).map((f: any) => ({
        nombre_autoridad: f.nombre_autoridad, cargo: f.cargo,
        imagen: f.imagen_firma, orden: f.orden,
      })),
      acta,
    };
}

/** Genera el PDF del certificado y guarda su URL en BD. */
async function generarPdfYGuardar(cert: any, tenantSlug: string): Promise<string | null> {
  try {
    const datos = await construirPdfDatos(cert, tenantSlug);
    const outputDir = path.join(process.cwd(), 'uploads', 'certificados', String(cert.empresa_id));
    const urlRelativa = await pdfService.generar(datos, outputDir);

    await pool().query(
      'UPDATE certificados SET url = ? WHERE id = ?',
      [`/${urlRelativa}`, cert.id],
    );

    return urlRelativa;
  } catch (err) {
    console.error('[generarPdfYGuardar]', (err as Error).message);
    return null;
  }
}
