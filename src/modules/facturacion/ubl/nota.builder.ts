/**
 * Construye el XML UBL 2.1 de una Nota de Crédito (07) o Débito (08).
 * Referencia al comprobante que corrige (cac:BillingReference) y el motivo
 * (cac:DiscrepancyResponse, catálogo 09 crédito / 10 débito).
 * Devuelve el XML SIN firmar (con ext:ExtensionContent vacío para la firma).
 */
import { getSunatConfig } from '../sunat/sunat.config';
import { ItemComprobante } from '../comprobante.types';
import { calcularTotales } from './factura.builder';
import { leyendaMonto } from '../util/numero-letras';

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);
const f10 = (n: number) => (Math.round(n * 1e10) / 1e10).toFixed(10);
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s: string) => `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

export type TipoNota = '07' | '08'; // 07 crédito · 08 débito

export interface DatosNota {
  tipoNota: TipoNota;
  serie: string;          // FC01 / FD01
  correlativo: number;
  fechaEmision: string;
  horaEmision?: string;
  moneda?: string;
  // Documento de origen que se corrige
  refTipo: string;        // '01' factura · '03' boleta
  refSerieCorrelativo: string;  // F001-2
  motivoCodigo: string;   // cat.09 / cat.10
  motivoDescripcion: string;
  cliente: { tipoDoc: string; numDoc: string; razonSocial: string; direccion?: string };
  items: ItemComprobante[];
}

export function construirNotaXml(d: DatosNota): { xml: string; totales: ReturnType<typeof calcularTotales> } {
  const cfg = getSunatConfig();
  const em = cfg.emisor;
  const moneda = d.moneda ?? 'PEN';
  const igvPct = cfg.igvPct;
  const totales = calcularTotales({ ...d, tipoDoc: '01', serie: d.serie, correlativo: d.correlativo, fechaEmision: d.fechaEmision } as any);
  const id = `${d.serie}-${d.correlativo}`;

  const esCredito = d.tipoNota === '07';
  const ROOT = esCredito ? 'CreditNote' : 'DebitNote';
  const NS_DOC = esCredito
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2';
  const LINE = esCredito ? 'CreditNoteLine' : 'DebitNoteLine';
  const QTY = esCredito ? 'CreditedQuantity' : 'DebitedQuantity';

  const lineasXml = d.items.map((it, i) => {
    const t = totales.lineas[i];
    return `  <cac:${LINE}>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${QTY} unitCode="${esc(it.unidad ?? 'NIU')}">${it.cantidad}</cbc:${QTY}>
    <cbc:LineExtensionAmount currencyID="${moneda}">${f2(t.valorVenta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${moneda}">${f10(t.precioUnitarioConIgv)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${f2(t.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${moneda}">${f2(t.valorVenta)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${moneda}">${f2(t.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${f2(igvPct)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${esc(it.tipoAfectacion ?? '10')}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>${cdata(it.descripcion)}</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${moneda}">${f10(it.valorUnitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${LINE}>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<${ROOT} xmlns="${NS_DOC}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${esc(id)}</cbc:ID>
  <cbc:IssueDate>${esc(d.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(d.horaEmision ?? '00:00:00')}</cbc:IssueTime>
  <cbc:Note languageLocaleID="1000">${cdata(leyendaMonto(totales.total, moneda))}</cbc:Note>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${esc(d.refSerieCorrelativo)}</cbc:ReferenceID>
    <cbc:ResponseCode>${esc(d.motivoCodigo)}</cbc:ResponseCode>
    <cbc:Description>${cdata(d.motivoDescripcion)}</cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(d.refSerieCorrelativo)}</cbc:ID>
      <cbc:DocumentTypeCode>${esc(d.refTipo)}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:Signature>
    <cbc:ID>SignVaxa</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${esc(em.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${cdata(em.razonSocial)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference><cbc:URI>#SignVaxa</cbc:URI></cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${esc(em.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${cdata(em.nombreComercial)}</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${cdata(em.razonSocial)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID>${esc(em.ubigeo)}</cbc:ID>
          <cbc:AddressTypeCode>${esc(em.codLocal)}</cbc:AddressTypeCode>
          <cbc:CityName>${cdata(em.provincia)}</cbc:CityName>
          <cbc:CountrySubentity>${cdata(em.departamento)}</cbc:CountrySubentity>
          <cbc:District>${cdata(em.distrito)}</cbc:District>
          <cac:AddressLine><cbc:Line>${cdata(em.direccion)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${esc(d.cliente.tipoDoc)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${esc(d.cliente.numDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${cdata(d.cliente.razonSocial)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${moneda}">${f2(totales.igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${f2(totales.gravado)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${f2(totales.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${moneda}">${f2(totales.gravado)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${f2(totales.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${f2(totales.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineasXml}
</${ROOT}>`;

  return { xml, totales };
}
