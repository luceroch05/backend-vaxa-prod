import type { Response } from 'express';

/**
 * Error "de negocio": su mensaje está pensado para mostrarse al usuario
 * (validaciones, conflictos, no encontrado, etc.) y por tanto es seguro
 * enviarlo al cliente. Cualquier error que NO sea de este tipo y que parezca
 * de infraestructura se responde de forma genérica (ver `sendError`).
 *
 * Uso recomendado en código nuevo:
 *   throw new AppError('La razón social no puede estar vacía', 400);
 *   throw new AppError('Empresa no encontrada', 404);
 *   throw new AppError('SIN_CREDITOS: ...', 409, 'SIN_CREDITOS');
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Detecta errores de infraestructura/driver cuyo mensaje NUNCA debe llegar al
 * cliente porque filtra detalles internos (estructura SQL, host de BD, etc.).
 */
function isInfrastructureError(err: any): boolean {
  if (!err) return false;
  // Errores de mysql2: traen sqlMessage / sql / errno o un code tipo ER_*.
  if (err.sqlMessage || err.sql || typeof err.errno === 'number') return true;
  if (typeof err.code === 'string' &&
      /^(ER_|ECONN|ENOTFOUND|ETIMEDOUT|EPIPE|PROTOCOL_|HANDSHAKE|EAI_)/.test(err.code)) {
    return true;
  }
  // Mensajes internos conocidos (config de BD ausente, etc.).
  if (typeof err.message === 'string' &&
      /(no configurad|MySQL no configurado|JWT_SECRET)/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * Handler central de errores para los wrappers de rutas.
 * - `AppError` → status + mensaje (+ code) tal cual: pensado para el usuario.
 * - Error con `status` 4xx (p.ej. AuthError) → mensaje tal cual.
 * - Infra/SQL/desconocido → loguea el detalle interno y responde genérico.
 *
 * Siempre loguea internamente para no perder trazabilidad.
 */
export function sendError(res: Response, err: unknown, context: string): void {
  const e = err as any;

  // 1) Errores de negocio explícitos.
  if (e instanceof AppError) {
    const body: Record<string, unknown> = { error: e.message };
    if (e.code) body.code = e.code;
    res.status(e.status).json(body);
    return;
  }

  // 2) Errores con status 4xx deliberado (AuthError u otros).
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    const body: Record<string, unknown> = { error: e.message };
    if (typeof e.code === 'string') body.code = e.code;
    res.status(e.status).json(body);
    return;
  }

  // 3) Infraestructura/SQL o bugs de programación → NUNCA exponer el detalle.
  //    TypeError/RangeError/etc. son fallos de código, nunca validaciones de negocio.
  const isRuntimeBug =
    e instanceof TypeError || e instanceof RangeError ||
    e instanceof ReferenceError || e instanceof SyntaxError;
  if (isInfrastructureError(e) || isRuntimeBug) {
    console.error(`[${context}] error interno:`, e);
    res.status(500).json({ error: 'Error interno del servidor' });
    return;
  }

  // 4) Error de negocio lanzado como Error plano (validaciones existentes):
  //    el mensaje es seguro y la UI lo necesita. Se loguea igualmente y se
  //    responde 400 (en lugar del 500 anterior, que era semánticamente erróneo).
  //    Nota: si en el futuro se migran estos throws a AppError, este rama deja
  //    de usarse y los errores inesperados caerán en la rama (3)/genérica.
  if (e instanceof Error && typeof e.message === 'string') {
    console.error(`[${context}]`, e);
    res.status(400).json({ error: e.message });
    return;
  }

  // 5) Cualquier otra cosa.
  console.error(`[${context}] error no tipado:`, e);
  res.status(500).json({ error: 'Error interno del servidor' });
}
