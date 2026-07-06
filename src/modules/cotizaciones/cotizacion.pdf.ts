/**
 * Genera la representación en PDF (A4) de una COTIZACIÓN. Mismo estilo que la
 * representación impresa de comprobantes (facturacion/pdf.service.ts) pero SIN
 * QR ni referencias a SUNAT: una cotización no es un documento tributario.
 */
import PDFDocument from 'pdfkit';
import { getSunatConfig, type EmisorConfig } from '../facturacion/sunat/sunat.config';
import type { CotizacionConDetalle } from './cotizacion.entity';
import { logoVaxa, LOGO_RATIO } from '../../shared/marca';

const sol = (n: number) => `S/ ${Number(n).toFixed(2)}`;

const fmtFecha = (s: string | null) =>
  (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

/** Emisor: usa la config SUNAT si está disponible; si no, datos de Vaxa por defecto. */
function emisorSeguro(): EmisorConfig {
  try {
    return getSunatConfig().emisor;
  } catch {
    return {
      ruc: '20615047954', razonSocial: 'VAXA SYSTEMS',
      direccion: '-', distrito: '-', provincia: '-', departamento: '-',
    } as EmisorConfig;
  }
}

export async function generarCotizacionPdf(c: CotizacionConDetalle): Promise<Buffer> {
  const em = emisorSeguro();

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (d: Buffer) => chunks.push(d));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const GOLD = '#C9962C';
  const DARK = '#0D0E12';
  const GREY = '#6B7280';

  // ── Encabezado: logo Vaxa + emisor (izq) + recuadro de cotización (der) ──
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
  doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
    .text('COTIZACIÓN', 360, 60, { width: 195, align: 'center' });
  doc.fillColor(GOLD).fontSize(14).text(c.numero, 360, 84, { width: 195, align: 'center' });

  // ── Cliente + validez ──
  let y = 176;
  doc.fillColor(DARK).fontSize(9.5).font('Helvetica-Bold').text('CLIENTE', 40, y);
  doc.font('Helvetica').fillColor(GREY)
    .text(c.cliente_razon_social, 40, y + 14, { width: 300 })
    .text(`Doc.: ${c.cliente_num_doc}`, 40, y + 28);
  if (c.cliente_email) doc.text(c.cliente_email, 40, y + 42, { width: 300 });

  doc.fillColor(DARK).font('Helvetica-Bold').text('Emitida', 400, y);
  doc.font('Helvetica').fillColor(GREY).text(fmtFecha(String(c.created_at ?? '').slice(0, 10)), 400, y + 14);
  doc.fillColor(DARK).font('Helvetica-Bold').text('Válida hasta', 400, y + 32);
  doc.font('Helvetica').fillColor(GREY).text(fmtFecha(c.valida_hasta), 400, y + 46);

  // ── Tabla de ítems ──
  y = 250;
  doc.rect(40, y, 515, 20).fill(DARK);
  doc.fillColor('#fff').fontSize(8.5).font('Helvetica-Bold')
    .text('CANT.', 48, y + 6)
    .text('DESCRIPCIÓN', 95, y + 6)
    .text('P. UNIT.', 400, y + 6, { width: 60, align: 'right' })
    .text('IMPORTE', 480, y + 6, { width: 67, align: 'right' });
  y += 20;
  doc.font('Helvetica').fontSize(9).fillColor(DARK);
  for (const d of c.detalle ?? []) {
    const h = Math.max(16, Math.ceil(String(d.descripcion).length / 60) * 12);
    doc.fillColor(DARK)
      .text(String(d.cantidad), 48, y + 4, { width: 40 })
      .text(String(d.descripcion), 95, y + 4, { width: 295 })
      .text(sol(d.precio_unitario), 400, y + 4, { width: 60, align: 'right' })
      .text(sol(d.total), 480, y + 4, { width: 67, align: 'right' });
    y += h;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
  }

  // ── Totales ──
  y += 12;
  const fila = (label: string, val: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(bold ? DARK : GREY)
      .text(label, 340, y, { width: 130, align: 'right' })
      .text(val, 475, y, { width: 72, align: 'right' });
    y += bold ? 18 : 15;
  };
  fila('Subtotal:', sol(c.subtotal));
  if (c.descuento_monto > 0) fila('Descuento:', `- ${sol(c.descuento_monto)}`);
  fila('TOTAL:', sol(c.total), true);
  doc.font('Helvetica').fontSize(8).fillColor(GREY)
    .text(c.igv_incluido ? 'Precios incluyen IGV (18%).' : 'Precios sin IGV.', 340, y, { width: 207, align: 'right' });
  y += 16;

  // ── Notas ──
  if (c.notas) {
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text('Notas', 40, y + 6);
    doc.font('Helvetica').fillColor(GREY).fontSize(8.5).text(c.notas, 40, y + 20, { width: 515 });
    y += 40;
  }

  // ── Pie ──
  doc.fontSize(7.5).fillColor(GREY).text(
    'Cotización referencial — no es un comprobante de pago. Los precios pueden variar después de la fecha de validez.',
    40, 790, { width: 515, align: 'center' },
  );

  doc.end();
  return done;
}
