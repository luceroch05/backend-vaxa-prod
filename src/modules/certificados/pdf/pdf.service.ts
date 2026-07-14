import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

/* ── Tipos ─────────────────────────────────────────────────── */
export interface PdfLogo {
  imagen: string;        // base64 dataURL o ruta
  nombre?: string | null;
  orden: number;
}

export interface PdfFirma {
  nombre_autoridad: string;
  cargo: string;
  imagen: string;        // base64 dataURL o ruta
  orden: number;
}

export interface PdfDatos {
  participante_nombre: string;
  programa_nombre:     string;
  tipo_programa:       string;
  horas_academicas:    number;
  creditos?:           number;
  fecha_inicio?:       string;
  fecha_fin?:          string;
  modalidad?:          string;
  fecha_emision:       string;
  codigo_unico:        string;
  empresa_nombre:      string;
  texto_personalizado?: string | null;
  plantilla_url?:      string | null;
  logos:               PdfLogo[];
  firmas:              PdfFirma[];
  acta?:               PdfActaDatos | null;
}

export interface PdfActaUnidad {
  id: number;
  nombre: string;
  orden: number;
  nota: number | null;
}

export interface PdfActaDatos {
  inscripcion_id:      number;
  participante_nombre: string;
  numero_documento:    string;
  programa_nombre:     string;
  nombre_grupo:        string;
  unidad_label:        string;
  nota_minima:         number;
  fecha_inicio?:       string;
  fecha_fin?:          string;
  empresa_nombre:      string;
  unidades:            PdfActaUnidad[];
  promedio:            number | null;
  completo:            boolean;
  aprobado:            boolean | null;
}

/* ── Constantes (medidas en pt — A4 landscape 72dpi) ────────── */
const W = 841.89;
const H = 595.28;
const PX = 0.75;  // 1px CSS ≈ 0.75pt

/* ── Helpers ───────────────────────────────────────────────── */
function fmtFecha(d?: string): string {
  if (!d) return '';
  const s = d.substring(0, 10);
  if (!s || s === '0000-00-00') return '';
  const [y, m, day] = s.split('-').map(Number);
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${day} de ${meses[m - 1]} de ${y}`;
}

interface ImagenBuffer {
  data: Buffer;
  type: string; // "image/png" | "image/jpeg" | etc.
}

function imagenABuffer(src: string | null | undefined): ImagenBuffer | null {
  if (!src) return null;

  if (src.startsWith('data:')) {
    // Extrae el mime type y el base64 limpio del data URL
    const match = src.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/s);
    if (!match) return null;
    try {
      return { data: Buffer.from(match[2], 'base64'), type: match[1] };
    } catch { return null; }
  }

  // Soporte para rutas de archivo: las imágenes subidas viven en cwd/uploads
  // (servidas por express.static); rutas legadas en cwd/public.
  const limpio = src.replace(/^\/+/, '');
  const abs = limpio.startsWith('uploads/')
    ? path.join(process.cwd(), limpio)              // cwd/uploads/<sub>/<archivo>
    : path.join(process.cwd(), 'public', limpio);   // legado
  if (!fs.existsSync(abs)) return null;
  const ext = path.extname(abs).toLowerCase().slice(1);
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  };
  return { data: fs.readFileSync(abs), type: mimeMap[ext] ?? 'image/png' };
}

function pintarActa(doc: any, datos: PdfActaDatos): void {
  const left     = doc.page.margins.left;
  const right    = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const topY     = doc.page.margins.top;

  const fechaIni = fmtFecha(datos.fecha_inicio);
  const fechaFin = fmtFecha(datos.fecha_fin);

  // ── Encabezado ──
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a365d')
    .text(datos.empresa_nombre.toUpperCase(), left, topY, { width: contentW, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a')
    .text('ACTA DE NOTAS', left, doc.y + 6, { width: contentW, align: 'center' });
  doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).strokeColor('#cbd5e1').lineWidth(1).stroke();
  doc.moveDown(1.2);

  // ── Datos del alumno / programa ──
  const fila = (label: string, valor: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#475569').text(label, left, y, { width: 130 });
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(valor || '—', left + 135, y, { width: contentW - 135 });
    doc.moveDown(0.35);
  };
  fila('Participante:', datos.participante_nombre);
  fila('Documento:',    datos.numero_documento);
  fila('Programa:',     datos.programa_nombre);
  fila('Grupo:',        datos.nombre_grupo);
  if (fechaIni || fechaFin) fila('Periodo:', `${fechaIni}${fechaIni && fechaFin ? ' al ' : ''}${fechaFin}`);
  doc.moveDown(0.8);

  // ── Tabla de notas ──
  const colNum    = 40;
  const colNota   = 110;
  const colUnidad = contentW - colNum - colNota;
  const rowH = 24;
  let y = doc.y;

  doc.rect(left, y, contentW, rowH).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
  doc.text('N°',                              left + 6,                y + 7, { width: colNum - 6 });
  doc.text(datos.unidad_label.toUpperCase(),  left + colNum + 6,       y + 7, { width: colUnidad - 12 });
  doc.text('NOTA',                            left + colNum + colUnidad, y + 7, { width: colNota, align: 'center' });
  y += rowH;

  const unidadesOrden = [...datos.unidades].sort((a, b) => a.orden - b.orden);
  doc.font('Helvetica').fontSize(10);
  unidadesOrden.forEach((u, i) => {
    if (i % 2 === 0) doc.rect(left, y, contentW, rowH).fill('#f8fafc');
    doc.fillColor('#334155').text(String(i + 1), left + 6, y + 7, { width: colNum - 6 });
    doc.fillColor('#0f172a').text(u.nombre, left + colNum + 6, y + 7, { width: colUnidad - 12 });
    const notaTxt = u.nota == null ? '—' : u.nota.toFixed(2);
    doc.font('Helvetica-Bold').fillColor('#0f172a')
      .text(notaTxt, left + colNum + colUnidad, y + 7, { width: colNota, align: 'center' });
    doc.font('Helvetica');
    y += rowH;
  });
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#e2e8f0').lineWidth(1).stroke();

  // ── Resumen final ──
  y += 18;
  const promedioTxt = datos.promedio == null ? '—' : datos.promedio.toFixed(2);
  const condicion   = !datos.completo ? 'PENDIENTE (faltan notas)' : datos.aprobado ? 'APROBADO' : 'DESAPROBADO';
  const condColor   = !datos.completo ? '#92400e' : datos.aprobado ? '#15803d' : '#b91c1c';

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#475569')
    .text('Promedio final: ', left, y, { continued: true })
    .fillColor('#0f172a').text(promedioTxt);
  doc.font('Helvetica').fontSize(9.5).fillColor('#94a3b8')
    .text(`(Nota mínima de aprobación: ${datos.nota_minima.toFixed(2)} · escala 0–20)`, left, doc.y + 2);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(condColor)
    .text(`Condición: ${condicion}`, left, doc.y);

  // ── Footer ──
  const footerY = doc.page.height - doc.page.margins.bottom - 24;
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
    .text(`Documento generado por ${datos.empresa_nombre} — Acta de notas`,
      left, footerY, { width: contentW, align: 'center', lineBreak: false });
}

/* ── Preparación de QR + cuerpo (común a archivo y buffer) ───── */
async function prepararContenido(datos: PdfDatos): Promise<{ cuerpo: string; qrDataUrl: string }> {
  const qrUrl    = `${process.env.PUBLIC_FRONTEND_URL ?? 'http://localhost:5173'}/${datos.empresa_nombre}/certificados/validar?codigo=${datos.codigo_unico}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 200, margin: 1 });

  const fechaIni   = fmtFecha(datos.fecha_inicio);
  const fechaFin   = fmtFecha(datos.fecha_fin);
  const periodo    = fechaIni && fechaFin ? `, realizado del ${fechaIni} al ${fechaFin}` : '';
  const cuerpoAuto = `Por haber completado satisfactoriamente ${datos.tipo_programa} "${datos.programa_nombre}" con una duración de ${datos.horas_academicas} horas académicas${periodo}.`;
  const cuerpo = (datos.texto_personalizado?.trim() || cuerpoAuto)
    .replace(/\{nombre\}/gi,       datos.participante_nombre)
    .replace(/\{participante\}/gi, datos.participante_nombre)
    .replace(/\{programa\}/gi,     datos.programa_nombre)
    .replace(/\{curso\}/gi,        datos.programa_nombre)
    .replace(/\{horas\}/gi,        String(datos.horas_academicas))
    .replace(/\{creditos\}/gi,     datos.creditos ? String(datos.creditos) : '')
    .replace(/\{fecha\}/gi,        fmtFecha(datos.fecha_emision))
    .replace(/\{fechaInicio\}/gi,  fechaIni)
    .replace(/\{fechaFin\}/gi,     fechaFin);

  return { cuerpo, qrDataUrl };
}

/* ── Dibujo del certificado (idéntico para PDF en disco y preview en memoria) ─ */
function pintarCertificado(doc: any, datos: PdfDatos, cuerpo: string, qrDataUrl: string): void {
        // ── FONDO ────────────────────────────────────────────
        const fondo = imagenABuffer(datos.plantilla_url);
        if (fondo) {
          try { doc.image(fondo.data, 0, 0, { width: W, height: H }); }
          catch (e) { console.warn('Error fondo:', (e as Error).message); }
        }

        // ── LOGOS ─────────────────────────────────────────────
        const LOGO_W    = 220 * PX;
        const LOGO_H    = 135 * PX;
        const LOGO_Y    =  55 * PX;
        const LOGO_SIDE =  70 * PX;
        const sorted    = [...datos.logos].sort((a, b) => a.orden - b.orden);

        const posiciones: number[] = [];
        if      (sorted.length === 1) posiciones.push((W - LOGO_W) / 2);
        else if (sorted.length === 2) posiciones.push(LOGO_SIDE, W - LOGO_W - LOGO_SIDE);
        else if (sorted.length >= 3)  posiciones.push(LOGO_SIDE, (W - LOGO_W) / 2, W - LOGO_W - LOGO_SIDE);

        sorted.slice(0, 3).forEach((logo, i) => {
          const img = imagenABuffer(logo.imagen);
          if (!img) return;
          try {
            doc.image(img.data, posiciones[i], LOGO_Y, {
              fit: [LOGO_W, LOGO_H], align: 'center', valign: 'center',
            });
          } catch (e) { console.warn(`Error logo ${i}:`, (e as Error).message); }
        });

        // ── BLOQUE CENTRAL ────────────────────────────────────
        const tituloSize  = 32 * PX;
        const otorgaSize  = 18 * PX;
        const nombreSize  = 42 * PX;
        const cuerpoSize  = (cuerpo.length > 200 ? 18 : 20) * PX;
        const programaSize = 22 * PX;
        const textWidth   = W - 2 * (180 * PX);
        const otorgaStr   = 'Se otorga a:';

        doc.font('Helvetica-Bold').fontSize(tituloSize);
        const tituloH = doc.heightOfString(datos.tipo_programa.toUpperCase(), { width: textWidth });

        doc.font('Helvetica').fontSize(otorgaSize);
        const otorgaH = doc.heightOfString(otorgaStr, { width: textWidth });

        doc.font('Times-Bold').fontSize(nombreSize);
        const nombreH = doc.heightOfString(datos.participante_nombre, { width: textWidth, lineGap: 2 });

        doc.font('Helvetica').fontSize(cuerpoSize);
        const cuerpoH = doc.heightOfString(cuerpo, { width: textWidth, lineGap: 4 });

        doc.font('Times-Italic').fontSize(programaSize);
        const programaStr = `"${datos.programa_nombre}"`;
        const programaH   = doc.heightOfString(programaStr, { width: textWidth, lineGap: 2 });

        const margenTitulo  = 20 * PX;
        const margenOtorga  = 10 * PX;
        const margenNombre  = 20 * PX;
        const margenCuerpo  = 20 * PX;

        const blockH =
          tituloH  + margenTitulo +
          otorgaH  + margenOtorga +
          nombreH  + margenNombre +
          cuerpoH  + margenCuerpo +
          programaH;

        const centroTop = 200 * PX;
        const centroBot = H - 180 * PX;
        const centroH   = centroBot - centroTop;
        let currentY    = centroTop + Math.max(0, (centroH - blockH) / 2);
        const textX     = 180 * PX;

        doc.font('Helvetica-Bold').fontSize(tituloSize).fillColor('#1a365d')
          .text(datos.tipo_programa.toUpperCase(), textX, currentY, {
            width: textWidth, align: 'center', characterSpacing: 1,
          });
        currentY += tituloH + margenTitulo;

        doc.font('Helvetica').fontSize(otorgaSize).fillColor('#475569')
          .text(otorgaStr, textX, currentY, {
            width: textWidth, align: 'center',
          });
        currentY += otorgaH + margenOtorga;

        doc.font('Times-Bold').fontSize(nombreSize).fillColor('#0f172a')
          .text(datos.participante_nombre, textX, currentY, {
            width: textWidth, align: 'center', lineGap: 2,
          });
        currentY += nombreH + margenNombre;

        doc.font('Helvetica').fontSize(cuerpoSize).fillColor('#475569')
          .text(cuerpo, textX, currentY, {
            width: textWidth, align: 'center', lineGap: 4,
          });
        currentY += cuerpoH + margenCuerpo;

        doc.font('Times-Italic').fontSize(programaSize).fillColor('#1e40af')
          .text(programaStr, textX, currentY, {
            width: textWidth, align: 'center', lineGap: 2,
          });

        // ── QR ───────────────────────────────────────────────
        const QR_SIZE = 75;
        const qrX     = W - 70 * PX - QR_SIZE;
        const qrY     = H - 40 * PX - QR_SIZE;
        const qrImg   = imagenABuffer(qrDataUrl);
        if (qrImg) {
          doc.image(qrImg.data, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
        }
        doc.font('Courier').fontSize(7).fillColor('#94a3b8')
          .text(datos.codigo_unico, qrX - 5, qrY + QR_SIZE + 4, {
            width: QR_SIZE + 10, align: 'center',
          });

        // ── FIRMAS ───────────────────────────────────────────
        // Máximo 3 firmas en el certificado (igual que los logos).
        const firmasOrdenadas = [...datos.firmas].sort((a, b) => a.orden - b.orden).slice(0, 3);
        if (firmasOrdenadas.length > 0) {
          const SIG_W     = 170;
          const SIG_IMG_H = 54;
          const gap       = firmasOrdenadas.length === 1 ? 0 : firmasOrdenadas.length === 2 ? 90 : 50;
          const totalW    = firmasOrdenadas.length * SIG_W + (firmasOrdenadas.length - 1) * gap;
          const nameSize  = 10;
          const cargoSize = 8.5;
          const sigBlockH = SIG_IMG_H + 4 + nameSize * 1.4 + cargoSize * 1.4;
          const startY    = H - 35 * PX - sigBlockH;
          let x           = (W - totalW) / 2;

          for (const f of firmasOrdenadas) {
            const fb = imagenABuffer(f.imagen);
            if (fb) {
              doc.image(fb.data, x, startY, { fit: [SIG_W, SIG_IMG_H], align: 'center', valign: 'bottom' });
            }
            const lineY = startY + SIG_IMG_H - 8;
            doc.moveTo(x, lineY).lineTo(x + SIG_W, lineY)
              .strokeColor('#475569').lineWidth(1).stroke();
            // El nombre puede envolver en varias líneas (sin lineBreak:false). El
            // cargo se dibuja en `doc.y` (donde terminó el nombre), así SIEMPRE queda
            // debajo del nombre completo y baja solo si el nombre es más largo.
            doc.font('Helvetica-Bold').fontSize(nameSize).fillColor('#1e293b')
              .text(f.nombre_autoridad, x, lineY + 4, { width: SIG_W, align: 'center', lineGap: 1 });
            doc.font('Helvetica-Oblique').fontSize(cargoSize).fillColor('#64748b')
              .text(f.cargo, x, doc.y + 2, { width: SIG_W, align: 'center' });
            x += SIG_W + gap;
          }
        }

        // ── FOOTER ───────────────────────────────────────────
        doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
          .text(`Fecha de emisión: ${fmtFecha(datos.fecha_emision)}`, 30, H - 18, { lineBreak: false });
        // Atribución fija a Vaxa: en TODOS los certificados, de cualquier empresa,
        // se indica que el certificado fue generado por Vaxa.
        doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
          .text('Certificado generado por Vaxa — Sistema de Certificación',
            0, H - 18, { width: W, align: 'center', lineBreak: false });

        // ── PÁGINA 2: ACTA DE NOTAS ───────────────────────────
        if (datos.acta && datos.acta.unidades.length > 0) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 50 });
          pintarActa(doc, datos.acta);
        }
}

/* ── Marca de agua (SOLO preview) ───────────────────────────────
   Hace que la vista previa sea inservible como certificado real:
   no se puede descargar/imprimir y usar sin emitir (sin gastar crédito). */
function pintarMarcaAgua(doc: any): void {
  doc.save();
  doc.rotate(-30, { origin: [W / 2, H / 2] });
  doc.fillColor('#dc2626').opacity(0.18)
    .font('Helvetica-Bold').fontSize(95)
    .text('VISTA PREVIA', 0, H / 2 - 70, { width: W, align: 'center' });
  doc.opacity(0.22).fontSize(22)
    .text('SIN VALIDEZ · NO EMITIDO', 0, H / 2 + 55, { width: W, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

/* ── Servicio ──────────────────────────────────────────────── */
export const pdfService = {
  /** Genera el PDF y lo guarda en disco. Devuelve la ruta relativa. */
  async generar(datos: PdfDatos, outputDir: string): Promise<string> {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const filename   = `${datos.codigo_unico}.pdf`;
    const outputPath = path.join(outputDir, filename);
    const { cuerpo, qrDataUrl } = await prepararContenido(datos);

    return new Promise<string>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4', layout: 'landscape', margin: 0,
          info: { Title: `Certificado ${datos.codigo_unico}`, Author: datos.empresa_nombre },
        });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);
        pintarCertificado(doc, datos, cuerpo, qrDataUrl);
        doc.end();
        stream.on('finish', () => {
          const rel = path.relative(process.cwd(), outputPath).replace(/\\/g, '/');
          resolve(rel);
        });
        stream.on('error', reject);
      } catch (err) { reject(err); }
    });
  },

  /** Genera el PDF en memoria (sin escribir en disco). Lo usa la previsualización:
   *  mismo motor y mismo dibujo que `generar`, así el preview es idéntico al PDF real. */
  async generarBuffer(datos: PdfDatos): Promise<Buffer> {
    const { cuerpo, qrDataUrl } = await prepararContenido(datos);

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4', layout: 'landscape', margin: 0, bufferPages: true,
          info: { Title: `Vista previa ${datos.codigo_unico}`, Author: datos.empresa_nombre },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        pintarCertificado(doc, datos, cuerpo, qrDataUrl);
        // Marca de agua en TODAS las páginas (certificado + acta) para que el
        // preview no pueda usarse como documento real sin emitir.
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          pintarMarcaAgua(doc);
        }
        doc.end();
      } catch (err) { reject(err); }
    });
  },

  eliminar(urlRelativa: string): void {
    try {
      const abs = path.join(process.cwd(), urlRelativa);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e) {
      console.warn('Error al eliminar PDF:', (e as Error).message);
    }
  },
};