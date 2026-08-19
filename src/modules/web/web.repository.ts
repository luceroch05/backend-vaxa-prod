import { getPool } from '../../db/pool';
import { AppError } from '../../shared/errors';
import { guardarImagen } from '../../shared/imagenes';

/**
 * Repositorio del módulo "Mi Web" (web pública editable por el cliente).
 * Aislado en su carpeta: solo depende del pool y de las tablas `web_*`
 * (ver scripts/mysql-web-publica.sql). Todo scoped por empresa_id (tenant),
 * resuelto desde el tenant_slug. Las imágenes se guardan como archivo en
 * /uploads/web (base64 → ruta), igual que el resto del sistema.
 */

const SUB = 'web';   // subcarpeta de /uploads para imágenes de la web

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

/** tenant_slug -> empresa_id. Mismo criterio que historias/certificados. */
async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new AppError('Empresa no encontrada', 404);
  return rows[0].id as number;
}

// ── Whitelists (qué columnas acepta cada tabla y cuáles son imágenes) ──────────
const CONFIG_CAMPOS = [
  'logo_url', 'color_primario', 'color_secundario',
  'hero_titulo', 'hero_subtitulo', 'hero_imagen', 'hero_boton_texto', 'hero_boton_link',
  'red_facebook', 'red_instagram', 'red_tiktok', 'red_youtube', 'red_linkedin', 'red_whatsapp',
  'contacto_direccion', 'contacto_telefono', 'contacto_telefono2', 'contacto_email',
  'contacto_horario', 'contacto_mapa_url', 'publicada',
] as const;
const CONFIG_IMAGENES = new Set(['logo_url', 'hero_imagen']);

const SERVICIO_CAMPOS = ['titulo', 'descripcion', 'icono', 'imagen_url', 'orden', 'activo'] as const;
const STAFF_CAMPOS    = ['nombre', 'cargo', 'descripcion', 'foto_url', 'orden', 'activo'] as const;
const ALIANZA_CAMPOS  = ['nombre', 'logo_url', 'link', 'orden', 'activo'] as const;
const IMAGENES = new Set(['imagen_url', 'foto_url', 'logo_url']);

/** Construye SET dinámico solo con los campos permitidos que vengan en el dto. */
function buildSet(dto: Record<string, any>, campos: readonly string[], imagenes: Set<string>) {
  const fields: string[] = [];
  const values: any[] = [];
  for (const c of campos) {
    if (dto[c] === undefined) continue;
    let v = dto[c];
    if (imagenes.has(c)) v = guardarImagen(v, SUB) ?? null;      // base64 → ruta
    else if (c === 'activo' || c === 'publicada') v = v ? 1 : 0;
    else if (c === 'orden') v = Number(v) || 0;
    fields.push(`${c} = ?`);
    values.push(v === undefined ? null : v);
  }
  return { fields, values };
}

export const webRepo = {
  // ── CONFIG (hero + marca + redes + contacto) — 1 fila por empresa ────────────
  async getConfig(tenantSlug: string) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>('SELECT * FROM web_config WHERE empresa_id = ? LIMIT 1', [empresaId]);
    return rows[0] ?? { empresa_id: empresaId, publicada: 0 };
  },

  async saveConfig(tenantSlug: string, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    // Asegura la fila única (idempotente), luego actualiza solo lo enviado.
    await pool().query('INSERT IGNORE INTO web_config (empresa_id) VALUES (?)', [empresaId]);
    const { fields, values } = buildSet(dto, CONFIG_CAMPOS, CONFIG_IMAGENES);
    if (fields.length) {
      fields.push('user_actua_id = ?'); values.push(userId ?? null);
      values.push(empresaId);
      await pool().query(`UPDATE web_config SET ${fields.join(', ')} WHERE empresa_id = ?`, values);
    }
    return this.getConfig(tenantSlug);
  },

  // ── SERVICIOS ────────────────────────────────────────────────────────────────
  async listServicios(tenantSlug: string, soloActivos = false) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT * FROM web_servicios WHERE empresa_id = ?${soloActivos ? ' AND activo = 1' : ''} ORDER BY orden, id`,
      [empresaId],
    );
    return rows;
  },
  async createServicio(tenantSlug: string, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    if (!dto.titulo?.trim()) throw new AppError('El título es requerido', 400);
    const { fields, values } = buildSet(dto, SERVICIO_CAMPOS, IMAGENES);
    const cols = ['empresa_id', 'user_crea_id', ...fields.map((f) => f.split(' = ')[0])];
    const vals = [empresaId, userId ?? null, ...values];
    const [res] = await pool().query<any>(
      `INSERT INTO web_servicios (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals,
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM web_servicios WHERE id = ?', [res.insertId]);
    return rows[0];
  },
  async updateServicio(tenantSlug: string, id: number, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const { fields, values } = buildSet(dto, SERVICIO_CAMPOS, IMAGENES);
    if (!fields.length) return this._one('web_servicios', empresaId, id);
    fields.push('user_actua_id = ?'); values.push(userId ?? null);
    values.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE web_servicios SET ${fields.join(', ')} WHERE empresa_id = ? AND id = ?`, values);
    if (!res.affectedRows) return null;
    return this._one('web_servicios', empresaId, id);
  },
  deleteServicio: (tenantSlug: string, id: number) => webRepo._del('web_servicios', tenantSlug, id),

  // ── STAFF ──────────────────────────────────────────────────────────────────
  async listStaff(tenantSlug: string, soloActivos = false) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT * FROM web_staff WHERE empresa_id = ?${soloActivos ? ' AND activo = 1' : ''} ORDER BY orden, id`,
      [empresaId],
    );
    return rows;
  },
  async createStaff(tenantSlug: string, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    if (!dto.nombre?.trim()) throw new AppError('El nombre es requerido', 400);
    const { fields, values } = buildSet(dto, STAFF_CAMPOS, IMAGENES);
    const cols = ['empresa_id', 'user_crea_id', ...fields.map((f) => f.split(' = ')[0])];
    const vals = [empresaId, userId ?? null, ...values];
    const [res] = await pool().query<any>(
      `INSERT INTO web_staff (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals,
    );
    return this._one('web_staff', empresaId, res.insertId);
  },
  async updateStaff(tenantSlug: string, id: number, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const { fields, values } = buildSet(dto, STAFF_CAMPOS, IMAGENES);
    if (!fields.length) return this._one('web_staff', empresaId, id);
    fields.push('user_actua_id = ?'); values.push(userId ?? null);
    values.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE web_staff SET ${fields.join(', ')} WHERE empresa_id = ? AND id = ?`, values);
    if (!res.affectedRows) return null;
    return this._one('web_staff', empresaId, id);
  },
  deleteStaff: (tenantSlug: string, id: number) => webRepo._del('web_staff', tenantSlug, id),

  // ── ALIANZAS Y CONVENIOS ─────────────────────────────────────────────────────
  async listAlianzas(tenantSlug: string, soloActivos = false) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT * FROM web_alianzas WHERE empresa_id = ?${soloActivos ? ' AND activo = 1' : ''} ORDER BY orden, id`,
      [empresaId],
    );
    return rows;
  },
  async createAlianza(tenantSlug: string, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    if (!dto.nombre?.trim()) throw new AppError('El nombre es requerido', 400);
    const { fields, values } = buildSet(dto, ALIANZA_CAMPOS, IMAGENES);
    const cols = ['empresa_id', 'user_crea_id', ...fields.map((f) => f.split(' = ')[0])];
    const vals = [empresaId, userId ?? null, ...values];
    const [res] = await pool().query<any>(
      `INSERT INTO web_alianzas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals,
    );
    return this._one('web_alianzas', empresaId, res.insertId);
  },
  async updateAlianza(tenantSlug: string, id: number, dto: Record<string, any>, userId?: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const { fields, values } = buildSet(dto, ALIANZA_CAMPOS, IMAGENES);
    if (!fields.length) return this._one('web_alianzas', empresaId, id);
    fields.push('user_actua_id = ?'); values.push(userId ?? null);
    values.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE web_alianzas SET ${fields.join(', ')} WHERE empresa_id = ? AND id = ?`, values);
    if (!res.affectedRows) return null;
    return this._one('web_alianzas', empresaId, id);
  },
  deleteAlianza: (tenantSlug: string, id: number) => webRepo._del('web_alianzas', tenantSlug, id),

  // ── PÚBLICO: todo el contenido de la web de un tenant (para la landing) ───────
  async getPublic(tenantSlug: string) {
    const [config, servicios, staff, alianzas] = await Promise.all([
      this.getConfig(tenantSlug),
      this.listServicios(tenantSlug, true),
      this.listStaff(tenantSlug, true),
      this.listAlianzas(tenantSlug, true),
    ]);
    return { config, servicios, staff, alianzas };
  },

  // ── Helpers internos ─────────────────────────────────────────────────────────
  async _one(tabla: string, empresaId: number, id: number) {
    const [rows] = await pool().query<any[]>(`SELECT * FROM ${tabla} WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
    return rows[0] ?? null;
  },
  async _del(tabla: string, tenantSlug: string, id: number) {
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(`DELETE FROM ${tabla} WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
    return (res.affectedRows ?? 0) > 0;
  },
};
