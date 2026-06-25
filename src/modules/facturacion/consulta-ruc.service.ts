/**
 * Consulta de RUC contra SUNAT (vía apis.net.pe — dato PÚBLICO de SUNAT).
 * Devuelve la razón social + estado/condición para autocompletar y validar
 * antes de emitir una factura. El token (gratis) va en .env: RUC_API_TOKEN.
 * El DNI NO se consulta (RENIEC no es público; queda manual).
 */

export interface RucInfo {
  ruc: string;
  razonSocial: string;
  estado?: string;       // ACTIVO / BAJA / ...
  condicion?: string;    // HABIDO / NO HABIDO / ...
  direccion?: string;
}

/** Valida el formato del RUC peruano (11 dígitos, empieza 10/15/17/20). */
function rucValido(ruc: string): boolean {
  return /^(10|15|17|20)\d{9}$/.test(ruc);
}

/** Consulta un RUC en SUNAT. Lanza error legible si falla (la UI cae a manual). */
export async function consultarRuc(rucRaw: string): Promise<RucInfo> {
  const ruc = String(rucRaw ?? '').trim();
  if (!rucValido(ruc)) throw new Error('RUC inválido: deben ser 11 dígitos y empezar en 10, 15, 17 o 20.');

  const token = process.env.RUC_API_TOKEN?.trim();
  if (!token) throw new Error('Falta RUC_API_TOKEN en el .env (token gratis de apis.net.pe).');

  const base = process.env.RUC_API_URL?.trim() || 'https://api.apis.net.pe/v2/sunat/ruc';
  const res = await fetch(`${base}?numero=${ruc}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (res.status === 404) throw new Error('RUC no encontrado en SUNAT.');
  if (res.status === 401 || res.status === 403) throw new Error('Token de consulta RUC inválido o vencido.');
  if (res.status === 422) throw new Error('RUC inválido para SUNAT.');
  if (!res.ok) throw new Error(`No se pudo consultar el RUC (HTTP ${res.status}).`);

  const d = await res.json() as Record<string, any>;
  // Tolera distintos proveedores: decolecta (razon_social) / apis.net.pe (razonSocial|nombre).
  const razonSocial = (d.razon_social ?? d.razonSocial ?? d.nombre ?? '').toString().trim();
  if (!razonSocial) throw new Error('SUNAT no devolvió la razón social del RUC.');

  return {
    ruc,
    razonSocial,
    estado: (d.estado ?? '').toString().trim() || undefined,
    condicion: (d.condicion ?? '').toString().trim() || undefined,
    direccion: (d.direccion ?? '').toString().trim() || undefined,
  };
}
