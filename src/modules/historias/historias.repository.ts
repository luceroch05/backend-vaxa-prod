import { randomBytes } from 'crypto';
import { getPool } from '../../db/pool';
import { AppError } from '../../shared/errors';

/**
 * Repositorio del módulo Historias Clínicas (centros terapéuticos).
 * Aislado en su propia carpeta: solo depende del pool y de las tablas `hc_*`
 * (ver scripts/mysql-historias-clinicas.sql). Todo va scoped por empresa_id
 * (el tenant), que se resuelve desde el tenant_slug del token.
 */

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

/** tenant_slug -> empresa_id (tenant). Igual criterio que el resto del sistema. */
async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new AppError('Empresa no encontrada', 404);
  return rows[0].id as number;
}

// ── Tipos de entrada ────────────────────────────────────────────────────────
export interface PacienteDto {
  tipo_doc?: string;
  num_doc?: string | null;
  nombres: string;
  apellidos: string;
  fecha_nacimiento?: string | null;
  sexo_id?: number | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  apoderado_nombre?: string | null;
  apoderado_telefono?: string | null;
  apoderado_relacion?: string | null;
  observaciones?: string | null;
}

export interface HistoriaDto {
  motivo_consulta?: string | null;
  antecedentes?: string | null;
  estado_id?: number;
}

export interface SesionDto {
  fecha?: string;
  subjetivo?: string | null;
  objetivo?: string | null;
  analisis?: string | null;
  plan?: string | null;
  evolucion?: string | null;
  firmada?: boolean;
}

export interface DiagnosticoDto {
  codigo_cie10?: string | null;
  descripcion: string;
  tipo_id?: number;
  fecha?: string;
}

export interface CitaDto {
  paciente_id: number;
  terapeuta_id: number;
  servicio_id?: number | null;
  inicio: string;         // 'YYYY-MM-DD HH:mm:ss'
  fin?: string | null;
  motivo?: string | null;
  estado_id?: number;
}
export interface CitaUpdateDto {
  inicio?: string;
  fin?: string | null;
  motivo?: string | null;
  estado_id?: number;
  terapeuta_id?: number;
  servicio_id?: number | null;
}

export interface ServicioDto {
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
}

export interface ObjetivoDto {
  descripcion?: string;
  unidad?: string | null;
  meta?: number | null;
  estado_id?: number;
}
export interface AvanceDto {
  valor?: number;
  fecha?: string | null;
  sesion_id?: number | null;
  nota?: string | null;
}
export interface TareaDto {
  descripcion?: string;
  detalle?: string | null;
  fecha_limite?: string | null;
  cumplida?: boolean;
  activo?: boolean;
}

export const historiasRepo = {
  // ── Catálogos (tablas maestras) ────────────────────────────────────────────
  async catalogos() {
    const p = pool();
    const [sexos]        = await p.query<any[]>('SELECT id, codigo, nombre FROM hc_sexo WHERE activo = 1 ORDER BY id');
    const [estadosHist]  = await p.query<any[]>('SELECT id, codigo, nombre FROM hc_historia_estado WHERE activo = 1 ORDER BY id');
    const [tiposDx]      = await p.query<any[]>('SELECT id, codigo, nombre FROM hc_diagnostico_tipo WHERE activo = 1 ORDER BY id');
    const [estadosCita]  = await p.query<any[]>('SELECT id, codigo, nombre FROM hc_cita_estado WHERE activo = 1 ORDER BY id');
    const [estadosObj]   = await p.query<any[]>('SELECT id, codigo, nombre FROM hc_objetivo_estado WHERE activo = 1 ORDER BY id').catch(() => [[]]);
    return { sexos, estados_historia: estadosHist, tipos_diagnostico: tiposDx, estados_cita: estadosCita, estados_objetivo: estadosObj };
  },

  // ── Pacientes ──────────────────────────────────────────────────────────────
  async listPacientes(tenantSlug: string, incluirInactivos = false) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, s.nombre AS sexo_nombre,
              h.id AS historia_id, h.numero AS historia_numero
         FROM hc_pacientes p
         LEFT JOIN hc_sexo s     ON s.id = p.sexo_id
         LEFT JOIN hc_historias h ON h.paciente_id = p.id
        WHERE p.empresa_id = ? ${incluirInactivos ? '' : 'AND p.activo = 1'}
        ORDER BY p.apellidos, p.nombres`,
      [empresaId],
    );
    return rows;
  },

  async getPaciente(tenantSlug: string, id: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, s.nombre AS sexo_nombre
         FROM hc_pacientes p
         LEFT JOIN hc_sexo s ON s.id = p.sexo_id
        WHERE p.empresa_id = ? AND p.id = ? LIMIT 1`,
      [empresaId, id],
    );
    return rows[0] ?? null;
  },

  async createPaciente(tenantSlug: string, dto: PacienteDto, userId?: number) {
    if (!dto.nombres?.trim() || !dto.apellidos?.trim()) {
      throw new AppError('Nombres y apellidos son requeridos', 400);
    }
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_pacientes
         (empresa_id, tipo_doc, num_doc, nombres, apellidos, fecha_nacimiento, sexo_id,
          telefono, email, direccion, apoderado_nombre, apoderado_telefono,
          apoderado_relacion, observaciones, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, dto.tipo_doc || '1', dto.num_doc || null,
        dto.nombres.trim(), dto.apellidos.trim(), dto.fecha_nacimiento || null, dto.sexo_id || null,
        dto.telefono || null, dto.email || null, dto.direccion || null,
        dto.apoderado_nombre || null, dto.apoderado_telefono || null,
        dto.apoderado_relacion || null, dto.observaciones || null, userId ?? null,
      ],
    );
    return this.getPacienteById(empresaId, res.insertId);
  },

  async updatePaciente(tenantSlug: string, id: number, dto: PacienteDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (col: string, val: any) => { campos.push(`${col} = ?`); vals.push(val); };

    if (dto.tipo_doc !== undefined)           set('tipo_doc', dto.tipo_doc || '1');
    if (dto.num_doc !== undefined)            set('num_doc', dto.num_doc || null);
    if (dto.nombres !== undefined)            set('nombres', dto.nombres.trim());
    if (dto.apellidos !== undefined)          set('apellidos', dto.apellidos.trim());
    if (dto.fecha_nacimiento !== undefined)   set('fecha_nacimiento', dto.fecha_nacimiento || null);
    if (dto.sexo_id !== undefined)            set('sexo_id', dto.sexo_id || null);
    if (dto.telefono !== undefined)           set('telefono', dto.telefono || null);
    if (dto.email !== undefined)              set('email', dto.email || null);
    if (dto.direccion !== undefined)          set('direccion', dto.direccion || null);
    if (dto.apoderado_nombre !== undefined)   set('apoderado_nombre', dto.apoderado_nombre || null);
    if (dto.apoderado_telefono !== undefined) set('apoderado_telefono', dto.apoderado_telefono || null);
    if (dto.apoderado_relacion !== undefined) set('apoderado_relacion', dto.apoderado_relacion || null);
    if (dto.observaciones !== undefined)      set('observaciones', dto.observaciones || null);

    if (!campos.length) return this.getPacienteById(empresaId, id);
    set('user_actua_id', userId ?? null);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(
      `UPDATE hc_pacientes SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals,
    );
    if (!res.affectedRows) return null;
    return this.getPacienteById(empresaId, id);
  },

  async setActivoPaciente(tenantSlug: string, id: number, activo: boolean, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'UPDATE hc_pacientes SET activo = ?, user_actua_id = ? WHERE empresa_id = ? AND id = ?',
      [activo ? 1 : 0, userId ?? null, empresaId, id],
    );
    return res.affectedRows > 0;
  },

  /** Helper interno: trae un paciente ya sabiendo el empresa_id (evita re-resolver). */
  async getPacienteById(empresaId: number, id: number) {
    const [rows] = await pool().query<any[]>(
      `SELECT p.*, s.nombre AS sexo_nombre
         FROM hc_pacientes p LEFT JOIN hc_sexo s ON s.id = p.sexo_id
        WHERE p.empresa_id = ? AND p.id = ? LIMIT 1`,
      [empresaId, id],
    );
    return rows[0] ?? null;
  },

  // ── Historia clínica (1 por paciente) ────────────────────────────────────────
  async getHistoriaByPaciente(tenantSlug: string, pacienteId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT h.*, e.nombre AS estado_nombre
         FROM hc_historias h
         LEFT JOIN hc_historia_estado e ON e.id = h.estado_id
        WHERE h.empresa_id = ? AND h.paciente_id = ? LIMIT 1`,
      [empresaId, pacienteId],
    );
    return rows[0] ?? null;
  },

  /** Abre la historia del paciente. Si ya existe, la devuelve (1 por paciente). */
  async abrirHistoria(tenantSlug: string, pacienteId: number, dto: HistoriaDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);

    const existente = await this.getHistoriaByPaciente(tenantSlug, pacienteId);
    if (existente) return existente;

    // Correlativo anual por centro: HC-YYYY-0001
    const anio = new Date().getFullYear();
    const [[{ n }]] = await pool().query<any[]>(
      `SELECT COUNT(*) + 1 AS n FROM hc_historias
        WHERE empresa_id = ? AND YEAR(created_at) = ?`,
      [empresaId, anio],
    ) as any;
    const numero = `HC-${anio}-${String(n).padStart(4, '0')}`;

    const [res] = await pool().query<any>(
      `INSERT INTO hc_historias
         (empresa_id, paciente_id, numero, motivo_consulta, antecedentes, estado_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, pacienteId, numero, dto.motivo_consulta || null,
       dto.antecedentes || null, dto.estado_id || 1, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_historias WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  async updateHistoria(tenantSlug: string, id: number, dto: HistoriaDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (col: string, val: any) => { campos.push(`${col} = ?`); vals.push(val); };

    if (dto.motivo_consulta !== undefined) set('motivo_consulta', dto.motivo_consulta || null);
    if (dto.antecedentes !== undefined)    set('antecedentes', dto.antecedentes || null);
    if (dto.estado_id !== undefined)       set('estado_id', dto.estado_id);

    if (!campos.length) return null;
    set('user_actua_id', userId ?? null);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(
      `UPDATE hc_historias SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals,
    );
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_historias WHERE id = ?', [id]);
    return rows[0];
  },

  // ── Diagnósticos ─────────────────────────────────────────────────────────────
  async listDiagnosticos(tenantSlug: string, historiaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT d.*, t.nombre AS tipo_nombre
         FROM hc_diagnosticos d LEFT JOIN hc_diagnostico_tipo t ON t.id = d.tipo_id
        WHERE d.empresa_id = ? AND d.historia_id = ? ORDER BY d.fecha DESC, d.id DESC`,
      [empresaId, historiaId],
    );
    return rows;
  },

  async addDiagnostico(tenantSlug: string, historiaId: number, dto: DiagnosticoDto, userId?: number) {
    if (!dto.descripcion?.trim()) throw new AppError('La descripción del diagnóstico es requerida', 400);
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_diagnosticos (empresa_id, historia_id, codigo_cie10, descripcion, tipo_id, fecha, user_crea_id)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)`,
      [empresaId, historiaId, dto.codigo_cie10 || null, dto.descripcion.trim(),
       dto.tipo_id || 1, dto.fecha || null, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_diagnosticos WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  // ── Sesiones / evoluciones (SOAP) ─────────────────────────────────────────────
  async listSesiones(tenantSlug: string, historiaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT s.*, CONCAT(u.nombres, ' ', u.apellidos) AS terapeuta_nombre
         FROM hc_sesiones s LEFT JOIN usuarios u ON u.id = s.terapeuta_id
        WHERE s.empresa_id = ? AND s.historia_id = ? ORDER BY s.fecha DESC, s.id DESC`,
      [empresaId, historiaId],
    );
    return rows;
  },

  async createSesion(tenantSlug: string, historiaId: number, dto: SesionDto, terapeutaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    // Correlativo dentro de la historia
    const [[{ n }]] = await pool().query<any[]>(
      'SELECT COUNT(*) + 1 AS n FROM hc_sesiones WHERE historia_id = ?', [historiaId],
    ) as any;
    const [res] = await pool().query<any>(
      `INSERT INTO hc_sesiones
         (empresa_id, historia_id, terapeuta_id, fecha, numero_sesion,
          subjetivo, objetivo, analisis, plan, evolucion, firmada)
       VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, historiaId, terapeutaId, dto.fecha || null, n,
       dto.subjetivo || null, dto.objetivo || null, dto.analisis || null,
       dto.plan || null, dto.evolucion || null, dto.firmada ? 1 : 0],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_sesiones WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  async updateSesion(tenantSlug: string, id: number, dto: SesionDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    // Una evolución firmada no se edita (integridad clínica).
    const [chk] = await pool().query<any[]>(
      'SELECT firmada FROM hc_sesiones WHERE empresa_id = ? AND id = ? LIMIT 1', [empresaId, id],
    );
    if (!chk.length) return null;
    if (chk[0].firmada) throw new AppError('La evolución está firmada y no puede editarse', 409, 'SESION_FIRMADA');

    const campos: string[] = [];
    const vals: any[] = [];
    const set = (col: string, val: any) => { campos.push(`${col} = ?`); vals.push(val); };
    if (dto.subjetivo !== undefined) set('subjetivo', dto.subjetivo || null);
    if (dto.objetivo !== undefined)  set('objetivo', dto.objetivo || null);
    if (dto.analisis !== undefined)  set('analisis', dto.analisis || null);
    if (dto.plan !== undefined)      set('plan', dto.plan || null);
    if (dto.evolucion !== undefined) set('evolucion', dto.evolucion || null);
    if (dto.firmada !== undefined)   set('firmada', dto.firmada ? 1 : 0);

    if (!campos.length) return null;
    set('user_actua_id', userId ?? null);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(
      `UPDATE hc_sesiones SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals,
    );
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_sesiones WHERE id = ?', [id]);
    return rows[0];
  },

  // ── Servicios del centro (catálogo por tenant) ────────────────────────────────
  async listServicios(tenantSlug: string, incluirInactivos = false) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id, nombre, descripcion, activo FROM hc_servicios
        WHERE empresa_id = ? ${incluirInactivos ? '' : 'AND activo = 1'}
        ORDER BY nombre`,
      [empresaId],
    );
    return rows;
  },

  async createServicio(tenantSlug: string, dto: ServicioDto, userId?: number) {
    if (!dto.nombre?.trim()) throw new AppError('El nombre del servicio es requerido', 400);
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_servicios (empresa_id, nombre, descripcion, user_crea_id) VALUES (?, ?, ?, ?)`,
      [empresaId, dto.nombre.trim(), dto.descripcion || null, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT id, nombre, descripcion, activo FROM hc_servicios WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  async updateServicio(tenantSlug: string, id: number, dto: ServicioDto) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (c: string, v: any) => { campos.push(`${c} = ?`); vals.push(v); };
    if (dto.nombre !== undefined)      set('nombre', dto.nombre.trim());
    if (dto.descripcion !== undefined) set('descripcion', dto.descripcion || null);
    if (dto.activo !== undefined)      set('activo', dto.activo ? 1 : 0);
    if (!campos.length) return null;
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE hc_servicios SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals);
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>('SELECT id, nombre, descripcion, activo FROM hc_servicios WHERE id = ?', [id]);
    return rows[0];
  },

  // ── Servicios que brinda cada terapeuta ───────────────────────────────────────
  async getServiciosDeTerapeuta(tenantSlug: string, terapeutaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT s.id, s.nombre FROM hc_terapeuta_servicio ts
         JOIN hc_servicios s ON s.id = ts.servicio_id
        WHERE ts.empresa_id = ? AND ts.terapeuta_id = ? ORDER BY s.nombre`,
      [empresaId, terapeutaId],
    );
    return rows;
  },

  /** Reemplaza el set de servicios de un terapeuta. */
  async setServiciosTerapeuta(tenantSlug: string, terapeutaId: number, servicioIds: number[]) {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query('DELETE FROM hc_terapeuta_servicio WHERE empresa_id = ? AND terapeuta_id = ?', [empresaId, terapeutaId]);
    for (const sid of servicioIds) {
      await pool().query(
        'INSERT IGNORE INTO hc_terapeuta_servicio (empresa_id, terapeuta_id, servicio_id) VALUES (?, ?, ?)',
        [empresaId, terapeutaId, sid],
      );
    }
    return this.getServiciosDeTerapeuta(tenantSlug, terapeutaId);
  },

  // ── Asignación paciente ↔ terapeuta (por servicio) ────────────────────────────
  async listAsignaciones(tenantSlug: string, pacienteId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT a.*, CONCAT(u.nombres, ' ', u.apellidos) AS terapeuta_nombre,
              s.nombre AS servicio_nombre
         FROM hc_asignaciones a
         JOIN usuarios u ON u.id = a.terapeuta_id
         LEFT JOIN hc_servicios s ON s.id = a.servicio_id
        WHERE a.empresa_id = ? AND a.paciente_id = ? AND a.activo = 1
        ORDER BY s.nombre, terapeuta_nombre`,
      [empresaId, pacienteId],
    );
    return rows;
  },

  async asignarTerapeuta(tenantSlug: string, pacienteId: number, terapeutaId: number, servicioId: number | null, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query<any>(
      `INSERT INTO hc_asignaciones (empresa_id, paciente_id, terapeuta_id, servicio_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE activo = 1`,
      [empresaId, pacienteId, terapeutaId, servicioId ?? null, userId ?? null],
    );
    return this.listAsignaciones(tenantSlug, pacienteId);
  },

  async quitarAsignacion(tenantSlug: string, asignacionId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'UPDATE hc_asignaciones SET activo = 0 WHERE empresa_id = ? AND id = ?',
      [empresaId, asignacionId],
    );
    return res.affectedRows > 0;
  },

  /** Terapeutas del centro (rol TERAPEUTA en este producto). Filtra por servicio si se indica. */
  async listTerapeutas(tenantSlug: string, servicioId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const filtroServicio = servicioId
      ? 'JOIN hc_terapeuta_servicio ts ON ts.terapeuta_id = u.id AND ts.servicio_id = ?'
      : '';
    const params: any[] = servicioId ? [servicioId, empresaId] : [empresaId];
    const [rows] = await pool().query<any[]>(
      `SELECT u.id, CONCAT(u.nombres, ' ', u.apellidos) AS nombre
         FROM usuarios u
         JOIN usuario_producto up ON up.usuario_id = u.id AND up.activo = 1
         JOIN productos p ON p.id = up.producto_id AND p.slug = 'historias-clinicas'
         JOIN roles r     ON r.id = up.rol_id AND r.nombre = 'TERAPEUTA'
         ${filtroServicio}
        WHERE u.empresa_id = ? AND u.activo = 1
        ORDER BY u.nombres, u.apellidos`,
      params,
    );
    return rows;
  },

  // ── Citas / agenda ────────────────────────────────────────────────────────────
  async listCitas(tenantSlug: string, filtros: { desde?: string; hasta?: string; terapeutaId?: number; pacienteId?: number } = {}) {
    const empresaId = await getEmpresaId(tenantSlug);
    const where: string[] = ['c.empresa_id = ?'];
    const vals: any[] = [empresaId];
    if (filtros.desde)      { where.push('c.inicio >= ?'); vals.push(filtros.desde); }
    if (filtros.hasta)      { where.push('c.inicio <= ?'); vals.push(filtros.hasta); }
    if (filtros.terapeutaId){ where.push('c.terapeuta_id = ?'); vals.push(filtros.terapeutaId); }
    if (filtros.pacienteId) { where.push('c.paciente_id = ?'); vals.push(filtros.pacienteId); }
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, e.nombre AS estado_nombre, s.nombre AS servicio_nombre,
              CONCAT(p.nombres, ' ', p.apellidos) AS paciente_nombre,
              CONCAT(u.nombres, ' ', u.apellidos) AS terapeuta_nombre
         FROM hc_citas c
         LEFT JOIN hc_cita_estado e ON e.id = c.estado_id
         LEFT JOIN hc_servicios s   ON s.id = c.servicio_id
         JOIN hc_pacientes p ON p.id = c.paciente_id
         JOIN usuarios u     ON u.id = c.terapeuta_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.inicio`,
      vals,
    );
    return rows;
  },

  async createCita(tenantSlug: string, dto: CitaDto, userId?: number) {
    if (!dto.paciente_id || !dto.terapeuta_id || !dto.inicio) {
      throw new AppError('Paciente, terapeuta y fecha/hora de inicio son requeridos', 400);
    }
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_citas (empresa_id, paciente_id, terapeuta_id, servicio_id, inicio, fin, estado_id, motivo, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.paciente_id, dto.terapeuta_id, dto.servicio_id || null, dto.inicio, dto.fin || null,
       dto.estado_id || 1, dto.motivo || null, userId ?? null],
    );
    return (await this.listCitasById(empresaId, res.insertId))[0];
  },

  async updateCita(tenantSlug: string, id: number, dto: CitaUpdateDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (col: string, val: any) => { campos.push(`${col} = ?`); vals.push(val); };
    if (dto.inicio !== undefined)       set('inicio', dto.inicio);
    if (dto.fin !== undefined)          set('fin', dto.fin || null);
    if (dto.motivo !== undefined)       set('motivo', dto.motivo || null);
    if (dto.estado_id !== undefined)    set('estado_id', dto.estado_id);
    if (dto.terapeuta_id !== undefined) set('terapeuta_id', dto.terapeuta_id);
    if (dto.servicio_id !== undefined)  set('servicio_id', dto.servicio_id || null);
    if (!campos.length) return null;
    set('user_actua_id', userId ?? null);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(
      `UPDATE hc_citas SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals,
    );
    if (!res.affectedRows) return null;
    return (await this.listCitasById(empresaId, id))[0];
  },

  /** Helper: trae una cita con sus nombres resueltos (mismo shape que listCitas). */
  async listCitasById(empresaId: number, id: number) {
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, e.nombre AS estado_nombre, s.nombre AS servicio_nombre,
              CONCAT(p.nombres, ' ', p.apellidos) AS paciente_nombre,
              CONCAT(u.nombres, ' ', u.apellidos) AS terapeuta_nombre
         FROM hc_citas c
         LEFT JOIN hc_cita_estado e ON e.id = c.estado_id
         LEFT JOIN hc_servicios s   ON s.id = c.servicio_id
         JOIN hc_pacientes p ON p.id = c.paciente_id
         JOIN usuarios u     ON u.id = c.terapeuta_id
        WHERE c.empresa_id = ? AND c.id = ? LIMIT 1`,
      [empresaId, id],
    );
    return rows;
  },

  // ── Adjuntos de la historia (informes, PDFs, exámenes) ─────────────────────
  async listAdjuntos(tenantSlug: string, historiaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT a.id, a.historia_id, a.sesion_id, a.nombre, a.ruta, a.mime, a.created_at,
              CONCAT(u.nombres, ' ', u.apellidos) AS subido_por
         FROM hc_adjuntos a
         LEFT JOIN usuarios u ON u.id = a.user_crea_id
        WHERE a.empresa_id = ? AND a.historia_id = ?
        ORDER BY a.created_at DESC, a.id DESC`,
      [empresaId, historiaId],
    );
    return rows;
  },

  /** Registra un adjunto ya subido (ruta validada en la ruta HTTP). */
  async addAdjunto(
    tenantSlug: string, historiaId: number,
    dto: { nombre: string; ruta: string; mime?: string | null; sesion_id?: number | null },
    userId?: number,
  ) {
    const empresaId = await getEmpresaId(tenantSlug);
    // La historia debe existir dentro de este tenant.
    const [h] = await pool().query<any[]>(
      'SELECT id FROM hc_historias WHERE empresa_id = ? AND id = ? LIMIT 1', [empresaId, historiaId],
    );
    if (!h.length) throw new AppError('Historia no encontrada', 404);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_adjuntos (empresa_id, historia_id, sesion_id, nombre, ruta, mime, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, historiaId, dto.sesion_id || null, dto.nombre, dto.ruta, dto.mime || null, userId ?? null],
    );
    const [rows] = await pool().query<any[]>(
      `SELECT a.id, a.historia_id, a.sesion_id, a.nombre, a.ruta, a.mime, a.created_at,
              CONCAT(u.nombres, ' ', u.apellidos) AS subido_por
         FROM hc_adjuntos a LEFT JOIN usuarios u ON u.id = a.user_crea_id
        WHERE a.id = ?`,
      [res.insertId],
    );
    return rows[0];
  },

  async deleteAdjunto(tenantSlug: string, id: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    // Solo se borra la fila; el archivo físico se comparte por hash (dedup), no se toca.
    const [res] = await pool().query<any>(
      'DELETE FROM hc_adjuntos WHERE empresa_id = ? AND id = ?', [empresaId, id],
    );
    return res.affectedRows > 0;
  },

  // ── Objetivos terapéuticos + progreso (diferenciador) ─────────────────────────
  /** Lista los objetivos de una historia con su último valor y nº de avances. */
  async listObjetivos(tenantSlug: string, historiaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT o.id, o.historia_id, o.descripcion, o.unidad, o.meta, o.estado_id,
              o.fecha_inicio, o.fecha_logro,
              e.codigo AS estado_codigo, e.nombre AS estado_nombre,
              (SELECT a.valor FROM hc_objetivo_avance a WHERE a.objetivo_id = o.id
                ORDER BY a.fecha DESC, a.id DESC LIMIT 1) AS ultimo_valor,
              (SELECT COUNT(*) FROM hc_objetivo_avance a WHERE a.objetivo_id = o.id) AS avances
         FROM hc_objetivos o
         LEFT JOIN hc_objetivo_estado e ON e.id = o.estado_id
        WHERE o.empresa_id = ? AND o.historia_id = ?
        ORDER BY o.created_at DESC, o.id DESC`,
      [empresaId, historiaId],
    );
    return rows;
  },

  async createObjetivo(tenantSlug: string, historiaId: number, dto: ObjetivoDto, userId?: number) {
    if (!dto.descripcion?.trim()) throw new AppError('La descripción del objetivo es requerida', 400);
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_objetivos (empresa_id, historia_id, descripcion, unidad, meta, estado_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [empresaId, historiaId, dto.descripcion.trim(), dto.unidad || '%',
       dto.meta != null ? dto.meta : 100, userId ?? null],
    );
    return this.getObjetivo(empresaId, res.insertId);
  },

  async updateObjetivo(tenantSlug: string, id: number, dto: ObjetivoDto) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (c: string, v: any) => { campos.push(`${c} = ?`); vals.push(v); };
    if (dto.descripcion !== undefined) set('descripcion', dto.descripcion.trim());
    if (dto.unidad !== undefined)      set('unidad', dto.unidad || '%');
    if (dto.meta !== undefined)        set('meta', dto.meta != null ? dto.meta : 100);
    if (dto.estado_id !== undefined) {
      set('estado_id', dto.estado_id);
      set('fecha_logro', dto.estado_id === 2 ? new Date().toISOString().slice(0, 10) : null);
    }
    if (!campos.length) return this.getObjetivo(empresaId, id);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(
      `UPDATE hc_objetivos SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals,
    );
    if (!res.affectedRows) return null;
    return this.getObjetivo(empresaId, id);
  },

  async deleteObjetivo(tenantSlug: string, id: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'DELETE FROM hc_objetivos WHERE empresa_id = ? AND id = ?', [empresaId, id],
    );
    return res.affectedRows > 0;
  },

  /** Puntos de avance de un objetivo (para la curva de progreso), en orden cronológico. */
  async listAvance(tenantSlug: string, objetivoId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id, objetivo_id, sesion_id, valor, fecha, nota
         FROM hc_objetivo_avance
        WHERE empresa_id = ? AND objetivo_id = ?
        ORDER BY fecha ASC, id ASC`,
      [empresaId, objetivoId],
    );
    return rows;
  },

  /** Registra una medición de avance. Si alcanza/supera la meta → marca LOGRADO. */
  async addAvance(tenantSlug: string, objetivoId: number, dto: AvanceDto, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const obj = await this.getObjetivo(empresaId, objetivoId);
    if (!obj) throw new AppError('Objetivo no encontrado', 404);
    if (dto.valor == null || isNaN(Number(dto.valor))) throw new AppError('El valor del avance es requerido', 400);
    const valor = Number(dto.valor);
    await pool().query<any>(
      `INSERT INTO hc_objetivo_avance (empresa_id, objetivo_id, sesion_id, valor, fecha, nota, user_crea_id)
       VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?, ?)`,
      [empresaId, objetivoId, dto.sesion_id || null, valor, dto.fecha || null, dto.nota || null, userId ?? null],
    );
    // Auto-marca LOGRADO al alcanzar la meta (si estaba en curso).
    if (obj.estado_id === 1 && valor >= Number(obj.meta)) {
      await pool().query<any>(
        'UPDATE hc_objetivos SET estado_id = 2, fecha_logro = CURRENT_DATE WHERE empresa_id = ? AND id = ?',
        [empresaId, objetivoId],
      );
    }
    return { objetivo: await this.getObjetivo(empresaId, objetivoId), avance: await this.listAvance(tenantSlug, objetivoId) };
  },

  /** Helper: un objetivo con su estado, ya sabiendo el empresa_id. */
  async getObjetivo(empresaId: number, id: number) {
    const [rows] = await pool().query<any[]>(
      `SELECT o.id, o.historia_id, o.descripcion, o.unidad, o.meta, o.estado_id,
              o.fecha_inicio, o.fecha_logro,
              e.codigo AS estado_codigo, e.nombre AS estado_nombre,
              (SELECT a.valor FROM hc_objetivo_avance a WHERE a.objetivo_id = o.id
                ORDER BY a.fecha DESC, a.id DESC LIMIT 1) AS ultimo_valor,
              (SELECT COUNT(*) FROM hc_objetivo_avance a WHERE a.objetivo_id = o.id) AS avances
         FROM hc_objetivos o LEFT JOIN hc_objetivo_estado e ON e.id = o.estado_id
        WHERE o.empresa_id = ? AND o.id = ? LIMIT 1`,
      [empresaId, id],
    );
    return rows[0] ?? null;
  },

  // ── Tareas para casa ──────────────────────────────────────────────────────────
  async listTareas(tenantSlug: string, historiaId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id, historia_id, sesion_id, descripcion, detalle,
              adjunto_ruta, adjunto_nombre, adjunto_mime,
              fecha_limite, cumplida, cumplida_at, activo, created_at
         FROM hc_tareas WHERE empresa_id = ? AND historia_id = ? AND activo = 1
        ORDER BY cumplida ASC, created_at DESC`,
      [empresaId, historiaId],
    );
    return rows;
  },

  /** Setea (o limpia) el adjunto de audio/imagen de una tarea. */
  async setTareaAdjunto(tenantSlug: string, tareaId: number, adj: { ruta: string; nombre: string; mime: string } | null) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'UPDATE hc_tareas SET adjunto_ruta = ?, adjunto_nombre = ?, adjunto_mime = ? WHERE empresa_id = ? AND id = ?',
      [adj?.ruta ?? null, adj?.nombre ?? null, adj?.mime ?? null, empresaId, tareaId],
    );
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_tareas WHERE id = ?', [tareaId]);
    return rows[0];
  },

  async createTarea(tenantSlug: string, historiaId: number, dto: TareaDto, userId?: number) {
    if (!dto.descripcion?.trim()) throw new AppError('La descripción de la tarea es requerida', 400);
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_tareas (empresa_id, historia_id, descripcion, detalle, fecha_limite, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, historiaId, dto.descripcion.trim(), dto.detalle || null, dto.fecha_limite || null, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_tareas WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  async updateTarea(tenantSlug: string, id: number, dto: TareaDto) {
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (c: string, v: any) => { campos.push(`${c} = ?`); vals.push(v); };
    if (dto.descripcion !== undefined)  set('descripcion', dto.descripcion.trim());
    if (dto.detalle !== undefined)      set('detalle', dto.detalle || null);
    if (dto.fecha_limite !== undefined) set('fecha_limite', dto.fecha_limite || null);
    if (dto.activo !== undefined)       set('activo', dto.activo ? 1 : 0);
    if (dto.cumplida !== undefined) {
      set('cumplida', dto.cumplida ? 1 : 0);
      set('cumplida_at', dto.cumplida ? new Date() : null);
    }
    if (!campos.length) return null;
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE hc_tareas SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals);
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_tareas WHERE id = ?', [id]);
    return rows[0];
  },

  async deleteTarea(tenantSlug: string, id: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>('DELETE FROM hc_tareas WHERE empresa_id = ? AND id = ?', [empresaId, id]);
    return res.affectedRows > 0;
  },

  // ── Portal del apoderado (enlace mágico por paciente) ─────────────────────────
  /** Acceso activo del paciente (o null). */
  async getAccesoByPaciente(tenantSlug: string, pacienteId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      'SELECT id, paciente_id, token, activo, created_at FROM hc_apoderado_acceso WHERE empresa_id = ? AND paciente_id = ? AND activo = 1 LIMIT 1',
      [empresaId, pacienteId],
    );
    return rows[0] ?? null;
  },

  /** Devuelve el acceso activo o crea uno nuevo (idempotente). */
  async crearAcceso(tenantSlug: string, pacienteId: number, userId?: number) {
    const existente = await this.getAccesoByPaciente(tenantSlug, pacienteId);
    if (existente) return existente;
    const empresaId = await getEmpresaId(tenantSlug);
    // El paciente debe existir en este centro.
    const pac = await this.getPacienteById(empresaId, pacienteId);
    if (!pac) throw new AppError('Paciente no encontrado', 404);
    const token = randomBytes(24).toString('hex');
    const [res] = await pool().query<any>(
      'INSERT INTO hc_apoderado_acceso (empresa_id, paciente_id, token, user_crea_id) VALUES (?, ?, ?, ?)',
      [empresaId, pacienteId, token, userId ?? null],
    );
    return { id: res.insertId, paciente_id: pacienteId, token, activo: 1 };
  },

  /** Revoca el acceso activo y genera uno nuevo (invalida el enlace anterior). */
  async regenerarAcceso(tenantSlug: string, pacienteId: number, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    await pool().query<any>(
      'UPDATE hc_apoderado_acceso SET activo = 0, revocado_at = CURRENT_TIMESTAMP WHERE empresa_id = ? AND paciente_id = ? AND activo = 1',
      [empresaId, pacienteId],
    );
    return this.crearAcceso(tenantSlug, pacienteId, userId);
  },

  /** Revoca (desactiva) el acceso del apoderado. */
  async revocarAcceso(tenantSlug: string, pacienteId: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'UPDATE hc_apoderado_acceso SET activo = 0, revocado_at = CURRENT_TIMESTAMP WHERE empresa_id = ? AND paciente_id = ? AND activo = 1',
      [empresaId, pacienteId],
    );
    return res.affectedRows > 0;
  },

  /**
   * DATOS DEL PORTAL (PÚBLICO): resuelve el token → centro + paciente y devuelve,
   * SOLO LECTURA, lo justo para la familia: progreso (objetivos + avances) y
   * próximas citas. No expone documentos, ni datos sensibles de más.
   */
  async portalData(token: string) {
    if (!token || token.length < 20) throw new AppError('Enlace inválido', 404);
    const [acc] = await pool().query<any[]>(
      'SELECT empresa_id, paciente_id FROM hc_apoderado_acceso WHERE token = ? AND activo = 1 LIMIT 1',
      [token],
    );
    if (!acc.length) throw new AppError('Enlace inválido o desactivado', 404);
    const { empresa_id, paciente_id } = acc[0];

    const [[centro]] = await pool().query<any[]>(
      'SELECT razon_social, logo_url FROM empresas WHERE id = ? LIMIT 1', [empresa_id],
    ) as any;
    const [[paciente]] = await pool().query<any[]>(
      'SELECT nombres, apellidos FROM hc_pacientes WHERE id = ? AND empresa_id = ? LIMIT 1', [paciente_id, empresa_id],
    ) as any;
    if (!paciente) throw new AppError('Paciente no encontrado', 404);

    const [[historia]] = await pool().query<any[]>(
      'SELECT id FROM hc_historias WHERE paciente_id = ? AND empresa_id = ? LIMIT 1', [paciente_id, empresa_id],
    ) as any;

    let objetivos: any[] = [];
    if (historia) {
      const [objs] = await pool().query<any[]>(
        `SELECT o.id, o.descripcion, o.unidad, o.meta, e.codigo AS estado_codigo, e.nombre AS estado_nombre,
                (SELECT a.valor FROM hc_objetivo_avance a WHERE a.objetivo_id = o.id ORDER BY a.fecha DESC, a.id DESC LIMIT 1) AS ultimo_valor
           FROM hc_objetivos o LEFT JOIN hc_objetivo_estado e ON e.id = o.estado_id
          WHERE o.historia_id = ? ORDER BY o.created_at ASC, o.id ASC`,
        [historia.id],
      );
      objetivos = objs;
      if (objs.length) {
        const ids = objs.map(o => o.id);
        const [av] = await pool().query<any[]>(
          `SELECT objetivo_id, valor, fecha FROM hc_objetivo_avance
            WHERE objetivo_id IN (${ids.map(() => '?').join(',')}) ORDER BY fecha ASC, id ASC`,
          ids,
        );
        const porObj: Record<number, any[]> = {};
        for (const a of av) (porObj[a.objetivo_id] ??= []).push({ valor: a.valor, fecha: a.fecha });
        objetivos = objs.map(o => ({ ...o, avances: porObj[o.id] ?? [] }));
      }
    }

    const [citas] = await pool().query<any[]>(
      `SELECT c.inicio, c.estado_id, es.nombre AS estado_nombre, sv.nombre AS servicio_nombre,
              CONCAT(u.nombres, ' ', u.apellidos) AS terapeuta_nombre
         FROM hc_citas c
         LEFT JOIN hc_cita_estado es ON es.id = c.estado_id
         LEFT JOIN hc_servicios sv   ON sv.id = c.servicio_id
         LEFT JOIN usuarios u        ON u.id = c.terapeuta_id
        WHERE c.paciente_id = ? AND c.empresa_id = ? AND c.inicio >= NOW() AND c.estado_id <> 3
        ORDER BY c.inicio ASC LIMIT 5`,
      [paciente_id, empresa_id],
    );

    let tareas: any[] = [];
    if (historia) {
      const [ts] = await pool().query<any[]>(
        `SELECT id, descripcion, detalle, adjunto_ruta, adjunto_nombre, adjunto_mime, fecha_limite, cumplida, cumplida_at
           FROM hc_tareas WHERE historia_id = ? AND empresa_id = ? AND activo = 1
          ORDER BY cumplida ASC, created_at DESC`,
        [historia.id, empresa_id],
      );
      tareas = ts;
    }

    return {
      centro: { razon_social: centro?.razon_social ?? null, logo_url: centro?.logo_url ?? null },
      paciente: { nombres: paciente.nombres, apellidos: paciente.apellidos },
      objetivos,
      citas_proximas: citas,
      tareas,
    };
  },

  /** PÚBLICO: el apoderado marca/desmarca una tarea como cumplida (validado por token). */
  async marcarTareaPortal(token: string, tareaId: number, cumplida: boolean) {
    if (!token || token.length < 20) throw new AppError('Enlace inválido', 404);
    const [acc] = await pool().query<any[]>(
      'SELECT empresa_id, paciente_id FROM hc_apoderado_acceso WHERE token = ? AND activo = 1 LIMIT 1',
      [token],
    );
    if (!acc.length) throw new AppError('Enlace inválido o desactivado', 404);
    const { empresa_id, paciente_id } = acc[0];
    // La tarea debe pertenecer a la historia de ESE paciente (no se toca otra).
    const [res] = await pool().query<any>(
      `UPDATE hc_tareas t
          JOIN hc_historias h ON h.id = t.historia_id
         SET t.cumplida = ?, t.cumplida_at = ?
        WHERE t.id = ? AND t.empresa_id = ? AND h.paciente_id = ?`,
      [cumplida ? 1 : 0, cumplida ? new Date() : null, tareaId, empresa_id, paciente_id],
    );
    if (!res.affectedRows) throw new AppError('Tarea no encontrada', 404);
    return { id: tareaId, cumplida };
  },
};
