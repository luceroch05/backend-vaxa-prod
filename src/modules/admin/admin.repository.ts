import bcrypt from 'bcryptjs';
import { getPool } from '../../db/pool';
import { creditosRepo } from '../certificados/shared/creditos.repository';

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface CrearEmpresaDto {
  razon_social: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  logo?: string;            // data URL base64
  creditos_iniciales?: number;
}

export interface EditarEmpresaDto {
  razon_social?: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  logo?: string;            // data URL base64; '' para quitar
  activo?: boolean;
}

export interface CrearUsuarioDto {
  nombres: string;
  apellidos: string;
  correo: string;
  contrasena: string;
  rol_id: number;
  producto?: string;   // slug del producto al que se le da acceso (por defecto: certificaciones)
}

export interface EditarUsuarioDto {
  nombres?: string;
  apellidos?: string;
  correo?: string;
  contrasena?: string;   // opcional: si viene, se cambia la contraseña
  rol_id?: number;
  activo?: boolean;
}

export const adminRepo = {
  /** Empresas con saldo y consumo (para el panel de Vaxa). */
  async listEmpresas() {
    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, logo_url, activo,
              creditos_disponibles, creditos_asignados_total,
              (creditos_asignados_total - creditos_disponibles) AS creditos_consumidos
       FROM empresas ORDER BY razon_social`,
    );
    return rows;
  },

  /** Actualiza los datos de una empresa. */
  async updateEmpresa(id: number, dto: EditarEmpresaDto) {
    const [exist] = await pool().query<any[]>('SELECT id FROM empresas WHERE id = ? LIMIT 1', [id]);
    if (!(exist as any[]).length) throw new Error('Empresa no encontrada');

    const fields: string[] = [];
    const values: any[] = [];

    if (dto.razon_social !== undefined) {
      if (!dto.razon_social.trim()) throw new Error('La razón social no puede estar vacía');
      fields.push('razon_social = ?'); values.push(dto.razon_social.trim());
    }
    if (dto.tenant_slug !== undefined) {
      const slug = slugify(dto.tenant_slug);
      if (!slug) throw new Error('Slug inválido');
      const [dup] = await pool().query<any[]>('SELECT id FROM empresas WHERE tenant_slug = ? AND id <> ? LIMIT 1', [slug, id]);
      if ((dup as any[]).length) throw new Error(`Ya existe otra empresa con el identificador "${slug}"`);
      fields.push('tenant_slug = ?'); values.push(slug);
    }
    if (dto.dominio !== undefined) { fields.push('dominio = ?'); values.push(dto.dominio.trim() || null); }
    if (dto.ruc !== undefined)     { fields.push('ruc = ?');     values.push(dto.ruc.trim() || null); }
    if (dto.logo !== undefined)    { fields.push('logo_url = ?'); values.push(dto.logo || null); }
    if (dto.activo !== undefined)  { fields.push('activo = ?');  values.push(dto.activo ? 1 : 0); }

    if (fields.length) {
      values.push(id);
      await pool().query(`UPDATE empresas SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, logo_url, activo,
              creditos_disponibles, creditos_asignados_total,
              (creditos_asignados_total - creditos_disponibles) AS creditos_consumidos
       FROM empresas WHERE id = ?`, [id],
    );
    return (rows as any[])[0];
  },

  /** Crea una empresa nueva. Genera slug si no se pasa y valida unicidad. */
  async crearEmpresa(dto: CrearEmpresaDto, userId?: number) {
    const razon = dto.razon_social?.trim();
    if (!razon) throw new Error('La razón social es requerida');

    const slug = (dto.tenant_slug?.trim() ? slugify(dto.tenant_slug) : slugify(razon));
    if (!slug) throw new Error('No se pudo generar un identificador (slug) válido');

    const [dup] = await pool().query<any[]>('SELECT id FROM empresas WHERE tenant_slug = ? LIMIT 1', [slug]);
    if ((dup as any[]).length) throw new Error(`Ya existe una empresa con el identificador "${slug}"`);

    const [res] = await pool().query<any>(
      `INSERT INTO empresas (razon_social, tenant_slug, dominio, ruc, logo_url, activo) VALUES (?, ?, ?, ?, ?, 1)`,
      [razon, slug, dto.dominio?.trim() || null, dto.ruc?.trim() || null, dto.logo || null],
    );
    const empresaId = res.insertId as number;

    // Multi-producto: toda empresa nueva arranca contratando Certificaciones.
    // Tolerante si la migración de productos aún no corrió.
    try {
      await pool().query(
        `INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
         SELECT ?, id FROM productos WHERE slug = 'certificaciones'`,
        [empresaId],
      );
    } catch (e) {
      console.warn('[admin] no se pudo vincular empresa↔producto (¿migración pendiente?):', (e as Error).message);
    }

    const iniciales = Number(dto.creditos_iniciales) || 0;
    if (iniciales > 0) {
      await creditosRepo.recargar(empresaId, iniciales, userId, 'Asignación inicial', 'asignacion');
    }

    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, ruc, activo, creditos_disponibles, creditos_asignados_total
       FROM empresas WHERE id = ?`, [empresaId],
    );
    return (rows as any[])[0];
  },

  /**
   * Usuarios de una empresa. Si se indica `producto`, devuelve SOLO los usuarios
   * con acceso a ese producto (y su rol EN ese producto). Así cada panel ve sus
   * propios usuarios y no se "comparten" entre sistemas.
   * Tolerante: si la migración de productos aún no corrió, cae al listado simple.
   */
  async listUsuarios(empresaId: number, producto?: string) {
    if (producto) {
      try {
        const [rows] = await pool().query<any[]>(
          `SELECT u.id, u.nombres, u.apellidos, u.correo, u.activo, up.rol_id, r.nombre AS rol
           FROM usuarios u
           JOIN usuario_producto up ON up.usuario_id = u.id AND up.activo = 1
           JOIN productos p ON p.id = up.producto_id AND p.slug = ? AND p.activo = 1
           JOIN roles r ON r.id = up.rol_id
           WHERE u.empresa_id = ?
           ORDER BY u.nombres, u.apellidos`,
          [producto, empresaId],
        );
        return rows;
      } catch (e) {
        console.warn('[admin] listado por producto no disponible (¿migración pendiente?):', (e as Error).message);
        // cae al listado simple
      }
    }
    const [rows] = await pool().query<any[]>(
      `SELECT u.id, u.nombres, u.apellidos, u.correo, u.activo, u.rol_id, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.empresa_id = ? ORDER BY u.nombres, u.apellidos`,
      [empresaId],
    );
    return rows;
  },

  /** Crea un usuario para una empresa (contraseña hasheada con bcrypt). */
  async crearUsuario(empresaId: number, dto: CrearUsuarioDto, userId?: number) {
    const correo = dto.correo?.toLowerCase().trim();
    if (!dto.nombres?.trim() || !dto.apellidos?.trim() || !correo || !dto.contrasena || !dto.rol_id) {
      throw new Error('nombres, apellidos, correo, contraseña y rol son requeridos');
    }
    if (dto.contrasena.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');

    // Verificar que la empresa existe
    const [emp] = await pool().query<any[]>('SELECT id FROM empresas WHERE id = ? LIMIT 1', [empresaId]);
    if (!(emp as any[]).length) throw new Error('Empresa no encontrada');

    // Correo único dentro de la empresa
    const [dup] = await pool().query<any[]>(
      'SELECT id FROM usuarios WHERE empresa_id = ? AND correo = ? LIMIT 1', [empresaId, correo],
    );
    if ((dup as any[]).length) throw new Error('Ya existe un usuario con ese correo en esta empresa');

    const hash = await bcrypt.hash(dto.contrasena, 10);
    const [res] = await pool().query<any>(
      `INSERT INTO usuarios (empresa_id, nombres, apellidos, correo, contrasena, rol_id, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.nombres.trim(), dto.apellidos.trim(), correo, hash, dto.rol_id, userId ?? null],
    );

    // Multi-producto: el usuario nuevo queda con acceso SOLO al producto indicado
    // (por defecto Certificaciones). Así un usuario creado para el certificado de
    // un cliente NO puede entrar a sistemas-vaxa ni a otros productos.
    // Aseguramos también que la empresa tenga contratado ese producto.
    // Tolerante: si la migración de productos aún no corrió, no rompe la creación.
    const productoSlug = dto.producto ?? 'certificaciones';
    try {
      await pool().query(
        `INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
         SELECT ?, id FROM productos WHERE slug = ?`,
        [empresaId, productoSlug],
      );
      await pool().query(
        `INSERT IGNORE INTO usuario_producto (usuario_id, producto_id, rol_id)
         SELECT ?, id, ? FROM productos WHERE slug = ?`,
        [res.insertId, dto.rol_id, productoSlug],
      );
    } catch (e) {
      console.warn('[admin] no se pudo vincular usuario↔producto (¿migración pendiente?):', (e as Error).message);
    }

    const [rows] = await pool().query<any[]>(
      `SELECT u.id, u.nombres, u.apellidos, u.correo, u.activo, u.rol_id, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [res.insertId],
    );
    return (rows as any[])[0];
  },

  /** Edita un usuario de una empresa. Solo actualiza los campos enviados. */
  async editarUsuario(empresaId: number, usuarioId: number, dto: EditarUsuarioDto) {
    // El usuario debe pertenecer a la empresa indicada.
    const [exist] = await pool().query<any[]>(
      'SELECT id FROM usuarios WHERE id = ? AND empresa_id = ? LIMIT 1', [usuarioId, empresaId],
    );
    if (!(exist as any[]).length) throw new Error('Usuario no encontrado');

    const fields: string[] = [];
    const values: any[] = [];

    if (dto.nombres !== undefined) {
      if (!dto.nombres.trim()) throw new Error('El nombre no puede estar vacío');
      fields.push('nombres = ?'); values.push(dto.nombres.trim());
    }
    if (dto.apellidos !== undefined) {
      if (!dto.apellidos.trim()) throw new Error('El apellido no puede estar vacío');
      fields.push('apellidos = ?'); values.push(dto.apellidos.trim());
    }
    if (dto.correo !== undefined) {
      const correo = dto.correo.toLowerCase().trim();
      if (!correo) throw new Error('El correo no puede estar vacío');
      const [dup] = await pool().query<any[]>(
        'SELECT id FROM usuarios WHERE empresa_id = ? AND correo = ? AND id <> ? LIMIT 1', [empresaId, correo, usuarioId],
      );
      if ((dup as any[]).length) throw new Error('Ya existe otro usuario con ese correo en esta empresa');
      fields.push('correo = ?'); values.push(correo);
    }
    if (dto.contrasena) {
      if (dto.contrasena.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      fields.push('contrasena = ?'); values.push(await bcrypt.hash(dto.contrasena, 10));
    }
    if (dto.rol_id !== undefined) { fields.push('rol_id = ?'); values.push(dto.rol_id); }
    if (dto.activo !== undefined) { fields.push('activo = ?'); values.push(dto.activo ? 1 : 0); }

    if (fields.length) {
      values.push(usuarioId);
      await pool().query(`UPDATE usuarios SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    // Mantener el rol del usuario en sus productos sincronizado. Tolerante si la
    // migración de productos aún no corrió.
    if (dto.rol_id !== undefined) {
      try { await pool().query('UPDATE usuario_producto SET rol_id = ? WHERE usuario_id = ?', [dto.rol_id, usuarioId]); }
      catch { /* tablas de producto pendientes */ }
    }

    const [rows] = await pool().query<any[]>(
      `SELECT u.id, u.nombres, u.apellidos, u.correo, u.activo, u.rol_id, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [usuarioId],
    );
    return (rows as any[])[0];
  },

  /**
   * Elimina un usuario. En contexto de producto, revoca su acceso a ESE producto
   * (no afecta otros productos donde tenga acceso). Si tras revocar no le queda
   * ningún producto, se elimina la cuenta; si tiene datos asociados que lo impiden,
   * queda desactivada como respaldo. Sin producto (o migración pendiente): elimina
   * la cuenta directamente (o la desactiva si una FK lo impide).
   */
  async eliminarUsuario(empresaId: number, usuarioId: number, producto?: string) {
    const [exist] = await pool().query<any[]>(
      'SELECT id FROM usuarios WHERE id = ? AND empresa_id = ? LIMIT 1', [usuarioId, empresaId],
    );
    if (!(exist as any[]).length) throw new Error('Usuario no encontrado');

    const borrarCuenta = async () => {
      try { await pool().query('DELETE FROM usuarios WHERE id = ?', [usuarioId]); }
      catch { await pool().query('UPDATE usuarios SET activo = 0 WHERE id = ?', [usuarioId]); }
    };

    if (producto) {
      try {
        await pool().query(
          `DELETE up FROM usuario_producto up
           JOIN productos p ON p.id = up.producto_id
           WHERE up.usuario_id = ? AND p.slug = ?`,
          [usuarioId, producto],
        );
        const [rest] = await pool().query<any[]>(
          'SELECT 1 FROM usuario_producto WHERE usuario_id = ? LIMIT 1', [usuarioId],
        );
        if (!(rest as any[]).length) await borrarCuenta();   // ya no usa ningún producto
        return { ok: true };
      } catch (e) {
        console.warn('[admin] revocar producto no disponible (¿migración pendiente?):', (e as Error).message);
        // cae a borrado directo
      }
    }

    await borrarCuenta();
    return { ok: true };
  },

  /** Roles disponibles (para el selector al crear usuario). */
  async listRoles() {
    const [rows] = await pool().query<any[]>('SELECT id, nombre, descripcion FROM roles ORDER BY id');
    return rows;
  },
};
