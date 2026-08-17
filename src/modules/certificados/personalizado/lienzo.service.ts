/* ────────────────────────────────────────────────────────────────
 * Modo "Diseño Personalizado (Lienzo)"
 *
 * Módulo AISLADO del motor por defecto (pdf.service). Cuando una empresa
 * contrata un diseño a medida (ej. el arte de FAP), el fondo entregado por
 * el cliente se dibuja a sangre completa y ENCIMA solo se estampan los
 * campos dinámicos (nombre, calidad, fecha, evento, QR) en las coordenadas
 * que el admin definió.
 *
 * pdf.service NO conoce esta lógica: solo pregunta `layoutActivo()` y, si es
 * así, delega en `pintarLienzo()`. Todo lo específico del diseño a medida
 * vive acá; el motor normal queda intacto.
 *
 * Las coordenadas se guardan en el mismo viewport que la vista previa del
 * frontend (1122×794 px). El contexto `ctx.PX` las convierte a puntos PDF.
 * ──────────────────────────────────────────────────────────────── */

import * as fs from 'fs';
import * as path from 'path';
import type { PdfDatos } from '../pdf/pdf.service'; // type-only: se borra al compilar (sin ciclo runtime)

/* ── Forma del layout guardado (JSON en configuraciones_certificado) ── */
export interface CampoTexto {
  on?:        boolean;
  /** Plantilla con variables: {nombre} {programa} {fecha} {horas} {creditos} {codigo}… */
  text?:      string;
  x?:         number;   // px (borde izquierdo de la caja)
  y?:         number;   // px (borde superior)
  w?:         number;   // px (ancho de la caja; el align actúa dentro)
  size?:      number;   // px
  color?:     string;   // #hex
  align?:     'left' | 'center' | 'right';
  bold?:      boolean;
  italic?:    boolean;
  uppercase?: boolean;
  font?:      'sans' | 'serif' | 'bebas' | 'barlow';
  weight?:    400 | 500 | 600 | 700 | 800;
  tracking?:  number;
  autoFit?:   boolean;
}

export interface CampoQR {
  on?:         boolean;
  x?:          number;  // px
  y?:          number;  // px
  size?:       number;  // px (lado del cuadrado)
  showCodigo?: boolean; // imprime el código único bajo el QR
}

/** Slot de logo: la imagen sale de datos.logos por orden (logo1→[0], logo2→[1]…). */
export interface CampoLogo {
  on?:   boolean;
  x?:    number;  // px
  y?:    number;  // px
  size?: number;  // px (lado de la caja; imagen "contain")
}

/** Slot de firma: jala datos.firmas por orden y dibuja imagen + línea + nombre + cargo. */
export interface CampoFirma {
  on?: boolean;
  x?:  number;  // px
  y?:  number;  // px
  w?:  number;  // px (ancho del bloque)
  h?:  number;  // px (alto de la imagen de la firma)
}

/** Línea decorativa horizontal. */
export interface CampoLinea {
  on?:        boolean;
  x?:         number;
  y?:         number;
  w?:         number;
  thickness?: number;
  color?:     string;
}

export interface LayoutLienzo {
  activo?: boolean;
  /** Campos por clave. La clave `qr` es el QR; el resto son campos de texto. */
  campos?: Record<string, CampoTexto | CampoQR>;
}

/** Dependencias que inyecta pdf.service para no acoplar este módulo al motor. */
export interface LienzoCtx {
  W: number;
  H: number;
  PX: number;
  imagenABuffer: (src: string | null | undefined) => { data: Buffer; type: string } | null;
}

/* ── Parseo seguro ──────────────────────────────────────────── */
export function parseLayout(raw?: string | null): LayoutLienzo | null {
  if (!raw) return null;
  try {
    const l = JSON.parse(raw);
    return l && typeof l === 'object' ? (l as LayoutLienzo) : null;
  } catch {
    return null;
  }
}

/** true si la empresa tiene un diseño a medida activo → usar el lienzo. */
export function layoutActivo(raw?: string | null): boolean {
  const l = parseLayout(raw);
  return !!(l && l.activo && l.campos && Object.keys(l.campos).length > 0);
}

/* ── Helpers de dibujo ──────────────────────────────────────── */
/* ── Montserrat (fuente de marca del lienzo) ─────────────────────
   Se registra en el PDFDocument si los .ttf están disponibles. Si no,
   el sans cae a Helvetica (built-in) sin romper nada. */
const ASSET_DIRS = [
  path.join(process.cwd(), 'assets', 'fonts'),                        // <raíz>/assets/fonts (dev y prod si subes assets/)
  path.join(__dirname, '..', '..', '..', '..', 'assets', 'fonts'),   // <raíz>/assets/fonts vía __dirname
  path.join(__dirname, '..', '..', '..', 'assets', 'fonts'),         // dist/assets/fonts (postbuild copia assets → dist; así viajan con el dist)
];
function fontFile(sub: string, file: string): string | null {
  for (const base of ASSET_DIRS) {
    const p = path.join(base, sub, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Fuentes disponibles tras registrarlas en el doc. */
interface FuentesReg {
  montserrat: boolean; medium: boolean; semibold: boolean; bebas: boolean; barlow: boolean;
  poppins: boolean; poppinsMed: boolean; poppinsSemi: boolean; poppinsBold: boolean;
  greatvibes: boolean; cardo: boolean; cardoBold: boolean; lobster: boolean;
  pacifico: boolean; sacramento: boolean; allura: boolean; alexbrush: boolean;
  tangerine: boolean; tangerineBold: boolean; parisienne: boolean;
  cinzel: boolean; cinzelBold: boolean; abril: boolean; crimson: boolean; crimsonBold: boolean;
}

/** Registra las fuentes de marca en el doc. Devuelve cuáles quedaron disponibles. */
function registrarFuentes(doc: any): FuentesReg {
  const reg = (name: string, sub: string, file: string): boolean => {
    const p = fontFile(sub, file);
    if (!p) return false;
    try { doc.registerFont(name, p); return true; }
    catch (e) { console.warn(`[lienzo] No se pudo registrar ${name}:`, (e as Error).message); return false; }
  };
  const montserrat =
    reg('Montserrat',            'montserrat', 'Montserrat-Regular.ttf') &&
    reg('Montserrat-Bold',       'montserrat', 'Montserrat-Bold.ttf') &&
    reg('Montserrat-Italic',     'montserrat', 'Montserrat-Italic.ttf') &&
    reg('Montserrat-BoldItalic', 'montserrat', 'Montserrat-BoldItalic.ttf');
  const medium   = reg('Montserrat-Medium',   'montserrat', 'Montserrat-Medium.ttf');
  const semibold = reg('Montserrat-SemiBold', 'montserrat', 'Montserrat-SemiBold.ttf');
  const bebas    = reg('BebasNeue', 'bebasneue', 'BebasNeue-Regular.ttf');
  const barlow =
    reg('Barlow',           'barlowcondensed', 'BarlowCondensed-Regular.ttf') &&
    reg('Barlow-SemiBold',  'barlowcondensed', 'BarlowCondensed-SemiBold.ttf') &&
    reg('Barlow-Bold',      'barlowcondensed', 'BarlowCondensed-Bold.ttf') &&
    reg('Barlow-ExtraBold', 'barlowcondensed', 'BarlowCondensed-ExtraBold.ttf');
  // Nuevas familias (más estilos para los textos)
  const poppins     = reg('Poppins',          'poppins', 'Poppins-Regular.ttf');
  const poppinsMed  = reg('Poppins-Medium',   'poppins', 'Poppins-Medium.ttf');
  const poppinsSemi = reg('Poppins-SemiBold', 'poppins', 'Poppins-SemiBold.ttf');
  const poppinsBold = reg('Poppins-Bold',     'poppins', 'Poppins-Bold.ttf');
  const greatvibes  = reg('GreatVibes', 'greatvibes', 'GreatVibes-Regular.ttf');
  const cardo       = reg('Cardo',      'cardo', 'Cardo-Regular.ttf');
  const cardoBold   = reg('Cardo-Bold', 'cardo', 'Cardo-Bold.ttf');
  const lobster     = reg('Lobster',    'lobster', 'Lobster-Regular.ttf');
  // Más familias: manuscritas/script + display + serif formal
  const pacifico      = reg('Pacifico',   'pacifico',   'Pacifico-Regular.ttf');
  const sacramento    = reg('Sacramento', 'sacramento', 'Sacramento-Regular.ttf');
  const allura        = reg('Allura',     'allura',     'Allura-Regular.ttf');
  const alexbrush     = reg('AlexBrush',  'alexbrush',  'AlexBrush-Regular.ttf');
  const tangerine     = reg('Tangerine',      'tangerine', 'Tangerine-Regular.ttf');
  const tangerineBold = reg('Tangerine-Bold', 'tangerine', 'Tangerine-Bold.ttf');
  const parisienne    = reg('Parisienne', 'parisienne', 'Parisienne-Regular.ttf');
  const cinzel        = reg('CinzelDecorative',      'cinzeldecorative', 'CinzelDecorative-Regular.ttf');
  const cinzelBold    = reg('CinzelDecorative-Bold', 'cinzeldecorative', 'CinzelDecorative-Bold.ttf');
  const abril         = reg('AbrilFatface', 'abrilfatface', 'AbrilFatface-Regular.ttf');
  const crimson       = reg('CrimsonText',      'crimsontext', 'CrimsonText-Regular.ttf');
  const crimsonBold   = reg('CrimsonText-Bold', 'crimsontext', 'CrimsonText-Bold.ttf');
  return { montserrat, medium, semibold, bebas, barlow,
           poppins, poppinsMed, poppinsSemi, poppinsBold, greatvibes, cardo, cardoBold, lobster,
           pacifico, sacramento, allura, alexbrush, tangerine, tangerineBold, parisienne,
           cinzel, cinzelBold, abril, crimson, crimsonBold };
}

const REG_VACIO: FuentesReg = {
  montserrat: false, medium: false, semibold: false, bebas: false, barlow: false,
  poppins: false, poppinsMed: false, poppinsSemi: false, poppinsBold: false,
  greatvibes: false, cardo: false, cardoBold: false, lobster: false,
  pacifico: false, sacramento: false, allura: false, alexbrush: false,
  tangerine: false, tangerineBold: false, parisienne: false,
  cinzel: false, cinzelBold: false, abril: false, crimson: false, crimsonBold: false,
};

type FontFamilia =
  | 'sans' | 'serif' | 'bebas' | 'barlow' | 'poppins' | 'vibes' | 'cardo' | 'lobster'
  | 'pacifico' | 'sacramento' | 'allura' | 'alexbrush' | 'tangerine' | 'parisienne'
  | 'cinzel' | 'abril' | 'crimson';

function fontFor(
  bold?: boolean, italic?: boolean,
  font?: FontFamilia,
  reg: FuentesReg = REG_VACIO,
  weight?: 400 | 500 | 600 | 700 | 800,
): string {
  // Bebas Neue: un solo peso, ignora bold/italic.
  if (font === 'bebas' && reg.bebas) return 'BebasNeue';

  // Barlow Condensed: condensada tipo señalética (alternativa a MVB Embarcadero).
  if (font === 'barlow' && reg.barlow) {
    const w = weight ?? (bold ? 700 : 400);
    if (w >= 800) return 'Barlow-ExtraBold';
    if (w >= 700) return 'Barlow-Bold';
    if (w >= 600) return 'Barlow-SemiBold';
    return 'Barlow';
  }

  // Poppins: sans geométrica moderna (varios pesos).
  if (font === 'poppins' && reg.poppins) {
    const w = weight ?? (bold ? 700 : 400);
    if (w >= 700 && reg.poppinsBold) return 'Poppins-Bold';
    if (w >= 600 && reg.poppinsSemi) return 'Poppins-SemiBold';
    if (w >= 500 && reg.poppinsMed)  return 'Poppins-Medium';
    return 'Poppins';
  }
  // Great Vibes: manuscrita elegante (un solo peso; ideal para nombres).
  if (font === 'vibes' && reg.greatvibes) return 'GreatVibes';
  // Cardo: serif clásica formal (regular/negrita).
  if (font === 'cardo' && reg.cardo) return (bold && reg.cardoBold) ? 'Cardo-Bold' : 'Cardo';
  // Lobster: script display para títulos (un solo peso).
  if (font === 'lobster' && reg.lobster) return 'Lobster';
  // Manuscritas / script (un solo peso salvo Tangerine).
  if (font === 'pacifico'   && reg.pacifico)   return 'Pacifico';
  if (font === 'sacramento' && reg.sacramento) return 'Sacramento';
  if (font === 'allura'     && reg.allura)     return 'Allura';
  if (font === 'alexbrush'  && reg.alexbrush)  return 'AlexBrush';
  if (font === 'parisienne' && reg.parisienne) return 'Parisienne';
  if (font === 'tangerine'  && reg.tangerine)  return (bold && reg.tangerineBold) ? 'Tangerine-Bold' : 'Tangerine';
  // Display / serif formal (diploma).
  if (font === 'cinzel'  && reg.cinzel)  return (bold && reg.cinzelBold) ? 'CinzelDecorative-Bold' : 'CinzelDecorative';
  if (font === 'abril'   && reg.abril)   return 'AbrilFatface';
  if (font === 'crimson' && reg.crimson) return (bold && reg.crimsonBold) ? 'CrimsonText-Bold' : 'CrimsonText';

  if (font === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold)   return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  // sans (y bebas sin fuente) → Montserrat si está; si no, Helvetica.
  if (reg.montserrat) {
    const w = weight ?? (bold ? 700 : 400);
    if (italic) return w >= 700 ? 'Montserrat-BoldItalic' : 'Montserrat-Italic';
    if (w >= 700) return 'Montserrat-Bold';
    if (w === 600 && reg.semibold) return 'Montserrat-SemiBold';
    if (w === 500 && reg.medium)   return 'Montserrat-Medium';
    if (w >= 600) return 'Montserrat-Bold';       // 600 sin semibold → bold
    if (w >= 500) return 'Montserrat';            // 500 sin medium → regular
    return 'Montserrat';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold)   return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** Reemplaza {variable} por su valor (case-insensitive). Desconocidas → "". */
function expandir(txt: string, vars: Record<string, string>): string {
  return txt.replace(/\{(\w+)\}/g, (_, k) => {
    const key = Object.keys(vars).find(v => v.toLowerCase() === String(k).toLowerCase());
    return key ? vars[key] : '';
  });
}

/* ── Render del lienzo ──────────────────────────────────────── */
/**
 * Dibuja el certificado en modo personalizado: fondo del cliente + campos
 * dinámicos posicionados. `doc` es el PDFDocument de pdfkit (ya con página
 * A4 landscape). La página del acta (si aplica) la sigue manejando pdf.service.
 */
export function pintarLienzo(
  doc: any,
  datos: PdfDatos,
  qrDataUrl: string,
  vars: Record<string, string>,
  layout: LayoutLienzo,
  ctx: LienzoCtx,
): void {
  const { W, H, PX, imagenABuffer } = ctx;
  const reg = registrarFuentes(doc);

  // ── FONDO (arte del cliente, a sangre completa) ──
  const fondo = imagenABuffer(datos.plantilla_url);
  if (fondo) {
    try { doc.image(fondo.data, 0, 0, { width: W, height: H }); }
    catch (e) { console.warn('[lienzo] Error fondo:', (e as Error).message); }
  }

  // ── CAMPOS ──
  const campos = layout.campos ?? {};
  for (const [key, raw] of Object.entries(campos)) {
    if (!raw || (raw as CampoTexto | CampoQR | CampoLogo).on === false) continue;

    // LOGO (imagen de datos.logos por orden)
    if (/^logo\d+$/i.test(key)) {
      const c = raw as CampoLogo;
      const idx = Math.max(0, Number(key.replace(/\D/g, '')) - 1);
      const logo = datos.logos[idx];
      if (!logo) continue;
      const img = imagenABuffer(logo.imagen);
      if (!img) continue;
      const size = (c.size ?? 100) * PX;
      try {
        doc.image(img.data, (c.x ?? 0) * PX, (c.y ?? 0) * PX, { fit: [size, size], align: 'center', valign: 'center' });
      } catch (e) { console.warn('[lienzo] Error logo:', (e as Error).message); }
      continue;
    }

    // FIRMA (imagen del garabato + nombre + cargo, de datos.firmas por orden)
    if (/^firma\d+$/i.test(key)) {
      const c = raw as CampoFirma;
      const idx = Math.max(0, Number(key.replace(/\D/g, '')) - 1);
      const firma = datos.firmas[idx];
      if (!firma) continue;
      const w = (c.w ?? 260) * PX;
      const h = (c.h ?? 58) * PX;
      const x = (c.x ?? 0) * PX;
      const y = (c.y ?? 0) * PX;
      const img = imagenABuffer(firma.imagen);
      if (img) {
        try { doc.image(img.data, x, y, { fit: [w, h], align: 'center', valign: 'bottom' }); }
        catch (e) { console.warn('[lienzo] Error firma:', (e as Error).message); }
      }
      // Línea de firma (horizontal) justo bajo el garabato.
      const lineaY = y + h;
      doc.moveTo(x, lineaY).lineTo(x + w, lineaY).lineWidth(1).strokeColor('#475569').stroke();
      doc.font(fontFor(true, false, 'sans', reg)).fontSize(9).fillColor('#1e293b')
        .text(firma.nombre_autoridad, x, lineaY + 4, { width: w, align: 'center', lineGap: 1 });
      doc.font(fontFor(false, true, 'sans', reg)).fontSize(7.5).fillColor('#64748b')
        .text(firma.cargo, x, doc.y + 1, { width: w, align: 'center' });
      continue;
    }

    // LÍNEA decorativa
    if (/^linea/i.test(key)) {
      const c = raw as CampoLinea;
      const lx = (c.x ?? 0) * PX;
      const ly = (c.y ?? 0) * PX;
      const lw = (c.w ?? 200) * PX;
      doc.moveTo(lx, ly).lineTo(lx + lw, ly)
        .lineWidth((c.thickness ?? 1.5) * PX).strokeColor(c.color ?? '#c9a24b').stroke();
      continue;
    }

    // QR
    if (key === 'qr') {
      const c = raw as CampoQR;
      const size = (c.size ?? 90) * PX;
      const qx   = (c.x ?? 0) * PX;
      const qy   = (c.y ?? 0) * PX;
      const qrImg = imagenABuffer(qrDataUrl);
      if (qrImg) {
        try { doc.image(qrImg.data, qx, qy, { width: size, height: size }); }
        catch (e) { console.warn('[lienzo] Error QR:', (e as Error).message); }
      }
      // Si no hay QR (qrDataUrl vacío porque el QR va al acta), tampoco se
      // dibuja el código en texto: ambos van solo en el acta.
      if (qrImg && c.showCodigo !== false && datos.codigo_unico) {
        doc.font('Courier').fontSize(7).fillColor('#94a3b8')
          .text(datos.codigo_unico, qx - 5, qy + size + 4, { width: size + 10, align: 'center' });
      }
      continue;
    }

    // Campo de texto
    const c = raw as CampoTexto;
    let txt = expandir(c.text ?? '', vars);
    if (c.uppercase) txt = txt.toUpperCase();
    if (!txt.trim()) continue;

    const trackPx = (c.tracking ?? 0) * PX;
    const maxW    = (c.w ?? 400) * PX;
    doc.font(fontFor(c.bold, c.italic, c.font, reg, c.weight));

    // Auto-ajuste: encoge el tamaño hasta que entre en una línea dentro de `w`.
    let size = (c.size ?? 20) * PX;
    if (c.autoFit) {
      const lineas = txt.split('\n');
      while (size > 8 * PX) {
        doc.fontSize(size);
        const w = Math.max(...lineas.map(l => doc.widthOfString(l) + trackPx * Math.max(0, l.length - 1)));
        if (w <= maxW) break;
        size -= 1;
      }
    }

    doc.fontSize(size)
      .fillColor(c.color ?? '#0f172a')
      .text(txt, (c.x ?? 0) * PX, (c.y ?? 0) * PX, {
        width: maxW,
        align: c.align ?? 'center',
        lineGap: 2,
        characterSpacing: trackPx,
      });
  }
}
