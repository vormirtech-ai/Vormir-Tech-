'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { readWorkbook, readDelimited, serialToIso } = require('../src/core/util/xlsx');

/** Builds a real (tiny) .xlsx in memory so the reader is tested against a ZIP. */
function makeXlsx(parts) {
  const files = [];
  const chunks = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt32LE(zlib.crc32 ? zlib.crc32(data) : 0, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);
    files.push({ nameBuf, deflated, data, offset });
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralStart = offset;
  for (const f of files) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(f.deflated.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(f.nameBuf.length, 28);
    central.writeUInt32LE(f.offset, 42);
    chunks.push(central, f.nameBuf);
    offset += central.length + f.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

const SHARED = ['Product Name', 'Batch No', 'Qty', 'Paracetamol 500mg', 'Azithro & Co', 'PCM777', 'BN900'];
const sst = `<?xml version="1.0"?><sst count="${SHARED.length}">${SHARED.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
const sheet = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>50</v></c></row>
  <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>30</v></c></row>
</sheetData></worksheet>`;

test('reads a real xlsx workbook without any third-party library', () => {
  const buffer = makeXlsx({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/sharedStrings.xml': sst,
    'xl/worksheets/sheet1.xml': sheet
  });
  const rows = readWorkbook(buffer);
  assert.deepEqual(rows[0], ['Product Name', 'Batch No', 'Qty']);
  assert.deepEqual(rows[1], ['Paracetamol 500mg', 'PCM777', '50']);
  assert.equal(rows[2][0], 'Azithro & Co');
});

test('rejects a file that is not a workbook', () => {
  assert.throws(() => readWorkbook(Buffer.from('hello world')), /not a valid .xlsx/);
});

test('csv reader handles quotes, semicolons and blank lines', () => {
  const rows = readDelimited('Name;Qty\n"Amox, 500";5\n\n"He said ""hi""";2\n');
  assert.deepEqual(rows, [['Name', 'Qty'], ['Amox, 500', '5'], ['He said "hi"', '2']]);
});

test('excel serial dates convert to ISO', () => {
  assert.equal(serialToIso(45000), '2023-03-15');
  assert.equal(serialToIso(0), null);
});
