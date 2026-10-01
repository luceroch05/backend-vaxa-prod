import { getPool } from '../../db/pool';
import { AppError } from '../../shared/errors';

/**
 * Repositorio de FINANZAS del centro terapéutico (Caja + Ventas + Inventario).
 * Aislado del repo clínico: solo toca las tablas hc_productos, hc_inventario_mov,
 * hc_ventas, hc_venta_items, hc_caja_mov y lee precios de hc_servicios/hc_productos.
 * Todo va scoped por empresa_id (tenant). Ver scripts/mysql-hc-finanzas.sql.
 */

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

/**
 * Fecha segura para columnas DATETIME, SIN corrimiento de zona horaria.
 * El input `date` del front manda solo 'YYYY-MM-DD'; si eso se pasa por `new Date()`
 * JS lo toma como medianoche UTC y en Perú (UTC−5) se guarda el día anterior.
 * Solución: si viene solo la fecha, se guarda a mediodía como STRING (mysql2 la
 * inserta literal, sin reinterpretarla). Si no viene, usa la hora actual.
 */
function fechaBD(f?: string | null): string | Date {
  if (!f) return new Date();
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f} 12:00:00` : new Date(f);
}

/** tenant_slug -> empresa_id (mismo criterio que el resto del sistema). */
async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new AppError('Empresa no encontrada', 404);
  return rows[0].id as number;
}

/**
 * Auto-sana el esquema de finanzas (precio en servicios + tablas de inventario/ventas/caja).
 * Se crea solo si la migración no corrió en prod, así las queries no fallan.
 * Mismo patrón que el resto de HC. Ver scripts/mysql-hc-finanzas.sql.
 */
let _ensuredFinanzas = false;
async function ensureFinanzas(): Promise<void> {
  if (_ensuredFinanzas) return;
  // precio del servicio
  const [col] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_servicios' AND COLUMN_NAME = 'precio' LIMIT 1`,
  );
  if (!(col as any[]).length) {
    await pool().query('ALTER TABLE hc_servicios ADD COLUMN precio DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER descripcion');
  }
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_productos (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
       nombre VARCHAR(160) NOT NULL, sku VARCHAR(60) DEFAULT NULL, descripcion VARCHAR(255) DEFAULT NULL,
       unidad VARCHAR(30) NOT NULL DEFAULT 'unidad',
       precio_venta DECIMAL(10,2) NOT NULL DEFAULT 0, costo DECIMAL(10,2) NOT NULL DEFAULT 0,
       stock DECIMAL(12,2) NOT NULL DEFAULT 0, stock_min DECIMAL(12,2) NOT NULL DEFAULT 0,
       activo TINYINT(1) NOT NULL DEFAULT 1, user_crea_id INT DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       CONSTRAINT fk_hcprod_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       INDEX idx_hcprod_empresa (empresa_id), UNIQUE KEY uq_hcprod (empresa_id, nombre)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_ventas (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, paciente_id INT DEFAULT NULL,
       fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, total DECIMAL(10,2) NOT NULL DEFAULT 0,
       metodo_pago VARCHAR(30) NOT NULL DEFAULT 'efectivo', nota VARCHAR(255) DEFAULT NULL,
       estado VARCHAR(12) NOT NULL DEFAULT 'emitida', user_crea_id INT DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       CONSTRAINT fk_hcvta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       CONSTRAINT fk_hcvta_paciente FOREIGN KEY (paciente_id) REFERENCES hc_pacientes(id) ON DELETE SET NULL,
       INDEX idx_hcvta_empresa (empresa_id), INDEX idx_hcvta_fecha (empresa_id, fecha)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_inventario_mov (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, producto_id INT NOT NULL,
       tipo VARCHAR(10) NOT NULL, cantidad DECIMAL(12,2) NOT NULL, motivo VARCHAR(160) DEFAULT NULL,
       venta_id INT DEFAULT NULL, user_crea_id INT DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_hcinv_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       CONSTRAINT fk_hcinv_producto FOREIGN KEY (producto_id) REFERENCES hc_productos(id) ON DELETE CASCADE,
       INDEX idx_hcinv_producto (producto_id), INDEX idx_hcinv_venta (venta_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_venta_items (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, venta_id INT NOT NULL,
       tipo VARCHAR(10) NOT NULL, servicio_id INT DEFAULT NULL, producto_id INT DEFAULT NULL,
       descripcion VARCHAR(200) NOT NULL, cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
       precio_unit DECIMAL(10,2) NOT NULL DEFAULT 0, subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
       CONSTRAINT fk_hcvi_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       CONSTRAINT fk_hcvi_venta FOREIGN KEY (venta_id) REFERENCES hc_ventas(id) ON DELETE CASCADE,
       INDEX idx_hcvi_venta (venta_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_caja_mov (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
       fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, tipo VARCHAR(10) NOT NULL,
       monto DECIMAL(10,2) NOT NULL, concepto VARCHAR(200) NOT NULL, categoria VARCHAR(60) DEFAULT NULL,
       metodo_pago VARCHAR(30) DEFAULT NULL, venta_id INT DEFAULT NULL, user_crea_id INT DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_hccaja_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       CONSTRAINT fk_hccaja_venta FOREIGN KEY (venta_id) REFERENCES hc_ventas(id) ON DELETE CASCADE,
       INDEX idx_hccaja_empresa (empresa_id), INDEX idx_hccaja_fecha (empresa_id, fecha)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  // Pago dividido: una venta puede saldarse con varios métodos (efectivo + yape…).
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_venta_pagos (
       id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, venta_id INT NOT NULL,
       metodo_pago VARCHAR(30) NOT NULL, monto DECIMAL(10,2) NOT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_hcvp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
       CONSTRAINT fk_hcvp_venta FOREIGN KEY (venta_id) REFERENCES hc_ventas(id) ON DELETE CASCADE,
       INDEX idx_hcvp_venta (venta_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  // Descuentos (recibo sin IGV): monto en S/ a nivel venta (global) y por línea.
  // Idempotente: solo agrega la columna si aún no existe.
  const [cvd] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_ventas' AND COLUMN_NAME = 'descuento' LIMIT 1`,
  );
  if (!(cvd as any[]).length) {
    await pool().query('ALTER TABLE hc_ventas ADD COLUMN descuento DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total');
  }
  const [cid] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_venta_items' AND COLUMN_NAME = 'descuento' LIMIT 1`,
  );
  if (!(cid as any[]).length) {
    await pool().query('ALTER TABLE hc_venta_items ADD COLUMN descuento DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER precio_unit');
  }
  // Módulos activos por centro (los prende/apaga Vaxa desde sistemas-vaxa). Sin
  // fila => módulo ON (default), así los centros existentes no pierden nada.
  await pool().query(
    `CREATE TABLE IF NOT EXISTS hc_modulos (
       empresa_id INT NOT NULL, modulo VARCHAR(20) NOT NULL, activo TINYINT(1) NOT NULL DEFAULT 1,
       PRIMARY KEY (empresa_id, modulo),
       CONSTRAINT fk_hcmod_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  _ensuredFinanzas = true;
}

/** Módulos del panel de Historias Clínicas que Vaxa puede activar/desactivar por centro. */
export const HC_MODULOS = ['pacientes', 'historia', 'agenda', 'servicios', 'ventas', 'inventario', 'caja', 'web'] as const;
export type HcModulo = (typeof HC_MODULOS)[number];
export type HcModulosMap = Record<HcModulo, boolean>;

// ── Tipos de entrada ──────────────────────────────────────────────────────────
export interface ProductoDto {
  nombre: string;
  sku?: string | null;
  descripcion?: string | null;
  unidad?: string | null;
  precio_venta?: number | null;
  costo?: number | null;
  stock?: number | null;       // stock inicial (solo al crear)
  stock_min?: number | null;
  activo?: boolean;
}

export interface VentaItemDto {
  tipo: 'servicio' | 'producto';
  servicio_id?: number | null;
  producto_id?: number | null;
  cantidad?: number | null;
  precio_unit?: number | null;   // opcional; si no viene se toma del catálogo
  descuento?: number | null;     // descuento de la línea en S/ (ya resuelto de %→monto)
}
export interface PagoDto { metodo: string; monto: number; }
export interface VentaDto {
  paciente_id?: number | null;
  metodo_pago?: string | null;   // método único (legacy); si viene `pagos`, se ignora
  pagos?: PagoDto[];             // pago dividido: varios métodos; su suma debe ser el total
  nota?: string | null;
  fecha?: string | null;
  descuento?: number | null;     // descuento GLOBAL de la venta en S/
  items: VentaItemDto[];
}

export interface CajaMovDto {
  tipo: 'ingreso' | 'egreso';
  monto: number;
  concepto: string;
  categoria?: string | null;
  metodo_pago?: string | null;
  fecha?: string | null;
}

export const finanzasRepo = {
  // ── Módulos activos por centro ────────────────────────────────────────────────
  /** Mapa completo de módulos (default true) por empresa_id. Uso interno/admin. */
  async getModulosByEmpresaId(empresaId: number): Promise<HcModulosMap> {
    await ensureFinanzas();
    const [rows] = await pool().query<any[]>(
      'SELECT modulo, activo FROM hc_modulos WHERE empresa_id = ?', [empresaId],
    );
    const guardado = new Map<string, boolean>();
    for (const r of rows as any[]) guardado.set(String(r.modulo), !!r.activo);
    const mapa = {} as HcModulosMap;
    for (const m of HC_MODULOS) mapa[m] = guardado.has(m) ? guardado.get(m)! : true;
    return mapa;
  },

  /** Igual, pero por tenant_slug (para el panel del centro). */
  async getModulos(tenantSlug: string): Promise<HcModulosMap> {
    const empresaId = await getEmpresaId(tenantSlug);
    return this.getModulosByEmpresaId(empresaId);
  },

  /** Upsert de módulos (solo Vaxa). Ignora claves fuera de la lista blanca. */
  async setModulos(empresaId: number, mapa: Record<string, unknown>): Promise<HcModulosMap> {
    await ensureFinanzas();
    const filas = HC_MODULOS
      .filter((m) => m in mapa)
      .map((m) => [empresaId, m, mapa[m] ? 1 : 0]);
    if (filas.length) {
      await pool().query(
        'INSERT INTO hc_modulos (empresa_id, modulo, activo) VALUES ? ' +
          'ON DUPLICATE KEY UPDATE activo = VALUES(activo)',
        [filas],
      );
    }
    return this.getModulosByEmpresaId(empresaId);
  },

  /** Datos fiscales del centro para el comprobante de venta (recibo interno). */
  async getCentro(tenantSlug: string): Promise<{ razon_social: string | null; ruc: string | null; logo_url: string | null }> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      'SELECT razon_social, ruc, logo_url FROM empresas WHERE id = ? LIMIT 1', [empresaId],
    );
    const r = (rows as any[])[0] ?? {};
    return { razon_social: r.razon_social ?? null, ruc: r.ruc ?? null, logo_url: r.logo_url ?? null };
  },

  // ── Inventario / Productos ───────────────────────────────────────────────────
  async listProductos(tenantSlug: string, incluirInactivos = false) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id, nombre, sku, descripcion, unidad, precio_venta, costo, stock, stock_min, activo
         FROM hc_productos
        WHERE empresa_id = ? ${incluirInactivos ? '' : 'AND activo = 1'}
        ORDER BY nombre`,
      [empresaId],
    );
    return rows;
  },

  async createProducto(tenantSlug: string, dto: ProductoDto, userId?: number) {
    if (!dto.nombre?.trim()) throw new AppError('El nombre del producto es requerido', 400);
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const stockInicial = Number(dto.stock) || 0;
    const [res] = await pool().query<any>(
      `INSERT INTO hc_productos
         (empresa_id, nombre, sku, descripcion, unidad, precio_venta, costo, stock, stock_min, activo, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, dto.nombre.trim(), dto.sku || null, dto.descripcion || null,
       (dto.unidad || 'unidad').trim(), Number(dto.precio_venta) || 0, Number(dto.costo) || 0,
       stockInicial, Number(dto.stock_min) || 0, dto.activo === false ? 0 : 1, userId ?? null],
    );
    // Deja constancia del stock inicial en el kardex.
    if (stockInicial > 0) {
      await pool().query(
        `INSERT INTO hc_inventario_mov (empresa_id, producto_id, tipo, cantidad, motivo, user_crea_id)
         VALUES (?, ?, 'entrada', ?, 'Stock inicial', ?)`,
        [empresaId, res.insertId, stockInicial, userId ?? null],
      );
    }
    return this.getProducto(tenantSlug, res.insertId);
  },

  async getProducto(tenantSlug: string, id: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT id, nombre, sku, descripcion, unidad, precio_venta, costo, stock, stock_min, activo
         FROM hc_productos WHERE empresa_id = ? AND id = ? LIMIT 1`,
      [empresaId, id],
    );
    return rows[0] ?? null;
  },

  async updateProducto(tenantSlug: string, id: number, dto: ProductoDto) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const campos: string[] = [];
    const vals: any[] = [];
    const set = (c: string, v: any) => { campos.push(`${c} = ?`); vals.push(v); };
    if (dto.nombre !== undefined)       set('nombre', dto.nombre.trim());
    if (dto.sku !== undefined)          set('sku', dto.sku || null);
    if (dto.descripcion !== undefined)  set('descripcion', dto.descripcion || null);
    if (dto.unidad !== undefined)       set('unidad', (dto.unidad || 'unidad').trim());
    if (dto.precio_venta !== undefined) set('precio_venta', Number(dto.precio_venta) || 0);
    if (dto.costo !== undefined)        set('costo', Number(dto.costo) || 0);
    if (dto.stock_min !== undefined)    set('stock_min', Number(dto.stock_min) || 0);
    if (dto.activo !== undefined)       set('activo', dto.activo ? 1 : 0);
    // OJO: `stock` no se edita aquí a mano; se mueve con ajustarStock (deja kardex).
    if (!campos.length) return this.getProducto(tenantSlug, id);
    vals.push(empresaId, id);
    const [res] = await pool().query<any>(`UPDATE hc_productos SET ${campos.join(', ')} WHERE empresa_id = ? AND id = ?`, vals);
    if (!res.affectedRows) return null;
    return this.getProducto(tenantSlug, id);
  },

  /** Ajuste manual de stock (entrada/salida) con constancia en el kardex. */
  async ajustarStock(tenantSlug: string, productoId: number, tipo: 'entrada' | 'salida', cantidad: number, motivo: string, userId?: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const cant = Number(cantidad);
    if (!(cant > 0)) throw new AppError('La cantidad debe ser mayor a 0', 400);
    const prod = await this.getProducto(tenantSlug, productoId);
    if (!prod) throw new AppError('Producto no encontrado', 404);
    const delta = tipo === 'salida' ? -cant : cant;
    if (Number(prod.stock) + delta < 0) throw new AppError('El stock no puede quedar negativo', 400);
    await pool().query('UPDATE hc_productos SET stock = stock + ? WHERE empresa_id = ? AND id = ?', [delta, empresaId, productoId]);
    await pool().query(
      `INSERT INTO hc_inventario_mov (empresa_id, producto_id, tipo, cantidad, motivo, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, productoId, tipo, cant, motivo || (tipo === 'entrada' ? 'Ingreso de stock' : 'Salida de stock'), userId ?? null],
    );
    return this.getProducto(tenantSlug, productoId);
  },

  async listMovsInventario(tenantSlug: string, productoId: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT m.*, CONCAT(u.nombres, ' ', u.apellidos) AS usuario
         FROM hc_inventario_mov m
         LEFT JOIN usuarios u ON u.id = m.user_crea_id
        WHERE m.empresa_id = ? AND m.producto_id = ?
        ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
      [empresaId, productoId],
    );
    return rows;
  },

  // ── Ventas ────────────────────────────────────────────────────────────────────
  async listVentas(tenantSlug: string, filtros: { desde?: string; hasta?: string } = {}) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const cond: string[] = ['v.empresa_id = ?'];
    const vals: any[] = [empresaId];
    if (filtros.desde) { cond.push('v.fecha >= ?'); vals.push(filtros.desde + ' 00:00:00'); }
    if (filtros.hasta) { cond.push('v.fecha <= ?'); vals.push(filtros.hasta + ' 23:59:59'); }
    const [rows] = await pool().query<any[]>(
      `SELECT v.*, CONCAT(p.apellidos, ', ', p.nombres) AS paciente_nombre,
              CONCAT(u.nombres, ' ', u.apellidos) AS vendedor
         FROM hc_ventas v
         LEFT JOIN hc_pacientes p ON p.id = v.paciente_id
         LEFT JOIN usuarios u ON u.id = v.user_crea_id
        WHERE ${cond.join(' AND ')}
        ORDER BY v.fecha DESC, v.id DESC`,
      vals,
    );
    return rows;
  },

  async getVenta(tenantSlug: string, id: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT v.*, CONCAT(p.apellidos, ', ', p.nombres) AS paciente_nombre,
              CONCAT(u.nombres, ' ', u.apellidos) AS vendedor
         FROM hc_ventas v
         LEFT JOIN hc_pacientes p ON p.id = v.paciente_id
         LEFT JOIN usuarios u ON u.id = v.user_crea_id
        WHERE v.empresa_id = ? AND v.id = ? LIMIT 1`,
      [empresaId, id],
    );
    if (!rows[0]) return null;
    const [items] = await pool().query<any[]>(
      'SELECT * FROM hc_venta_items WHERE empresa_id = ? AND venta_id = ? ORDER BY id',
      [empresaId, id],
    );
    const [pagos] = await pool().query<any[]>(
      'SELECT metodo_pago, monto FROM hc_venta_pagos WHERE empresa_id = ? AND venta_id = ? ORDER BY id',
      [empresaId, id],
    );
    return { ...rows[0], items, pagos };
  },

  /**
   * Crea una venta con sus ítems en UNA transacción:
   *  - resuelve precio/nombre desde hc_servicios / hc_productos (snapshot),
   *  - descuenta stock de los productos (con kardex 'salida'),
   *  - registra el ingreso equivalente en caja.
   */
  async createVenta(tenantSlug: string, dto: VentaDto, userId?: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const items = Array.isArray(dto.items) ? dto.items.filter(Boolean) : [];
    if (!items.length) throw new AppError('La venta necesita al menos un ítem', 400);

    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      // Resolver cada línea (precio + nombre snapshot) y validar stock de productos.
      // `subtotal` es el NETO de la línea (bruto − descuento de línea, no negativo).
      const lineas: { tipo: string; servicio_id: number | null; producto_id: number | null;
                      descripcion: string; cantidad: number; precio_unit: number; descuento: number; subtotal: number }[] = [];
      for (const it of items) {
        const cantidad = Number(it.cantidad) || 1;
        if (cantidad <= 0) throw new AppError('La cantidad debe ser mayor a 0', 400);

        if (it.tipo === 'servicio') {
          const [r] = await conn.query<any[]>('SELECT nombre, precio FROM hc_servicios WHERE empresa_id = ? AND id = ? LIMIT 1', [empresaId, it.servicio_id]);
          if (!r.length) throw new AppError('Servicio no encontrado en la venta', 400);
          const precio = it.precio_unit != null ? Number(it.precio_unit) : Number(r[0].precio) || 0;
          const bruto = precio * cantidad;
          const desc = Math.min(Math.max(Number(it.descuento) || 0, 0), bruto);
          lineas.push({ tipo: 'servicio', servicio_id: Number(it.servicio_id), producto_id: null, descripcion: r[0].nombre, cantidad, precio_unit: precio, descuento: +desc.toFixed(2), subtotal: +(bruto - desc).toFixed(2) });
        } else if (it.tipo === 'producto') {
          const [r] = await conn.query<any[]>('SELECT nombre, precio_venta, stock FROM hc_productos WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE', [empresaId, it.producto_id]);
          if (!r.length) throw new AppError('Producto no encontrado en la venta', 400);
          if (Number(r[0].stock) < cantidad) throw new AppError(`Stock insuficiente de "${r[0].nombre}" (quedan ${r[0].stock})`, 400);
          const precio = it.precio_unit != null ? Number(it.precio_unit) : Number(r[0].precio_venta) || 0;
          const bruto = precio * cantidad;
          const desc = Math.min(Math.max(Number(it.descuento) || 0, 0), bruto);
          lineas.push({ tipo: 'producto', servicio_id: null, producto_id: Number(it.producto_id), descripcion: r[0].nombre, cantidad, precio_unit: precio, descuento: +desc.toFixed(2), subtotal: +(bruto - desc).toFixed(2) });
        } else {
          throw new AppError('Tipo de ítem inválido (servicio|producto)', 400);
        }
      }

      const subtotalNeto = +lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2);
      // Descuento global: acotado entre 0 y el subtotal neto (no deja el total negativo).
      const descGlobal = Math.min(Math.max(Number(dto.descuento) || 0, 0), subtotalNeto);
      const total = +(subtotalNeto - descGlobal).toFixed(2);
      const fecha = fechaBD(dto.fecha);

      // Pago dividido: si vienen varios métodos, su suma debe cuadrar con el total.
      // Si no vienen, se asume un solo pago por el total con el método único (o efectivo).
      let pagos: { metodo: string; monto: number }[];
      if (Array.isArray(dto.pagos) && dto.pagos.length) {
        pagos = dto.pagos
          .map((p) => ({ metodo: (p.metodo || 'efectivo').trim(), monto: +(Number(p.monto) || 0).toFixed(2) }))
          .filter((p) => p.monto > 0);
        if (!pagos.length) throw new AppError('Los pagos deben tener un monto mayor a 0', 400);
        const suma = +pagos.reduce((s, p) => s + p.monto, 0).toFixed(2);
        if (Math.abs(suma - total) > 0.01) throw new AppError(`Los pagos (S/ ${suma.toFixed(2)}) no cuadran con el total (S/ ${total.toFixed(2)})`, 400);
      } else {
        pagos = [{ metodo: (dto.metodo_pago || 'efectivo').trim(), monto: total }];
      }
      // Método "resumen" que guarda la venta: el único, o 'mixto' si son varios.
      const metodo = pagos.length > 1 ? 'mixto' : pagos[0].metodo;

      const [vr] = await conn.query<any>(
        `INSERT INTO hc_ventas (empresa_id, paciente_id, fecha, total, descuento, metodo_pago, nota, user_crea_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, dto.paciente_id || null, fecha, total, +descGlobal.toFixed(2), metodo, dto.nota || null, userId ?? null],
      );
      const ventaId = vr.insertId;

      for (const l of lineas) {
        await conn.query(
          `INSERT INTO hc_venta_items (empresa_id, venta_id, tipo, servicio_id, producto_id, descripcion, cantidad, precio_unit, descuento, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [empresaId, ventaId, l.tipo, l.servicio_id, l.producto_id, l.descripcion, l.cantidad, l.precio_unit, l.descuento, l.subtotal],
        );
        if (l.tipo === 'producto' && l.producto_id) {
          await conn.query('UPDATE hc_productos SET stock = stock - ? WHERE empresa_id = ? AND id = ?', [l.cantidad, empresaId, l.producto_id]);
          await conn.query(
            `INSERT INTO hc_inventario_mov (empresa_id, producto_id, tipo, cantidad, motivo, venta_id, user_crea_id)
             VALUES (?, ?, 'salida', ?, 'Venta', ?, ?)`,
            [empresaId, l.producto_id, l.cantidad, ventaId, userId ?? null],
          );
        }
      }

      // Concepto de caja legible: se reconoce por A QUIÉN se le vendió, no por el id.
      let cliente = 'Mostrador';
      if (dto.paciente_id) {
        const [pr] = await conn.query<any[]>('SELECT apellidos, nombres FROM hc_pacientes WHERE empresa_id = ? AND id = ? LIMIT 1', [empresaId, dto.paciente_id]);
        if ((pr as any[]).length) cliente = `${pr[0].apellidos}, ${pr[0].nombres}`;
      }
      const conceptoCaja = `Venta a ${cliente}`;

      // Desglose de pagos: un renglón por método en hc_venta_pagos (para el detalle/comprobante).
      for (const p of pagos) {
        await conn.query(
          'INSERT INTO hc_venta_pagos (empresa_id, venta_id, metodo_pago, monto) VALUES (?, ?, ?, ?)',
          [empresaId, ventaId, p.metodo, p.monto],
        );
      }
      // La caja registra UN SOLO ingreso por la venta (el total), NO uno por método:
      // así una venta se ve como una sola línea en Caja. El desglose por método (efectivo,
      // yape, etc.) queda en hc_venta_pagos y se ve en el detalle de la venta ("Ver venta").
      await conn.query(
        `INSERT INTO hc_caja_mov (empresa_id, fecha, tipo, monto, concepto, categoria, metodo_pago, venta_id, user_crea_id)
         VALUES (?, ?, 'ingreso', ?, ?, 'Venta', ?, ?, ?)`,
        [empresaId, fecha, total, conceptoCaja, metodo, ventaId, userId ?? null],
      );

      await conn.commit();
      return this.getVenta(tenantSlug, ventaId);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  /** Anula una venta: repone stock de los productos y borra su ingreso de caja. */
  async anularVenta(tenantSlug: string, id: number, userId?: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [vr] = await conn.query<any[]>('SELECT estado FROM hc_ventas WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE', [empresaId, id]);
      if (!vr.length) throw new AppError('Venta no encontrada', 404);
      if (vr[0].estado === 'anulada') throw new AppError('La venta ya está anulada', 400);

      const [items] = await conn.query<any[]>('SELECT tipo, producto_id, cantidad FROM hc_venta_items WHERE empresa_id = ? AND venta_id = ?', [empresaId, id]);
      for (const l of items) {
        if (l.tipo === 'producto' && l.producto_id) {
          await conn.query('UPDATE hc_productos SET stock = stock + ? WHERE empresa_id = ? AND id = ?', [l.cantidad, empresaId, l.producto_id]);
          await conn.query(
            `INSERT INTO hc_inventario_mov (empresa_id, producto_id, tipo, cantidad, motivo, venta_id, user_crea_id)
             VALUES (?, ?, 'entrada', ?, 'Anulación de venta', ?, ?)`,
            [empresaId, l.producto_id, l.cantidad, id, userId ?? null],
          );
        }
      }
      // Quita el ingreso de caja de esa venta y marca la venta como anulada.
      await conn.query('DELETE FROM hc_caja_mov WHERE empresa_id = ? AND venta_id = ?', [empresaId, id]);
      await conn.query("UPDATE hc_ventas SET estado = 'anulada' WHERE empresa_id = ? AND id = ?", [empresaId, id]);

      await conn.commit();
      return this.getVenta(tenantSlug, id);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  // ── Caja: ingresos / egresos ───────────────────────────────────────────────────
  async listCaja(tenantSlug: string, filtros: { desde?: string; hasta?: string; tipo?: string; metodo?: string } = {}) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);

    const cond: string[] = ['c.empresa_id = ?'];
    const vals: any[] = [empresaId];
    if (filtros.desde) { cond.push('c.fecha >= ?'); vals.push(filtros.desde + ' 00:00:00'); }
    if (filtros.hasta) { cond.push('c.fecha <= ?'); vals.push(filtros.hasta + ' 23:59:59'); }
    if (filtros.tipo)  { cond.push('c.tipo = ?');   vals.push(filtros.tipo); }

    let rows: any[];
    if (filtros.metodo) {
      // Filtro por método "de verdad": incluye también las ventas MIXTAS que tuvieron
      // ese método, mostrando SOLO la porción pagada con él (desde hc_venta_pagos).
      // - match directo (movs manuales y ventas de un solo método): c.metodo_pago = ?
      // - match por desglose (ventas mixtas que contienen ese método): via hc_venta_pagos
      // El monto y el método mostrados se ajustan a esa porción para que los totales cuadren.
      const m = filtros.metodo;
      const [r] = await pool().query<any[]>(
        `SELECT c.id, c.empresa_id, c.fecha, c.tipo, c.concepto, c.categoria, c.venta_id, c.user_crea_id,
                CONCAT(u.nombres, ' ', u.apellidos) AS usuario,
                CASE WHEN c.metodo_pago = ? THEN c.metodo_pago ELSE ? END AS metodo_pago,
                CASE WHEN c.metodo_pago = ? THEN c.monto ELSE COALESCE(vp.monto, 0) END AS monto
           FROM hc_caja_mov c
           LEFT JOIN usuarios u ON u.id = c.user_crea_id
           LEFT JOIN (
             SELECT venta_id, SUM(monto) AS monto
               FROM hc_venta_pagos
              WHERE empresa_id = ? AND metodo_pago = ?
              GROUP BY venta_id
           ) vp ON vp.venta_id = c.venta_id
          WHERE ${cond.join(' AND ')} AND (c.metodo_pago = ? OR vp.venta_id IS NOT NULL)
          ORDER BY c.fecha DESC, c.id DESC`,
        [m, m, m, empresaId, m, ...vals, m],
      );
      rows = r;
    } else {
      const [r] = await pool().query<any[]>(
        `SELECT c.*, CONCAT(u.nombres, ' ', u.apellidos) AS usuario
           FROM hc_caja_mov c
           LEFT JOIN usuarios u ON u.id = c.user_crea_id
          WHERE ${cond.join(' AND ')}
          ORDER BY c.fecha DESC, c.id DESC`,
        vals,
      );
      rows = r;
    }

    const ingresos = rows.filter(r => r.tipo === 'ingreso').reduce((s, r) => s + Number(r.monto), 0);
    const egresos  = rows.filter(r => r.tipo === 'egreso').reduce((s, r) => s + Number(r.monto), 0);
    return { movimientos: rows, resumen: { ingresos: +ingresos.toFixed(2), egresos: +egresos.toFixed(2), saldo: +(ingresos - egresos).toFixed(2) } };
  },

  async createCajaMov(tenantSlug: string, dto: CajaMovDto, userId?: number) {
    if (dto.tipo !== 'ingreso' && dto.tipo !== 'egreso') throw new AppError('Tipo inválido (ingreso|egreso)', 400);
    const monto = Number(dto.monto);
    if (!(monto > 0)) throw new AppError('El monto debe ser mayor a 0', 400);
    if (!dto.concepto?.trim()) throw new AppError('El concepto es requerido', 400);
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const fecha = fechaBD(dto.fecha);
    const [res] = await pool().query<any>(
      `INSERT INTO hc_caja_mov (empresa_id, fecha, tipo, monto, concepto, categoria, metodo_pago, user_crea_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, fecha, dto.tipo, monto, dto.concepto.trim(), dto.categoria || null, dto.metodo_pago || null, userId ?? null],
    );
    const [rows] = await pool().query<any[]>('SELECT * FROM hc_caja_mov WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  /** Borra un movimiento de caja MANUAL (los de venta se quitan al anular la venta). */
  async deleteCajaMov(tenantSlug: string, id: number) {
    await ensureFinanzas();
    const empresaId = await getEmpresaId(tenantSlug);
    const [res] = await pool().query<any>(
      'DELETE FROM hc_caja_mov WHERE empresa_id = ? AND id = ? AND venta_id IS NULL',
      [empresaId, id],
    );
    return res.affectedRows > 0;
  },
};
