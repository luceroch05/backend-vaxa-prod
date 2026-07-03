import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Almacenamiento de imágenes como ARCHIVO en el servidor (no base64 en la BD).
 *
 * `guardarImagen` recibe lo que manda el front (normalmente un data URL
 * `data:image/png;base64,...`), lo escribe como archivo bajo `/uploads/<sub>/` y
 * devuelve la RUTA pública (`/uploads/<sub>/<hash>.<ext>`) que se guarda en la BD.
 *
 * Es idempotente y tolerante:
 *  - Si `src` ya es una ruta/URL (`/uploads/...`, `http...`) → la devuelve igual.
 *  - Si `src` es vacío/null/undefined → lo devuelve igual (no rompe "quitar logo").
 *  - Si no logra parsear el data URL → devuelve `src` tal cual (fallback seguro).
 *
 * El PDF (`pdf.service.ts`) y los <img> del front soportan tanto ruta como base64,
 * así que la migración es gradual y sin romper lo existente.
 */

/** Carpeta física de subidas (coincide con express.static de index.ts). */
export const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const EXT_POR_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

/** ¿El valor es un data URL base64 de imagen? */
function esDataUrl(src: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(src);
}

/**
 * Guarda `src` como archivo si es un data URL; si ya es ruta/URL o está vacío, lo
 * devuelve sin tocar. `subcarpeta` agrupa por tipo: 'empresas' | 'logos' | 'firmas' | 'config'.
 */
export function guardarImagen(src: string | null | undefined, subcarpeta: string): string | null | undefined {
  if (!src || typeof src !== 'string') return src;
  if (!esDataUrl(src)) return src;   // ya es ruta/URL http o /uploads → no se toca

  const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return src;            // no se pudo parsear → fallback: deja el original
  const mime = match[1].toLowerCase();
  const ext = EXT_POR_MIME[mime] ?? 'png';
  let buffer: Buffer;
  try { buffer = Buffer.from(match[2], 'base64'); } catch { return src; }
  if (!buffer.length) return src;

  // Nombre por contenido (hash) → evita duplicados y es estable.
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 24);
  const dir = path.join(UPLOADS_DIR, subcarpeta);
  fs.mkdirSync(dir, { recursive: true });
  const nombre = `${hash}.${ext}`;
  const absoluta = path.join(dir, nombre);
  if (!fs.existsSync(absoluta)) fs.writeFileSync(absoluta, buffer);

  // Ruta pública (relativa) que se guarda en la BD y sirve express.static.
  return `/uploads/${subcarpeta}/${nombre}`;
}
