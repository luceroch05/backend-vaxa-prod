import { getPool } from '../../db/pool';
import { AppError } from '../../shared/errors';

/**
 * Auditoría del módulo Historias Clínicas. Aislada en su propia tabla `hc_auditoria`
 * (no se mezcla con la de certificados). SIEMPRE activa: la historia clínica es dato
 * sensible (Ley 29733), no se gatea por plan.
 *
 * Cada evento se describe de forma ESPECÍFICA: quién lo hizo, qué acción y —sobre todo—
 * de QUÉ PACIENTE (por su nombre, no por id). El nombre se resuelve en el backend a
 * partir de los ids de la ruta (paciente ← historia ← objetivo/sesión/tarea/…).
 * Se registra fire-and-forget desde un middleware del router; nunca lanza.
 */

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new AppError('Empresa no encontrada', 404);
  return rows[0].id as number;
}

let _ensured = false;
async function ensureTabla(): Promise<void> {
  if (_ensured) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_auditoria (
       id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
       empresa_id     INT          NOT NULL,
       usuario_id     INT          NULL,
       usuario_nombre VARCHAR(160) NULL,
       usuario_rol    VARCHAR(60)  NULL,
       accion         VARCHAR(20)  NOT NULL,
       entidad        VARCHAR(30)  NOT NULL,
       entidad_id     INT          NULL,
       descripcion    VARCHAR(400) NOT NULL,
       ip             VARCHAR(45)  NULL,
       created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
       INDEX idx_hcaud_empresa_fecha   (empresa_id, created_at),
       INDEX idx_hcaud_empresa_entidad (empresa_id, entidad),
       INDEX idx_hcaud_empresa_accion  (empresa_id, accion),
       CONSTRAINT fk_hcaud_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  _ensured = true;
}

/** Pistas que el middleware saca de la ruta/body para poder resolver los nombres. */
export interface HcAuditRef {
  pacienteId?: number;       // paciente en la ruta (pacientes/:id/…)
  historiaId?: number;       // historia en la ruta (historias/:id/…)
  objetivoId?: number;
  sesionId?: number;
  tareaId?: number;
  tratamientoId?: number;
  citaId?: number;
  adjuntoId?: number;
  asignacionId?: number;
  servicioId?: number;
  terapeutaId?: number;
  // Del body (para acciones de creación donde el id aún no está en la ruta):
  nombres?: string;          // crear paciente
  apellidos?: string;        // crear paciente
  pacienteIdBody?: number;   // crear cita
  servicioNombre?: string;   // crear servicio
  activo?: boolean;          // activar/desactivar paciente
}

export interface HcAuditIntent {
  tenant: string;
  usuarioId?: number | null;
  ip?: string | null;
  accion: string;            // crear|editar|eliminar|ver|asignar|revocar|adjuntar
  entidad: string;           // paciente|historia|objetivo|sesion|tarea|…
  ref?: HcAuditRef;
}

export interface HcAuditFiltro { accion?: string; entidad?: string; limit?: number; offset?: number; }

export interface HcAuditEvento {
  id: number;
  usuario_id: number | null;
  usuario_nombre: string | null;
  usuario_rol: string | null;
  accion: string;
  entidad: string;
  entidad_id: number | null;
  descripcion: string;
  ip: string | null;
  created_at: string;
}

// ── Resolución de nombres ──────────────────────────────────────────────────────
const NOMBRE_PACIENTE = `TRIM(TRIM(BOTH ',' FROM CONCAT(COALESCE(p.apellidos,''), ', ', COALESCE(p.nombres,''))))`;

/** Nombre del paciente a partir de cualquiera de las pistas (paciente ← historia ← …). */
async function resolverPaciente(empresaId: number, ref: HcAuditRef): Promise<string | null> {
  const q = async (sql: string, params: any[]): Promise<string | null> => {
    try {
      const [r] = await pool().query<any[]>(sql, params);
      const n = (r as any[])[0]?.n?.trim();
      return n || null;
    } catch { return null; }
  };
  const P = `SELECT ${NOMBRE_PACIENTE} AS n FROM hc_pacientes p`;
  if (ref.pacienteId)     return q(`${P} WHERE p.id = ? AND p.empresa_id = ?`, [ref.pacienteId, empresaId]);
  if (ref.pacienteIdBody) return q(`${P} WHERE p.id = ? AND p.empresa_id = ?`, [ref.pacienteIdBody, empresaId]);
  if (ref.historiaId)     return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_historias h JOIN hc_pacientes p ON p.id = h.paciente_id WHERE h.id = ? AND p.empresa_id = ?`, [ref.historiaId, empresaId]);
  if (ref.objetivoId)     return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_objetivos o JOIN hc_historias h ON h.id = o.historia_id JOIN hc_pacientes p ON p.id = h.paciente_id WHERE o.id = ? AND p.empresa_id = ?`, [ref.objetivoId, empresaId]);
  if (ref.sesionId)       return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_sesiones s JOIN hc_historias h ON h.id = s.historia_id JOIN hc_pacientes p ON p.id = h.paciente_id WHERE s.id = ? AND p.empresa_id = ?`, [ref.sesionId, empresaId]);
  if (ref.tareaId)        return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_tareas t JOIN hc_historias h ON h.id = t.historia_id JOIN hc_pacientes p ON p.id = h.paciente_id WHERE t.id = ? AND p.empresa_id = ?`, [ref.tareaId, empresaId]);
  if (ref.tratamientoId)  return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_tratamientos tr JOIN hc_historias h ON h.id = tr.historia_id JOIN hc_pacientes p ON p.id = h.paciente_id WHERE tr.id = ? AND p.empresa_id = ?`, [ref.tratamientoId, empresaId]);
  if (ref.citaId)         return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_citas c JOIN hc_pacientes p ON p.id = c.paciente_id WHERE c.id = ? AND p.empresa_id = ?`, [ref.citaId, empresaId]);
  if (ref.adjuntoId)      return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_adjuntos a JOIN hc_historias h ON h.id = a.historia_id JOIN hc_pacientes p ON p.id = h.paciente_id WHERE a.id = ? AND p.empresa_id = ?`, [ref.adjuntoId, empresaId]);
  if (ref.asignacionId)   return q(`SELECT ${NOMBRE_PACIENTE} AS n FROM hc_asignaciones asg JOIN hc_pacientes p ON p.id = asg.paciente_id WHERE asg.id = ? AND p.empresa_id = ?`, [ref.asignacionId, empresaId]);
  // Crear paciente: el nombre viene en el body (aún no hay id).
  const nombre = `${(ref.apellidos ?? '').trim()}${ref.apellidos && ref.nombres ? ', ' : ''}${(ref.nombres ?? '').trim()}`.trim();
  return nombre || null;
}

/** Nombre de un usuario (terapeuta) por id. */
async function resolverUsuario(id?: number): Promise<string | null> {
  if (!id) return null;
  try {
    const [r] = await pool().query<any[]>(
      `SELECT TRIM(CONCAT(COALESCE(nombres,''),' ',COALESCE(apellidos,''))) AS n, correo FROM usuarios WHERE id = ?`, [id]);
    return (r as any[])[0]?.n?.trim() || (r as any[])[0]?.correo || null;
  } catch { return null; }
}

/** Nombre de un servicio del centro por id. */
async function resolverServicio(empresaId: number, id?: number): Promise<string | null> {
  if (!id) return null;
  try {
    const [r] = await pool().query<any[]>('SELECT nombre AS n FROM hc_servicios WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    return (r as any[])[0]?.n?.trim() || null;
  } catch { return null; }
}

/** Arma la frase específica de la acción con los nombres ya resueltos. */
function describir(accion: string, entidad: string, ctx: { paciente: string | null; servicio: string | null; terapeuta: string | null; activo?: boolean }): string {
  const de = ctx.paciente ? `de ${ctx.paciente}` : 'de un paciente';
  const a  = ctx.paciente ? `a ${ctx.paciente}` : 'a un paciente';
  const para = ctx.paciente ? `para ${ctx.paciente}` : 'para un paciente';
  const key = `${entidad}:${accion}`;
  switch (key) {
    case 'paciente:crear':     return `Registró al paciente ${ctx.paciente ?? '(nuevo)'}`;
    case 'paciente:editar':    return ctx.activo === undefined
      ? `Editó los datos del paciente ${ctx.paciente ?? ''}`.trim()
      : (ctx.activo ? `Reactivó al paciente ${ctx.paciente ?? ''}`.trim() : `Desactivó al paciente ${ctx.paciente ?? ''}`.trim());
    case 'historia:crear':     return `Abrió la historia clínica ${de}`;
    case 'historia:ver':       return `Consultó la historia clínica ${de}`;
    case 'historia:editar':    return `Editó la historia clínica ${de}`;
    case 'diagnostico:crear':  return `Registró un diagnóstico ${a}`;
    case 'objetivo:crear':     return `Creó un objetivo terapéutico ${para}`;
    case 'objetivo:editar':    return `Editó un objetivo terapéutico ${de}`;
    case 'objetivo:eliminar':  return `Eliminó un objetivo terapéutico ${de}`;
    case 'avance:crear':       return `Registró un avance de objetivo ${de}`;
    case 'sesion:crear':       return `Registró una evolución (sesión) ${de}`;
    case 'sesion:editar':      return `Editó una evolución (sesión) ${de}`;
    case 'tarea:crear':        return `Asignó una tarea para casa ${a}`;
    case 'tarea:editar':       return `Editó una tarea ${de}`;
    case 'tarea:eliminar':     return `Eliminó una tarea ${de}`;
    case 'tarea:adjuntar':     return `Adjuntó un archivo a una tarea ${de}`;
    case 'tratamiento:crear':  return `Inició un tratamiento ${para}`;
    case 'tratamiento:editar': return `Actualizó un tratamiento ${de}`;
    case 'tratamiento:eliminar': return `Eliminó un tratamiento ${de}`;
    case 'servicio:crear':     return `Creó el servicio "${ctx.servicio ?? '(nuevo)'}"`;
    case 'servicio:editar':    return `Editó el servicio "${ctx.servicio ?? ''}"`.trim();
    case 'cita:crear':         return `Agendó una cita ${para}`;
    case 'cita:editar':        return `Editó una cita ${de}`;
    case 'asignacion:asignar': return `Asignó ${ctx.terapeuta ? `al terapeuta ${ctx.terapeuta}` : 'un terapeuta'} ${a}`;
    case 'asignacion:eliminar': return `Quitó una asignación de terapeuta ${de}`;
    case 'acceso:crear':       return `Generó el acceso del apoderado ${de}`;
    case 'acceso:revocar':     return `Revocó el acceso del apoderado ${de}`;
    case 'adjunto:crear':      return `Subió un documento a la historia ${de}`;
    case 'adjunto:eliminar':   return `Eliminó un documento de la historia ${de}`;
    case 'terapeuta_servicio:editar': return `Actualizó los servicios que brinda el terapeuta ${ctx.terapeuta ?? ''}`.trim();
    default:                   return `${accion} ${entidad} ${de}`.trim();
  }
}

export const hcAuditoriaRepo = {
  /** Resuelve nombres, arma la descripción específica y registra. Fire-and-forget. */
  async registrar(evt: HcAuditIntent): Promise<void> {
    try {
      await ensureTabla();
      const empresaId = await getEmpresaId(evt.tenant);
      const ref = evt.ref ?? {};

      // Snapshot del autor + su rol en este producto.
      let nombre: string | null = null;
      let rol: string | null = null;
      if (evt.usuarioId) {
        try {
          const [u] = await pool().query<any[]>(
            `SELECT TRIM(CONCAT(COALESCE(nombres,''),' ',COALESCE(apellidos,''))) AS nombre, correo FROM usuarios WHERE id = ?`,
            [evt.usuarioId],
          );
          nombre = (u as any[])[0]?.nombre?.trim() || (u as any[])[0]?.correo || null;
        } catch { /* ignorar */ }
        try {
          const [r] = await pool().query<any[]>(
            `SELECT ro.nombre AS rol FROM usuario_producto up
               JOIN productos p ON p.id = up.producto_id
               JOIN roles ro    ON ro.id = up.rol_id
              WHERE up.usuario_id = ? AND p.slug = 'historias-clinicas' AND up.activo = 1 LIMIT 1`,
            [evt.usuarioId],
          );
          rol = (r as any[])[0]?.rol ?? null;
        } catch { /* legacy */ }
      }

      // Resolución de nombres para la frase específica.
      const [paciente, servicioPorId, terapeuta] = await Promise.all([
        resolverPaciente(empresaId, ref),
        resolverServicio(empresaId, ref.servicioId),
        resolverUsuario(ref.terapeutaId),
      ]);
      const servicio = servicioPorId ?? ref.servicioNombre ?? null;
      const descripcion = describir(evt.accion, evt.entidad, { paciente, servicio, terapeuta, activo: ref.activo });

      // Id de referencia guardado: el del paciente cuando aplica (útil para filtrar/ligar).
      const entidadId = ref.pacienteId ?? ref.pacienteIdBody ?? ref.historiaId ?? ref.objetivoId ?? ref.sesionId
        ?? ref.tareaId ?? ref.tratamientoId ?? ref.citaId ?? ref.servicioId ?? ref.asignacionId ?? ref.adjuntoId ?? null;

      await pool().query(
        `INSERT INTO hc_auditoria
           (empresa_id, usuario_id, usuario_nombre, usuario_rol, accion, entidad, entidad_id, descripcion, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, evt.usuarioId ?? null, nombre, rol, evt.accion, evt.entidad, entidadId, descripcion.slice(0, 400), evt.ip ?? null],
      );
    } catch (e) {
      console.warn('[hc-auditoria] no se pudo registrar el evento:', (e as Error).message);
    }
  },

  /** Lista los eventos de la empresa (más recientes primero) con filtros y paginación. */
  async listar(tenantSlug: string, filtro: HcAuditFiltro = {}): Promise<{ items: HcAuditEvento[]; total: number }> {
    await ensureTabla();
    const empresaId = await getEmpresaId(tenantSlug);
    const where: string[] = ['empresa_id = ?'];
    const params: any[] = [empresaId];
    if (filtro.accion)  { where.push('accion = ?');  params.push(filtro.accion); }
    if (filtro.entidad) { where.push('entidad = ?'); params.push(filtro.entidad); }
    const whereSql = where.join(' AND ');

    const limit  = Math.min(Math.max(Number(filtro.limit) || 30, 1), 200);
    const offset = Math.max(Number(filtro.offset) || 0, 0);

    const [cnt] = await pool().query<any[]>(`SELECT COUNT(*) AS total FROM hc_auditoria WHERE ${whereSql}`, params);
    const total = Number((cnt as any[])[0]?.total ?? 0);

    const [rows] = await pool().query<any[]>(
      `SELECT id, usuario_id, usuario_nombre, usuario_rol, accion, entidad, entidad_id, descripcion, ip, created_at
         FROM hc_auditoria WHERE ${whereSql}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows as HcAuditEvento[], total };
  },
};
