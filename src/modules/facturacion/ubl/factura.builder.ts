/**
 * Construye el XML UBL 2.1 de una Factura (01) o Boleta (03) de SUNAT.
 * Devuelve el XML SIN firmar, con el contenedor de firma (ext:ExtensionContent)
 * vacío para que el firmador inserte ahí la ds:Signature.
 */
import { getSunatConfig } from '../sunat/sunat.config';
import { DatosComprobante, TotalesComprobante } from '../comprobante.types';
import { leyendaMonto } from '../util/numero-letras';

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);
const f10 = (n: number) => (Math.round(n * 1e10) / 1e10).toFixed(10);

/** Escapa texto para nodo XML. Para campos libres usamos CDATA aparte. */
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const cdata = (s: string) => `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

/** Calcula los totales del comprobante (asume afectación gravada '10'). */
export function calcularTotales(d: DatosComprobante): TotalesComprobante {
  const igvPct = getSunatConfig().igvPct / 100;
  let gravado = 0;
  let igv = 0;
  const lineas = d.items.map((it) => {
    const valorVenta = r2(it.cantidad * it.valorUnitario);
    const igvLinea = r2(valorVenta * igvPct);
    gravado += valorVenta;
    igv += igvLinea;
    return {
      valorVenta,
      igv: igvLinea,
      precioUnitarioConIgv: r2(it.valorUnitario * (1 + igvPct)),
    };
  });
  gravado = r2(gravado);
  igv = r2(igv);
  return { gravado, igv, total: r2(gravado + igv), lineas };
}

/** Genera el XML UBL 2.1 (sin firma). */
export function construirFacturaXml(d: DatosComprobante): { xml: string; totales: TotalesComprobante } {
  const cfg = getSunatConfig();
  const em = cfg.emisor;
  const moneda = d.moneda ?? 'PEN';
  const igvPct = cfg.igvPct;
  const totales = calcularTotales(d);
  const id = `${d.serie}-${d.correlativo}`;
  const tipoNombre = d.tipoDoc === '01' ? 'Factura' : 'Boleta';

  const lineasXml = d.items.map((it, i) => {
    const t = totales.lineas[i];
    return `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(it.unidad ?? 'NIU')}">${it.cantidad}</cbc:InvoicedQuantity>
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
            <cbc:ID>1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
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
  </cac:InvoiceLine>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ProfileID schemeName="Tipo de Operacion" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo17">0101</cbc:ProfileID>
  <cbc:ID>${esc(id)}</cbc:ID>
  <cbc:IssueDate>${esc(d.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(d.horaEmision ?? '00:00:00')}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${d.tipoDoc}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000">${cdata(leyendaMonto(totales.total, moneda))}</cbc:Note>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
  <cac:Signature>
    <cbc:ID>SignVaxa</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${esc(em.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${cdata(em.razonSocial)}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignVaxa</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${esc(em.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${cdata(em.nombreComercial)}</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${cdata(em.razonSocial)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID>${esc(em.ubigeo)}</cbc:ID>
          <cbc:AddressTypeCode>${esc(em.codLocal)}</cbc:AddressTypeCode>
          <cbc:CityName>${cdata(em.provincia)}</cbc:CityName>
          <cbc:CountrySubentity>${cdata(em.departamento)}</cbc:CountrySubentity>
          <cbc:District>${cdata(em.distrito)}</cbc:District>
          <cac:AddressLine>
            <cbc:Line>${cdata(em.direccion)}</cbc:Line>
          </cac:AddressLine>
          <cac:Country>
            <cbc:IdentificationCode>PE</cbc:IdentificationCode>
          </cac:Country>
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
        <cbc:RegistrationName>${cdata(d.cliente.razonSocial)}</cbc:RegistrationName>${d.cliente.direccion ? `
        <cac:RegistrationAddress>
          <cac:AddressLine>
            <cbc:Line>${cdata(d.cliente.direccion)}</cbc:Line>
          </cac:AddressLine>
        </cac:RegistrationAddress>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${moneda}">${f2(totales.igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${f2(totales.gravado)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${f2(totales.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>1000</cbc:ID>
          <cbc:Name>IGV</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
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
</Invoice>`;

  // `tipoNombre` queda disponible por si se requiere en logs/PDF.
  void tipoNombre;
  return { xml, totales };
}
