import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/pool';
import { revokeOtherSessions } from '../../realtime/session-socket';
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
  empresa_activa: number;
}

export async function loginService(dto: LoginDto): Promise<LoginResponse> {
  const pool = getPool();
  if (!pool) throw new Error('Base de datos no configurada');

  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.nombres, u.apellidos, u.correo, u.contrasena,
            r.nombre AS rol_nombre, u.empresa_id, e.tenant_slug, e.activo AS empresa_activa
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

  // Empresa desactivada: NO puede entrar a gestionar sus certificados (la
  // validación pública de certificados sí sigue funcionando, en otra ruta).
  // Se valida tras la contraseña para no revelar el estado de la empresa
  // a quien no tiene credenciales correctas.
  if (!usuario.empresa_activa) {
    throw new AuthError('Esta empresa está desactivada. Contacta con Vaxa para reactivarla.', 403);
  }

  // Multi-producto: el acceso se valida POR USUARIO y POR PRODUCTO. El mismo
  // correo puede tener acceso a varios productos (filas en `usuario_producto`),
  // pero a CADA producto se entra solo si tiene su fila para ese producto. Así un
  // usuario creado para el certificado de un cliente NO entra a sistemas-vaxa.
  // El rol que vale es el que tiene EN ese producto.
  //
  // Reglas:
  //  · Tiene fila para el producto         -> entra, con su rol de ahí.
  //  · No la tiene pero sí otras            -> está acotado a otros productos -> 403.
  //  · No tiene ninguna fila (cuenta vieja) -> fallback a nivel empresa (legacy).
  // Tolerante: si las tablas aún no existen (migración pendiente), no bloquea.
  let rolEfectivo = usuario.rol_nombre;
  // ¿La sesión única se maneja a nivel de producto? (true si el usuario tiene su
  // fila en usuario_producto para este producto). Si no, se usa el modo legacy
  // por usuario en la tabla `usuarios`.
  let sesionPorProducto = false;
  if (dto.producto) {
    try {
      const [acceso] = await pool.execute<any[]>(
        `SELECT r.nombre AS rol_nombre
         FROM usuario_producto up
         JOIN productos p ON p.id = up.producto_id
         JOIN roles r     ON r.id = up.rol_id
         WHERE up.usuario_id = ? AND p.slug = ? AND up.activo = 1 AND p.activo = 1`,
        [usuario.id, dto.producto],
      );

      if (acceso.length) {
        rolEfectivo = acceso[0].rol_nombre;   // tiene acceso explícito a este producto
        sesionPorProducto = true;
      } else {
        const [otros] = await pool.execute<any[]>(
          'SELECT 1 FROM usuario_producto WHERE usuario_id = ? AND activo = 1 LIMIT 1',
          [usuario.id],
        );
        if ((otros as any[]).length) {
          // Está acotado a otros productos, no a éste.
          throw new AuthError('No tienes acceso a este producto', 403);
        }
        // Cuenta sin productos asignados (legacy): permitir si la empresa lo tiene.
        const [emp] = await pool.execute<any[]>(
          `SELECT 1 FROM empresa_producto ep JOIN productos p ON p.id = ep.producto_id
           WHERE ep.empresa_id = ? AND p.slug = ? AND ep.activo = 1 AND p.activo = 1 LIMIT 1`,
          [usuario.empresa_id, dto.producto],
        );
        if (!(emp as any[]).length) {
          throw new AuthError('No tienes acceso a este producto', 403);
        }
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      // ER_NO_SUCH_TABLE u otro problema de esquema → migración pendiente: no bloquear.
      console.warn('[auth] validación de producto omitida (¿migración pendiente?):', (err as Error).message);
    }
  }

  // Sesión única POR PRODUCTO: generamos un id de sesión y lo guardamos en la
  // fila del producto (usuario_producto). Así entrar al MISMO producto desde otro
  // dispositivo invalida el anterior, pero entrar a OTRO producto con la misma
  // cuenta NO afecta esta sesión (los diferencia el producto).
  // Si la cuenta no tiene fila de producto (legacy), se usa usuarios.session_token.
  const sid = randomUUID();
  if (sesionPorProducto && dto.producto) {
    await pool.execute(
      `UPDATE usuario_producto up JOIN productos p ON p.id = up.producto_id
       SET up.session_token = ? WHERE up.usuario_id = ? AND p.slug = ?`,
      [sid, usuario.id, dto.producto],
    );
  } else {
    await pool.execute('UPDATE usuarios SET session_token = ? WHERE id = ?', [sid, usuario.id]);
  }

  // Cierre en tiempo real, acotado al mismo producto (null = legacy, afecta todo).
  revokeOtherSessions(usuario.id, sesionPorProducto ? dto.producto! : null, sid);

  const payload: JwtPayload = {
    sub: usuario.id,
    empresa: usuario.tenant_slug,
    rol: rolEfectivo,
    producto: dto.producto,
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
      rol: rolEfectivo,
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
