export interface LoginDto {
  correo: string;
  contrasena: string;
  empresa: string;   // tenant_slug de la empresa
  producto?: string; // slug del producto al que intenta entrar (certificaciones, sistemas-vaxa, …)
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
  producto?: string; // slug del producto del que es esta sesión
  sid?: string;      // id de la sesión activa (sesión única por usuario)
  iat?: number;
  exp?: number;
}
