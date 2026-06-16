import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/pool';
import type { LoginDto, LoginResponse, JwtPayload } from './auth.types';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../../config/jwt.config';

interface UsuarioRow {
  id: number;
  nombres: string;
  apellidos: string;
  correo: string;
  contrasena: string;
  rol_nombre: string;
  empresa_id: number;
  tenant_slug: string;
}

export async function loginService(dto: LoginDto): Promise<LoginResponse> {
  const pool = getPool();
  if (!pool) throw new Error('Base de datos no configurada');

  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.nombres, u.apellidos, u.correo, u.contrasena,
            r.nombre AS rol_nombre, u.empresa_id, e.tenant_slug
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     JOIN empresas e ON e.id = u.empresa_id
     WHERE u.correo = ? AND e.tenant_slug = ? AND u.activo = 1`,
    [dto.correo.toLowerCase().trim(), dto.empresa]
  );

  const usuario = rows[0] as UsuarioRow | undefined;

  if (!usuario) {
    throw new AuthError('Credenciales inválidas', 401);
  }

  const passwordValida = await bcrypt.compare(dto.contrasena, usuario.contrasena);
  if (!passwordValida) {
    throw new AuthError('Credenciales inválidas', 401);
  }

  // Sesión única: generamos un id de sesión nuevo y lo persistimos. Pisa el de
  // cualquier sesión anterior, de modo que el token del dispositivo previo deja
  // de coincidir y queda invalidado en su próxima petición.
  const sid = randomUUID();
  await pool.execute('UPDATE usuarios SET session_token = ? WHERE id = ?', [sid, usuario.id]);

  const payload: JwtPayload = {
    sub: usuario.id,
    empresa: usuario.tenant_slug,
    rol: usuario.rol_nombre,
    sid,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);

  return {
    token,
    usuario: {
      id: usuario.id,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      correo: usuario.correo,
      rol: usuario.rol_nombre,
      empresa: usuario.tenant_slug,
    },
  };
}

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'AuthError';
  }
}
