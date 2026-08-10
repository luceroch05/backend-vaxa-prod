import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { layoutActivo, parseLayout, pintarLienzo } from '../personalizado/lienzo.service';
import { logoVaxa, LOGO_RATIO } from '../../../shared/marca';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
// sharp es OPCIONAL: solo se usa para convertir imágenes webp/gif/avif a PNG,
// porque PDFKit únicamente acepta PNG/JPEG. Si no está instalado, esas imágenes
// se omiten como antes (degradación, sin romper la generación del PDF).
let sharp: any = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
try { sharp = require('sharp'); } catch { /* sharp no instalado */ }

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
  /** Primer nombre + apellidos (para la variable {nombreCorto}). */
  participante_nombre_corto?: string;
  /** Rol/calidad de participación (para la variable {calidad}). */
  participante_calidad?: string;
  programa_nombre:     string;
  tipo_programa:       string;
  horas_academicas:    number;
  creditos?:           number;
  fecha_inicio?:       string;
  fecha_fin?:          string;
  fecha_dia2?:         string;
  fecha_dia3?:         string;
  modalidad?:          string;
  fecha_emision:       string;
  codigo_unico:        string;
  empresa_nombre:      string;
  texto_personalizado?: string | null;
  /** JSON del modo "Diseño Personalizado (Lienzo)". null = diseño por defecto. */
  layout_personalizado?: string | null;
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
  creditos?: number;
}

export interface PdfActaDatos {
  inscripcion_id:      number;
  participante_nombre: string;
  numero_documento:    string;
  programa_nombre:     string;
  nombre_grupo:        string;
  unidad_label:        string;
  /** Modo créditos: la tabla muestra créditos por unidad + total, no notas. */
  es_creditos?:        boolean;
  total_creditos?:     number;
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

const MESES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function ymd(d?: string): { y: number; m: number; d: number } | null {
  if (!d) return null;
  const s = d.substring(0, 10);
  if (!s || s === '0000-00-00') return null;
  const [y, m, dd] = s.split('-').map(Number);
  if (!y || !m || !dd) return null;
  return { y, m, d: dd };
}
const fechaLarga = (p: { y: number; m: number; d: number }) => `${p.d} de ${MESES_LARGO[p.m - 1]} de ${p.y}`;
const unirDias = (arr: string[]) =>
  arr.length === 2 ? `${arr[0]} y ${arr[1]}` : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;

/** Frase del periodo del certificado (sin el "realizado" delante).
 *   1 día  → "el 15 de agosto de 2026"
 *   2-3 días puntuales → "los días 15, 18 y 22 de agosto de 2026"
 *     (mes/año una sola vez si coinciden; si cruzan mes/año, cada fecha completa)
 *   aula antigua con rango (solo fecha_fin) → "del 15 al 20 de agosto de 2026" */
function periodoCurso(inicio?: string, fin?: string, dia2?: string, dia3?: string): string {
  const parts = [ymd(inicio), ymd(dia2), ymd(dia3)].filter(Boolean) as { y: number; m: number; d: number }[];
  parts.sort((a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d));

  if (parts.length >= 2) {
    const mismoMesAnio = parts.every(p => p.y === parts[0].y && p.m === parts[0].m);
    if (mismoMesAnio) {
      return `los días ${unirDias(parts.map(p => String(p.d)))} de ${MESES_LARGO[parts[0].m - 1]} de ${parts[0].y}`;
    }
    return `los días ${unirDias(parts.map(fechaLarga))}`;
  }

  const ini = parts[0];
  const f = ymd(fin);   // compatibilidad con aulas antiguas (rango inicio–fin)
  if (ini && f && (f.y !== ini.y || f.m !== ini.m || f.d !== ini.d)) {
    return `del ${fechaLarga(ini)} al ${fechaLarga(f)}`;
  }
  return ini ? `el ${fechaLarga(ini)}` : '';
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

function pintarActa(doc: any, datos: PdfActaDatos, qrDataUrl?: string, codigo?: string): void {
  const left     = doc.page.margins.left;
  const right    = doc.page.width - doc.page.margins.right;
  const contentW = right - left;
  const topY     = doc.page.margins.top;
  const esCreditos = !!datos.es_creditos;

  const fechaIni = fmtFecha(datos.fecha_inicio);
  const fechaFin = fmtFecha(datos.fecha_fin);

  // ── QR de validación (mismo del certificado) en el encabezado, a la derecha ──
  // Va DENTRO del acta (arriba-derecha), integrado al encabezado. Reservamos ese
  // ancho para que los datos del alumno no se le encimen.
  const ACTA_QR   = 66;
  const qrImg     = qrDataUrl ? imagenABuffer(qrDataUrl) : null;
  const qrReserve = qrImg ? ACTA_QR + 16 : 0;
  // El QR va DEBAJO de la línea decorativa (a la altura de los datos del alumno),
  // no pegado arriba, para que no la cruce.
  const qrTop     = topY + 46;
  if (qrImg) {
    doc.image(qrImg.data, right - ACTA_QR, qrTop, { width: ACTA_QR, height: ACTA_QR });
    if (codigo) {
      doc.font('Courier').fontSize(7).fillColor('#94a3b8')
        .text(codigo, right - ACTA_QR - 6, qrTop + ACTA_QR + 2, { width: ACTA_QR + 12, align: 'center', lineBreak: false });
    }
  }

  // ── Encabezado (sin nombre de empresa: ya va en logos/footer) ──
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a')
    .text(esCreditos ? 'ACTA DE CRÉDITOS' : 'ACTA DE NOTAS', left, topY + 4, { width: contentW, align: 'center' });
  doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).strokeColor('#cbd5e1').lineWidth(1).stroke();
  doc.moveDown(1.2);

  // ── Datos del alumno / programa ──
  // El ancho del valor deja libre la esquina del QR (a su altura).
  const fila = (label: string, valor: string) => {
    const y = doc.y;
    const valW = contentW - 135 - (y < qrTop + ACTA_QR ? qrReserve : 0);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#475569').text(label, left, y, { width: 130 });
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(valor || '—', left + 135, y, { width: valW });
    doc.moveDown(0.35);
  };
  fila('Participante:', datos.participante_nombre);
  fila('Documento:',    datos.numero_documento);
  fila('Programa:',     datos.programa_nombre);
  fila('Grupo:',        datos.nombre_grupo);
  if (fechaIni || fechaFin) fila('Periodo:', `${fechaIni}${fechaIni && fechaFin ? ' al ' : ''}${fechaFin}`);
  doc.moveDown(0.8);

  // ── Tabla ──
  const colNum    = 40;
  const colValor  = 110;   // NOTA o CRÉDITOS
  const colUnidad = contentW - colNum - colValor;
  const rowH = 24;
  let y = doc.y;

  doc.rect(left, y, contentW, rowH).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
  const colNombreHdr = esCreditos ? 'TEMA' : datos.unidad_label.toUpperCase();
  doc.text('N°',                              left + 6,                  y + 7, { width: colNum - 6 });
  doc.text(colNombreHdr,                       left + colNum + 6,         y + 7, { width: colUnidad - 12 });
  doc.text(esCreditos ? 'CRÉDITOS' : 'NOTA',   left + colNum + colUnidad, y + 7, { width: colValor, align: 'center' });
  y += rowH;

  const unidadesOrden = [...datos.unidades].sort((a, b) => a.orden - b.orden);
  const padY = 7;   // relleno arriba/abajo del texto dentro de la fila
  unidadesOrden.forEach((u, i) => {
    // La fila se ADAPTA: si el nombre del tema es largo, se parte en varias líneas y
    // la altura de la fila crece para que no se encime con la siguiente.
    doc.font('Helvetica').fontSize(10);
    const nombre = u.nombre ?? '';
    const nombreH = doc.heightOfString(nombre, { width: colUnidad - 12 });
    const rowHi = Math.max(rowH, nombreH + padY * 2);
    if (i % 2 === 0) doc.rect(left, y, contentW, rowHi).fill('#f8fafc');
    doc.fillColor('#334155').font('Helvetica').fontSize(10)
      .text(String(i + 1), left + 6, y + padY, { width: colNum - 6 });
    doc.fillColor('#0f172a').text(nombre, left + colNum + 6, y + padY, { width: colUnidad - 12 });
    const valorTxt = esCreditos
      ? String(Number(u.creditos ?? 0))
      : (u.nota == null ? '—' : u.nota.toFixed(2));
    doc.font('Helvetica-Bold').fillColor('#0f172a')
      .text(valorTxt, left + colNum + colUnidad, y + padY, { width: colValor, align: 'center' });
    doc.font('Helvetica');
    y += rowHi;
  });
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#e2e8f0').lineWidth(1).stroke();

  // ── Resumen final ──
  y += 18;
  if (esCreditos) {
    // Modo créditos: total de créditos + condición por asistencia (aprobado = 3).
    const totalCred = datos.total_creditos ?? unidadesOrden.reduce((s, u) => s + Number(u.creditos ?? 0), 0);
    const condicion = datos.aprobado ? 'APROBADO' : 'PENDIENTE';
    const condColor = datos.aprobado ? '#15803d' : '#92400e';
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#475569')
      .text('Total de créditos: ', left, y, { continued: true })
      .fillColor('#0f172a').text(String(Number(totalCred)));
    doc.font('Helvetica').fontSize(9.5).fillColor('#94a3b8')
      .text('Los créditos se otorgan por asistencia al programa.', left, doc.y + 2);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(condColor)
      .text(`Condición: ${condicion}`, left, doc.y);
  } else {
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
  }

  // ── Footer ──
  const footerY = doc.page.height - doc.page.margins.bottom - 24;
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
    .text(esCreditos ? 'Acta de créditos' : 'Acta de notas',
      left, footerY, { width: contentW, align: 'center', lineBreak: false });
}

/* ── Preparación de QR + cuerpo (común a archivo y buffer) ───── */
/**
 * URL pública de validación que va en el QR del certificado.
 *  - Producción (subdominios): definir CERT_PUBLIC_URL=https://certificados.vaxasys.com
 *    → queda `.../<empresa>/validar` (URL limpia, sin `/certificados`).
 *  - Local / legacy: si CERT_PUBLIC_URL no está, usa PUBLIC_FRONTEND_URL con la
 *    estructura de hoy `.../<empresa>/certificados/validar`.
 * Los certificados YA emitidos llevan su QR grabado; por eso la estructura legacy
 * debe seguir resolviendo (redirect en el frontend viejo).
 */
function buildValidarUrl(empresa: string, codigo: string): string {
  const certBase = process.env.CERT_PUBLIC_URL?.replace(/\/$/, '');
  if (certBase) return `${certBase}/${empresa}/validar?codigo=${codigo}`;
  const legacy = (process.env.PUBLIC_FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${legacy}/${empresa}/certificados/validar?codigo=${codigo}`;
}

/** PDFKit solo dibuja PNG/JPEG. Convierte a PNG (vía sharp) una imagen en otro
 *  formato (webp, gif, avif…) y la devuelve como data URL png. Si ya es png/jpeg,
 *  o sharp no está / falla, deja el src intacto. */
async function aFormatoPdf(src: string | null | undefined): Promise<string | null | undefined> {
  if (!src || !sharp) return src;
  const esData = src.startsWith('data:');
  const ext = esData
    ? (src.match(/^data:image\/([a-zA-Z0-9+]+);base64,/)?.[1] ?? '').toLowerCase()
    : path.extname(src).toLowerCase().replace('.', '');
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return src;   // ya compatible
  try {
    let input: Buffer;
    if (esData) {
      input = Buffer.from(src.substring(src.indexOf(',') + 1), 'base64');
    } else {
      const limpio = src.replace(/^\/+/, '');
      const abs = limpio.startsWith('uploads/')
        ? path.join(process.cwd(), limpio)
        : path.join(process.cwd(), 'public', limpio);
      if (!fs.existsSync(abs)) return src;
      input = fs.readFileSync(abs);
    }
    const png = await sharp(input).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (e) {
    console.warn('[pdf] No se pudo convertir imagen a PNG:', (e as Error).message);
    return src;
  }
}

/** Convierte fondo, logos y firmas de `datos` a formatos que PDFKit soporta. */
async function asegurarImagenesPdf(datos: PdfDatos): Promise<void> {
  datos.plantilla_url = (await aFormatoPdf(datos.plantilla_url)) ?? null;
  for (const l of datos.logos)  l.imagen = (await aFormatoPdf(l.imagen)) ?? l.imagen;
  for (const f of datos.firmas) f.imagen = (await aFormatoPdf(f.imagen)) ?? f.imagen;
}

/**
 * Logo de Vaxa TRANSPARENTE para el pie del certificado. Lee el archivo LOCAL
 * `uploads/marca/vaxa-cert.png` (fondo transparente) — NO la versión de
 * comprobantes (que tiene fondo blanco). Cacheado en memoria.
 */
let _vaxaCertLogo: Buffer | null | undefined;
function logoVaxaCertLocal(): Buffer | null {
  if (_vaxaCertLogo !== undefined) return _vaxaCertLogo;
  const candidatos = [
    path.join(process.cwd(), 'uploads', 'marca', 'vaxa-cert.png'),
    path.join(__dirname, '..', '..', '..', '..', 'uploads', 'marca', 'vaxa-cert.png'),
  ];
  for (const p of candidatos) {
    try { if (fs.existsSync(p)) { _vaxaCertLogo = fs.readFileSync(p); return _vaxaCertLogo; } } catch { /* siguiente */ }
  }
  _vaxaCertLogo = null;
  return _vaxaCertLogo;
}

async function prepararContenido(datos: PdfDatos): Promise<{ cuerpo: string; qrDataUrl: string; vars: Record<string, string>; vaxaLogo: Buffer | null }> {
  await asegurarImagenesPdf(datos);   // webp/gif → png (PDFKit solo acepta png/jpeg)
  // Pie del certificado: logo transparente local; si no está, cae al de comprobantes.
  const vaxaLogo = logoVaxaCertLocal() ?? await logoVaxa();
  const qrUrl    = buildValidarUrl(datos.empresa_nombre, datos.codigo_unico);
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 200, margin: 1 });

  const fechaIni   = fmtFecha(datos.fecha_inicio);
  const fechaFin   = fmtFecha(datos.fecha_fin);
  // Periodo según los días del curso: hasta 3 días puntuales → "los días X, Y y Z";
  // 1 día → "el X"; aula antigua con rango → "del X al Y". Ver periodoCurso.
  const periodoFrase = periodoCurso(datos.fecha_inicio, datos.fecha_fin, datos.fecha_dia2, datos.fecha_dia3);
  const periodo    = periodoFrase ? `, realizado ${periodoFrase}` : '';
  const cuerpoAuto = `Por haber completado satisfactoriamente ${datos.tipo_programa} "${datos.programa_nombre}" con una duración de ${datos.horas_academicas} horas académicas${periodo}.`;

  // Mapa de variables — fuente única para el cuerpo y para los campos del lienzo.
  const vars: Record<string, string> = {
    nombre:       datos.participante_nombre,
    participante: datos.participante_nombre,
    nombreCorto:  datos.participante_nombre_corto ?? datos.participante_nombre,
    calidad:      datos.participante_calidad ?? 'Participante',
    programa:     datos.programa_nombre,
    curso:        datos.programa_nombre,
    tipo:         datos.tipo_programa,
    horas:        String(datos.horas_academicas),
    creditos:     datos.creditos ? String(datos.creditos) : '',
    fecha:        fmtFecha(datos.fecha_emision),
    fechaInicio:  fechaIni,
    fechaFin:     fechaFin,
    // Mes + año de emisión, ej. "septiembre 2026" (para "Miraflores, {mesEmision}.").
    mesEmision:   (() => { const p = ymd(datos.fecha_emision); return p ? `${MESES_LARGO[p.m - 1]} ${p.y}` : ''; })(),
    codigo:       datos.codigo_unico,
    empresa:      datos.empresa_nombre,
  };

  const expandir = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => {
    const key = Object.keys(vars).find(v => v.toLowerCase() === String(k).toLowerCase());
    return key ? vars[key] : '';
  });

  const cuerpo = expandir(datos.texto_personalizado?.trim() || cuerpoAuto);
  // {cuerpo} disponible como variable de los campos del lienzo (ya expandido).
  vars.cuerpo = cuerpo;

  return { cuerpo, qrDataUrl, vars, vaxaLogo };
}

/** Pie fijo de Vaxa: "Fecha de emisión" a la izquierda + "Certificado emitido por"
 *  con el logo de Vaxa, centrado. Se dibuja en TODOS los certificados (diseño por
 *  defecto Y personalizado/Lienzo). */
function pintarFooterVaxa(doc: any, datos: PdfDatos, vaxaLogo?: Buffer | null): void {
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
    .text(`Fecha de emisión: ${fmtFecha(datos.fecha_emision)}`, 30, H - 18, { lineBreak: false });
  const attr   = 'Certificado emitido por';
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
  const attrW  = doc.widthOfString(attr);
  const vlogoH = 13;
  const vlogoW = vaxaLogo ? Math.round(vlogoH * LOGO_RATIO) : 0;
  const gap    = vaxaLogo ? 5 : 0;
  const startX = (W - (attrW + gap + vlogoW)) / 2;
  doc.text(attr, startX, H - 18, { lineBreak: false });
  if (vaxaLogo) {
    try { doc.image(vaxaLogo, startX + attrW + gap, H - 23, { width: vlogoW, height: vlogoH }); }
    catch (e) { console.warn('Error logo Vaxa footer:', (e as Error).message); }
  }
}

/* ── Dibujo del certificado (idéntico para PDF en disco y preview en memoria) ─ */
function pintarCertificado(doc: any, datos: PdfDatos, cuerpo: string, qrDataUrl: string, vars: Record<string, string>): void {
  // Si hay acta (2ª hoja), el QR va SOLO en el acta, no en el certificado.
  const tieneActa = !!(datos.acta && datos.acta.unidades.length > 0);
  // Modo "Diseño Personalizado (Lienzo)": si la empresa tiene un diseño a medida
  // activo, se delega en el módulo aislado (personalizado/) y se omite TODO el
  // layout por defecto de abajo. El motor normal queda intacto.
  const layout = parseLayout(datos.layout_personalizado);
  if (layout && layoutActivo(datos.layout_personalizado)) {
    // Si hay acta, el QR va solo en el acta: pasamos '' para que el lienzo no lo dibuje.
    pintarLienzo(doc, datos, tieneActa ? '' : qrDataUrl, vars, layout, { W, H, PX, imagenABuffer });
  } else {
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
        // En el certificado va el nombre CORTO (primer nombre + apellidos). El nombre
        // completo se reserva para la página de validación. Cae al completo si no hay corto.
        const nombreCert  = datos.participante_nombre_corto ?? datos.participante_nombre;

        doc.font('Helvetica-Bold').fontSize(tituloSize);
        const tituloH = doc.heightOfString(datos.tipo_programa.toUpperCase(), { width: textWidth });

        doc.font('Helvetica').fontSize(otorgaSize);
        const otorgaH = doc.heightOfString(otorgaStr, { width: textWidth });

        doc.font('Times-Bold').fontSize(nombreSize);
        const nombreH = doc.heightOfString(nombreCert, { width: textWidth, lineGap: 2 });

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
          .text(nombreCert, textX, currentY, {
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
        // Si el PDF lleva acta (2ª hoja), el QR Y el código en texto van SOLO en
        // el acta; el certificado queda sin ninguno de los dos.
        if (!tieneActa) {
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
        }

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

  } // ── fin del diseño por defecto ──
        // El footer de Vaxa se dibuja al final sobre TODAS las páginas (ver generar/generarBuffer).

        // ── PÁGINA 2: ACTA DE NOTAS ───────────────────────────
        // Común a ambos modos: el acta de notas no depende del diseño del certificado.
        if (datos.acta && datos.acta.unidades.length > 0) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 50 });
          pintarActa(doc, datos.acta, qrDataUrl, datos.codigo_unico);
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
    const { cuerpo, qrDataUrl, vars, vaxaLogo } = await prepararContenido(datos);

    return new Promise<string>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4', layout: 'landscape', margin: 0, bufferPages: true,
          info: { Title: `Certificado ${datos.codigo_unico}`, Author: datos.empresa_nombre },
        });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);
        pintarCertificado(doc, datos, cuerpo, qrDataUrl, vars);
        // Footer de Vaxa en TODAS las páginas (certificado + acta).
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          pintarFooterVaxa(doc, datos, vaxaLogo);
        }
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
    const { cuerpo, qrDataUrl, vars, vaxaLogo } = await prepararContenido(datos);

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
        pintarCertificado(doc, datos, cuerpo, qrDataUrl, vars);
        // Footer de Vaxa + marca de agua en TODAS las páginas (certificado + acta).
        // El footer va en todas; la marca de agua hace inservible el preview.
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          pintarFooterVaxa(doc, datos, vaxaLogo);
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