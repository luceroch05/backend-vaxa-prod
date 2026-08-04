import bcrypt from 'bcryptjs';
import { getPool } from '../../db/pool';
import { planRepo } from '../certificados/planes/plan.repository';
import { guardarImagen } from '../../shared/imagenes';

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Auto-sana la columna `empresas.permite_diseno` (servicio a medida "Diseño
 * personalizado / Lienzo" que Vaxa activa por empresa). Si no existe, la crea.
 * Se corre al operar empresas, así no hace falta migración manual.
 */
let _ensuredDiseno = false;
async function ensurePermiteDiseno(): Promise<void> {
  if (_ensuredDiseno) return;
  const [cols] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas'
        AND COLUMN_NAME = 'permite_diseno' LIMIT 1`,
  );
  if (!(cols as any[]).length) {
    await pool().query(
      `ALTER TABLE empresas ADD COLUMN permite_diseno TINYINT(1) NOT NULL DEFAULT 0 AFTER activo`,
    );
  }
  _ensuredDiseno = true;
}

export interface CrearEmpresaDto {
  razon_social: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  tipo_doc?: string;        // cat.06: '6' RUC (default) · '1' DNI · '4' CE · '7' pasaporte
  logo?: string;            // data URL base64
  plan_id?: number;         // plan con el que arranca (default: Básico)
  ciclo_id?: number;        // ciclo de facturación (default: mensual)
  permite_diseno?: boolean; // servicio a medida (Lienzo) que activa Vaxa por empresa
}

export interface EditarEmpresaDto {
  razon_social?: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  tipo_doc?: string;
  logo?: string;            // data URL base64; '' para quitar
  activo?: boolean;
  permite_diseno?: boolean; // servicio a medida (Lienzo) que activa Vaxa por empresa
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
    await ensurePermiteDiseno();
    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, activo,
              permite_diseno,
              creditos_disponibles, creditos_asignados_total,
              (creditos_asignados_total - creditos_disponibles) AS creditos_consumidos
       FROM empresas ORDER BY razon_social`,
    );
    return rows;
  },

  /** Actualiza los datos de una empresa. */
  async updateEmpresa(id: number, dto: EditarEmpresaDto) {
    await ensurePermiteDiseno();
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
    if (dto.tipo_doc !== undefined){ fields.push('tipo_doc = ?'); values.push(dto.tipo_doc || '6'); }
    if (dto.logo !== undefined)    { fields.push('logo_url = ?'); values.push(guardarImagen(dto.logo, 'empresas') || null); }
    if (dto.activo !== undefined)  { fields.push('activo = ?');  values.push(dto.activo ? 1 : 0); }
    if (dto.permite_diseno !== undefined) { fields.push('permite_diseno = ?'); values.push(dto.permite_diseno ? 1 : 0); }

    if (fields.length) {
      values.push(id);
      await pool().query(`UPDATE empresas SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, activo,
              permite_diseno,
              creditos_disponibles, creditos_asignados_total,
              (creditos_asignados_total - creditos_disponibles) AS creditos_consumidos
       FROM empresas WHERE id = ?`, [id],
    );
    return (rows as any[])[0];
  },

  /**
   * Elimina una empresa. Si tiene datos asociados (usuarios, programas,
   * participantes o certificados) NO se borra: se desactiva (activo=0), que es
   * reversible. Solo si está completamente vacía se elimina de verdad, limpiando
   * antes sus filas satélite (suscripción, consumo, pagos, dominios, productos).
   * Nunca elimina la empresa raíz de Vaxa.
   */
  async eliminarEmpresa(id: number) {
    const [exist] = await pool().query<any[]>(
      'SELECT id, tenant_slug FROM empresas WHERE id = ? LIMIT 1', [id],
    );
    if (!(exist as any[]).length) throw new Error('Empresa no encontrada');

    const root = process.env.VAXA_ROOT_TENANT || 'vaxa';
    if ((exist as any[])[0].tenant_slug === root) {
      throw new Error('No se puede eliminar la empresa raíz de Vaxa');
    }

    // ¿Tiene datos reales? Si sí, solo se desactiva (no se pierde nada).
    const count = async (tabla: string) => {
      try {
        const [r] = await pool().query<any[]>(`SELECT COUNT(*) AS n FROM ${tabla} WHERE empresa_id = ?`, [id]);
        return Number((r as any[])[0]?.n ?? 0);
      } catch { return 0; }
    };
    const conDatos =
      (await count('usuarios')) +
      (await count('programas')) +
      (await count('participantes')) +
      (await count('certificados'));

    if (conDatos > 0) {
      await pool().query('UPDATE empresas SET activo = 0 WHERE id = ?', [id]);
      return { ok: true, modo: 'desactivada' as const };
    }

    // Empresa vacía: se borra de verdad, limpiando sus filas satélite.
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE empresas SET plan_actual_id = NULL WHERE id = ?', [id]);
      for (const tabla of [
        'pagos', 'consumo_mensual', 'empresa_suscripcion', 'empresa_dominios',
        'empresa_producto', 'creditos_movimientos',
      ]) {
        try { await conn.query(`DELETE FROM ${tabla} WHERE empresa_id = ?`, [id]); }
        catch { /* la tabla puede no existir según las migraciones aplicadas */ }
      }
      await conn.query('DELETE FROM empresas WHERE id = ?', [id]);
      await conn.commit();
      return { ok: true, modo: 'eliminada' as const };
    } catch {
      await conn.rollback();
      // Si una FK imprevista lo impide, desactivamos para no dejar la empresa a medias.
      await pool().query('UPDATE empresas SET activo = 0 WHERE id = ?', [id]);
      return { ok: true, modo: 'desactivada' as const };
    } finally {
      conn.release();
    }
  },

  /** Crea una empresa nueva. Genera slug si no se pasa y valida unicidad. */
  async crearEmpresa(dto: CrearEmpresaDto, userId?: number) {
    await ensurePermiteDiseno();
    const razon = dto.razon_social?.trim();
    if (!razon) throw new Error('La razón social es requerida');

    const slug = (dto.tenant_slug?.trim() ? slugify(dto.tenant_slug) : slugify(razon));
    if (!slug) throw new Error('No se pudo generar un identificador (slug) válido');

    const [dup] = await pool().query<any[]>('SELECT id FROM empresas WHERE tenant_slug = ? LIMIT 1', [slug]);
    if ((dup as any[]).length) throw new Error(`Ya existe una empresa con el identificador "${slug}"`);

    const docNum = dto.ruc?.trim();
    if (docNum) {
      const [dupRuc] = await pool().query<any[]>('SELECT razon_social FROM empresas WHERE ruc = ? LIMIT 1', [docNum]);
      if ((dupRuc as any[]).length) {
        throw new Error(`Ya existe una empresa registrada con el documento ${docNum} (${dupRuc[0].razon_social}).`);
      }
    }

    const [res] = await pool().query<any>(
      `INSERT INTO empresas (razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, activo, permite_diseno) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [razon, slug, dto.dominio?.trim() || null, dto.ruc?.trim() || null, dto.tipo_doc || '6', guardarImagen(dto.logo, 'empresas') || null, dto.permite_diseno ? 1 : 0],
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

    // La empresa arranca con el plan elegido (o Básico por defecto), con suscripción
    // vigente, así puede emitir desde el primer día. Tolerante si la migración de planes aún no corrió.
    try {
      const planId = Number(dto.plan_id) || (await planRepo.getPlanIdBySlug('basico'));
      if (planId) {
        await planRepo.asignarPlan(empresaId, planId, Number(dto.ciclo_id) || 1);
        // Créditos incluidos del plan → saldo inicial de la empresa (acumulables).
        const [pl] = await pool().query<any[]>('SELECT creditos_incluidos FROM planes WHERE id = ?', [planId]);
        const incluidos = Number((pl as any[])[0]?.creditos_incluidos ?? 0);
        if (incluidos > 0) {
          await pool().query(
            `UPDATE empresas
                SET creditos_disponibles = creditos_disponibles + ?,
                    creditos_asignados_total = creditos_asignados_total + ?
              WHERE id = ?`,
            [incluidos, incluidos, empresaId],
          );
          await pool().query(
            `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion, user_crea_id)
             VALUES (?, 'asignacion', ?, ?, 'Créditos incluidos del plan', ?)`,
            [empresaId, incluidos, incluidos, userId ?? null],
          );
        }
      }
    } catch (e) {
      console.warn('[admin] no se pudo asignar el plan inicial / créditos:', (e as Error).message);
    }

    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, ruc, activo, permite_diseno, creditos_disponibles, creditos_asignados_total
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

    // Correo único GLOBAL (el nombre de usuario no puede repetirse en ningún
    // sistema/empresa). Una persona = una cuenta; el acceso a varios productos se
    // da con filas en usuario_producto, no duplicando el usuario.
    const [dup] = await pool().query<any[]>(
      'SELECT id FROM usuarios WHERE correo = ? LIMIT 1', [correo],
    );
    if ((dup as any[]).length) throw new Error('Ese correo ya está en uso. El nombre de usuario debe ser único.');

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
      // Correo único GLOBAL (excluyendo al propio usuario).
      const [dup] = await pool().query<any[]>(
        'SELECT id FROM usuarios WHERE correo = ? AND id <> ? LIMIT 1', [correo, usuarioId],
      );
      if ((dup as any[]).length) throw new Error('Ese correo ya está en uso. El nombre de usuario debe ser único.');
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

  /**
   * Migra las imágenes guardadas como base64 en la BD a ARCHIVOS en /uploads y deja
   * en la columna solo la ruta. Idempotente (salta las que ya son ruta). Pensado para
   * correr desde un botón del panel (cPanel no tiene terminal). No toca certificados emitidos.
   */
  async migrarImagenes() {
    const OBJETIVOS: Array<{ tabla: string; col: string; sub: string; pk: string }> = [
      { tabla: 'empresas',                    col: 'logo_url',      sub: 'empresas',   pk: 'id' },
      { tabla: 'logos',                       col: 'imagen_logo',   sub: 'logos',      pk: 'id' },
      { tabla: 'firmas',                      col: 'imagen_firma',  sub: 'firmas',     pk: 'id' },
      { tabla: 'configuraciones_certificado', col: 'plantilla_url', sub: 'plantillas', pk: 'id' },
    ];
    const resultado: Array<{ tabla: string; migradas: number; total: number }> = [];
    let totalMigradas = 0;
    for (const t of OBJETIVOS) {
      let rows: any[];
      try {
        [rows] = await pool().query<any[]>(
          `SELECT ${t.pk} AS pk, ${t.col} AS img FROM ${t.tabla} WHERE ${t.col} LIKE 'data:image%'`,
        );
      } catch {
        resultado.push({ tabla: t.tabla, migradas: 0, total: 0 });  // tabla/columna no existe → se salta
        continue;
      }
      let migr = 0;
      for (const r of rows) {
        const ruta = guardarImagen(r.img, t.sub);
        if (ruta && ruta !== r.img) {
          await pool().query(`UPDATE ${t.tabla} SET ${t.col} = ? WHERE ${t.pk} = ?`, [ruta, r.pk]);
          migr++;
        }
      }
      totalMigradas += migr;
      resultado.push({ tabla: t.tabla, migradas: migr, total: rows.length });
    }
    return { totalMigradas, detalle: resultado };
  },
};
