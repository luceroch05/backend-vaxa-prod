/**
 * Construye el XML UBL del Resumen Diario de Boletas (RC) de SUNAT.
 * Las boletas (03) NO se envían por sendBill: se informan a SUNAT en un resumen
 * diario (sendSummary -> ticket -> getStatus). Este builder arma ese resumen.
 * El contenedor de firma (ext:ExtensionContent) va vacío para que el firmador
 * inserte la ds:Signature (igual que la factura).
 */
import { getSunatConfig } from '../sunat/sunat.config';

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const cdata = (s: string) => `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

/** Una boleta a informar dentro del resumen. Montos en soles. */
export interface BoletaResumen {
  serie: string;            // B001
  correlativo: number;      // 1
  clienteTipoDoc: string;   // cat.06: '0' sin doc, '1' DNI, '6' RUC...
  clienteNumDoc: string;
  gravado: number;          // base afecta (sin IGV)
  igv: number;
  total: number;            // importe total (con IGV)
}

export interface DatosResumen {
  id: string;               // 'RC-YYYYMMDD-N'
  fechaReferencia: string;  // 'YYYY-MM-DD' fecha de emisión de las boletas
  fechaGeneracion: string;  // 'YYYY-MM-DD' fecha en que se genera/envía el resumen
  boletas: BoletaResumen[];
}

/** Genera el XML UBL del resumen diario (sin firma). */
export function construirResumenXml(d: DatosResumen): { xml: string } {
  const cfg = getSunatConfig();
  const em = cfg.emisor;
  const moneda = 'PEN';

  const lineas = d.boletas.map((b, i) => `  <sac:SummaryDocumentsLine>
    <cbc:LineID>${i + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>
    <cbc:ID>${esc(`${b.serie}-${b.correlativo}`)}</cbc:ID>
    <cac:AccountingCustomerParty>
      <cbc:CustomerAssignedAccountID>${esc(b.clienteNumDoc)}</cbc:CustomerAssignedAccountID>
      <cbc:AdditionalAccountID>${esc(b.clienteTipoDoc)}</cbc:AdditionalAccountID>
    </cac:AccountingCustomerParty>
    <cac:Status>
      <cbc:ConditionCode>1</cbc:ConditionCode>
    </cac:Status>
    <sac:TotalAmount currencyID="${moneda}">${f2(b.total)}</sac:TotalAmount>
    <sac:BillingPayment>
      <cbc:PaidAmount currencyID="${moneda}">${f2(b.gravado)}</cbc:PaidAmount>
      <cbc:InstructionID>01</cbc:InstructionID>
    </sac:BillingPayment>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${f2(b.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxAmount currencyID="${moneda}">${f2(b.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID>1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </sac:SummaryDocumentsLine>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${esc(d.id)}</cbc:ID>
  <cbc:ReferenceDate>${esc(d.fechaReferencia)}</cbc:ReferenceDate>
  <cbc:IssueDate>${esc(d.fechaGeneracion)}</cbc:IssueDate>
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
    <cbc:CustomerAssignedAccountID>${esc(em.ruc)}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${cdata(em.razonSocial)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
${lineas}
</SummaryDocuments>`;

  return { xml };
}
