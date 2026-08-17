import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AppError } from './errors';
import { UPLOADS_DIR } from './imagenes';

/**
 * Guardado de ARCHIVOS ADJUNTOS (evidencia de reclamos) como binario en el
 * servidor — NO base64 en la BD. El front sube el archivo crudo (binario) y aquí
 * se escribe bajo `/uploads/reclamos/` devolviendo la ruta pública que va a la BD.
 *
 * Tipos permitidos: PDF, imágenes (png/jpg/webp) y Word (doc/docx).
 */

/** Extensiones permitidas por MIME (allowlist: nada fuera de esto se guarda). */
const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Tamaño máximo por archivo (bytes). */
export const ADJUNTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const SUBCARPETA = 'reclamos';

export interface AdjuntoGuardado {
  ruta: string;      // /uploads/reclamos/<hash>.<ext>
  nombre: string;    // nombre original saneado
  mime: string;
  tamano: number;    // bytes
}

/** Limpia el nombre original (sin rutas ni caracteres raros) para mostrarlo/descargarlo. */
function sanitizarNombre(nombre: string, ext: string): string {
  const base = String(nombre || `archivo.${ext}`).replace(/[/\\]/g, '').replace(/[^\w.\- ()]/g, '').trim();
  return (base || `archivo.${ext}`).slice(0, 200);
}

/** Escribe el buffer como archivo adjunto y devuelve su metadata. Valida MIME y tamaño.
 *  `subcarpeta` permite reutilizar el mismo guardado en otros módulos (p. ej. 'hc'
 *  para historias clínicas); por defecto usa la de reclamos. */
export function guardarAdjunto(buffer: Buffer, mime: string, nombreOriginal: string, subcarpeta: string = SUBCARPETA): AdjuntoGuardado {
  const tipo = String(mime || '').toLowerCase().split(';')[0].trim();
  const ext = EXT_POR_MIME[tipo];
  if (!ext) throw new AppError('Tipo de archivo no permitido. Adjunta PDF, imagen (JPG/PNG) o Word.', 400);
  if (!buffer?.length) throw new AppError('El archivo está vacío.', 400);
  if (buffer.length > ADJUNTO_MAX_BYTES) throw new AppError('El archivo supera el máximo de 10 MB.', 400);

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 24);
  const dir = path.join(UPLOADS_DIR, subcarpeta);
  fs.mkdirSync(dir, { recursive: true });
  const archivo = `${hash}.${ext}`;
  const absoluta = path.join(dir, archivo);
  if (!fs.existsSync(absoluta)) fs.writeFileSync(absoluta, buffer);

  return {
    ruta: `/uploads/${subcarpeta}/${archivo}`,
    nombre: sanitizarNombre(nombreOriginal, ext),
    mime: tipo,
    tamano: buffer.length,
  };
}

/**
 * Valida que una ruta recibida del cliente sea un adjunto legítimo ya subido
 * (formato correcto + el archivo existe en disco). Evita que el POST de creación
 * inyecte rutas arbitrarias.
 */
export function esRutaAdjuntoValida(ruta: string, subcarpeta: string = SUBCARPETA): boolean {
  const re = new RegExp(`^/uploads/${subcarpeta}/[a-f0-9]{24}\\.(pdf|png|jpg|webp|doc|docx)$`);
  if (!re.test(ruta || '')) return false;
  return fs.existsSync(path.join(process.cwd(), ruta.replace(/^\//, '')));
}
