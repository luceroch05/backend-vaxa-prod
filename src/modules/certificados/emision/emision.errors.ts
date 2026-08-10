/**
 * Certificado bloqueado por antigüedad para el rol ADMISION: pasadas 24 h desde
 * su emisión, un usuario ADMISION ya no puede eliminarlo — solo el ADMINISTRADOR
 * de la empresa (que no tiene ese límite). Evita que el personal operativo borre
 * certificados ya entregados; el administrador conserva el control total.
 */
export class CertBloqueadoError extends Error {
  constructor(
    msg = 'CERT_BLOQUEADO: Pasadas 24 horas de su emisión, solo el administrador de la empresa puede eliminar el certificado.',
  ) {
    super(msg);
    this.name = 'CertBloqueadoError';
  }
}

/** Horas tras la emisión en que el rol ADMISION deja de poder eliminar el certificado. */
export const HORAS_BLOQUEO_CERT = 24;
