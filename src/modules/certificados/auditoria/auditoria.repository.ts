import { pool, getEmpresaId } from '../shared/db.helper';
import { planRepo } from '../planes/plan.repository';

/** Evento de auditoría a registrar (lo arman los repos tras una mutación exitosa). */
export interface AuditInput {
  empresaId: number;
  usuarioId?: number | null;
  accion: 'crear' | 'editar' | 'eliminar' | 'emitir' | 'anular' | 'importar' | 'login';
  entidad: 'programa' | 'aula' | 'inscripcion' | 'participante' | 'nota' | 'certificado' | 'config' | 'logo' | 'firma' | 'unidad' | 'sesion';
  entidadId?: number | null;
  entidadNombre?: string | null;
  descripcion: string;
  detalle?: unknown;
  ip?: string | null;
}

export interface AuditEvento {
  id: number;
  usuario_id: number | null;
  usuario_nombre: string | null;
  usuario_rol: string | null;
  accion: string;
  entidad: string;
  entidad_id: number | null;
  entidad_nombre: string | null;
  descripcion: string;
  detalle: unknown | null;
  ip: string | null;
  created_at: string;
}

export interface AuditFiltro {
  accion?: string;
  entidad?: string;
  limit?: number;
  offset?: number;
}

/**
 * Arma un texto + JSON de diffs comparando el estado anterior y el nuevo.
 * Solo incluye los campos de `campos` que realmente cambiaron.
 * Devuelve `{ texto: "nombre: 'A' → 'B'; horas: 10 → 12", detalle: {...} }`.
 */
export function describirCambios(
  antes: Record<string, any> | null | undefined,
  despues: Record<string, any> | null | undefined,
  campos: Array<{ key: string; label: string }>,
): { texto: string; detalle: Record<string, { antes: any; despues: any }> } {
  const detalle: Record<string, { antes: any; despues: any }> = {};
  const partes: string[] = [];
  for (const { key, label } of campos) {
    const a = antes?.[key];
    const d = despues?.[key];
    if (d === undefined) continue;              // no se tocó ese campo en la edición
    if (String(a ?? '') === String(d ?? '')) continue;  // sin cambio real
    detalle[key] = { antes: a ?? null, despues: d ?? null };
    partes.push(`${label}: '${a ?? '—'}' → '${d ?? '—'}'`);
  }
  return { texto: partes.join('; '), detalle };
}

export const auditoriaRepo = {
  /**
   * Registra un evento de auditoría. GATEADO POR PLAN: si el plan de la empresa no
   * incluye auditoría (solo Profesional/Empresarial/Corporativo), no hace nada.
   * Nunca lanza: cualquier error se loguea y se traga para no romper la operación.
   * Se llama sin `await` (fire-and-forget) desde los repos.
   */
  async registrar(evt: AuditInput): Promise<void> {
    try {
      if (!(await planRepo.permiteAuditoria(evt.empresaId))) return;

      // Snapshot del autor (sobrevive a borrados de usuario).
      let nombre: string | null = null;
      let rol: string | null = null;
      if (evt.usuarioId) {
        try {
          const [u] = await pool().query<any[]>(
            `SELECT CONCAT(COALESCE(nombres,''),' ',COALESCE(apellidos,'')) AS nombre, correo
               FROM usuarios WHERE id = ?`,
            [evt.usuarioId],
          );
          nombre = (u as any[])[0]?.nombre?.trim() || (u as any[])[0]?.correo || null;
        } catch { /* tabla/credenciales: ignorar */ }
        try {
          const [r] = await pool().query<any[]>(
            `SELECT ro.nombre AS rol
               FROM usuario_producto up
               JOIN productos p ON p.id = up.producto_id
               JOIN roles ro    ON ro.id = up.rol_id
              WHERE up.usuario_id = ? AND p.slug = 'certificaciones' AND up.activo = 1
              LIMIT 1`,
            [evt.usuarioId],
          );
          rol = (r as any[])[0]?.rol ?? null;
        } catch { /* legacy sin usuario_producto: rol queda null */ }
      }

      await pool().query(
        `INSERT INTO auditoria
           (empresa_id, usuario_id, usuario_nombre, usuario_rol, accion, entidad,
            entidad_id, entidad_nombre, descripcion, detalle, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          evt.empresaId, evt.usuarioId ?? null, nombre, rol, evt.accion, evt.entidad,
          evt.entidadId ?? null, evt.entidadNombre ?? null, evt.descripcion,
          evt.detalle != null ? JSON.stringify(evt.detalle) : null, evt.ip ?? null,
        ],
      );
    } catch (e) {
      console.warn('[auditoria] no se pudo registrar el evento:', (e as Error).message);
    }
  },

  /** Lista los eventos de auditoría de la empresa (más recientes primero) con filtros. */
  async listar(tenantSlug: string, filtro: AuditFiltro = {}): Promise<{ items: AuditEvento[]; total: number }> {
    const empresaId = await getEmpresaId(tenantSlug);
    const where: string[] = ['empresa_id = ?'];
    const params: any[] = [empresaId];
    if (filtro.accion)  { where.push('accion = ?');  params.push(filtro.accion); }
    if (filtro.entidad) { where.push('entidad = ?'); params.push(filtro.entidad); }
    const whereSql = where.join(' AND ');

    const limit  = Math.min(Math.max(Number(filtro.limit) || 20, 1), 200);
    const offset = Math.max(Number(filtro.offset) || 0, 0);

    const [cnt] = await pool().query<any[]>(`SELECT COUNT(*) AS total FROM auditoria WHERE ${whereSql}`, params);
    const total = Number((cnt as any[])[0]?.total ?? 0);

    const [rows] = await pool().query<any[]>(
      `SELECT id, usuario_id, usuario_nombre, usuario_rol, accion, entidad,
              entidad_id, entidad_nombre, descripcion, detalle, ip, created_at
         FROM auditoria WHERE ${whereSql}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const items = (rows as any[]).map(r => ({
      ...r,
      detalle: r.detalle ? (typeof r.detalle === 'string' ? JSON.parse(r.detalle) : r.detalle) : null,
    })) as AuditEvento[];
    return { items, total };
  },
};
