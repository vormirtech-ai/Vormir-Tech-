"""Reading a distributor's bill out of .xlsx or .csv."""
import io
import unittest
import zipfile

from tests.helpers import sys  # noqa: F401

from medv.services.importer import detect_columns, find_header_row, parse_expiry, parse_pack, to_number
from medv.util.sheets import read_any, read_delimited, read_workbook, serial_to_iso

SHARED = ["Product Name", "Batch No", "Qty", "Paracetamol 500mg", "Azithro & Co", "PCM777", "BN900"]
SHEET = """<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>50</v></c></row>
  <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>30</v></c></row>
</sheetData></worksheet>"""


def make_xlsx() -> bytes:
    strings = "".join(f"<si><t>{s.replace('&', '&amp;')}</t></si>" for s in SHARED)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        archive.writestr("xl/sharedStrings.xml", f'<?xml version="1.0"?><sst>{strings}</sst>')
        archive.writestr("xl/worksheets/sheet1.xml", SHEET)
    return buffer.getvalue()


class SheetTests(unittest.TestCase):
    def test_reads_a_real_xlsx(self):
        rows = read_workbook(make_xlsx())
        self.assertEqual(rows[0], ["Product Name", "Batch No", "Qty"])
        self.assertEqual(rows[1], ["Paracetamol 500mg", "PCM777", "50"])
        self.assertEqual(rows[2][0], "Azithro & Co")

    def test_rejects_a_file_that_is_not_a_workbook(self):
        with self.assertRaises(ValueError):
            read_workbook(b"hello world")

    def test_csv_handles_quotes_and_semicolons(self):
        rows = read_delimited('Name;Qty\n"Amox, 500";5\n\n"He said ""hi""";2\n')
        self.assertEqual(rows, [["Name", "Qty"], ["Amox, 500", "5"], ['He said "hi"', "2"]])

    def test_read_any_detects_the_format(self):
        self.assertEqual(len(read_any(make_xlsx(), "bill.xlsx")), 3)
        self.assertEqual(read_any(b"a,b\n1,2\n", "bill.csv"), [["a", "b"], ["1", "2"]])

    def test_excel_serial_dates(self):
        self.assertEqual(serial_to_iso(45000), "2023-03-15")
        self.assertIsNone(serial_to_iso(0))


class ColumnDetectionTests(unittest.TestCase):
    def test_columns_are_found_by_keyword(self):
        header = ["Sr", "Product Name", "Pack", "Batch No", "Exp Date", "Qty", "Free", "MRP",
                  "Rate", "Disc%", "GST%"]
        mapping = detect_columns(header)
        self.assertEqual(mapping["name"], 1)
        self.assertEqual(mapping["batch"], 3)
        self.assertEqual(mapping["expiry"], 4)
        self.assertEqual(mapping["qty"], 5)
        self.assertEqual(mapping["rate"], 8)

    def test_header_row_is_found_below_a_letterhead(self):
        rows = [["ACME DISTRIBUTORS"], ["Invoice 123"], ["Product", "Batch", "Qty", "Rate"],
                ["Paracetamol", "B1", "10", "1.5"]]
        index, mapping = find_header_row(rows)
        self.assertEqual(index, 2)
        self.assertIn("name", mapping)

    def test_expiry_shapes_seen_on_real_bills(self):
        for raw, expected in (("06/2028", "2028-06"), ("6/28", "2028-06"), ("Jun-28", "2028-06"),
                              ("2028-06", "2028-06"), ("30/06/2028", "2028-06")):
            self.assertEqual(parse_expiry(raw), expected, raw)
        self.assertIsNone(parse_expiry("rubbish"))

    def test_pack_sizes(self):
        self.assertEqual(parse_pack("10x10"), 10)
        self.assertEqual(parse_pack("1x15 TAB"), 15)
        self.assertEqual(parse_pack("30 ML"), 30)

    def test_numbers_with_currency_and_commas(self):
        self.assertEqual(to_number("₹ 1,234.50"), 1234.5)
        self.assertEqual(to_number(""), 0.0)


if __name__ == "__main__":
    unittest.main()
