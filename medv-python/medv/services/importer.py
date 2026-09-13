"""
Purchase-bill import.

Distributor sheets never share a layout, so columns are detected from the header
row by keyword and anything ambiguous comes back to the screen as an editable
preview instead of being guessed at.
"""

from __future__ import annotations
import base64
import re

from .. import db
from ..util.dates import is_expiry_month
from ..util.errors import assert_that
from ..util.money import r2, r3
from ..util.sheets import read_any, serial_to_iso
from . import products, settings

FIELDS = {
    "name": ["product", "item", "medicine", "description", "particulars", "name", "product name", "item name"],
    "pack": ["pack", "packing"],
    "batch": ["batch", "batch no", "batchno", "b.no", "bno", "lot"],
    "expiry": ["expiry", "exp", "exp date", "expdt", "exp.dt", "expiry date"],
    "qty": ["qty", "quantity", "qnty", "nos", "units", "pcs"],
    "free": ["free", "free qty", "scheme", "bonus"],
    "mrp": ["mrp", "m.r.p", "mrp rs", "retail"],
    "rate": ["rate", "ptr", "purchase rate", "price", "net rate", "basic", "trade rate"],
    "disc": ["disc", "discount", "disc %", "dis%", "cd"],
    "gst": ["gst", "gst %", "tax", "igst", "cgst+sgst", "gst rate", "vat"],
    "hsn": ["hsn", "hsn code"],
    "mfr": ["mfr", "manufacturer", "company", "mfg", "marketer"],
}
GST_RATES = (0, 5, 12, 18, 28)
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def _normalise_header(cell) -> str:
    return re.sub(r"\s+", " ", str(cell or "").lower().replace(".", " ").replace("_", " ")).strip()


def detect_columns(header_row) -> dict:
    mapping: dict[str, int] = {}
    headers = [(index, _normalise_header(cell)) for index, cell in enumerate(header_row)]
    for index, head in headers:
        if not head:
            continue
        for field, keys in FIELDS.items():
            if field not in mapping and head in keys:
                mapping[field] = index
                break
        else:
            for field, keys in FIELDS.items():
                if field not in mapping and any(key in head for key in keys):
                    mapping[field] = index
                    break
    return mapping


def find_header_row(rows):
    """The header is the first row that names a product and a quantity or rate."""
    for index, row in enumerate(rows[:25]):
        mapping = detect_columns(row)
        if "name" in mapping and ("qty" in mapping or "rate" in mapping):
            return index, mapping
    return -1, {}


def to_number(value) -> float:
    if value in (None, ""):
        return 0.0
    cleaned = re.sub(r"[^0-9.+-]", "", str(value).replace("₹", "").replace(",", ""))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_expiry(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    if is_expiry_month(raw):
        return raw
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw[:7]
    try:
        serial = float(raw)
        if serial > 1000:
            iso = serial_to_iso(serial)
            if iso:
                return iso[:7]
    except ValueError:
        pass
    match = re.match(r"^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$", raw)
    if match:
        month = str(min(12, max(1, int(match.group(1))))).zfill(2)
        year = f"20{match.group(2)}" if len(match.group(2)) == 2 else match.group(2)
        return f"{year}-{month}"
    match = re.match(r"^([A-Za-z]{3,9})[\s-]*(\d{2}|\d{4})$", raw)
    if match and match.group(1)[:3].lower() in MONTHS:
        month = str(MONTHS.index(match.group(1)[:3].lower()) + 1).zfill(2)
        year = f"20{match.group(2)}" if len(match.group(2)) == 2 else match.group(2)
        return f"{year}-{month}"
    match = re.match(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$", raw)
    if match:
        month = str(min(12, max(1, int(match.group(2))))).zfill(2)
        year = f"20{match.group(3)}" if len(match.group(3)) == 2 else match.group(3)
        return f"{year}-{month}"
    return None


def parse_pack(value) -> int:
    raw = str(value or "").lower()
    cross = re.search(r"(\d+)\s*[x*]\s*(\d+)", raw)
    if cross:
        return max(1, int(cross.group(2)))
    plain = re.search(r"(\d+)", raw)
    return max(1, int(plain.group(1))) if plain else 1


def match_product(name):
    clean = str(name or "").strip()
    if not clean:
        return None
    exact = db.one_row("SELECT * FROM products WHERE lower(name) = lower(?) AND active = 1", (clean,))
    if exact:
        return exact
    first_word = clean.split()[0] if clean.split() else clean
    like = db.one_row(
        "SELECT * FROM products WHERE name LIKE ? AND active = 1 ORDER BY length(name) LIMIT 1",
        (f"{first_word}%",))
    if like and like["name"].lower().startswith(clean[:4].lower()):
        return like
    return None


def _decode(base64_text="", text="") -> bytes:
    if base64_text:
        return base64.b64decode(base64_text)
    return str(text).encode("utf-8")


def preview(filename="", base64_data="", text="", **kwargs):
    """Parses a sheet into draft purchase lines. Nothing is written yet."""
    data = _decode(base64_data or kwargs.get("base64", ""), text)
    assert_that(len(data) > 0, "That file is empty.")
    assert_that(len(data) < 12 * 1024 * 1024, "That file is larger than 12 MB — please split it.")
    rows = read_any(data, filename)
    assert_that(len(rows) > 1, "No rows could be read from that file.")
    index, mapping = find_header_row(rows)
    assert_that(index >= 0,
                "Could not find a header row. The sheet needs column titles such as Product, "
                "Batch, Expiry, Qty, Rate, MRP.")

    default_gst = settings.num("default_gst_rate", 12)
    lines = []
    for row in rows[index + 1:]:
        def cell(field):
            position = mapping.get(field)
            if position is None or position >= len(row):
                return ""
            return row[position]

        name = str(cell("name")).strip()
        if not name or re.match(r"^(total|grand total|sub total|net amount|amount)", name, re.I):
            continue
        qty = round(to_number(cell("qty")))
        rate = to_number(cell("rate"))
        if qty <= 0 and rate <= 0:
            continue
        matched = match_product(name)
        expiry = parse_expiry(cell("expiry"))
        gst_raw = to_number(cell("gst"))
        issues = []
        if not matched:
            issues.append("New medicine — will be created on import")
        if not expiry:
            issues.append("Expiry missing or unreadable")
        if qty <= 0:
            issues.append("Quantity missing")
        if rate <= 0:
            issues.append("Rate missing")
        lines.append({
            "source_name": name,
            "product_id": matched["id"] if matched else None,
            "product_name": matched["name"] if matched else name,
            "manufacturer": str(cell("mfr")).strip(),
            "hsn": str(cell("hsn")).strip() or "3004",
            "pack_size": matched["pack_size"] if matched else (parse_pack(cell("pack")) if "pack" in mapping else 1),
            "batch_no": str(cell("batch")).strip().upper() or "NA",
            "expiry": expiry,
            "qty_units": max(0, qty),
            "free_units": max(0, round(to_number(cell("free")))),
            "mrp": r2(to_number(cell("mrp"))),
            "rate_per_unit": r3(rate),
            "disc_pct": min(100.0, max(0.0, to_number(cell("disc")))),
            "gst_rate": gst_raw if int(gst_raw) in GST_RATES else (matched["gst_rate"] if matched else default_gst),
            "issues": issues,
        })
    assert_that(lines, "No usable item rows were found in that file.")
    return {
        "filename": filename,
        "headerRow": index + 1,
        "columns": mapping,
        "detected": list(mapping),
        "lines": lines,
        "summary": {
            "rows": len(lines),
            "newProducts": sum(1 for line in lines if not line["product_id"]),
            "withIssues": sum(1 for line in lines if line["issues"]),
            "value": r2(sum(line["qty_units"] * line["rate_per_unit"] for line in lines)),
        },
    }


def materialise(actor, payload):
    """Creates any medicine the sheet introduced, returning lines ready to save."""
    lines = payload.get("lines") or []
    assert_that(isinstance(lines, list) and lines, "Nothing to import.")
    with db.tx():
        out = []
        for line in lines:
            product_id = int(line["product_id"]) if line.get("product_id") else None
            if not product_id:
                created = products.save(actor, {
                    "name": line.get("product_name") or line.get("source_name"),
                    "manufacturer": line.get("manufacturer", ""),
                    "hsn": line.get("hsn") or "3004",
                    "gst_rate": line.get("gst_rate"),
                    "pack_size": line.get("pack_size") or 1,
                    "category": "Medicine",
                })
                product_id = created["id"]
            out.append({
                "product_id": product_id,
                "batch_no": line.get("batch_no"),
                "expiry": line.get("expiry"),
                "mrp": line.get("mrp"),
                "qty_units": line.get("qty_units"),
                "free_units": line.get("free_units"),
                "rate_per_unit": line.get("rate_per_unit"),
                "disc_pct": line.get("disc_pct"),
                "gst_rate": line.get("gst_rate"),
            })
        return out


def import_products(actor, payload):
    """Medicine-master import — used to load an opening catalogue quickly."""
    data = _decode(payload.get("base64", ""), payload.get("text", ""))
    rows = read_any(data, payload.get("filename", ""))
    index, mapping = find_header_row(rows)
    assert_that(index >= 0, "Could not find a header row with a product name column.")
    created, skipped = [], []
    with db.tx():
        for row in rows[index + 1:]:
            def cell(field):
                position = mapping.get(field)
                if position is None or position >= len(row):
                    return ""
                return row[position]

            name = str(cell("name")).strip()
            if not name:
                continue
            gst_raw = to_number(cell("gst"))
            try:
                product = products.save(actor, {
                    "name": name,
                    "manufacturer": str(cell("mfr")).strip(),
                    "hsn": str(cell("hsn")).strip() or "3004",
                    "gst_rate": gst_raw if int(gst_raw) in GST_RATES else settings.num("default_gst_rate", 12),
                    "pack_size": parse_pack(cell("pack")) if "pack" in mapping else 1,
                })
                created.append(product["name"])
            except Exception as error:  # one bad row must not stop the import
                skipped.append({"name": name, "reason": str(error)})
    return {"created": len(created), "skipped": skipped, "names": created[:50]}
