import * as path from 'path';
import * as fs from 'fs';
import type { PoolConnection } from 'mysql2/promise';
import { pool, getEmpresaId } from './db.helper';
import { planRepo } from '../planes/plan.repository';
import { auditoriaRepo, describirCambios } from '../auditoria/auditoria.repository';
import { aTituloNombre } from '../../../shared/text';
import { guardarImagen } from '../../../shared/imagenes';
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

/** Se lanza cuando no se puede BORRAR algo por datos asociados. El controller la mapea a 409.
 *  (Hoy el borrado arrastra los certificados, así que normalmente no se usa; queda como
 *  red de seguridad para errores de integridad inesperados.) */
export class DatosAsociadosError extends Error {
  constructor(public detalle: string) {
    super(`No se puede borrar: tiene ${detalle}.`);
    this.name = 'DatosAsociadosError';
  }
}

/** Borra las filas de certificados dadas, devolviendo 1 de cupo por cada una.
 *  Devuelve las URLs de los PDFs para eliminarlos del disco tras el commit. */
async function purgarCerts(conn: any, empresaId: number, certRows: any[]): Promise<string[]> {
  const urls: string[] = [];
  for (const c of certRows as any[]) {
    if (c.url) urls.push(c.url);
    await conn.query('DELETE FROM certificados WHERE id = ? AND empresa_id = ?', [c.id, empresaId]);
    await planRepo.devolverCupo(conn, empresaId);   // devuelve el cupo del mes
  }
  return urls;
}

/** Elimina los PDFs del disco (best-effort, fuera de la transacción). */
function borrarPdfs(urls: string[]): void {
  for (const u of urls) {
    try {
      const abs = path.join(process.cwd(), u.replace(/^\/+/, ''));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch { /* si no se puede borrar el archivo, no afecta los datos */ }
  }
}

// ============================================================
// PROGRAMAS
// ============================================================
export const programasRepo = {
  async findAll(tenantSlug: string, incluirInactivos = false): Promise<ProgramaEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, tp.nombre AS tipo_programa_nombre
       FROM programas p
       JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
       WHERE p.empresa_id = ? ${incluirInactivos ? '' : 'AND p.activo = 1'}
       ORDER BY p.activo DESC, p.created_at DESC`,
      [empresaId],
    );
    return (rows as any[]).map(ProgramaEntity.fromRow);
  },

  // Sin filtro de activo: el admin necesita ver/recuperar también los archivados.
  async findById(tenantSlug: string, id: number): Promise<ProgramaEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, tp.nombre AS tipo_programa_nombre
       FROM programas p
       JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
       WHERE p.id = ? AND p.empresa_id = ?`,
      [id, empresaId],
    );
    return rows[0] ? ProgramaEntity.fromRow(rows[0]) : null;
  },

  /** Activa/desactiva (soft-delete): no borra, solo archiva. */
  async setActivo(tenantSlug: string, id: number, activo: boolean, userId?: number): Promise<ProgramaEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query(
      'UPDATE programas SET activo = ?, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
      [activo ? 1 : 0, userId ?? null, id, empresaId],
    );
    const prog = await programasRepo.findById(tenantSlug, id);
    if (prog) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'programa', entidadId: id, entidadNombre: prog.nombre,
      descripcion: `${activo ? 'Reactivó' : 'Archivó'} el programa "${prog.nombre}"`,
    });
    return prog;
  },

  async create(tenantSlug: string, dto: CreateProgramaDto, userId?: number): Promise<ProgramaEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      `INSERT INTO programas (empresa_id, tipo_programa_id, nombre, descripcion, horas_academicas, creditos, unidad_label, nota_minima, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.tipo_programa_id, dto.nombre, dto.descripcion ?? null, dto.horas_academicas, dto.creditos ?? 0,
       dto.unidad_label || 'Unidad', dto.nota_minima ?? 11, userId ?? null],
    );
    const prog = (await programasRepo.findById(tenantSlug, result.insertId))!;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'programa', entidadId: prog.id, entidadNombre: prog.nombre,
      descripcion: `Creó el programa "${prog.nombre}"`,
    });
    return prog;
  },

  async update(tenantSlug: string, id: number, dto: UpdateProgramaDto, userId?: number): Promise<ProgramaEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const antes = await programasRepo.findById(tenantSlug, id);
    const fields: string[] = [];
    const values: any[]    = [];
    if (dto.nombre           !== undefined) { fields.push('nombre = ?');           values.push(dto.nombre); }
    if (dto.descripcion      !== undefined) { fields.push('descripcion = ?');      values.push(dto.descripcion); }
    if (dto.horas_academicas !== undefined) { fields.push('horas_academicas = ?'); values.push(dto.horas_academicas); }
    if (dto.creditos         !== undefined) { fields.push('creditos = ?');         values.push(dto.creditos); }
    if (dto.tipo_programa_id !== undefined) { fields.push('tipo_programa_id = ?'); values.push(dto.tipo_programa_id); }
    if (dto.unidad_label     !== undefined) { fields.push('unidad_label = ?');     values.push(dto.unidad_label || 'Unidad'); }
    if (dto.nota_minima      !== undefined) { fields.push('nota_minima = ?');       values.push(dto.nota_minima); }
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
      await pool().query(`UPDATE programas SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    const despues = await programasRepo.findById(tenantSlug, id);
    if (antes && despues) {
      const { texto, detalle } = describirCambios(antes, despues, [
        { key: 'nombre', label: 'nombre' },
        { key: 'descripcion', label: 'descripción' },
        { key: 'horas_academicas', label: 'horas' },
        { key: 'creditos', label: 'créditos' },
        { key: 'tipo_programa_id', label: 'tipo' },
        { key: 'unidad_label', label: 'rótulo de unidad' },
        { key: 'nota_minima', label: 'nota mínima' },
      ]);
      if (texto) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'editar', entidad: 'programa', entidadId: id, entidadNombre: despues.nombre,
        descripcion: `Editó el programa "${despues.nombre}": ${texto}`, detalle,
      });
    }
    return despues;
  },

  /**
   * BORRA un programa por completo (aulas, inscripciones, notas, unidades y diseño).
   * Protección: si hay certificados emitidos bajo el programa, NO borra y avisa.
   */
  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const nombrePrev = (await programasRepo.findById(tenantSlug, id))?.nombre ?? null;
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      const [certs] = await conn.query<any[]>(
        `SELECT c.id, c.url FROM certificados c
           JOIN inscripciones i    ON i.id = c.inscripcion_id
           JOIN grupos_programas g ON g.id = i.grupo_id
          WHERE g.programa_id = ? AND c.empresa_id = ?`,
        [id, empresaId],
      );
      const urlsCert = await purgarCerts(conn, empresaId, certs as any[]);

      // Diseño del certificado (config + sus logos/firmas).
      const [cfgs] = await conn.query<any[]>(
        'SELECT id FROM configuraciones_certificado WHERE empresa_id = ? AND programa_id = ?', [empresaId, id],
      );
      for (const c of cfgs as any[]) {
        await conn.query('DELETE FROM config_logos  WHERE config_id = ?', [c.id]);
        await conn.query('DELETE FROM config_firmas WHERE config_id = ?', [c.id]);
      }
      await conn.query('DELETE FROM configuraciones_certificado WHERE empresa_id = ? AND programa_id = ?', [empresaId, id]);

      // Inscripciones de sus aulas (notas en cascada), luego aulas, unidades y el programa.
      await conn.query(
        `DELETE i FROM inscripciones i JOIN grupos_programas g ON g.id = i.grupo_id
          WHERE g.programa_id = ? AND i.empresa_id = ?`, [id, empresaId],
      );
      await conn.query('DELETE FROM grupos_programas WHERE programa_id = ? AND empresa_id = ?', [id, empresaId]);
      await conn.query('DELETE FROM unidades         WHERE programa_id = ? AND empresa_id = ?', [id, empresaId]);
      const [r] = await conn.query<any>('DELETE FROM programas WHERE id = ? AND empresa_id = ?', [id, empresaId]);

      await conn.commit();
      borrarPdfs(urlsCert);
      if (r.affectedRows > 0) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'programa', entidadId: id, entidadNombre: nombrePrev,
        descripcion: `Eliminó el programa "${nombrePrev ?? id}" (con sus aulas, inscripciones y diseño)`,
      });
      return r.affectedRows > 0;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
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
    const unidad = UnidadEntity.fromRow(rows[0]);
    const [pn] = await pool().query<any[]>('SELECT nombre FROM programas WHERE id = ? AND empresa_id = ?', [dto.programa_id, empresaId]);
    const programa = (pn as any[])[0]?.nombre ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'unidad', entidadId: unidad.id, entidadNombre: unidad.nombre,
      descripcion: `Agregó la unidad "${unidad.nombre}"${programa ? ` al programa "${programa}"` : ''}`,
    });
    return unidad;
  },

  async update(tenantSlug: string, id: number, dto: UpdateUnidadDto, userId?: number): Promise<UnidadEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [prevRows] = await pool().query<any[]>(`SELECT * FROM unidades WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
    const antes = prevRows[0] ? UnidadEntity.fromRow(prevRows[0]) : null;
    const fields: string[] = [];
    const values: any[]    = [];
    if (dto.nombre !== undefined) { fields.push('nombre = ?'); values.push(dto.nombre); }
    if (dto.orden  !== undefined) { fields.push('orden = ?');  values.push(dto.orden); }
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
      await pool().query(`UPDATE unidades SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    const [rows] = await pool().query<any[]>(`SELECT * FROM unidades WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
    const despues = rows[0] ? UnidadEntity.fromRow(rows[0]) : null;
    if (antes && despues) {
      const { texto, detalle } = describirCambios(antes, despues, [
        { key: 'nombre', label: 'nombre' },
        { key: 'orden', label: 'orden' },
      ]);
      if (texto) {
        const [pn] = await pool().query<any[]>('SELECT nombre FROM programas WHERE id = ? AND empresa_id = ?', [despues.programa_id, empresaId]);
        const programa = (pn as any[])[0]?.nombre ?? null;
        auditoriaRepo.registrar({
          empresaId, usuarioId: userId, accion: 'editar', entidad: 'unidad', entidadId: id, entidadNombre: despues.nombre,
          descripcion: `Editó la unidad "${despues.nombre}"${programa ? ` del programa "${programa}"` : ''}: ${texto}`, detalle,
        });
      }
    }
    return despues;
  },

  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [prevRows] = await pool().query<any[]>(
      `SELECT u.nombre, p.nombre AS programa
         FROM unidades u LEFT JOIN programas p ON p.id = u.programa_id
        WHERE u.id = ? AND u.empresa_id = ?`,
      [id, empresaId],
    );
    const nombrePrev = (prevRows as any[])[0]?.nombre ?? null;
    const programa = (prevRows as any[])[0]?.programa ?? null;
    // El borrado de unidad arrastra sus notas (ON DELETE CASCADE).
    const [r] = await pool().query<any>(`DELETE FROM unidades WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
    if (r.affectedRows > 0) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'unidad', entidadId: id, entidadNombre: nombrePrev,
      descripcion: `Eliminó la unidad "${nombrePrev ?? id}"${programa ? ` del programa "${programa}"` : ''}`,
    });
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

    const [meta] = await pool().query<any[]>(
      `SELECT CONCAT(p.nombres,' ',p.apellidos) AS alumno, p.numero_documento AS doc,
              prog.nombre AS programa, g.nombre_grupo AS aula
         FROM inscripciones i
         JOIN participantes p    ON p.id = i.participante_id
         JOIN grupos_programas g ON g.id = i.grupo_id
         JOIN programas prog     ON prog.id = g.programa_id
        WHERE i.id = ? AND i.empresa_id = ?`,
      [inscripcionId, empresaId],
    );
    const m = (meta as any[])[0] ?? {};
    const alumno = m.alumno ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'nota', entidadId: inscripcionId, entidadNombre: alumno,
      descripcion: `Registró/actualizó ${notas.length} nota(s) de ${alumno ?? 'un alumno'}${m.doc ? ` (${m.doc})` : ''}`
        + `${m.programa ? ` en el programa "${m.programa}"` : ''}${m.aula ? ` · aula "${m.aula}"` : ''}`
        + `${row[0]?.estado_nombre ? ` · resultado: ${row[0].estado_nombre}` : ''}`,
      detalle: { notas: notas.length, estado: row[0]?.estado_nombre ?? null, programa: m.programa ?? null, aula: m.aula ?? null },
    });

    return row[0] ?? null;
  },

  /** Datos completos para el acta de notas de un alumno. */
  async actaData(tenantSlug: string, inscripcionId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT i.id AS inscripcion_id, i.empresa_id, i.estado_id, ei.nombre AS estado_nombre,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre, p.numero_documento,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3,
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
  async findAll(tenantSlug: string, incluirInactivos = false): Promise<GrupoEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT g.*, p.nombre AS programa_nombre, m.nombre AS modalidad_nombre
       FROM grupos_programas g
       JOIN programas p   ON p.id = g.programa_id
       JOIN modalidades m ON m.id = g.modalidad_id
       WHERE g.empresa_id = ? ${incluirInactivos ? '' : 'AND g.activo = 1'}
       ORDER BY g.activo DESC, g.fecha_inicio DESC`,
      [empresaId],
    );
    return (rows as any[]).map(GrupoEntity.fromRow);
  },

  /** Activa/desactiva un aula (soft-delete). */
  async setActivo(tenantSlug: string, id: number, activo: boolean, userId?: number): Promise<GrupoEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query(
      'UPDATE grupos_programas SET activo = ? WHERE id = ? AND empresa_id = ?',
      [activo ? 1 : 0, id, empresaId],
    );
    const grupo = await gruposRepo.findById(tenantSlug, id);
    if (grupo) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'aula', entidadId: id, entidadNombre: grupo.nombre_grupo,
      descripcion: `${activo ? 'Reactivó' : 'Archivó'} el aula "${grupo.nombre_grupo}" (${grupo.programa_nombre})`,
    });
    return grupo;
  },

  /** BORRA un aula, sus inscripciones/notas y certificados (devuelve cupo + borra PDFs). */
  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const grupoPrev = await gruposRepo.findById(tenantSlug, id);
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      const [certs] = await conn.query<any[]>(
        `SELECT c.id, c.url FROM certificados c
           JOIN inscripciones i ON i.id = c.inscripcion_id
          WHERE i.grupo_id = ? AND c.empresa_id = ?`,
        [id, empresaId],
      );
      const urlsCert = await purgarCerts(conn, empresaId, certs as any[]);

      // Diseño específico del aula (override).
      const [cfgs] = await conn.query<any[]>(
        'SELECT id FROM configuraciones_certificado WHERE empresa_id = ? AND grupo_id = ?', [empresaId, id],
      );
      for (const c of cfgs as any[]) {
        await conn.query('DELETE FROM config_logos  WHERE config_id = ?', [c.id]);
        await conn.query('DELETE FROM config_firmas WHERE config_id = ?', [c.id]);
      }
      await conn.query('DELETE FROM configuraciones_certificado WHERE empresa_id = ? AND grupo_id = ?', [empresaId, id]);

      await conn.query('DELETE FROM inscripciones    WHERE grupo_id = ? AND empresa_id = ?', [id, empresaId]);
      const [r] = await conn.query<any>('DELETE FROM grupos_programas WHERE id = ? AND empresa_id = ?', [id, empresaId]);

      await conn.commit();
      borrarPdfs(urlsCert);
      if (r.affectedRows > 0) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'aula', entidadId: id,
        entidadNombre: grupoPrev?.nombre_grupo ?? null,
        descripcion: `Eliminó el aula "${grupoPrev?.nombre_grupo ?? id}"${grupoPrev?.programa_nombre ? ` (${grupoPrev.programa_nombre})` : ''} con sus inscripciones`,
      });
      return r.affectedRows > 0;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
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
      `INSERT INTO grupos_programas (empresa_id, programa_id, nombre_grupo, fecha_inicio, fecha_fin, fecha_dia2, fecha_dia3, dias_semana, hora_inicio, hora_fin, modalidad_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.programa_id, dto.nombre_grupo, dto.fecha_inicio, dto.fecha_fin ?? null,
       dto.fecha_dia2 ?? null, dto.fecha_dia3 ?? null,
       dto.dias_semana ?? null, dto.hora_inicio ?? null, dto.hora_fin ?? null,
       dto.modalidad_id, userId ?? null],
    );
    const grupo = (await gruposRepo.findById(tenantSlug, result.insertId))!;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'aula', entidadId: grupo.id, entidadNombre: grupo.nombre_grupo,
      descripcion: `Creó el aula "${grupo.nombre_grupo}" en el programa "${grupo.programa_nombre}"`,
    });
    return grupo;
  },

  async update(tenantSlug: string, id: number, dto: CreateGrupoDto, userId?: number): Promise<GrupoEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    // Verificamos existencia aparte: un UPDATE sin cambios reporta affectedRows=0
    // aunque la fila exista, así que no podemos usar eso para el 404.
    const existe = await gruposRepo.findById(tenantSlug, id);
    if (!existe) return null;
    await pool().query<any>(
      `UPDATE grupos_programas
          SET programa_id = ?, nombre_grupo = ?, fecha_inicio = ?, fecha_fin = ?,
              fecha_dia2 = ?, fecha_dia3 = ?,
              dias_semana = ?, hora_inicio = ?, hora_fin = ?, modalidad_id = ?
        WHERE id = ? AND empresa_id = ?`,
      [dto.programa_id, dto.nombre_grupo, dto.fecha_inicio, dto.fecha_fin ?? null,
       dto.fecha_dia2 ?? null, dto.fecha_dia3 ?? null,
       dto.dias_semana ?? null, dto.hora_inicio ?? null, dto.hora_fin ?? null, dto.modalidad_id,
       id, empresaId],
    );
    const grupo = (await gruposRepo.findById(tenantSlug, id))!;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'aula', entidadId: grupo.id, entidadNombre: grupo.nombre_grupo,
      descripcion: `Editó el aula "${grupo.nombre_grupo}" del programa "${grupo.programa_nombre}"`,
    });
    return grupo;
  },
};

// ============================================================
// PARTICIPANTES
// ============================================================
export const participantesRepo = {
  async findAll(tenantSlug: string, incluirInactivos = false): Promise<ParticipanteEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
       FROM participantes p
       JOIN tipos_documento td ON td.id = p.tipo_documento_id
       WHERE p.empresa_id = ? ${incluirInactivos ? '' : 'AND p.activo = 1'}
       ORDER BY p.activo DESC, p.apellidos, p.nombres`,
      [empresaId],
    );
    return (rows as any[]).map(ParticipanteEntity.fromRow);
  },

  /** Activa/desactiva un estudiante (soft-delete). */
  async setActivo(tenantSlug: string, id: number, activo: boolean, userId?: number): Promise<ParticipanteEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query(
      'UPDATE participantes SET activo = ? WHERE id = ? AND empresa_id = ?',
      [activo ? 1 : 0, id, empresaId],
    );
    const p = await participantesRepo.findById(tenantSlug, id);
    if (p) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'participante', entidadId: id,
      entidadNombre: `${p.nombres} ${p.apellidos}`,
      descripcion: `${activo ? 'Reactivó' : 'Archivó'} al estudiante ${p.nombres} ${p.apellidos} (${p.numero_documento})`,
    });
    return p;
  },

  /** BORRA un estudiante, sus inscripciones/notas y sus certificados (devuelve cupo + borra PDFs). */
  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const prev = await participantesRepo.findById(tenantSlug, id);
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      const [certs] = await conn.query<any[]>(
        `SELECT c.id, c.url FROM certificados c
           JOIN inscripciones i ON i.id = c.inscripcion_id
          WHERE i.participante_id = ? AND c.empresa_id = ?`,
        [id, empresaId],
      );
      const urls = await purgarCerts(conn, empresaId, certs as any[]);

      await conn.query('DELETE FROM inscripciones WHERE participante_id = ? AND empresa_id = ?', [id, empresaId]);
      const [r] = await conn.query<any>('DELETE FROM participantes WHERE id = ? AND empresa_id = ?', [id, empresaId]);

      await conn.commit();
      borrarPdfs(urls);
      if (r.affectedRows > 0) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'participante', entidadId: id,
        entidadNombre: prev ? `${prev.nombres} ${prev.apellidos}` : null,
        descripcion: `Eliminó al estudiante ${prev ? `${prev.nombres} ${prev.apellidos} (${prev.numero_documento})` : id} con sus inscripciones`,
      });
      return r.affectedRows > 0;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
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
    const p = (await participantesRepo.findById(tenantSlug, result.insertId))!;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'participante', entidadId: p.id,
      entidadNombre: `${p.nombres} ${p.apellidos}`,
      descripcion: `Registró al estudiante ${p.nombres} ${p.apellidos} (${p.numero_documento})`,
    });
    return p;
  },

  /** Edita los datos de un estudiante. Solo actualiza los campos enviados. */
  async update(tenantSlug: string, id: number, dto: Partial<CreateParticipanteDto>, userId?: number): Promise<ParticipanteEntity | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const antes = await participantesRepo.findById(tenantSlug, id);
    const fields: string[] = [];
    const values: any[]    = [];
    if (dto.tipo_documento_id !== undefined) { fields.push('tipo_documento_id = ?'); values.push(dto.tipo_documento_id); }
    if (dto.numero_documento  !== undefined) { fields.push('numero_documento = ?');  values.push(String(dto.numero_documento).trim()); }
    if (dto.nombres           !== undefined) { fields.push('nombres = ?');           values.push(aTituloNombre(dto.nombres)); }
    if (dto.apellidos         !== undefined) { fields.push('apellidos = ?');         values.push(aTituloNombre(dto.apellidos)); }
    if (dto.email             !== undefined) { fields.push('email = ?');             values.push(dto.email || null); }
    if (dto.telefono          !== undefined) { fields.push('telefono = ?');          values.push(dto.telefono || null); }
    if (fields.length) {
      values.push(id, empresaId);
      await pool().query(`UPDATE participantes SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    }
    const despues = await participantesRepo.findById(tenantSlug, id);
    if (antes && despues) {
      const { texto, detalle } = describirCambios(antes, despues, [
        { key: 'numero_documento', label: 'documento' },
        { key: 'nombres', label: 'nombres' },
        { key: 'apellidos', label: 'apellidos' },
        { key: 'email', label: 'email' },
        { key: 'telefono', label: 'teléfono' },
      ]);
      if (texto) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'editar', entidad: 'participante', entidadId: id,
        entidadNombre: `${despues.nombres} ${despues.apellidos}`,
        descripcion: `Editó al estudiante ${despues.nombres} ${despues.apellidos}: ${texto}`, detalle,
      });
    }
    return despues;
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
    const empresaId = await getEmpresaId(tenantSlug);
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

    const [gr] = await pool().query<any[]>(
      `SELECT g.nombre_grupo AS aula, prog.nombre AS programa
         FROM grupos_programas g JOIN programas prog ON prog.id = g.programa_id
        WHERE g.id = ? AND g.empresa_id = ?`,
      [dto.grupo_id, empresaId],
    );
    const aula = (gr as any[])[0]?.aula ?? null;
    const programa = (gr as any[])[0]?.programa ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'inscripcion', entidadId: inscripcion.id,
      entidadNombre: `${participante.nombres} ${participante.apellidos}`,
      descripcion: `Inscribió a ${participante.nombres} ${participante.apellidos} (${participante.numero_documento})`
        + `${programa ? ` en el programa "${programa}"` : ''}${aula ? ` · aula "${aula}"` : ''}`,
    });
    return { participante, inscripcion };
  },

  /**
   * Carga masiva (Excel): por cada fila crea o reutiliza el participante (por
   * documento) y lo inscribe al grupo. Si `emitir` es true, además aprueba la
   * inscripción y genera el certificado (consume cupo). Procesa fila por fila y
   * NO corta todo si una falla: devuelve el resultado de cada una para mostrarlo.
   *
   * La emisión masiva aprueba la inscripción directamente (sin pasar por el flujo
   * de notas) porque es una acción explícita del operador. La validación de
   * documentos ya inscritos / ya emitidos se hace aquí contra la BD; el Excel no
   * necesita saberlo.
   */
  async importarMasivo(
    tenantSlug: string,
    grupoId: number,
    filas: Array<{ tipo_documento_id: number; numero_documento: string; nombres: string; apellidos: string; email?: string; telefono?: string }>,
    emitir: boolean,
    userId?: number,
  ) {
    const empresaId = await getEmpresaId(tenantSlug);

    // El grupo debe existir, ser de la empresa y estar activo.
    const [g] = await pool().query<any[]>(
      'SELECT id FROM grupos_programas WHERE id = ? AND empresa_id = ? AND activo = 1',
      [grupoId, empresaId],
    );
    if (!(g as any[]).length) throw new Error('Aula no encontrada o inactiva');

    type Estado = 'inscrito' | 'ya_inscrito' | 'emitido' | 'ya_emitido' | 'error';
    const resultados: Array<{ fila: number; documento: string; nombre: string; estado: Estado; motivo?: string }> = [];

    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      const doc       = String(f.numero_documento ?? '').trim();
      const nombres   = String(f.nombres ?? '').trim();
      const apellidos = String(f.apellidos ?? '').trim();
      const nombre    = `${nombres} ${apellidos}`.trim();
      const base      = { fila: i + 2, documento: doc, nombre };   // +2: la fila 1 del Excel es el encabezado

      if (!f.tipo_documento_id || !doc || !nombres || !apellidos) {
        resultados.push({ ...base, estado: 'error', motivo: 'Faltan datos obligatorios (tipo de documento, documento, nombres y apellidos).' });
        continue;
      }

      try {
        // 1) Participante: reutiliza por documento o lo crea.
        let participante = await participantesRepo.findByDocumento(tenantSlug, doc, f.tipo_documento_id);
        if (!participante) {
          participante = await participantesRepo.create(tenantSlug, {
            tipo_documento_id: f.tipo_documento_id, numero_documento: doc,
            nombres, apellidos, email: f.email, telefono: f.telefono,
          }, userId);
        }

        // 2) Inscripción: reutiliza la del grupo o la crea.
        const [insRows] = await pool().query<any[]>(
          'SELECT id FROM inscripciones WHERE grupo_id = ? AND participante_id = ? AND empresa_id = ? AND estado_id <> 6 LIMIT 1',
          [grupoId, participante.id, empresaId],
        );
        let inscripcionId: number;
        const yaInscrito = (insRows as any[]).length > 0;
        if (yaInscrito) {
          inscripcionId = (insRows as any[])[0].id;
        } else {
          const ins = await inscripcionesRepo.create(tenantSlug, {
            participante_id: participante.id, grupo_id: grupoId,
            fecha_inscripcion: new Date().toISOString().split('T')[0],
          }, userId);
          inscripcionId = ins.id;
        }

        if (!emitir) {
          resultados.push({ ...base, estado: yaInscrito ? 'ya_inscrito' : 'inscrito' });
          continue;
        }

        // 3) ¿Ya tiene certificado vigente?
        const [certRows] = await pool().query<any[]>(
          'SELECT id FROM certificados WHERE inscripcion_id = ? AND estado_id != 2 LIMIT 1',
          [inscripcionId],
        );
        if ((certRows as any[]).length) {
          resultados.push({ ...base, estado: 'ya_emitido' });
          continue;
        }

        // 4) Aprobar + emitir. Si la emisión falla, se revierte la aprobación.
        try {
          await pool().query(
            'UPDATE inscripciones SET estado_id = 3, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
            [userId ?? null, inscripcionId, empresaId],
          );
          await emisionRepo.generar(tenantSlug, inscripcionId, userId, { auditar: false });
          resultados.push({ ...base, estado: 'emitido' });
        } catch (eEmit) {
          if (!yaInscrito) {
            // Recién inscrito en esta carga: lo dejamos como inscrito (estado 1), no aprobado.
            await pool().query('UPDATE inscripciones SET estado_id = 1 WHERE id = ? AND empresa_id = ?', [inscripcionId, empresaId]);
          }
          resultados.push({ ...base, estado: 'error', motivo: (eEmit as Error).message });
        }
      } catch (e) {
        resultados.push({ ...base, estado: 'error', motivo: (e as Error).message });
      }
    }

    const cuenta = (k: Estado) => resultados.filter(r => r.estado === k).length;
    const resumen = {
      total:        filas.length,
      inscritos:    cuenta('inscrito'),
      ya_inscritos: cuenta('ya_inscrito'),
      emitidos:     cuenta('emitido'),
      ya_emitidos:  cuenta('ya_emitido'),
      errores:      cuenta('error'),
    };

    const [gn] = await pool().query<any[]>('SELECT nombre_grupo FROM grupos_programas WHERE id = ?', [grupoId]);
    const aula = (gn as any[])[0]?.nombre_grupo ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'importar', entidad: 'inscripcion', entidadId: grupoId, entidadNombre: aula,
      descripcion: `Importó ${resumen.inscritos} estudiante(s) por Excel al aula "${aula ?? grupoId}"`
        + (emitir ? ` y emitió ${resumen.emitidos} certificado(s)` : '')
        + (resumen.errores ? ` · ${resumen.errores} con error` : ''),
      detalle: resumen,
    });

    return { resumen, resultados };
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
              p.numero_documento, g.nombre_grupo, prog.nombre AS programa_nombre, ei.nombre AS estado_nombre
       FROM inscripciones i
       JOIN participantes p       ON p.id  = i.participante_id
       JOIN grupos_programas g    ON g.id  = i.grupo_id
       JOIN programas prog        ON prog.id = g.programa_id
       JOIN estado_inscripcion ei ON ei.id = i.estado_id
       WHERE i.id = ?`,
      [id],
    );
    const r = rows[0];
    if (r) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'inscripcion', entidadId: id,
      entidadNombre: r.participante_nombre,
      descripcion: `Cambió el estado de ${r.participante_nombre}${r.numero_documento ? ` (${r.numero_documento})` : ''} a "${r.estado_nombre}" en el programa "${r.programa_nombre}" · aula "${r.nombre_grupo}"`,
    });
    return r ? InscripcionEntity.fromRow(r) : null;
  },

  /**
   * Cambia el estado de VARIAS inscripciones a la vez (ej. aprobar a todo un grupo
   * de un programa por asistencia, sin notas). Aplica el mismo guard que el cambio
   * individual: Aprobado/Desaprobado a mano solo si NINGÚN programa involucrado usa notas.
   * Devuelve cuántas filas se actualizaron.
   */
  async cambiarEstadoMasivo(tenantSlug: string, ids: number[], estadoId: number, userId?: number): Promise<number> {
    const idsLimpios = (ids ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!idsLimpios.length) return 0;

    const empresaId = await getEmpresaId(tenantSlug);
    const placeholders = idsLimpios.map(() => '?').join(',');

    if (estadoId === 3 || estadoId === 4) {
      const [u] = await pool().query<any[]>(
        `SELECT COUNT(*) AS total
         FROM unidades un
         JOIN grupos_programas g ON g.programa_id = un.programa_id
         JOIN inscripciones i    ON i.grupo_id = g.id
         WHERE i.id IN (${placeholders}) AND i.empresa_id = ? AND un.activo = 1`,
        [...idsLimpios, empresaId],
      );
      if (Number((u as any[])[0]?.total ?? 0) > 0) {
        throw new Error('Hay programas que usan notas: su aprobación se define al registrar las notas, no manualmente.');
      }
    }

    const [upd] = await pool().query<any>(
      `UPDATE inscripciones SET estado_id = ?, user_actua_id = ?
       WHERE id IN (${placeholders}) AND empresa_id = ?`,
      [estadoId, userId ?? null, ...idsLimpios, empresaId],
    );

    if (upd.affectedRows) {
      const [nm] = await pool().query<any[]>(
        `SELECT CONCAT(p.nombres,' ',p.apellidos) AS nombre
           FROM inscripciones i JOIN participantes p ON p.id = i.participante_id
          WHERE i.id IN (${placeholders}) AND i.empresa_id = ?`,
        [...idsLimpios, empresaId],
      );
      const [est] = await pool().query<any[]>('SELECT nombre FROM estado_inscripcion WHERE id = ?', [estadoId]);
      const estadoNombre = (est as any[])[0]?.nombre ?? String(estadoId);
      const nombres = (nm as any[]).map(r => r.nombre);
      const lista = nombres.slice(0, 5).join(', ') + (nombres.length > 5 ? ` y ${nombres.length - 5} más` : '');
      auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'editar', entidad: 'inscripcion', entidadId: null,
        entidadNombre: null,
        descripcion: `Cambió a "${estadoNombre}" a ${upd.affectedRows} alumno(s): ${lista}`,
        detalle: { estado: estadoNombre, total: upd.affectedRows },
      });
    }
    return upd.affectedRows ?? 0;
  },

  /** BORRA una inscripción, sus notas (cascada) y su certificado si lo tuviera
   *  (devolviendo el cupo y eliminando el PDF). */
  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [prevRows] = await pool().query<any[]>(
      `SELECT CONCAT(p.nombres,' ',p.apellidos) AS alumno, p.numero_documento AS doc, g.nombre_grupo AS aula
         FROM inscripciones i
         JOIN participantes p    ON p.id = i.participante_id
         JOIN grupos_programas g ON g.id = i.grupo_id
        WHERE i.id = ? AND i.empresa_id = ?`,
      [id, empresaId],
    );
    const prev = (prevRows as any[])[0];
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [certs] = await conn.query<any[]>(
        'SELECT id, url FROM certificados WHERE inscripcion_id = ? AND empresa_id = ?', [id, empresaId],
      );
      const urls = await purgarCerts(conn, empresaId, certs as any[]);
      const [r] = await conn.query<any>('DELETE FROM inscripciones WHERE id = ? AND empresa_id = ?', [id, empresaId]);
      await conn.commit();
      borrarPdfs(urls);
      if (r.affectedRows > 0) auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'inscripcion', entidadId: id,
        entidadNombre: prev?.alumno ?? null,
        descripcion: `Eliminó la inscripción de ${prev ? `${prev.alumno} (${prev.doc})` : 'un alumno'}${prev?.aula ? ` en el aula "${prev.aula}"` : ''}`,
      });
      return r.affectedRows > 0;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
};

// ============================================================
// LOGOS
// ============================================================
/** Planes cuyo logo de empresa (logo_url) es OBLIGATORIO en los certificados. */
export const PLANES_LOGO_DEFAULT = ['basico', 'profesional'];

/**
 * Garantiza que exista (y esté sincronizado) el logo default de la empresa cuando
 * su plan lo exige (Básico/Profesional). Materializa empresas.logo_url como una
 * fila en `logos` con es_default=1. Si el plan NO lo exige, no hace nada.
 */
async function ensureLogoDefault(empresaId: number): Promise<void> {
  const [emp] = await pool().query<any[]>(
    `SELECT e.logo_url, pl.slug AS plan_slug
       FROM empresas e LEFT JOIN planes pl ON pl.id = e.plan_actual_id
      WHERE e.id = ? LIMIT 1`,
    [empresaId],
  );
  const row = (emp as any[])[0];
  const aplica = !!row?.logo_url && PLANES_LOGO_DEFAULT.includes(row.plan_slug);
  if (!aplica) {
    // El plan ya no exige logo obligatorio (ej. subió a Empresarial/Corporativo):
    // desbloquear el default que hubiera para que sea un logo normal (eliminable).
    await pool().query('UPDATE logos SET es_default = 0 WHERE empresa_id = ? AND es_default = 1', [empresaId]);
    return;
  }

  const [exist] = await pool().query<any[]>(
    'SELECT id, imagen_logo FROM logos WHERE empresa_id = ? AND es_default = 1 AND activo = 1 LIMIT 1',
    [empresaId],
  );
  if ((exist as any[]).length) {
    // Mantenerlo sincronizado si Vaxa cambió el logo de la empresa.
    if (exist[0].imagen_logo !== row.logo_url) {
      await pool().query('UPDATE logos SET imagen_logo = ? WHERE id = ?', [row.logo_url, exist[0].id]);
    }
    return;
  }
  await pool().query(
    `INSERT INTO logos (empresa_id, nombre, imagen_logo, es_default) VALUES (?, 'Logo de la empresa', ?, 1)`,
    [empresaId, row.logo_url],
  );
}

export const logosRepo = {
  ensureLogoDefault,
  async findAll(tenantSlug: string): Promise<LogoEntity[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    await ensureLogoDefault(empresaId);  // crea/sincroniza el logo obligatorio si aplica
    const [rows] = await pool().query<any[]>(
      'SELECT * FROM logos WHERE empresa_id = ? AND activo = 1 ORDER BY es_default DESC, created_at DESC',
      [empresaId],
    );
    return (rows as any[]).map(LogoEntity.fromRow);
  },

  async create(tenantSlug: string, dto: CreateLogoDto, userId?: number): Promise<LogoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [result] = await pool().query<any>(
      'INSERT INTO logos (empresa_id, nombre, imagen_logo, user_crea_id) VALUES (?, ?, ?, ?)',
      [empresaId, dto.nombre ?? null, guardarImagen(dto.imagen_logo, 'logos'), userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM logos WHERE id = ?', [result.insertId]);
    const logo = LogoEntity.fromRow(rows[0]);
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'logo', entidadId: logo.id, entidadNombre: logo.nombre ?? null,
      descripcion: `Agregó el logo${logo.nombre ? ` "${logo.nombre}"` : ''}`,
    });
    return logo;
  },

  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    // El logo default es obligatorio: no se puede eliminar.
    const [chk] = await pool().query<any[]>(
      'SELECT es_default, nombre FROM logos WHERE id = ? AND empresa_id = ?', [id, empresaId],
    );
    if ((chk as any[])[0]?.es_default) {
      throw new Error('LOGO_DEFAULT: El logo de la empresa es obligatorio en tu plan y no se puede eliminar.');
    }
    const nombrePrev = (chk as any[])[0]?.nombre ?? null;
    const [r] = await pool().query<any>('UPDATE logos SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    if (r.affectedRows > 0) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'logo', entidadId: id, entidadNombre: nombrePrev,
      descripcion: `Eliminó el logo${nombrePrev ? ` "${nombrePrev}"` : ''}`,
    });
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
      [empresaId, dto.nombre_autoridad, dto.cargo, guardarImagen(dto.imagen_firma, 'firmas'), userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM firmas WHERE id = ?', [result.insertId]);
    const firma = FirmaEntity.fromRow(rows[0]);
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'crear', entidad: 'firma', entidadId: firma.id, entidadNombre: firma.nombre_autoridad,
      descripcion: `Agregó la firma de ${firma.nombre_autoridad}${firma.cargo ? ` (${firma.cargo})` : ''}`,
    });
    return firma;
  },

  async remove(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [prevRows] = await pool().query<any[]>('SELECT nombre_autoridad FROM firmas WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    const nombrePrev = (prevRows as any[])[0]?.nombre_autoridad ?? null;
    const [r] = await pool().query<any>('UPDATE firmas SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    if (r.affectedRows > 0) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'firma', entidadId: id, entidadNombre: nombrePrev,
      descripcion: `Eliminó la firma de ${nombrePrev ?? 'una autoridad'}`,
    });
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
      [empresaId, programaId, grupoId, guardarImagen(dto.plantilla_url, 'plantillas') ?? null, dto.texto_personalizado ?? null, userId ?? null, userId ?? null],
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

    const [pn] = await pool().query<any[]>('SELECT nombre FROM programas WHERE id = ? AND empresa_id = ?', [programaId, empresaId]);
    const programa = (pn as any[])[0]?.nombre ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'editar', entidad: 'config', entidadId: programaId, entidadNombre: programa,
      descripcion: `Actualizó el diseño del certificado del programa "${programa ?? programaId}"${grupoId ? ' (diseño específico de un aula)' : ''}`
        + ` · ${dto.logo_ids?.length ?? 0} logo(s), ${dto.firma_ids?.length ?? 0} firma(s)${dto.plantilla_url ? ', con plantilla' : ''}`,
      detalle: { logos: dto.logo_ids?.length ?? 0, firmas: dto.firma_ids?.length ?? 0, plantilla: !!dto.plantilla_url, grupo_id: grupoId },
    });

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
  async eliminarConfigGrupo(tenantSlug: string, programaId: number, grupoId: number, userId?: number): Promise<boolean> {
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

    const [pn] = await pool().query<any[]>('SELECT nombre FROM programas WHERE id = ? AND empresa_id = ?', [programaId, empresaId]);
    const [gn] = await pool().query<any[]>('SELECT nombre_grupo FROM grupos_programas WHERE id = ? AND empresa_id = ?', [grupoId, empresaId]);
    const programa = (pn as any[])[0]?.nombre ?? null;
    const aula = (gn as any[])[0]?.nombre_grupo ?? null;
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'config', entidadId: programaId, entidadNombre: programa,
      descripcion: `Quitó el diseño específico del aula "${aula ?? grupoId}" del programa "${programa ?? programaId}" (vuelve a heredar del programa)`,
    });
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
              prog.horas_academicas, prog.creditos,
              tp.nombre AS tipo_programa_nombre,
              g.id AS grupo_id, g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3, g.fecha_dia2, g.fecha_dia3,
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

  /**
   * Inserta el certificado de una inscripción dentro de una transacción YA abierta,
   * SIN tocar el crédito. Valida: aprobado (estado 3), sin duplicado vigente y que el
   * programa tenga diseño configurado (si no → FALTA_CONFIG). Devuelve id y código.
   * Lo usan `generar` (individual) y `generarLote` (tanda) para compartir la lógica.
   */
  async _emitirCertEnTx(
    conn: PoolConnection, tenantSlug: string, empresaId: number, inscripcionId: number, userId?: number,
  ): Promise<{ certId: number; codigo: string }> {
    const [insc] = await conn.query<any[]>(
      'SELECT * FROM inscripciones WHERE id = ? AND empresa_id = ? AND estado_id = 3',
      [inscripcionId, empresaId],
    );
    if (!(insc as any[]).length) throw new Error('Inscripción no encontrada o el participante no está aprobado');

    const [dup] = await conn.query<any[]>(
      'SELECT id FROM certificados WHERE inscripcion_id = ? AND estado_id != 2',
      [inscripcionId],
    );
    if ((dup as any[]).length) throw new Error('Ya existe un certificado vigente para esta inscripción');

    // Bloquear emisión si el programa/grupo no tiene diseño configurado.
    const grupoId = (insc as any[])[0].grupo_id;
    const [progRows] = await conn.query<any[]>('SELECT programa_id FROM grupos_programas WHERE id = ?', [grupoId]);
    const programaId = (progRows as any[])[0]?.programa_id;
    const config = await configRepo.findByPrograma(tenantSlug, programaId, grupoId);
    const sinDiseno = !config || (!config.plantilla_url && (config.logos?.length ?? 0) === 0 && (config.firmas?.length ?? 0) === 0);
    if (sinDiseno) {
      throw new Error('FALTA_CONFIG: Falta configurar el diseño del certificado de este programa. Ve a Configuración y agrega al menos el fondo, un logo o una firma.');
    }

    const codigo = generarCodigo(empresaId);
    const [result] = await conn.query<any>(
      `INSERT INTO certificados (empresa_id, inscripcion_id, codigo_unico, fecha_emision, estado_id, user_crea_id)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [empresaId, inscripcionId, codigo, new Date().toISOString().split('T')[0], userId ?? null],
    );
    return { certId: result.insertId, codigo };
  },

  /** Recupera todos los datos (JOINs) de un certificado recién creado, para responder y generar PDF. */
  async _cargarCertCompleto(certId: number): Promise<any> {
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas, prog.creditos,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3,
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
    return (rows as any[])[0];
  },

  async generar(tenantSlug: string, inscripcionId: number, userId?: number, opts: { auditar?: boolean } = {}): Promise<CertificadoEntity> {
    const empresaId = await getEmpresaId(tenantSlug);

    // Transacción: insertar el certificado y consumir 1 crédito de forma atómica.
    const conn = await pool().getConnection();
    let certId: number;
    try {
      await conn.beginTransaction();
      const r = await emisionRepo._emitirCertEnTx(conn, tenantSlug, empresaId, inscripcionId, userId);
      certId = r.certId;
      await planRepo.consumirCupo(conn, empresaId);   // 1 crédito, movimiento individual
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const cert = await emisionRepo._cargarCertCompleto(certId);

    // Generar el PDF en segundo plano (no bloquea la respuesta al frontend)
    setImmediate(() => generarPdfYGuardar(cert, tenantSlug).catch(err =>
      console.error(`[PDF] Error generando ${cert.codigo_unico}:`, err.message),
    ));

    // Auditoría: emisión individual.
    auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'emitir', entidad: 'certificado',
      entidadId: certId, entidadNombre: cert.codigo_unico,
      descripcion: `Emitió el certificado ${cert.codigo_unico} de ${cert.participante_nombre} (${cert.programa_nombre})`,
    });

    return CertificadoEntity.fromRow(cert);
  },

  /**
   * Emisión EN LOTE: emite una lista de inscripciones en UNA sola transacción y
   * registra UN solo movimiento de crédito (-N) en vez de N de -1. En planes con
   * saldo, emite hasta donde alcance (los que no entran se reportan como bloqueo
   * 'creditos'); plan ilimitado emite todo. Por inscripción inválida (no aprobada,
   * duplicada, FALTA_CONFIG) acumula el error y sigue con las demás.
   */
  async generarLote(
    tenantSlug: string, inscripcionIds: number[], userId?: number,
  ): Promise<{ emitidos: number; errores: Array<{ id: number; error: string }>; bloqueo: 'creditos' | null }> {
    const empresaId = await getEmpresaId(tenantSlug);
    const ids = Array.from(new Set(inscripcionIds.map(Number).filter(Boolean)));
    if (ids.length === 0) return { emitidos: 0, errores: [], bloqueo: null };

    const errores: Array<{ id: number; error: string }> = [];
    const emitidosIds: number[] = [];
    let bloqueo: 'creditos' | null = null;
    let nombreAula: string | null = null;

    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const { saldo, ilimitado } = await planRepo.saldoCreditos(conn, empresaId);

      for (const inscId of ids) {
        // Sin plan ilimitado: parar cuando se agotó el saldo (el resto = bloqueo creditos).
        if (!ilimitado && emitidosIds.length >= saldo) { bloqueo = 'creditos'; break; }
        try {
          const r = await emisionRepo._emitirCertEnTx(conn, tenantSlug, empresaId, inscId, userId);
          emitidosIds.push(r.certId);
        } catch (e) {
          errores.push({ id: inscId, error: (e as Error).message });
        }
      }

      if (emitidosIds.length > 0) {
        const desc = emitidosIds.length === 1
          ? 'Emisión de certificado'
          : `Emisión de ${emitidosIds.length} certificados`;
        await planRepo.consumirCreditos(conn, empresaId, emitidosIds.length, desc);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Fuera de la transacción: cargar datos + generar PDFs en background.
    for (const certId of emitidosIds) {
      const cert = await emisionRepo._cargarCertCompleto(certId);
      if (!nombreAula) nombreAula = cert?.nombre_grupo ?? null;
      if (cert) setImmediate(() => generarPdfYGuardar(cert, tenantSlug).catch(err =>
        console.error(`[PDF] Error generando ${cert.codigo_unico}:`, err.message),
      ));
    }

    // Auditoría: una sola entrada por la tanda.
    if (emitidosIds.length > 0) {
      const desc = emitidosIds.length === 1
        ? `Emitió 1 certificado${nombreAula ? ` del aula "${nombreAula}"` : ''}`
        : `Emitió ${emitidosIds.length} certificados${nombreAula ? ` del aula "${nombreAula}"` : ''}`;
      auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'emitir', entidad: 'certificado',
        entidadId: null, entidadNombre: nombreAula, descripcion: desc,
        detalle: { emitidos: emitidosIds.length, errores: errores.length },
      });
    }

    return { emitidos: emitidosIds.length, errores, bloqueo };
  },

  /** Regenera el PDF de un certificado existente (si cambias diseño, etc) */
  async regenerarPDF(tenantSlug: string, id: number): Promise<string | null> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, prog.id AS programa_id,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento,
              prog.nombre AS programa_nombre,
              prog.horas_academicas, prog.creditos,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3,
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
              prog.horas_academicas, prog.creditos,
              tp.nombre AS tipo_programa_nombre,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3,
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

  /**
   * Valida un certificado por su código único, ACOTADO a una empresa (tenant_slug).
   * Esto impide que el certificado de una empresa se valide desde el slug de otra:
   * un código emitido por "cueto" solo es válido en /cueto/certificados/validar,
   * no en /vaxa/... ni en ningún otro tenant.
   */
  async validarPublico(codigoUnico: string, tenantSlug: string): Promise<CertificadoPublicoEntity | null> {
    const [rows] = await pool().query<any[]>(
      `SELECT c.codigo_unico, c.fecha_emision, c.url,
              CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
              p.numero_documento, td.codigo AS tipo_doc,
              prog.nombre AS programa_nombre, prog.horas_academicas,
              g.nombre_grupo, g.fecha_inicio, g.fecha_fin, g.fecha_dia2, g.fecha_dia3,
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
       WHERE c.codigo_unico = ? AND e.tenant_slug = ?`,
      [codigoUnico, tenantSlug.toLowerCase().trim()],
    );
    return rows[0] ? CertificadoPublicoEntity.fromRow(rows[0]) : null;
  },

  async anular(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const info = await emisionRepo._infoCertParaAudit(empresaId, id);
    const [r] = await pool().query<any>(
      'UPDATE certificados SET estado_id = 2, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
      [userId ?? null, id, empresaId],
    );
    if (r.affectedRows > 0) auditoriaRepo.registrar({
      empresaId, usuarioId: userId, accion: 'anular', entidad: 'certificado', entidadId: id, entidadNombre: info?.codigo ?? null,
      descripcion: `Anuló el certificado ${info?.codigo ?? id}${info?.alumno ? ` de ${info.alumno}` : ''}${info?.programa ? ` (programa "${info.programa}"${info.aula ? `, aula "${info.aula}"` : ''})` : ''}`,
    });
    return r.affectedRows > 0;
  },

  /** Datos mínimos (código + alumno) de un certificado para describir la auditoría. */
  async _infoCertParaAudit(empresaId: number, id: number): Promise<{ codigo: string; alumno: string; programa: string | null; aula: string | null } | null> {
    const [rows] = await pool().query<any[]>(
      `SELECT c.codigo_unico AS codigo, CONCAT(p.nombres,' ',p.apellidos) AS alumno,
              prog.nombre AS programa, g.nombre_grupo AS aula
         FROM certificados c
         JOIN inscripciones i    ON i.id = c.inscripcion_id
         JOIN participantes p    ON p.id = i.participante_id
         JOIN grupos_programas g ON g.id = i.grupo_id
         JOIN programas prog     ON prog.id = g.programa_id
        WHERE c.id = ? AND c.empresa_id = ?`,
      [id, empresaId],
    );
    return (rows as any[])[0] ?? null;
  },

  /**
   * Elimina el certificado por completo y DEVUELVE 1 al cupo del mes.
   * (Anular solo desactiva; eliminar libera el cupo). Borra también el PDF físico.
   */
  async eliminar(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const info = await emisionRepo._infoCertParaAudit(empresaId, id);
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
      auditoriaRepo.registrar({
        empresaId, usuarioId: userId, accion: 'eliminar', entidad: 'certificado', entidadId: id, entidadNombre: info?.codigo ?? null,
        descripcion: `Eliminó el certificado ${info?.codigo ?? id}${info?.alumno ? ` de ${info.alumno}` : ''}${info?.programa ? ` (programa "${info.programa}"${info.aula ? `, aula "${info.aula}"` : ''})` : ''} · se devolvió 1 crédito`,
      });
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

  if (!rows.length) return null;
  return zipearCerts(rows);
},

/**
 * Igual que zipGrupo pero por una LISTA explícita de IDs de certificado:
 * sirve para descargar exactamente lo que el panel tenga filtrado
 * (por grupo, por nombre/documento, o cualquier combinación).
 */
async zipPorIds(tenantSlug: string, ids: number[]): Promise<Buffer | null> {
  const idsLimpios = (ids ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!idsLimpios.length) return null;

  const empresaId = await getEmpresaId(tenantSlug);
  const placeholders = idsLimpios.map(() => '?').join(',');

  const [rows] = await pool().query<any[]>(
    `SELECT c.url, c.codigo_unico,
            CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre
     FROM certificados c
     INNER JOIN inscripciones i ON i.id = c.inscripcion_id
     INNER JOIN participantes p ON p.id = i.participante_id
     WHERE c.id IN (${placeholders})
       AND c.empresa_id = ?
       AND c.estado_id = 1
       AND c.url IS NOT NULL`,
    [...idsLimpios, empresaId],
  );

  if (!rows.length) return null;
  return zipearCerts(rows);
},

};

/* ── Helper: arma un ZIP en memoria a partir de filas {url, participante_nombre} ── */
function zipearCerts(rows: any[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    // archiver v8 es ESM y cambió la API: ya no es archiver('zip', …) sino la clase ZipArchive.
    const archive = new (archiver as any).ZipArchive({ zlib: { level: 9 } });

    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);

    // Evita nombres repetidos en el ZIP (dos alumnos con el mismo nombre).
    const usados = new Map<string, number>();
    for (const cert of rows) {
      const pdfPath = path.join(process.cwd(), cert.url.replace(/^\/+/, ''));
      if (!fs.existsSync(pdfPath)) continue;

      let base = `${cert.participante_nombre}`.replace(/[\\/:*?"<>|]/g, '_').trim() || cert.codigo_unico;
      const n = usados.get(base) ?? 0;
      usados.set(base, n + 1);
      const nombreArchivo = (n === 0 ? base : `${base} (${n + 1})`) + '.pdf';

      archive.file(pdfPath, { name: nombreArchivo });
    }

    archive.finalize();
  });
}

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
    const aYmdOpt = (v: any) => v ? (typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10)) : undefined;
    const fechaDia2 = aYmdOpt(cert.fecha_dia2);
    const fechaDia3 = aYmdOpt(cert.fecha_dia3);

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

    // Logos del cert. Logo DEFAULT obligatorio (planes Básico/Profesional): el
    // logo de la empresa (logo_url) SIEMPRE aparece, aunque la config no lo tenga
    // seleccionado — red de seguridad. Va primero (orden -1).
    let logosDatos = (config?.logos ?? []).map((l: any) => ({
      imagen: l.imagen_logo, nombre: l.nombre, orden: l.orden,
    }));
    const [empLogoRows] = await pool().query<any[]>(
      `SELECT e.logo_url, pl.slug AS plan_slug
         FROM empresas e LEFT JOIN planes pl ON pl.id = e.plan_actual_id
        WHERE e.tenant_slug = ? LIMIT 1`,
      [tenantSlug],
    );
    const empLogo = (empLogoRows as any[])[0];
    if (empLogo?.logo_url && PLANES_LOGO_DEFAULT.includes(empLogo.plan_slug)
        && !logosDatos.some((l: any) => l.imagen === empLogo.logo_url)) {
      logosDatos = [{ imagen: empLogo.logo_url, nombre: 'Logo de la empresa', orden: -1 }, ...logosDatos];
    }

    return {
      participante_nombre:  cert.participante_nombre,
      programa_nombre:      cert.programa_nombre,
      tipo_programa:        cert.tipo_programa_nombre ?? 'Certificado',
      horas_academicas:     cert.horas_academicas ?? 0,
      creditos:             cert.creditos ?? 0,
      fecha_inicio:         fechaInicio,
      fecha_fin:            fechaFin,
      fecha_dia2:           fechaDia2,
      fecha_dia3:           fechaDia3,
      modalidad:            cert.modalidad_nombre,
      fecha_emision:        fechaEmision,
      codigo_unico:         cert.codigo_unico,
      empresa_nombre:       cert.tenant_slug ?? tenantSlug,
      texto_personalizado:  (config as any)?.texto_personalizado ?? null,
      plantilla_url:        config?.plantilla_url ?? null,
      logos: logosDatos,
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
