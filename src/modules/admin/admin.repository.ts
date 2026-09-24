import bcrypt from 'bcryptjs';
import { getPool } from '../../db/pool';
import { planRepo } from '../certificados/planes/plan.repository';
import { guardarImagen } from '../../shared/imagenes';
import { enviarCorreo, CONTACTO_TO } from '../../shared/mailer';

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

/**
 * ¿El nombre de usuario es una cuenta de soporte de Vaxa? (exactamente "admin" o
 * "administrador", con o sin dominio). Estas cuentas SÍ pueden repetirse en varias
 * empresas —mismo correo y misma contraseña— para que Vaxa entre al certificado de
 * cada empresa. El resto de usuarios siguen siendo únicos a nivel global.
 */
const esCuentaSoporteVaxa = (correo: string) => {
  const usuario = correo.includes('@') ? correo.split('@')[0] : correo;
  return /^admin(istrador)?$/i.test(usuario.trim());
};

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

/**
 * Auto-sana la columna `empresas.precio_certificado` (modo "Pago por certificado":
 * S/ por cada certificado emitido, configurable por cliente). NULL = la empresa no
 * está en ese modo. Si no existe, la crea, así no hace falta migración manual.
 */
let _ensuredPrecioCert = false;
async function ensurePrecioCertificado(): Promise<void> {
  if (_ensuredPrecioCert) return;
  const [cols] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas'
        AND COLUMN_NAME = 'precio_certificado' LIMIT 1`,
  );
  if (!(cols as any[]).length) {
    await pool().query(
      `ALTER TABLE empresas ADD COLUMN precio_certificado DECIMAL(10,2) NULL`,
    );
  }
  _ensuredPrecioCert = true;
}

/**
 * Auto-sana la columna `empresas.logo_cert_url` (logo OBLIGATORIO del certificado:
 * una imagen dedicada que Vaxa asigna a cada cliente, SEPARADA del `logo_url` que se
 * sube al registrar la empresa). Si está vacía, el obligatorio cae al `logo_url`.
 * Se crea sola al operar empresas, así no hace falta migración manual.
 */
let _ensuredLogoCert = false;
async function ensureLogoCert(): Promise<void> {
  if (_ensuredLogoCert) return;
  const [cols] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas'
        AND COLUMN_NAME = 'logo_cert_url' LIMIT 1`,
  );
  if (!(cols as any[]).length) {
    await pool().query(`ALTER TABLE empresas ADD COLUMN logo_cert_url MEDIUMTEXT NULL AFTER logo_url`);
  }
  _ensuredLogoCert = true;
}

/**
 * Auto-crea la tabla `vaxa_landing` (una sola fila, id=1) con las redes/contacto que
 * salen en la landing pública de Vaxa. Editable desde sistemas-vaxa. Siembra los valores
 * actuales que estaban hardcodeados. Se crea sola, sin migración manual.
 */
let _ensuredVaxaLanding = false;
async function ensureVaxaLanding(): Promise<void> {
  if (_ensuredVaxaLanding) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS vaxa_landing (
       id         TINYINT      NOT NULL PRIMARY KEY,
       facebook   VARCHAR(300) NULL,
       instagram  VARCHAR(300) NULL,
       tiktok     VARCHAR(300) NULL,
       youtube    VARCHAR(300) NULL,
       linkedin   VARCHAR(300) NULL,
       whatsapp   VARCHAR(40)  NULL,
       email      VARCHAR(160) NULL,
       telefono   VARCHAR(40)  NULL,
       updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `INSERT IGNORE INTO vaxa_landing (id, whatsapp, email) VALUES (1, '51924600490', 'info@vaxa.com.pe')`,
  );
  _ensuredVaxaLanding = true;
}

const LANDING_CAMPOS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'whatsapp', 'email', 'telefono'] as const;

/**
 * Auto-crea la tabla `vaxa_alianzas` (aliados/convenios que salen en la landing
 * pública de Vaxa). Editable desde sistemas-vaxa. El logo se guarda como ARCHIVO
 * en /uploads/vaxa (la BD solo tiene la ruta, no base64). Se crea sola, sin
 * migración manual, igual que `vaxa_landing`.
 */
let _ensuredVaxaAlianzas = false;
async function ensureVaxaAlianzas(): Promise<void> {
  if (_ensuredVaxaAlianzas) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS vaxa_alianzas (
       id       INT AUTO_INCREMENT PRIMARY KEY,
       nombre   VARCHAR(200) NOT NULL,
       logo_url VARCHAR(400) NULL,
       link     VARCHAR(400) NULL,
       orden    INT          NOT NULL DEFAULT 0,
       activo   TINYINT(1)   NOT NULL DEFAULT 1,
       creado   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  _ensuredVaxaAlianzas = true;
}

const ALIANZA_COLS = 'id, nombre, logo_url, link, orden, activo';

/**
 * Auto-crea la tabla `vaxa_testimonios` (comentarios reales de clientes que salen
 * en la landing pública de Vaxa). El testimonio NO guarda foto de la persona:
 * se enlaza a una alianza (`alianza_id`) y reutiliza su logo. Se crea sola, sin
 * migración manual, igual que `vaxa_alianzas`.
 */
let _ensuredVaxaTestimonios = false;
async function ensureVaxaTestimonios(): Promise<void> {
  if (_ensuredVaxaTestimonios) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS vaxa_testimonios (
       id           INT AUTO_INCREMENT PRIMARY KEY,
       comentario   TEXT         NOT NULL,
       autor        VARCHAR(200) NOT NULL,
       cargo        VARCHAR(200) NULL,
       empresa      VARCHAR(200) NULL,
       alianza_id   INT          NULL,
       calificacion TINYINT      NOT NULL DEFAULT 5,
       orden        INT          NOT NULL DEFAULT 0,
       activo       TINYINT(1)   NOT NULL DEFAULT 1,
       creado       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  _ensuredVaxaTestimonios = true;
}

/**
 * Auto-crea las tablas del módulo Infraestructura (uso interno de Vaxa, solo ADMIN):
 *  - `infra_recursos`   = activos propios (VPS/dominios/hosting) con lo que TÚ pagas al proveedor.
 *  - `infra_alquileres` = lo que le cobras/alquilas a un cliente (con su próximo cobro).
 * Incluye los campos fijos de auditoría (activo, user_crea_id, user_actua_id, created_at, updated_at).
 */
let _ensuredInfra = false;
async function ensureInfra(): Promise<void> {
  if (_ensuredInfra) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS infra_recursos (
       id               INT AUTO_INCREMENT PRIMARY KEY,
       tipo             VARCHAR(40)   NOT NULL DEFAULT 'Hosting',
       nombre           VARCHAR(200)  NOT NULL,
       proveedor        VARCHAR(150)  NULL,
       costo            DECIMAL(10,2) NOT NULL DEFAULT 0,
       moneda           VARCHAR(8)    NOT NULL DEFAULT 'PEN',
       ciclo            VARCHAR(20)   NOT NULL DEFAULT 'mensual',
       fecha_renovacion DATE          NULL,
       proyectos        TEXT          NULL,
       credenciales     TEXT          NULL,
       notas            TEXT          NULL,
       activo           TINYINT(1)    NOT NULL DEFAULT 1,
       user_crea_id     INT           DEFAULT NULL,
       user_actua_id    INT           DEFAULT NULL,
       created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS infra_alquileres (
       id            INT AUTO_INCREMENT PRIMARY KEY,
       cliente       VARCHAR(200)  NULL,
       empresa_id    INT           NULL,
       recurso_id    INT           NULL,
       descripcion   VARCHAR(250)  NULL,
       precio        DECIMAL(10,2) NOT NULL DEFAULT 0,
       moneda        VARCHAR(8)    NOT NULL DEFAULT 'PEN',
       ciclo         VARCHAR(20)   NOT NULL DEFAULT 'mensual',
       fecha_inicio  DATE          NULL,
       proximo_cobro DATE          NULL,
       ultimo_cobro  DATE          NULL,
       estado_pago   VARCHAR(20)   NOT NULL DEFAULT 'pendiente',
       notas         TEXT          NULL,
       activo        TINYINT(1)    NOT NULL DEFAULT 1,
       user_crea_id  INT           DEFAULT NULL,
       user_actua_id INT           DEFAULT NULL,
       created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS infra_meta (
       clave VARCHAR(60) PRIMARY KEY,
       valor VARCHAR(255) NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  // Migración suave: agrega columnas nuevas a tablas ya creadas (ignora "columna duplicada").
  await addColIfMissing('infra_recursos', 'proyectos', 'TEXT NULL AFTER fecha_renovacion');
  await addColIfMissing('infra_alquileres', 'ultimo_cobro', 'DATE NULL AFTER proximo_cobro');
  _ensuredInfra = true;
}

/** Fecha local (Lima) en 'YYYY-MM-DD'. */
function hoyYmd(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** ALTER TABLE ADD COLUMN idempotente (ignora ER_DUP_FIELDNAME 1060). */
async function addColIfMissing(tabla: string, col: string, def: string): Promise<void> {
  try {
    await pool().query(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`);
  } catch (e: any) {
    if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
  }
}

const RECURSO_COLS = 'id, tipo, nombre, proveedor, costo, moneda, ciclo, fecha_renovacion, proyectos, credenciales, notas, activo, user_crea_id, user_actua_id, created_at, updated_at';

export interface CrearEmpresaDto {
  razon_social: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  tipo_doc?: string;        // cat.06: '6' RUC (default) · '1' DNI · '4' CE · '7' pasaporte
  logo?: string;            // data URL base64 — logo de registro de la empresa
  logo_cert?: string;       // data URL base64 — logo OBLIGATORIO dedicado al certificado (Vaxa lo asigna)
  plan_id?: number;         // plan con el que arranca (default: Básico)
  ciclo_id?: number;        // ciclo de facturación (default: mensual)
  precio_certificado?: number; // solo modo "Pago por certificado": S/ por cert emitido (default 20)
  permite_diseno?: boolean; // servicio a medida (Lienzo) que activa Vaxa por empresa
}

export interface EditarEmpresaDto {
  razon_social?: string;
  tenant_slug?: string;
  dominio?: string;
  ruc?: string;
  tipo_doc?: string;
  logo?: string;            // data URL base64; '' para quitar — logo de registro de la empresa
  logo_cert?: string;       // data URL base64; '' para quitar — logo dedicado del certificado (Vaxa)
  activo?: boolean;
  permite_diseno?: boolean; // servicio a medida (Lienzo) que activa Vaxa por empresa
  precio_certificado?: number; // solo modo "Pago por certificado": S/ por cert emitido
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
    await ensurePrecioCertificado();
    await ensureLogoCert();
    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, logo_cert_url, activo,
              permite_diseno, precio_certificado,
              creditos_disponibles, creditos_asignados_total,
              (creditos_asignados_total - creditos_disponibles) AS creditos_consumidos
       FROM empresas ORDER BY razon_social`,
    );
    return rows;
  },

  /** Actualiza los datos de una empresa. */
  async updateEmpresa(id: number, dto: EditarEmpresaDto) {
    await ensurePermiteDiseno();
    await ensurePrecioCertificado();
    await ensureLogoCert();
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
    // Logo dedicado del certificado (obligatorio). '' o null lo quita → cae al logo de registro.
    if (dto.logo_cert !== undefined) { fields.push('logo_cert_url = ?'); values.push(guardarImagen(dto.logo_cert, 'empresas') || null); }
    if (dto.activo !== undefined)  { fields.push('activo = ?');  values.push(dto.activo ? 1 : 0); }
    if (dto.permite_diseno !== undefined) { fields.push('permite_diseno = ?'); values.push(dto.permite_diseno ? 1 : 0); }
    // Precio por certificado (modo "Pago por certificado"). Debe ser > 0; solo aplica
    // si la empresa está en ese plan, pero se guarda tal cual (NULL si mandan 0/negativo).
    if (dto.precio_certificado !== undefined) {
      const precio = Number(dto.precio_certificado);
      fields.push('precio_certificado = ?');
      values.push(Number.isFinite(precio) && precio > 0 ? Math.round(precio * 100) / 100 : null);
    }

    if (fields.length) {
      values.push(id);
      await pool().query(`UPDATE empresas SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await pool().query<any[]>(
      `SELECT id, razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, logo_cert_url, activo,
              permite_diseno, precio_certificado,
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
    await ensureLogoCert();
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
      `INSERT INTO empresas (razon_social, tenant_slug, dominio, ruc, tipo_doc, logo_url, logo_cert_url, activo, permite_diseno) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [razon, slug, dto.dominio?.trim() || null, dto.ruc?.trim() || null, dto.tipo_doc || '6', guardarImagen(dto.logo, 'empresas') || null, guardarImagen(dto.logo_cert, 'empresas') || null, dto.permite_diseno ? 1 : 0],
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
        const [pl] = await pool().query<any[]>('SELECT slug, creditos_incluidos FROM planes WHERE id = ?', [planId]);
        const plan = (pl as any[])[0] ?? {};
        // Modo "Pago por certificado": fija el precio del cliente (el que puso Vaxa,
        // o 20 por defecto). asignarPlan ya lo dejó en 20; aquí lo sobreescribe si mandó otro.
        if (plan.slug === 'pago_certificado') {
          const precio = Number(dto.precio_certificado) > 0 ? Number(dto.precio_certificado) : 20;
          await pool().query('UPDATE empresas SET precio_certificado = ? WHERE id = ?', [precio, empresaId]);
        }
        // Créditos incluidos del plan → saldo inicial de la empresa (acumulables).
        const incluidos = Number(plan.creditos_incluidos ?? 0);
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

    // Unicidad del nombre de usuario:
    //  · Regla general: correo ÚNICO GLOBAL (una persona = una cuenta; el acceso a
    //    varios productos va por usuario_producto, no duplicando el usuario).
    //  · Excepción soporte Vaxa (usuario "admin" / "administrador"): puede repetirse
    //    en varias empresas con el MISMO correo y contraseña; solo debe ser único
    //    DENTRO de la empresa. El login resuelve por correo + tenant_slug.
    const esSoporte = esCuentaSoporteVaxa(correo);
    const [dup] = esSoporte
      ? await pool().query<any[]>(
          'SELECT id FROM usuarios WHERE correo = ? AND empresa_id = ? LIMIT 1', [correo, empresaId])
      : await pool().query<any[]>(
          'SELECT id FROM usuarios WHERE correo = ? LIMIT 1', [correo]);
    if ((dup as any[]).length) {
      throw new Error(esSoporte
        ? 'Ese usuario ya existe en esta empresa.'
        : 'Ese correo ya está en uso. El nombre de usuario debe ser único.');
    }

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
      // Único GLOBAL, salvo las cuentas de soporte de Vaxa ("admin"/"administrador"),
      // que solo son únicas dentro de la empresa (ver crearUsuario). Excluye al propio usuario.
      const esSoporte = esCuentaSoporteVaxa(correo);
      const [dup] = esSoporte
        ? await pool().query<any[]>(
            'SELECT id FROM usuarios WHERE correo = ? AND empresa_id = ? AND id <> ? LIMIT 1', [correo, empresaId, usuarioId])
        : await pool().query<any[]>(
            'SELECT id FROM usuarios WHERE correo = ? AND id <> ? LIMIT 1', [correo, usuarioId]);
      if ((dup as any[]).length) {
        throw new Error(esSoporte
          ? 'Ese usuario ya existe en esta empresa.'
          : 'Ese correo ya está en uso. El nombre de usuario debe ser único.');
      }
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

  /** Redes/contacto de la landing pública de Vaxa (una sola fila). */
  async getVaxaLanding() {
    await ensureVaxaLanding();
    const [rows] = await pool().query<any[]>(
      `SELECT ${LANDING_CAMPOS.join(', ')} FROM vaxa_landing WHERE id = 1`,
    );
    return (rows as any[])[0] ?? {};
  },

  /** Guarda las redes/contacto de la landing (upsert de la fila id=1). */
  async saveVaxaLanding(dto: Record<string, unknown>) {
    await ensureVaxaLanding();
    const sets = LANDING_CAMPOS.map(c => `${c} = ?`).join(', ');
    const vals = LANDING_CAMPOS.map(c => {
      const v = dto?.[c];
      return v == null ? null : String(v).trim() || null;
    });
    await pool().query(`UPDATE vaxa_landing SET ${sets} WHERE id = 1`, vals);
    return this.getVaxaLanding();
  },

  /** Alianzas de la landing de Vaxa. `soloActivas` para la lectura pública. */
  async listVaxaAlianzas(soloActivas = false) {
    await ensureVaxaAlianzas();
    const [rows] = await pool().query<any[]>(
      `SELECT ${ALIANZA_COLS} FROM vaxa_alianzas${soloActivas ? ' WHERE activo = 1' : ''} ORDER BY orden, id`,
    );
    return rows;
  },

  /** Crea una alianza. El logo (data URL) se guarda como archivo PNG en /uploads/vaxa. */
  async createVaxaAlianza(dto: Record<string, unknown>) {
    await ensureVaxaAlianzas();
    const nombre = String(dto?.nombre ?? '').trim();
    if (!nombre) throw new Error('El nombre es requerido');
    const logo = guardarImagen(dto?.logo_url as any, 'vaxa') ?? null;
    const link = dto?.link ? String(dto.link).trim() || null : null;
    const orden = Number(dto?.orden) || 0;
    const activo = dto?.activo === false || dto?.activo === 0 ? 0 : 1;
    const [res] = await pool().query<any>(
      `INSERT INTO vaxa_alianzas (nombre, logo_url, link, orden, activo) VALUES (?, ?, ?, ?, ?)`,
      [nombre, logo, link, orden, activo],
    );
    const [rows] = await pool().query<any[]>(`SELECT ${ALIANZA_COLS} FROM vaxa_alianzas WHERE id = ?`, [res.insertId]);
    return rows[0];
  },

  /** Actualiza solo los campos enviados. El logo nuevo (data URL) se guarda como archivo. */
  async updateVaxaAlianza(id: number, dto: Record<string, unknown>) {
    await ensureVaxaAlianzas();
    const fields: string[] = [];
    const vals: any[] = [];
    if (dto.nombre !== undefined)   { fields.push('nombre = ?');   vals.push(String(dto.nombre).trim()); }
    if (dto.logo_url !== undefined) { fields.push('logo_url = ?'); vals.push(guardarImagen(dto.logo_url as any, 'vaxa') ?? null); }
    if (dto.link !== undefined)     { fields.push('link = ?');     vals.push(dto.link ? String(dto.link).trim() || null : null); }
    if (dto.orden !== undefined)    { fields.push('orden = ?');    vals.push(Number(dto.orden) || 0); }
    if (dto.activo !== undefined)   { fields.push('activo = ?');   vals.push(dto.activo === false || dto.activo === 0 ? 0 : 1); }
    if (fields.length) {
      vals.push(id);
      const [res] = await pool().query<any>(`UPDATE vaxa_alianzas SET ${fields.join(', ')} WHERE id = ?`, vals);
      if (!res.affectedRows) return null;
    }
    const [rows] = await pool().query<any[]>(`SELECT ${ALIANZA_COLS} FROM vaxa_alianzas WHERE id = ?`, [id]);
    return rows[0] ?? null;
  },

  async deleteVaxaAlianza(id: number) {
    await ensureVaxaAlianzas();
    const [res] = await pool().query<any>('DELETE FROM vaxa_alianzas WHERE id = ?', [id]);
    return (res.affectedRows ?? 0) > 0;
  },

  /**
   * Testimonios de la landing. Hace LEFT JOIN a `vaxa_alianzas` para resolver el
   * logo de la empresa (reutilizado) y el nombre. `soloActivos` para lo público.
   */
  async listVaxaTestimonios(soloActivos = false) {
    await ensureVaxaTestimonios();
    await ensureVaxaAlianzas();
    const [rows] = await pool().query<any[]>(
      `SELECT t.id, t.comentario, t.autor, t.cargo,
              COALESCE(t.empresa, a.nombre) AS empresa,
              t.alianza_id, a.logo_url AS logo_url,
              t.calificacion, t.orden, t.activo
         FROM vaxa_testimonios t
         LEFT JOIN vaxa_alianzas a ON a.id = t.alianza_id
        ${soloActivos ? 'WHERE t.activo = 1' : ''}
        ORDER BY t.orden, t.id`,
    );
    return rows;
  },

  async createVaxaTestimonio(dto: Record<string, unknown>) {
    await ensureVaxaTestimonios();
    const comentario = String(dto?.comentario ?? '').trim();
    const autor = String(dto?.autor ?? '').trim();
    if (!comentario) throw new Error('El comentario es requerido');
    if (!autor) throw new Error('El autor es requerido');
    const cargo = dto?.cargo ? String(dto.cargo).trim() || null : null;
    const empresa = dto?.empresa ? String(dto.empresa).trim() || null : null;
    const alianzaId = dto?.alianza_id ? Number(dto.alianza_id) || null : null;
    const calificacion = Math.max(1, Math.min(5, Number(dto?.calificacion) || 5));
    const orden = Number(dto?.orden) || 0;
    const activo = dto?.activo === false || dto?.activo === 0 ? 0 : 1;
    const [res] = await pool().query<any>(
      `INSERT INTO vaxa_testimonios (comentario, autor, cargo, empresa, alianza_id, calificacion, orden, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [comentario, autor, cargo, empresa, alianzaId, calificacion, orden, activo],
    );
    const list = await this.listVaxaTestimonios();
    return list.find((r) => r.id === res.insertId) ?? null;
  },

  async updateVaxaTestimonio(id: number, dto: Record<string, unknown>) {
    await ensureVaxaTestimonios();
    const fields: string[] = [];
    const vals: any[] = [];
    if (dto.comentario !== undefined)   { fields.push('comentario = ?');   vals.push(String(dto.comentario).trim()); }
    if (dto.autor !== undefined)        { fields.push('autor = ?');        vals.push(String(dto.autor).trim()); }
    if (dto.cargo !== undefined)        { fields.push('cargo = ?');        vals.push(dto.cargo ? String(dto.cargo).trim() || null : null); }
    if (dto.empresa !== undefined)      { fields.push('empresa = ?');      vals.push(dto.empresa ? String(dto.empresa).trim() || null : null); }
    if (dto.alianza_id !== undefined)   { fields.push('alianza_id = ?');   vals.push(dto.alianza_id ? Number(dto.alianza_id) || null : null); }
    if (dto.calificacion !== undefined) { fields.push('calificacion = ?'); vals.push(Math.max(1, Math.min(5, Number(dto.calificacion) || 5))); }
    if (dto.orden !== undefined)        { fields.push('orden = ?');        vals.push(Number(dto.orden) || 0); }
    if (dto.activo !== undefined)       { fields.push('activo = ?');       vals.push(dto.activo === false || dto.activo === 0 ? 0 : 1); }
    if (fields.length) {
      vals.push(id);
      const [res] = await pool().query<any>(`UPDATE vaxa_testimonios SET ${fields.join(', ')} WHERE id = ?`, vals);
      if (!res.affectedRows) return null;
    }
    const list = await this.listVaxaTestimonios();
    return list.find((r) => r.id === id) ?? null;
  },

  async deleteVaxaTestimonio(id: number) {
    await ensureVaxaTestimonios();
    const [res] = await pool().query<any>('DELETE FROM vaxa_testimonios WHERE id = ?', [id]);
    return (res.affectedRows ?? 0) > 0;
  },

  /* ── Infraestructura (interno Vaxa): recursos propios + alquileres a clientes ── */

  /** Recursos propios (VPS/dominios/hosting). `soloActivos` para ocultar los dados de baja. */
  async listInfraRecursos(soloActivos = false) {
    await ensureInfra();
    const [rows] = await pool().query<any[]>(
      `SELECT ${RECURSO_COLS} FROM infra_recursos${soloActivos ? ' WHERE activo = 1' : ''} ORDER BY fecha_renovacion IS NULL, fecha_renovacion, id`,
    );
    return rows;
  },

  async createInfraRecurso(dto: Record<string, unknown>, uid?: number) {
    await ensureInfra();
    const nombre = String(dto?.nombre ?? '').trim();
    if (!nombre) throw new Error('El nombre es requerido');
    const [res] = await pool().query<any>(
      `INSERT INTO infra_recursos (tipo, nombre, proveedor, costo, moneda, ciclo, fecha_renovacion, proyectos, credenciales, notas, activo, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(dto?.tipo ?? 'Hosting').trim() || 'Hosting',
        nombre,
        dto?.proveedor ? String(dto.proveedor).trim() || null : null,
        Number(dto?.costo) || 0,
        String(dto?.moneda ?? 'PEN').trim() || 'PEN',
        String(dto?.ciclo ?? 'mensual').trim() || 'mensual',
        dto?.fecha_renovacion ? String(dto.fecha_renovacion).slice(0, 10) : null,
        dto?.proyectos ? String(dto.proyectos) : null,
        dto?.credenciales ? String(dto.credenciales) : null,
        dto?.notas ? String(dto.notas) : null,
        dto?.activo === false || dto?.activo === 0 ? 0 : 1,
        uid ?? null,
      ],
    );
    const [rows] = await pool().query<any[]>(`SELECT ${RECURSO_COLS} FROM infra_recursos WHERE id = ?`, [res.insertId]);
    return rows[0];
  },

  async updateInfraRecurso(id: number, dto: Record<string, unknown>, uid?: number) {
    await ensureInfra();
    const fields: string[] = [];
    const vals: any[] = [];
    if (dto.tipo !== undefined)             { fields.push('tipo = ?');             vals.push(String(dto.tipo).trim() || 'Hosting'); }
    if (dto.nombre !== undefined)           { fields.push('nombre = ?');           vals.push(String(dto.nombre).trim()); }
    if (dto.proveedor !== undefined)        { fields.push('proveedor = ?');        vals.push(dto.proveedor ? String(dto.proveedor).trim() || null : null); }
    if (dto.costo !== undefined)            { fields.push('costo = ?');            vals.push(Number(dto.costo) || 0); }
    if (dto.moneda !== undefined)           { fields.push('moneda = ?');           vals.push(String(dto.moneda).trim() || 'PEN'); }
    if (dto.ciclo !== undefined)            { fields.push('ciclo = ?');            vals.push(String(dto.ciclo).trim() || 'mensual'); }
    if (dto.fecha_renovacion !== undefined) { fields.push('fecha_renovacion = ?'); vals.push(dto.fecha_renovacion ? String(dto.fecha_renovacion).slice(0, 10) : null); }
    if (dto.proyectos !== undefined)        { fields.push('proyectos = ?');        vals.push(dto.proyectos ? String(dto.proyectos) : null); }
    if (dto.credenciales !== undefined)     { fields.push('credenciales = ?');     vals.push(dto.credenciales ? String(dto.credenciales) : null); }
    if (dto.notas !== undefined)            { fields.push('notas = ?');            vals.push(dto.notas ? String(dto.notas) : null); }
    if (dto.activo !== undefined)           { fields.push('activo = ?');           vals.push(dto.activo === false || dto.activo === 0 ? 0 : 1); }
    fields.push('user_actua_id = ?'); vals.push(uid ?? null);
    vals.push(id);
    const [res] = await pool().query<any>(`UPDATE infra_recursos SET ${fields.join(', ')} WHERE id = ?`, vals);
    if (!res.affectedRows) return null;
    const [rows] = await pool().query<any[]>(`SELECT ${RECURSO_COLS} FROM infra_recursos WHERE id = ?`, [id]);
    return rows[0] ?? null;
  },

  async deleteInfraRecurso(id: number) {
    await ensureInfra();
    const [res] = await pool().query<any>('DELETE FROM infra_recursos WHERE id = ?', [id]);
    return (res.affectedRows ?? 0) > 0;
  },

  /** Alquileres a clientes. Hace LEFT JOIN al recurso (para el margen) y a la empresa (nombre). */
  async listInfraAlquileres(soloActivos = false) {
    await ensureInfra();
    await ensureVaxaAlianzas(); // no-op de seguridad; empresas viene de su propia tabla
    const [rows] = await pool().query<any[]>(
      `SELECT al.id, al.cliente, al.empresa_id, al.recurso_id, al.descripcion,
              al.precio, al.moneda, al.ciclo, al.fecha_inicio, al.proximo_cobro, al.ultimo_cobro,
              al.estado_pago, al.notas, al.activo, al.user_crea_id, al.user_actua_id,
              al.created_at, al.updated_at,
              e.razon_social AS empresa_nombre,
              r.nombre AS recurso_nombre, r.tipo AS recurso_tipo, r.costo AS recurso_costo
         FROM infra_alquileres al
         LEFT JOIN empresas e ON e.id = al.empresa_id
         LEFT JOIN infra_recursos r ON r.id = al.recurso_id
        ${soloActivos ? 'WHERE al.activo = 1' : ''}
        ORDER BY al.proximo_cobro IS NULL, al.proximo_cobro, al.id`,
    );
    return rows;
  },

  async createInfraAlquiler(dto: Record<string, unknown>, uid?: number) {
    await ensureInfra();
    const cliente = dto?.cliente ? String(dto.cliente).trim() || null : null;
    const empresaId = dto?.empresa_id ? Number(dto.empresa_id) || null : null;
    if (!cliente && !empresaId) throw new Error('Indica el cliente (empresa o nombre)');
    const [res] = await pool().query<any>(
      `INSERT INTO infra_alquileres (cliente, empresa_id, recurso_id, descripcion, precio, moneda, ciclo, fecha_inicio, proximo_cobro, estado_pago, notas, activo, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cliente,
        empresaId,
        dto?.recurso_id ? Number(dto.recurso_id) || null : null,
        dto?.descripcion ? String(dto.descripcion).trim() || null : null,
        Number(dto?.precio) || 0,
        String(dto?.moneda ?? 'PEN').trim() || 'PEN',
        String(dto?.ciclo ?? 'mensual').trim() || 'mensual',
        dto?.fecha_inicio ? String(dto.fecha_inicio).slice(0, 10) : null,
        dto?.proximo_cobro ? String(dto.proximo_cobro).slice(0, 10) : null,
        String(dto?.estado_pago ?? 'pendiente').trim() || 'pendiente',
        dto?.notas ? String(dto.notas) : null,
        dto?.activo === false || dto?.activo === 0 ? 0 : 1,
        uid ?? null,
      ],
    );
    const list = await this.listInfraAlquileres();
    return list.find((r) => r.id === res.insertId) ?? null;
  },

  async updateInfraAlquiler(id: number, dto: Record<string, unknown>, uid?: number) {
    await ensureInfra();
    const fields: string[] = [];
    const vals: any[] = [];
    if (dto.cliente !== undefined)       { fields.push('cliente = ?');       vals.push(dto.cliente ? String(dto.cliente).trim() || null : null); }
    if (dto.empresa_id !== undefined)    { fields.push('empresa_id = ?');    vals.push(dto.empresa_id ? Number(dto.empresa_id) || null : null); }
    if (dto.recurso_id !== undefined)    { fields.push('recurso_id = ?');    vals.push(dto.recurso_id ? Number(dto.recurso_id) || null : null); }
    if (dto.descripcion !== undefined)   { fields.push('descripcion = ?');   vals.push(dto.descripcion ? String(dto.descripcion).trim() || null : null); }
    if (dto.precio !== undefined)        { fields.push('precio = ?');        vals.push(Number(dto.precio) || 0); }
    if (dto.moneda !== undefined)        { fields.push('moneda = ?');        vals.push(String(dto.moneda).trim() || 'PEN'); }
    if (dto.ciclo !== undefined)         { fields.push('ciclo = ?');         vals.push(String(dto.ciclo).trim() || 'mensual'); }
    if (dto.fecha_inicio !== undefined)  { fields.push('fecha_inicio = ?');  vals.push(dto.fecha_inicio ? String(dto.fecha_inicio).slice(0, 10) : null); }
    if (dto.proximo_cobro !== undefined) { fields.push('proximo_cobro = ?'); vals.push(dto.proximo_cobro ? String(dto.proximo_cobro).slice(0, 10) : null); }
    if (dto.estado_pago !== undefined)   { fields.push('estado_pago = ?');   vals.push(String(dto.estado_pago).trim() || 'pendiente'); }
    if (dto.notas !== undefined)         { fields.push('notas = ?');         vals.push(dto.notas ? String(dto.notas) : null); }
    if (dto.activo !== undefined)        { fields.push('activo = ?');        vals.push(dto.activo === false || dto.activo === 0 ? 0 : 1); }
    fields.push('user_actua_id = ?'); vals.push(uid ?? null);
    vals.push(id);
    const [res] = await pool().query<any>(`UPDATE infra_alquileres SET ${fields.join(', ')} WHERE id = ?`, vals);
    if (!res.affectedRows) return null;
    const list = await this.listInfraAlquileres();
    return list.find((r) => r.id === id) ?? null;
  },

  async deleteInfraAlquiler(id: number) {
    await ensureInfra();
    const [res] = await pool().query<any>('DELETE FROM infra_alquileres WHERE id = ?', [id]);
    return (res.affectedRows ?? 0) > 0;
  },

  /**
   * Registra un cobro: guarda `ultimo_cobro = hoy` y CORRE el próximo cobro al
   * siguiente ciclo (mensual +1 mes, anual +1 año). Pago único queda 'pagado' y sin
   * próxima fecha; recurrentes vuelven a 'pendiente' con la nueva fecha (sale del semáforo).
   */
  async registrarCobroAlquiler(id: number, uid?: number) {
    await ensureInfra();
    const [res] = await pool().query<any>(
      `UPDATE infra_alquileres SET
         ultimo_cobro = CURDATE(),
         proximo_cobro = CASE ciclo
           WHEN 'anual'   THEN DATE_ADD(COALESCE(proximo_cobro, CURDATE()), INTERVAL 1 YEAR)
           WHEN 'mensual' THEN DATE_ADD(COALESCE(proximo_cobro, CURDATE()), INTERVAL 1 MONTH)
           ELSE NULL END,
         estado_pago = CASE ciclo WHEN 'unico' THEN 'pagado' ELSE 'pendiente' END,
         user_actua_id = ?
       WHERE id = ?`,
      [uid ?? null, id],
    );
    if (!res.affectedRows) return null;
    const list = await this.listInfraAlquileres();
    return list.find((r) => r.id === id) ?? null;
  },

  /**
   * Alertas de cobro: alquileres activos, NO pagados, cuyo próximo cobro cae dentro
   * de `dias` (por defecto 7) o ya venció. Ordenados del más urgente al menos.
   */
  async alertasCobro(dias = 7) {
    await ensureInfra();
    const [rows] = await pool().query<any[]>(
      `SELECT al.id, al.empresa_id, al.precio, al.moneda, al.proximo_cobro, al.estado_pago,
              COALESCE(e.razon_social, al.cliente) AS cliente,
              COALESCE(al.descripcion, r.nombre) AS descripcion,
              DATEDIFF(al.proximo_cobro, CURDATE()) AS dias
         FROM infra_alquileres al
         LEFT JOIN empresas e ON e.id = al.empresa_id
         LEFT JOIN infra_recursos r ON r.id = al.recurso_id
        WHERE al.activo = 1
          AND al.estado_pago <> 'pagado'
          AND al.proximo_cobro IS NOT NULL
          AND al.proximo_cobro <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        ORDER BY al.proximo_cobro`,
      [dias],
    );
    return rows;
  },

  async getMeta(clave: string): Promise<string | null> {
    await ensureInfra();
    const [rows] = await pool().query<any[]>('SELECT valor FROM infra_meta WHERE clave = ?', [clave]);
    return rows[0]?.valor ?? null;
  },

  async setMeta(clave: string, valor: string): Promise<void> {
    await ensureInfra();
    await pool().query(
      'INSERT INTO infra_meta (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [clave, valor],
    );
  },

  /**
   * Envía UN correo-resumen de cobros pendientes a info@vaxa.com.pe, como máximo una
   * vez por día (se controla con infra_meta). Lo llama el scheduler diario.
   * `force` ignora el candado del día (para el botón "enviar ahora").
   */
  async procesarAvisosCobro(force = false): Promise<{ enviado: boolean; motivo?: string; cantidad?: number }> {
    const hoy = hoyYmd();
    if (!force) {
      const ultimo = await this.getMeta('cobro_aviso_ultimo');
      if (ultimo === hoy) return { enviado: false, motivo: 'ya se envió hoy' };
    }
    const items = await this.alertasCobro(7);
    if (items.length === 0) {
      await this.setMeta('cobro_aviso_ultimo', hoy);
      return { enviado: false, motivo: 'sin cobros pendientes', cantidad: 0 };
    }

    const money = (n: number, m: string) => `${m === 'USD' ? '$' : 'S/'} ${(Number(n) || 0).toFixed(2)}`;
    const etiqueta = (d: number) => d < 0 ? `venció hace ${Math.abs(d)} día(s)` : d === 0 ? 'vence HOY' : `vence en ${d} día(s)`;
    const filasTxt = items.map((i) => `• ${i.cliente} — ${i.descripcion || 'Servicio'} — ${money(i.precio, i.moneda)} — ${etiqueta(Number(i.dias))} (${String(i.proximo_cobro).slice(0, 10)})`).join('\n');
    const filasHtml = items.map((i) => {
      const d = Number(i.dias);
      const col = d < 0 ? '#DC2626' : d === 0 ? '#D97706' : '#059669';
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:600;color:#0D0E12">${i.cliente}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#555">${i.descripcion || 'Servicio'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#0D0E12">${money(i.precio, i.moneda)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:${col};font-weight:600">${etiqueta(d)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#888">${String(i.proximo_cobro).slice(0, 10)}</td>
      </tr>`;
    }).join('');

    await enviarCorreo({
      to: CONTACTO_TO, // info@vaxa.com.pe
      subject: `💰 Cobros pendientes (${items.length}) — Vaxa Infraestructura`,
      text: `Tienes ${items.length} cobro(s) por gestionar:\n\n${filasTxt}\n\n— Vaxa`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
          <h2 style="color:#0D0E12">Cobros pendientes (${items.length})</h2>
          <p style="color:#555">Estos clientes tienen un cobro por vencer o vencido:</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
              <th style="padding:8px 10px">Cliente</th><th style="padding:8px 10px">Servicio</th>
              <th style="padding:8px 10px">Monto</th><th style="padding:8px 10px">Estado</th><th style="padding:8px 10px">Fecha</th>
            </tr></thead>
            <tbody>${filasHtml}</tbody>
          </table>
          <p style="color:#999;font-size:12px;margin-top:18px">Aviso automático de Vaxa · módulo Infraestructura</p>
        </div>`,
    });

    await this.setMeta('cobro_aviso_ultimo', hoy);
    return { enviado: true, cantidad: items.length };
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
