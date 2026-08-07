/**
 * Repositorio del Libro de Reclamaciones Virtual de Vaxa (formato INDECOPI).
 *
 * - `crear` lo llama el formulario PÚBLICO (cualquier consumidor). Reserva el
 *   correlativo anual de forma atómica (LR-2026-0001) y calcula la fecha límite
 *   de respuesta (+15 días hábiles).
 * - `list` / `getById` / `getByNumero` / `responder` / `cambiarEstado` los usa el
 *   panel ADMIN de Vaxa (tenant raíz).
 */
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../certificados/shared/db.helper';
import { AppError } from '../../shared/errors';
import {
  Reclamo, ReclamoEntity, NuevoReclamoInput, ResponderInput,
  ReclamoHito, ReclamoConsulta, ReclamoAdjunto,
  TIPO_ID, BIEN_TIPO_ID, ESTADO, DOCS_CONSUMIDOR, sumarDiasHabiles, fechaYMD, fechaHora,
} from './reclamo.entity';
import { esRutaAdjuntoValida } from '../../shared/archivos';

/**
 * Registra un hito en la línea de tiempo del reclamo. Best-effort: si la tabla
 * `reclamo_historial` aún no existe (migración pendiente) NO rompe la acción
 * principal (crear/responder/cambiar estado); solo deja un aviso en el log.
 */
async function registrarHistorial(
  db: { query: Function }, reclamoId: number, estadoId: number, nota: string | null, by: number | null,
): Promise<void> {
  try {
    await db.query(
      'INSERT INTO reclamo_historial (reclamo_id, estado_id, nota, user_crea_id) VALUES (?, ?, ?, ?)',
      [reclamoId, estadoId, nota, by],
    );
  } catch (e) {
    console.warn('[reclamos] no se pudo registrar el historial (¿falta correr la migración reclamo_historial?):', (e as Error).message);
  }
}

/** Plazo legal de respuesta del proveedor: 15 días hábiles improrrogables. */
const PLAZO_DIAS_HABILES = 15;

/** Nota por defecto de cada estado, para que la línea de tiempo sea legible. */
const ETIQUETA_ESTADO: Record<number, string> = {
  [ESTADO.PENDIENTE]:  'Reclamo recibido, pendiente de atención.',
  [ESTADO.EN_PROCESO]: 'El proveedor está atendiendo el reclamo.',
  [ESTADO.ATENDIDO]:   'El proveedor comunicó su respuesta.',
  [ESTADO.CERRADO]:    'El reclamo fue cerrado.',
};

/** SELECT base con los nombres de catálogo resueltos. */
const SELECT_BASE = `
  SELECT r.*,
         t.codigo  AS tipo,       t.nombre AS tipo_nombre,
         b.codigo  AS bien_tipo,  b.nombre AS bien_tipo_nombre,
         e.codigo  AS estado,     e.nombre AS estado_nombre
    FROM reclamos r
    JOIN reclamo_tipo      t ON t.id = r.tipo_id
    JOIN reclamo_bien_tipo b ON b.id = r.bien_tipo_id
    JOIN reclamo_estado    e ON e.id = r.estado_id`;

/** Reserva el siguiente número anual (LR-2026-0001) de forma atómica. */
async function siguienteNumero(conn: PoolConnection): Promise<string> {
  const anio = new Date().getFullYear();
  await conn.query(
    `INSERT INTO reclamo_series (anio, correlativo) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE correlativo = correlativo + 1`,
    [anio],
  );
  const [rows] = await conn.query<any[]>('SELECT correlativo FROM reclamo_series WHERE anio = ?', [anio]);
  const corr = Number(rows[0]?.correlativo ?? 1);
  return `LR-${anio}-${String(corr).padStart(4, '0')}`;
}

const limpio = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export const reclamoRepo = {
  /** Registra un reclamo/queja desde el formulario público. */
  async crear(input: NuevoReclamoInput): Promise<Reclamo> {
    const c = input.consumidor ?? ({} as NuevoReclamoInput['consumidor']);
    const b = input.bien ?? ({} as NuevoReclamoInput['bien']);
    const rc = input.reclamacion ?? ({} as NuevoReclamoInput['reclamacion']);

    // ── Validaciones (mensajes pensados para el consumidor) ──
    const nombre = limpio(c.nombre, 150);
    if (!nombre) throw new AppError('Ingresa tu nombre completo.', 400);

    const tipoDoc = String(c.tipoDoc || '1');
    if (!DOCS_CONSUMIDOR.includes(tipoDoc as any)) {
      throw new AppError('Tipo de documento inválido. Usa DNI, Carné de Extranjería o Pasaporte.', 400);
    }
    const numDoc = limpio(c.numDoc, 20);
    if (!numDoc) throw new AppError('Ingresa tu número de documento.', 400);

    const bienTipoId = BIEN_TIPO_ID[String(b.tipo || '').toUpperCase()];
    if (!bienTipoId) throw new AppError('Indica si tu reclamo es sobre un Producto o un Servicio.', 400);

    const tipoId = TIPO_ID[String(rc.tipo || '').toUpperCase()];
    if (!tipoId) throw new AppError('Indica si es un Reclamo o una Queja.', 400);

    const detalle = limpio(rc.detalle, 5000);
    if (!detalle) throw new AppError('Describe el detalle de tu reclamo o queja.', 400);
    const pedido = limpio(rc.pedido, 5000);
    if (!pedido) throw new AppError('Indica tu pedido concreto.', 400);

    const esMenor = !!c.esMenor;
    let apoderadoNombre: string | null = null;
    let apoderadoNumDoc: string | null = null;
    if (esMenor) {
      apoderadoNombre = limpio(c.apoderadoNombre, 150);
      apoderadoNumDoc = limpio(c.apoderadoNumDoc, 20);
      if (!apoderadoNombre) throw new AppError('Al ser menor de edad, ingresa el nombre del padre, madre o apoderado.', 400);
    }

    let bienMonto: number | null = null;
    if (b.monto != null && String(b.monto).trim() !== '') {
      const m = Number(b.monto);
      if (!Number.isFinite(m) || m < 0) throw new AppError('El monto reclamado no es válido.', 400);
      bienMonto = Math.round(m * 100) / 100;
    }

    const email = limpio(c.email, 120);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError('El correo electrónico no tiene un formato válido.', 400);
    }

    const fechaLimite = fechaYMD(sumarDiasHabiles(new Date(), PLAZO_DIAS_HABILES));

    const conn = await pool().getConnection();
    let id = 0;
    try {
      await conn.beginTransaction();
      const numero = await siguienteNumero(conn);
      const [ins] = await conn.query<any>(
        `INSERT INTO reclamos
           (numero, consumidor_nombre, consumidor_tipo_doc, consumidor_num_doc,
            consumidor_domicilio, consumidor_telefono, consumidor_email,
            es_menor, apoderado_nombre, apoderado_num_doc,
            bien_tipo_id, bien_monto, bien_descripcion,
            tipo_id, detalle, pedido,
            estado_id, fecha_limite, ip_registro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          numero, nombre, tipoDoc, numDoc,
          limpio(c.domicilio, 255), limpio(c.telefono, 30), email,
          esMenor ? 1 : 0, apoderadoNombre, apoderadoNumDoc,
          bienTipoId, bienMonto, limpio(b.descripcion, 500),
          tipoId, detalle, pedido,
          ESTADO.PENDIENTE, fechaLimite, limpio(input.ip, 45),
        ],
      );
      id = ins.insertId;
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Primer hito de la línea de tiempo (fuera de la tx: no debe tumbar el registro).
    await registrarHistorial(pool(), id, ESTADO.PENDIENTE, 'Reclamo registrado por el consumidor.', null);

    // Adjuntos: los archivos ya se subieron al servidor; aquí solo se guardan sus
    // rutas (validadas). Best-effort: un adjunto inválido no tumba el registro.
    for (const a of input.adjuntos ?? []) {
      try {
        if (!a?.ruta || !esRutaAdjuntoValida(a.ruta)) continue;
        await pool().query(
          'INSERT INTO reclamo_adjunto (reclamo_id, nombre, ruta, mime, tamano) VALUES (?, ?, ?, ?, ?)',
          [id, String(a.nombre ?? 'archivo').slice(0, 255), a.ruta, String(a.mime ?? '').slice(0, 100), Number(a.tamano) || 0],
        );
      } catch (e) {
        console.warn('[reclamos] no se pudo guardar un adjunto (¿falta la migración reclamo_adjunto?):', (e as Error).message);
      }
    }

    const rec = await this.getById(id);
    if (!rec) throw new AppError('No se pudo leer el reclamo recién creado.', 500);
    return rec;
  },

  /** Lista de reclamos (más recientes primero), opcionalmente filtrada por estado. */
  async list(opts: { estadoId?: number; limit?: number } = {}): Promise<Reclamo[]> {
    const where = opts.estadoId ? ' WHERE r.estado_id = ?' : '';
    const params: any[] = opts.estadoId ? [opts.estadoId] : [];
    params.push(Math.min(Number(opts.limit) || 300, 1000));
    const [rows] = await pool().query<any[]>(
      `${SELECT_BASE}${where} ORDER BY r.id DESC LIMIT ?`, params,
    );
    return rows.map(ReclamoEntity.fromRow);
  },

  /** Un reclamo por id (admin), con sus adjuntos. */
  async getById(id: number): Promise<Reclamo | null> {
    const [rows] = await pool().query<any[]>(`${SELECT_BASE} WHERE r.id = ? LIMIT 1`, [id]);
    if (!rows.length) return null;
    return { ...ReclamoEntity.fromRow(rows[0]), adjuntos: await this.getAdjuntos(id) };
  },

  /** Adjuntos (evidencia) de un reclamo. Best-effort si falta la migración. */
  async getAdjuntos(reclamoId: number): Promise<ReclamoAdjunto[]> {
    try {
      const [rows] = await pool().query<any[]>(
        'SELECT nombre, ruta, mime, tamano FROM reclamo_adjunto WHERE reclamo_id = ? ORDER BY id ASC',
        [reclamoId],
      );
      return rows.map((a) => ({ nombre: a.nombre, ruta: a.ruta, mime: a.mime, tamano: Number(a.tamano) || 0 }));
    } catch (e) {
      console.warn('[reclamos] no se pudieron leer los adjuntos (¿falta la migración?):', (e as Error).message);
      return [];
    }
  },

  /** Un reclamo por su número público LR-YYYY-NNNN (descarga de la hoja). */
  async getByNumero(numero: string): Promise<Reclamo | null> {
    const [rows] = await pool().query<any[]>(`${SELECT_BASE} WHERE r.numero = ? LIMIT 1`, [numero]);
    return rows.length ? ReclamoEntity.fromRow(rows[0]) : null;
  },

  /** Registra la respuesta/acciones del proveedor y marca el reclamo atendido. */
  async responder(id: number, input: ResponderInput): Promise<Reclamo> {
    const respuesta = limpio(input.respuesta, 5000);
    if (!respuesta) throw new AppError('Escribe la respuesta o las acciones adoptadas.', 400);
    const estadoId = input.estadoId && [ESTADO.EN_PROCESO, ESTADO.ATENDIDO, ESTADO.CERRADO].includes(input.estadoId as any)
      ? input.estadoId
      : ESTADO.ATENDIDO;

    const [res] = await pool().query<any>(
      `UPDATE reclamos
          SET respuesta = ?, estado_id = ?, respondido_at = NOW(), user_actua_id = ?
        WHERE id = ?`,
      [respuesta, estadoId, input.respondidoBy ?? null, id],
    );
    if (!res.affectedRows) throw new AppError('Reclamo no encontrado.', 404);
    await registrarHistorial(pool(), id, estadoId, 'El proveedor comunicó su respuesta.', input.respondidoBy ?? null);
    const rec = await this.getById(id);
    if (!rec) throw new AppError('Reclamo no encontrado.', 404);
    return rec;
  },

  /** Cambia solo el estado de atención (PENDIENTE/EN_PROCESO/ATENDIDO/CERRADO). */
  async cambiarEstado(id: number, estadoId: number, nota?: string, by?: number): Promise<Reclamo> {
    if (![ESTADO.PENDIENTE, ESTADO.EN_PROCESO, ESTADO.ATENDIDO, ESTADO.CERRADO].includes(estadoId as any)) {
      throw new AppError('Estado inválido.', 400);
    }
    const [res] = await pool().query<any>('UPDATE reclamos SET estado_id = ?, user_actua_id = ? WHERE id = ?', [estadoId, by ?? null, id]);
    if (!res.affectedRows) throw new AppError('Reclamo no encontrado.', 404);
    const notaHito = (nota && nota.trim()) || ETIQUETA_ESTADO[estadoId] || 'El proveedor actualizó el estado del reclamo.';
    await registrarHistorial(pool(), id, estadoId, notaHito, by ?? null);
    const rec = await this.getById(id);
    if (!rec) throw new AppError('Reclamo no encontrado.', 404);
    return rec;
  },

  /** Línea de tiempo (hitos) de un reclamo, del más antiguo al más reciente. Best-effort. */
  async getHistorial(reclamoId: number): Promise<ReclamoHito[]> {
    try {
      const [rows] = await pool().query<any[]>(
        `SELECT h.nota, h.created_at, e.codigo AS estado, e.nombre AS estado_nombre
           FROM reclamo_historial h
           JOIN reclamo_estado e ON e.id = h.estado_id
          WHERE h.reclamo_id = ? ORDER BY h.id ASC`,
        [reclamoId],
      );
      return rows.map((h) => ({
        estado: h.estado, estado_nombre: h.estado_nombre,
        nota: h.nota ?? null, fecha: fechaHora(h.created_at),
      }));
    } catch (e) {
      console.warn('[reclamos] no se pudo leer el historial (¿falta la migración?):', (e as Error).message);
      return [];
    }
  },

  /**
   * Seguimiento PÚBLICO: el consumidor consulta su reclamo con el número + su
   * documento (que debe coincidir, por privacidad). Devuelve datos mínimos + la
   * línea de tiempo y la respuesta del proveedor.
   */
  async consultaPublica(numero: string, doc: string): Promise<ReclamoConsulta> {
    const num = String(numero || '').trim();
    const docLimpio = String(doc || '').trim();
    if (!num || !docLimpio) throw new AppError('Ingresa el número de reclamo y tu documento.', 400);

    const [rows] = await pool().query<any[]>(`${SELECT_BASE} WHERE r.numero = ? LIMIT 1`, [num]);
    if (!rows.length) throw new AppError('No encontramos un reclamo con ese número.', 404);
    const rec = ReclamoEntity.fromRow(rows[0]);

    // Privacidad: el documento debe coincidir con el del reclamante.
    if (docLimpio !== rec.consumidor_num_doc) {
      throw new AppError('El número de documento no coincide con el reclamo.', 403);
    }

    // Línea de tiempo: la real del historial; si está vacía (reclamos previos a la
    // migración), se reconstruye con las fechas de registro y respuesta.
    let historial = await this.getHistorial(rec.id);
    if (!historial.length) {
      historial = [{ estado: 'PENDIENTE', estado_nombre: 'Pendiente', nota: 'Reclamo registrado por el consumidor.', fecha: rec.created_at }];
      if (rec.respondido_at) {
        historial.push({ estado: rec.estado, estado_nombre: rec.estado_nombre, nota: 'El proveedor comunicó su respuesta.', fecha: rec.respondido_at });
      }
    }

    return {
      numero:           rec.numero,
      tipo_nombre:      rec.tipo_nombre,
      bien_tipo_nombre: rec.bien_tipo_nombre,
      estado:           rec.estado,
      estado_nombre:    rec.estado_nombre,
      created_at:       rec.created_at,
      fecha_limite:     rec.fecha_limite,
      respondido_at:    rec.respondido_at,
      respuesta:        rec.respuesta,
      historial,
      adjuntos:         await this.getAdjuntos(rec.id),
    };
  },
};
