import fs from 'fs';
import path from 'path';

/**
 * Logo de Vaxa para la representación impresa (PDF) de comprobantes y cotizaciones.
 *
 * Se carga desde una URL http configurable en `LOGO_COMPROBANTE_URL` (el logo lo
 * sirve el frontend público, que ya está desplegado). Se descarga una sola vez y se
 * cachea en memoria como Buffer, porque pdfkit `doc.image()` acepta un Buffer.
 *
 * Fallback: si no hay URL o la descarga falla, intenta el archivo local
 * `uploads/marca/vaxa-comprobante.png`. Si tampoco existe, devuelve `null` y el
 * encabezado del PDF simplemente cae al texto (no revienta).
 */
const LOGO_URL = process.env.LOGO_COMPROBANTE_URL || 'https://sistemas.vaxa.pe/vaxa-comprobante.png';

const CANDIDATOS_LOCALES = [
  path.join(process.cwd(), 'uploads', 'marca', 'vaxa-comprobante.png'),
  path.join(__dirname, '..', '..', 'uploads', 'marca', 'vaxa-comprobante.png'),
];

/** Proporción del logo (ancho/alto) para calcular la altura al fijar un ancho. */
export const LOGO_RATIO = 500 / 145;

// `undefined` = aún no resuelto; `null` = resuelto pero sin logo disponible.
let cache: Buffer | null | undefined;

function leerLocal(): Buffer | null {
  for (const ruta of CANDIDATOS_LOCALES) {
    try {
      if (fs.existsSync(ruta)) return fs.readFileSync(ruta);
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

/** Buffer del logo de Vaxa (URL http con caché; fallback a archivo local), o `null`. */
export async function logoVaxa(): Promise<Buffer | null> {
  if (cache !== undefined) return cache;

  if (LOGO_URL) {
    try {
      const res = await fetch(LOGO_URL);
      if (res.ok) {
        cache = Buffer.from(await res.arrayBuffer());
        return cache;
      }
    } catch {
      /* cae al fallback local */
    }
  }

  cache = leerLocal();
  return cache;
}
