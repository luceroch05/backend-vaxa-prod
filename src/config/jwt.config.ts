/**
 * Configuración centralizada del JWT.
 *
 * En PRODUCCIÓN el secreto es obligatorio: si falta o es demasiado corto, el
 * backend NO arranca (fail-fast). Así evitamos el peligro de firmar tokens en
 * silencio con un secreto por defecto conocido, que permitiría a un atacante
 * fabricar tokens de cualquier usuario/empresa (incluido el tenant raíz).
 *
 * En desarrollo permitimos un secreto de respaldo, pero avisando en consola.
 */
const IS_PROD = process.env.NODE_ENV === 'production';
const MIN_LEN = 32;

const fromEnv = process.env.JWT_SECRET?.trim();

if (IS_PROD && (!fromEnv || fromEnv.length < MIN_LEN)) {
  throw new Error(
    `[config] JWT_SECRET no definido o demasiado corto (mínimo ${MIN_LEN} caracteres). ` +
    'El backend no arranca en producción sin un secreto válido.',
  );
}

if (!IS_PROD && (!fromEnv || fromEnv.length < MIN_LEN)) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] ⚠ JWT_SECRET ausente o corto: usando secreto de DESARROLLO. ' +
    'Nunca uses esto en producción.',
  );
}

export const JWT_SECRET: string = fromEnv && fromEnv.length >= MIN_LEN
  ? fromEnv
  : 'vaxa_secret_dev_only_not_for_production_use_32x';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '8h';
