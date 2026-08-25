/**
 * Genera la representación impresa (PDF/A4) de un comprobante, con el QR
 * en el formato que exige SUNAT:
 *   RUC | tipoDoc | serie | correlativo | IGV | total | fecha | tipoDocCliente | numDocCliente | hash
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getSunatConfig } from './sunat/sunat.config';
import { leyendaMonto } from './util/numero-letras';
import { logoVaxa, LOGO_RATIO } from '../../shared/marca';

const sol = (n: number) => `S/ ${Number(n).toFixed(2)}`;

const TITULO: Record<string, string> = {
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA ELECTRÓNICA',
  '07': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '08': 'NOTA DE DÉBITO ELECTRÓNICA',
  'NV': 'NOTA DE VENTA',
};

/** Comprobante con detalle (lo que devuelve comprobanteRepo.getById). */
export async function generarPdf(c: any): Promise<Buffer> {
  const cfg = getSunatConfig();
  const em = cfg.emisor;

  const qrText = [
    em.ruc, c.tipo_comprobante, c.serie, c.correlativo,
    Number(c.total_igv).toFixed(2), Number(c.importe_total).toFixed(2),
    c.fecha_emision, c.cliente_tipo_doc, c.cliente_num_doc, c.hash ?? '',
  ].join('|') + '|';
  const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 0, width: 130 });
  const qrImg = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (d: Buffer) => chunks.push(d));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const GOLD = '#C9962C';
  const DARK = '#0D0E12';
  const GREY = '#6B7280';

  // ── Encabezado: logo Vaxa + emisor (izq) + recuadro del comprobante (der) ──
  const logo = await logoVaxa();
  if (logo) {
    const lw = 150;
    doc.image(logo, 40, 42, { width: lw, height: lw / LOGO_RATIO });
  }
  doc.fillColor(DARK).fontSize(15).font('Helvetica-Bold').text(em.razonSocial, 40, 108, { width: 300 });
  doc.fillColor(GREY).fontSize(9).font('Helvetica')
    .text(`RUC: ${em.ruc}`, 40, 130)
    .text(em.direccion, 40, 142, { width: 300 })
    .text(`${em.distrito} - ${em.provincia} - ${em.departamento}`, 40, 154, { width: 300 });

  doc.roundedRect(360, 45, 195, 72, 8).lineWidth(1).fillAndStroke('#F4F5F7', '#E5E7EB');
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
    .text(TITULO[c.tipo_comprobante] ?? 'COMPROBANTE', 360, 57, { width: 195, align: 'center' });
  doc.fillColor(GOLD).fontSize(13).text(`RUC ${em.ruc}`, 360, 77, { width: 195, align: 'center' });
  doc.fillColor(DARK).fontSize(13).text(c.numero, 360, 94, { width: 195, align: 'center' });

  // ── Cliente + fecha ──
  let y = 176;
  doc.fillColor(DARK).fontSize(9.5).font('Helvetica-Bold').text('CLIENTE', 40, y);
  doc.font('Helvetica').fillColor(GREY)
    .text(`${c.cliente_razon_social}`, 40, y + 14, { width: 360 })
    .text(`Doc.: ${c.cliente_num_doc}`, 40, y + 28);
  doc.fillColor(DARK).font('Helvetica-Bold').text('Fecha de emisión', 400, y);
  doc.font('Helvetica').fillColor(GREY).text(String(c.fecha_emision ?? ''), 400, y + 14);
  if (c.ref_serie_correlativo) {
    doc.fillColor(DARK).font('Helvetica-Bold').text('Documento que modifica', 400, y + 32);
    doc.font('Helvetica').fillColor(GREY).text(String(c.ref_serie_correlativo), 400, y + 46);
  }

  // ── Tabla de ítems ──
  y = 240;
  doc.rect(40, y, 515, 20).fill(DARK);
  doc.fillColor('#fff').fontSize(8.5).font('Helvetica-Bold')
    .text('CANT.', 48, y + 6)
    .text('DESCRIPCIÓN', 95, y + 6)
    .text('V. UNIT.', 400, y + 6, { width: 60, align: 'right' })
    .text('IMPORTE', 480, y + 6, { width: 67, align: 'right' });
  y += 20;
  doc.font('Helvetica').fontSize(9).fillColor(DARK);
  for (const d of c.detalle ?? []) {
    const h = Math.max(16, Math.ceil(String(d.descripcion).length / 60) * 12);
    doc.fillColor(DARK)
      .text(String(d.cantidad), 48, y + 4, { width: 40 })
      .text(String(d.descripcion), 95, y + 4, { width: 295 })
      .text(sol(d.valor_unitario), 400, y + 4, { width: 60, align: 'right' })
      .text(sol(d.valor_total), 480, y + 4, { width: 67, align: 'right' });
    y += h;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
  }

  // ── Totales ──
  y += 12;
  const fila = (label: string, val: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(bold ? DARK : GREY)
      .text(label, 360, y, { width: 110, align: 'right' })
      .text(val, 475, y, { width: 72, align: 'right' });
    y += bold ? 18 : 15;
  };
  fila('Op. Gravada:', sol(c.total_gravado));
  fila('IGV (18%):', sol(c.total_igv));
  fila('TOTAL:', sol(c.importe_total), true);

  // ── Leyenda en letras ──
  y += 6;
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY)
    .text(leyendaMonto(Number(c.importe_total), c.moneda), 40, y, { width: 515 });

  // ── QR + nota ──
  doc.image(qrImg, 40, y + 22, { width: 110 });
  doc.fontSize(7.5).fillColor(GREY).text(
    'Representación impresa del comprobante electrónico. Consulte su validez en www.sunat.gob.pe',
    160, y + 30, { width: 395 },
  );
  if (c.estado === 'ACEPTADO') {
    doc.fillColor('#047857').fontSize(8).font('Helvetica-Bold').text('ACEPTADO POR SUNAT', 160, y + 70);
  }

  // ── Notas / observaciones ── (debajo del QR; se respetan los saltos de línea / párrafos)
  if (c.notas) {
    const ny = y + 150;
    doc.fillColor(DARK).fontSize(8.5).font('Helvetica-Bold').text('Notas', 40, ny);
    doc.font('Helvetica').fillColor(GREY).fontSize(8);
    doc.text(String(c.notas).replace(/\r\n/g, '\n'), 40, ny + 12, { width: 515, lineGap: 1.5 });
  }

  doc.end();
  return done;
}
