export interface LoginDto {
  correo: string;
  contrasena: string;
  empresa: string; // tenant_slug de la empresa
}

export interface LoginResponse {
  token: string;
  usuario: {
    id: number;
    nombres: string;
    apellidos: string;
    correo: string;
    rol: string;
    empresa: string;
  };
}

export interface JwtPayload {
  sub: number;       // usuario.id
  empresa: string;   // tenant_slug
  rol: string;
  sid?: string;      // id de la sesión activa (sesión única por usuario)
  iat?: number;
  exp?: number;
}
