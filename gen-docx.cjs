/* Genera un .docx (Word) a partir de MANUAL_USUARIO.md con los colores de Vaxa.
 * No usa librerías de docx: arma el OOXML a mano y lo empaqueta con archiver.
 * Uso: node gen-docx.cjs <ruta-md> <ruta-salida-docx> */
const fs = require('fs');
const archiver = require('archiver');

const MD_PATH  = process.argv[2];
const OUT_PATH = process.argv[3];

/* ── Paleta Vaxa ──────────────────────────────────────────── */
const EMERALD   = '059669'; // primario
const EMERALD_D = '047857'; // secundario
const GREEN_TXT = '065F46'; // texto verde oscuro
const SOFT      = 'ECFDF5'; // verde suave (fondos)
const INK       = '0D0E12'; // texto principal
const GREY      = '6B7280'; // texto secundario
const HAIR      = 'E5E7EB'; // bordes

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Convierte texto con **negrita** y `código` en runs OOXML. */
function runs(text, base = {}) {
  const out = [];
  // Tokeniza por **bold**, `code` y *cursiva*
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m;
  const push = (t, extra) => { if (t) out.push(run(t, { ...base, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**'))      push(tok.slice(2, -2), { b: true });
    else if (tok.startsWith('`'))  push(tok.slice(1, -1), { mono: true });
    else                           push(tok.slice(1, -1), { i: true });
    last = re.lastIndex;
  }
  push(text.slice(last));
  return out.join('');
}

function run(text, o = {}) {
  const rPr = [];
  rPr.push(`<w:rFonts w:ascii="${o.mono ? 'Consolas' : 'Calibri'}" w:hAnsi="${o.mono ? 'Consolas' : 'Calibri'}"/>`);
  if (o.b)     rPr.push('<w:b/>');
  if (o.i)     rPr.push('<w:i/>');
  if (o.color) rPr.push(`<w:color w:val="${o.color}"/>`);
  if (o.sz)    rPr.push(`<w:sz w:val="${o.sz}"/>`);
  if (o.mono)  rPr.push(`<w:color w:val="${EMERALD_D}"/>`);
  return `<w:r><w:rPr>${rPr.join('')}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(inner, o = {}) {
  const pPr = [];
  const spacing = `<w:spacing w:before="${o.before ?? 40}" w:after="${o.after ?? 80}" w:line="276" w:lineRule="auto"/>`;
  pPr.push(spacing);
  if (o.shd)    pPr.push(`<w:shd w:val="clear" w:fill="${o.shd}"/>`);
  if (o.bar)    pPr.push(`<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${o.bar}"/></w:pBdr>`);
  if (o.align)  pPr.push(`<w:jc w:val="${o.align}"/>`);
  if (o.ind)    pPr.push(`<w:ind w:left="${o.ind}"/>`);
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${inner}</w:p>`;
}

/* ── Tabla con cabecera esmeralda ─────────────────────────── */
function table(headers, rows) {
  const W = 9300;
  const colW = Math.floor(W / headers.length);
  const grid = headers.map(() => `<w:gridCol w:w="${colW}"/>`).join('');

  const cell = (content, { fill, color, b, header } = {}) => {
    const tcPr = [`<w:tcW w:w="${colW}" w:type="dxa"/>`];
    if (fill) tcPr.push(`<w:shd w:val="clear" w:fill="${fill}"/>`);
    tcPr.push(`<w:tcBorders>${['top','bottom','left','right'].map(s => `<w:${s} w:val="single" w:sz="4" w:color="${HAIR}"/>`).join('')}</w:tcBorders>`);
    tcPr.push('<w:vAlign w:val="center"/>');
    const p = `<w:p><w:pPr><w:spacing w:before="30" w:after="30"/></w:pPr>${runs(content, { b, color, sz: header ? 20 : 20 })}</w:p>`;
    return `<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${p}</w:tc>`;
  };

  const headRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map(h => cell(h, { fill: EMERALD, color: 'FFFFFF', b: true, header: true })).join('')}</w:tr>`;
  const bodyRows = rows.map((r, i) =>
    `<w:tr>${r.map(c => cell(c, { fill: i % 2 ? SOFT : 'FFFFFF' })).join('')}</w:tr>`
  ).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders>${['top','bottom','left','right','insideH','insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:color="${HAIR}"/>`).join('')}</w:tblBorders><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headRow}${bodyRows}</w:tbl>`
       + `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

/* ── Parser de Markdown (acotado a lo que usa el manual) ───── */
function mdToBody(md) {
  const lines = md.split(/\r?\n/);
  const body = [];
  let i = 0;
  let inCode = false, codeBuf = [];

  while (i < lines.length) {
    let line = lines[i];

    // Bloques de código ```
    if (/^```/.test(line)) {
      if (inCode) {
        codeBuf.forEach(cl => body.push(para(run(cl || ' ', { mono: true, sz: 18 }), { shd: 'F3F4F6', before: 0, after: 0 })));
        body.push(para('', { after: 80 }));
        codeBuf = []; inCode = false;
      } else { inCode = true; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // Tablas
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      body.push(table(headers, rows));
      continue;
    }

    // Encabezados
    if (/^#\s+/.test(line)) {
      body.push(para(runs(line.replace(/^#\s+/, ''), { b: true, color: EMERALD, sz: 44 }), { before: 80, after: 160 }));
      i++; continue;
    }
    if (/^##\s+/.test(line)) {
      body.push(para(runs(line.replace(/^##\s+/, ''), { b: true, color: EMERALD_D, sz: 30 }), { before: 280, after: 120, bar: EMERALD }));
      i++; continue;
    }
    if (/^###\s+/.test(line)) {
      body.push(para(runs(line.replace(/^###\s+/, ''), { b: true, color: GREEN_TXT, sz: 24 }), { before: 180, after: 80 }));
      i++; continue;
    }

    // Separador horizontal
    if (/^---\s*$/.test(line)) {
      body.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${HAIR}"/></w:pBdr></w:pPr></w:p>`);
      i++; continue;
    }

    // Cita / nota
    if (/^>\s?/.test(line)) {
      body.push(para(runs(line.replace(/^>\s?/, ''), { i: true, color: GREEN_TXT, sz: 20 }), { shd: SOFT, bar: EMERALD, before: 40, after: 80 }));
      i++; continue;
    }

    // Lista numerada
    let m;
    if ((m = line.match(/^(\d+)\.\s+(.*)/))) {
      body.push(para(runs(`${m[1]}.  ${m[2]}`), { ind: 360, before: 10, after: 40 }));
      i++; continue;
    }

    // Viñetas (con o sin sangría)
    if ((m = line.match(/^(\s*)[-*]\s+(.*)/))) {
      const lvl = m[1].length >= 2 ? 720 : 360;
      body.push(para(run('•  ', { color: EMERALD, b: true }) + runs(m[2]), { ind: lvl, before: 10, after: 40 }));
      i++; continue;
    }

    // Línea vacía
    if (/^\s*$/.test(line)) { i++; continue; }

    // Párrafo normal
    body.push(para(runs(line)));
    i++;
  }
  return body.join('');
}

/* ── Ensamblar el .docx ───────────────────────────────────── */
const md = fs.readFileSync(MD_PATH, 'utf8');
const bodyXml = mdToBody(md);

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="${INK}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const out = fs.createWriteStream(OUT_PATH);
const zip = new archiver.ZipArchive({ zlib: { level: 9 } });
zip.pipe(out);
zip.append(contentTypes, { name: '[Content_Types].xml' });
zip.append(rels,         { name: '_rels/.rels' });
zip.append(documentXml,  { name: 'word/document.xml' });
zip.append(docRels,      { name: 'word/_rels/document.xml.rels' });
zip.append(stylesXml,    { name: 'word/styles.xml' });
out.on('close', () => console.log('OK', OUT_PATH, zip.pointer(), 'bytes'));
zip.on('error', (e) => { console.error(e); process.exit(1); });
zip.finalize();
