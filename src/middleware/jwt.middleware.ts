import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../modules/auth/auth.types';
import { JWT_SECRET } from '../config/jwt.config';
import { getPool } from '../db/pool';

export interface RequestWithAuth extends Request {
  authUser: JwtPayload;
}

export async function jwtMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  // Sesión única POR PRODUCTO: el token solo es válido si su `sid` coincide con la
  // sesión activa guardada para ESE producto (usuario_producto.session_token). Si
  // el token no trae producto o la cuenta no tiene fila de producto, se usa el
  // modo legacy (usuarios.session_token). Si no hay BD (dev), se omite el chequeo.
  try {
    const pool = getPool();
    if (pool) {
      let activo: string | null | undefined;
      let encontrado = false;

      if (payload.producto) {
        try {
          const [rows] = await pool.execute<any[]>(
            `SELECT up.session_token FROM usuario_producto up
             JOIN productos p ON p.id = up.producto_id
             WHERE up.usuario_id = ? AND p.slug = ?`,
            [payload.sub, payload.producto],
          );
          if (rows.length) { activo = rows[0].session_token; encontrado = true; }
        } catch { /* migración pendiente → cae a legacy */ }
      }

      if (!encontrado) {
        const [rows] = await pool.execute<any[]>(
          'SELECT session_token FROM usuarios WHERE id = ?', [payload.sub],
        );
        activo = rows[0]?.session_token as string | null | undefined;
      }

      // Si hay una sesión activa registrada y el token no coincide → revocada.
      if (activo && activo !== payload.sid) {
        res.status(401).json({
          error: 'Tu sesión se cerró porque iniciaste sesión en otro dispositivo.',
          code: 'SESSION_REVOKED',
        });
        return;
      }
    }
  } catch (err) {
    console.error('[jwt] error verificando sesión única:', err);
    res.status(401).json({ error: 'No se pudo verificar la sesión' });
    return;
  }

  (req as RequestWithAuth).authUser = payload;
  next();
}
