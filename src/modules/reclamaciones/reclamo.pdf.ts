/**
 * Genera la Hoja de Reclamación en PDF (A4) reproduciendo el formato oficial de
 * INDECOPI (el mismo de virtual_archivo.pdf): cabecera del proveedor (Vaxa) +
 * los 3 bloques legales + acciones del proveedor. Las firmas van como TEXTO:
 *  - Firma del consumidor: "Presentado virtualmente el {fecha}" (libro virtual).
 *  - Firma del proveedor: "VAXA SYSTEMS S.A.C." + fecha de la respuesta.
 */
import PDFDocument from 'pdfkit';
import { getSunatConfig, type EmisorConfig } from '../facturacion/sunat/sunat.config';
import type { Reclamo } from './reclamo.entity';

/** Datos fijos del proveedor (Vaxa). Se toman de la config SUNAT si existe. */
function proveedor() {
  let em: Partial<EmisorConfig> = {};
  try { em = getSunatConfig().emisor; } catch { /* usa defaults */ }
  const direccion = em.direccion && em.direccion !== '-'
    ? em.direccion
    : 'CAL.CALLE 48 MZA. W1 LOTE 5 URB. EL PINAR';
  const ubigeo = [em.departamento, em.provincia, em.distrito]
    .filter((x) => x && x !== '-')
    .join(' - ') || 'LIMA - LIMA - COMAS';
  return {
    razonSocial: em.razonSocial || 'VAXA SYSTEMS S.A.C',
    ruc: em.ruc || '20615047954',
    domicilio: `${direccion} ${ubigeo}`,
  };
}

const fmtFecha = (s: string | null) => {
  if (!s) return '';
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export async function generarReclamoPdf(r: Reclamo): Promise<Buffer> {
  const prov = proveedor();
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const chunks: Buffer[] = [];
  doc.on('data', (d: Buffer) => chunks.push(d));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const X0 = 30;        // borde izquierdo
  const W = 535;        // ancho útil
  const X1 = X0 + W;    // borde derecho (565)
  const GREY = '#D9D9D9';
  const BLACK = '#000000';

  doc.lineWidth(0.8).strokeColor(BLACK);

  // ── Helpers de dibujo ──
  const rect = (x: number, y: number, w: number, h: number) => doc.rect(x, y, w, h).stroke();
  const vline = (x: number, y: number, h: number) => doc.moveTo(x, y).lineTo(x, y + h).stroke();

  /** Barra de sección gris a todo el ancho. */
  const bar = (y: number, h: number, text: string) => {
    doc.rect(X0, y, W, h).fillAndStroke(GREY, BLACK);
    doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(8).text(text, X0 + 5, y + (h - 8) / 2 + 1);
  };

  /** Etiqueta en negrita dentro de una celda. */
  const label = (x: number, y: number, text: string, w?: number) =>
    doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(8).text(text, x + 4, y + 6, w ? { width: w } : undefined);

  /** Valor normal. */
  const value = (x: number, y: number, text: string, w: number) =>
    doc.fillColor(BLACK).font('Helvetica').fontSize(9).text(text || '', x + 4, y + 6, { width: w - 8 });

  /** Casilla de verificación con "X" si está marcada. */
  const check = (x: number, y: number, marcado: boolean) => {
    doc.rect(x, y, 11, 11).stroke();
    if (marcado) doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text('X', x + 2.5, y + 1.5);
  };

  let y = 30;

  // ── Cabecera: LIBRO DE RECLAMACIONES | HOJA DE RECLAMACIÓN ──
  const hHead = 34;
  const splitHead = X0 + 355;
  rect(X0, y, W, hHead);
  vline(splitHead, y, hHead);
  doc.rect(X0, y, 355, hHead).fillAndStroke(GREY, BLACK);
  doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(11)
    .text('LIBRO DE RECLAMACIONES', X0, y + 11, { width: 355, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(10)
    .text('HOJA DE RECLAMACIÓN', splitHead, y + 12, { width: X1 - splitHead, align: 'center' });
  y += hHead;

  // ── FECHA | N° ──
  const hFecha = 24;
  rect(X0, y, W, hFecha);
  vline(splitHead, y, hFecha);
  label(X0, y, 'FECHA:');
  value(X0 + 48, y, fmtFecha(r.created_at), 300);
  doc.font('Helvetica-Bold').fontSize(9).text('N°', splitHead + 6, y + 7);
  doc.font('Helvetica').fontSize(10).text(r.numero, splitHead + 26, y + 6, { width: X1 - splitHead - 30 });
  y += hFecha;

  // ── Proveedor (Vaxa, fijo) ──
  const hProv = 46;
  rect(X0, y, W, hProv);
  const rot = (lbl: string, val: string, yy: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text(lbl, X0 + 4, yy);
    doc.font('Helvetica').fontSize(8).text(val, X0 + 78, yy, { width: W - 82 });
  };
  rot('PROVEEDOR:', prov.razonSocial, y + 6);
  rot('RUC:', prov.ruc, y + 20);
  rot('DOMICILIO:', prov.domicilio, y + 34);
  y += hProv;

  // ── 1. Identificación del consumidor ──
  bar(y, 16, '1. IDENTIFICACIÓN DEL CONSUMIDOR RECLAMANTE'); y += 16;
  const lblW = 105;
  const filaLV = (lbl: string, val: string, h = 22) => {
    rect(X0, y, W, h);
    vline(X0 + lblW, y, h);
    doc.rect(X0, y, lblW, h).fillAndStroke('#F2F2F2', BLACK);
    label(X0, y, lbl, lblW - 8);
    value(X0 + lblW, y, val, W - lblW);
    y += h;
  };
  filaLV('NOMBRE:', r.consumidor_nombre);
  filaLV('DNI / CE:', r.consumidor_num_doc);
  filaLV('DOMICILIO:', r.consumidor_domicilio ?? '');
  // TELÉFONO | E-MAIL en una fila
  {
    const h = 22, mid = X0 + 300;
    rect(X0, y, W, h);
    doc.rect(X0, y, lblW, h).fillAndStroke('#F2F2F2', BLACK);
    label(X0, y, 'TELÉFONO', lblW - 8);
    value(X0 + lblW, y, r.consumidor_telefono ?? '', mid - (X0 + lblW));
    doc.rect(mid, y, 70, h).fillAndStroke('#F2F2F2', BLACK);
    label(mid, y, 'E-MAIL:', 66);
    value(mid + 70, y, r.consumidor_email ?? '', X1 - (mid + 70));
    // bordes verticales
    vline(X0 + lblW, y, h); vline(mid, y, h); vline(mid + 70, y, h);
    y += h;
  }
  // Menor de edad
  {
    doc.rect(X0, y, W, 15).fillAndStroke('#F2F2F2', BLACK);
    label(X0, y - 1, 'SI ES MENOR DE EDAD, NOMBRE DEL PADRE, MADRE O APODERADO:', W - 8);
    y += 15;
    const h = 18;
    rect(X0, y, W, h);
    const apo = r.es_menor
      ? [r.apoderado_nombre, r.apoderado_num_doc].filter(Boolean).join(' — ')
      : '';
    value(X0, y - 1, apo, W);
    y += h;
  }

  // ── 2. Identificación del bien contratado ──
  bar(y, 16, '2. IDENTIFICACIÓN DEL BIEN CONTRATADO'); y += 16;
  const colBien = X0 + 200; // fin de la columna izquierda (PRODUCTO/SERVICIO)
  const colMonto = colBien + 130; // fin de la etiqueta MONTO/DESCRIPCIÓN
  const filaBien = (etq: string, marcado: boolean, lbl2: string, val: string) => {
    const h = 22;
    rect(X0, y, W, h);
    vline(colBien, y, h); vline(colMonto, y, h);
    check(X0 + 6, y + 5, marcado);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(etq, X0 + 24, y + 6);
    label(colBien, y, lbl2, colMonto - colBien - 8);
    value(colMonto, y, val, X1 - colMonto);
    y += h;
  };
  filaBien('PRODUCTO', r.bien_tipo === 'PRODUCTO', 'MONTO RECLAMADO:',
    r.bien_monto != null ? `S/ ${r.bien_monto.toFixed(2)}` : '');
  filaBien('SERVICIO', r.bien_tipo === 'SERVICIO', 'DESCRIPCIÓN:', r.bien_descripcion ?? '');

  // ── 3. Detalle de la reclamación + Reclamo/Queja ──
  {
    const h = 20, r1 = X0 + 300;
    doc.rect(X0, y, W, h).fillAndStroke(GREY, BLACK);
    doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(7.5)
      .text('3. DETALLE DE LA RECLAMACIÓN Y PEDIDO DEL CONSUMIDOR', X0 + 4, y + 7, { width: r1 - X0 - 6 });
    // RECLAMO [ ]   QUEJA [ ]
    doc.font('Helvetica-Bold').fontSize(8).text('RECLAMO¹', r1 + 6, y + 7);
    check(r1 + 62, y + 5, r.tipo === 'RECLAMO');
    doc.font('Helvetica-Bold').fontSize(8).text('QUEJA²', r1 + 92, y + 7);
    check(r1 + 138, y + 5, r.tipo === 'QUEJA');
    vline(r1, y, h);
    y += h;
  }
  // DETALLE (caja alta)
  {
    const h = 120;
    rect(X0, y, W, h);
    label(X0, y, 'DETALLE:');
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
      .text(r.detalle, X0 + 4, y + 20, { width: W - 8, height: h - 24 });
    y += h;
  }
  // PEDIDO | FIRMA DEL CONSUMIDOR
  {
    const h = 100, col = X0 + 355;
    rect(X0, y, W, h);
    vline(col, y, h);
    label(X0, y, 'PEDIDO:');
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
      .text(r.pedido, X0 + 4, y + 20, { width: col - X0 - 8, height: h - 24 });
    // Firma del consumidor (presentación virtual)
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#333')
      .text(`Presentado virtualmente el ${fmtFecha(r.created_at)}.\nDocumento generado electrónicamente; no requiere firma manuscrita.\n\n${r.consumidor_nombre}`,
        col + 6, y + 12, { width: X1 - col - 12, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
      .text('FIRMA DEL CONSUMIDOR', col, y + h - 14, { width: X1 - col, align: 'center' });
    y += h;
  }

  // ── 4. Observaciones y acciones del proveedor ──
  bar(y, 16, '4. OBSERVACIONES Y ACCIONES ADOPTADAS POR EL PROVEEDOR'); y += 16;
  // Fecha de comunicación de la respuesta
  {
    const h = 20, lblW2 = 260;
    rect(X0, y, W, h);
    vline(X0 + lblW2, y, h);
    label(X0, y, 'FECHA DE COMUNICACIÓN DE LA RESPUESTA:', lblW2 - 8);
    value(X0 + lblW2, y, fmtFecha(r.respondido_at), W - lblW2);
    y += h;
  }
  // Respuesta | FIRMA DEL PROVEEDOR
  {
    const h = 90, col = X0 + 355;
    rect(X0, y, W, h);
    vline(col, y, h);
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
      .text(r.respuesta ?? '', X0 + 4, y + 6, { width: col - X0 - 8, height: h - 10 });
    if (r.respondido_at) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
        .text(prov.razonSocial, col + 6, y + 24, { width: X1 - col - 12, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#333')
        .text(`Respondido el ${fmtFecha(r.respondido_at)}`, col + 6, y + 40, { width: X1 - col - 12, align: 'center' });
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
      .text('FIRMA DEL PROVEEDOR', col, y + h - 14, { width: X1 - col, align: 'center' });
    y += h;
  }

  // ── Notas al pie de las definiciones ──
  {
    const h = 30, mid = X0 + 267;
    rect(X0, y, W, h);
    vline(mid, y, h);
    doc.font('Helvetica').fontSize(6.5).fillColor(BLACK)
      .text('¹ RECLAMO: Disconformidad relacionada a los productos o servicios.', X0 + 4, y + 5, { width: mid - X0 - 8 });
    doc.text('² QUEJA: Disconformidad no relacionada a los productos o servicios; o, malestar o descontento respecto a la atención al público.',
      mid + 4, y + 4, { width: X1 - mid - 8 });
    y += h;
  }
  // HOJA DE RECLAMACIÓN VIRTUAL
  {
    const h = 16;
    doc.rect(X0, y, W, h).fillAndStroke(GREY, BLACK);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
      .text('HOJA DE RECLAMACIÓN VIRTUAL', X0, y + 4, { width: W - 6, align: 'right' });
    y += h + 6;
  }
  // Avisos legales
  doc.font('Helvetica').fontSize(6.5).fillColor('#222')
    .text('*La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.', X0, y, { width: W })
    .text('*El proveedor debe dar respuesta al reclamo o queja en un plazo no mayor a quince (15) días hábiles, el cual es improrrogable.', X0, y + 12, { width: W });

  doc.end();
  return done;
}
