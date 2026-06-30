import type { Request, Response } from 'express';
import { loginService, AuthError } from './auth.service';
import type { LoginDto } from './auth.types';

export async function loginController(req: Request, res: Response): Promise<void> {
  const { correo, contrasena, empresa, producto } = (req.body ?? {}) as Partial<LoginDto>;

  console.log('[auth/login] body recibido:', { correo, empresa, producto, contrasena: contrasena ? '***' : '(vacío)' });

  if (!correo || !contrasena || !empresa) {
    res.status(400).json({
      error: 'correo, contrasena y empresa son requeridos',
      recibido: { correo: !!correo, contrasena: !!contrasena, empresa: !!empresa },
    });
    return;
  }

  try {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const result = await loginService({ correo, contrasena, empresa, producto }, ip);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[auth] loginController:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}
