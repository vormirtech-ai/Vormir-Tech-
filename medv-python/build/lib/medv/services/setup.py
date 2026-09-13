"""First-run wizard and the optional sample catalogue."""

from __future__ import annotations
from .. import db
from ..util.dates import add_months, today
from ..util.errors import assert_that
from ..util import validate as v
from . import audit, auth, parties, products, purchases, settings

SAMPLE_PRODUCTS = [
    ("Paracetamol 500mg Tablet", "Paracetamol", "Cipla", "Tablet", 10, "Strip", "Tablet", 12, 24.5, 18.2, "A1"),
    ("Azithromycin 500mg Tablet", "Azithromycin", "Alkem", "Tablet", 5, "Strip", "Tablet", 12, 118.0, 86.4, "A2"),
    ("Amoxycillin 500mg Capsule", "Amoxycillin", "Sun Pharma", "Tablet", 10, "Strip", "Capsule", 12, 96.0, 71.5, "A3"),
    ("Pantoprazole 40mg Tablet", "Pantoprazole", "Zydus", "Tablet", 15, "Strip", "Tablet", 12, 152.0, 108.0, "B1"),
    ("Metformin 500mg Tablet", "Metformin", "USV", "Tablet", 20, "Strip", "Tablet", 12, 68.0, 47.5, "B2"),
    ("Amlodipine 5mg Tablet", "Amlodipine", "Torrent", "Tablet", 10, "Strip", "Tablet", 12, 42.0, 29.0, "B3"),
    ("Cetirizine 10mg Tablet", "Cetirizine", "Dr Reddy's", "Tablet", 10, "Strip", "Tablet", 12, 32.0, 21.0, "C1"),
    ("Cough Syrup 100ml", "Dextromethorphan", "Glenmark", "Syrup", 1, "Bottle", "Bottle", 12, 128.0, 92.0, "C2"),
    ("ORS Powder Sachet", "Oral Rehydration Salts", "FDC", "General", 1, "Sachet", "Sachet", 5, 22.0, 15.0, "C3"),
    ("Insulin Glargine 100IU", "Insulin Glargine", "Biocon", "Injection", 1, "Vial", "Vial", 5, 460.0, 352.0, "F1"),
    ("Vitamin D3 60000 IU", "Cholecalciferol", "Mankind", "General", 4, "Strip", "Sachet", 12, 89.0, 62.0, "D1"),
    ("Digital Thermometer", "", "Dr Morepen", "Surgical", 1, "Piece", "Piece", 18, 240.0, 165.0, "S1"),
    ("Surgical Face Mask", "", "Romsons", "Surgical", 50, "Box", "Piece", 5, 250.0, 150.0, "S2"),
    ("Betadine Ointment 20g", "Povidone Iodine", "Win-Medicare", "Ointment", 1, "Tube", "Tube", 12, 148.0, 106.0, "S3"),
]


def status(**_):
    return {
        "complete": settings.flag("setup_complete"),
        "settings": settings.all_settings(),
        "users": db.scalar("SELECT COUNT(*) FROM users WHERE active = 1", (), 0),
        "hasData": db.scalar("SELECT COUNT(*) FROM sales", (), 0) > 0,
    }


def load_sample_data(actor):
    """A small demo catalogue so a new installation has something to click."""
    supplier = parties.save_supplier(actor, {
        "name": "Nagpur Medical Distributors", "phone": "9226406057",
        "address": "Itwari Market, Nagpur", "gstin": "27ABCDE1234F1Z5",
        "dl_no": "MH-NAG-20B-123456"})
    parties.save_supplier(actor, {"name": "Sanjivani Pharma Agencies", "phone": "9834523160",
                                  "address": "Sitabuldi, Nagpur"})
    parties.save_doctor(actor, {"name": "Dr. A. Deshmukh", "clinic": "Shree Clinic",
                                "reg_no": "MMC-45821", "commission_pct": 2})
    parties.save_doctor(actor, {"name": "Dr. S. Iyer", "clinic": "City Hospital", "reg_no": "MMC-31204"})
    for name, phone, address in (("Ramesh Patil", "9822012345", "Dharampeth, Nagpur"),
                                 ("Sunita Kale", "9765098765", "Sadar, Nagpur"),
                                 ("Imran Sheikh", "9970011223", "Mominpura, Nagpur")):
        parties.save_customer(actor, {"name": name, "phone": phone, "address": address})

    created = []
    for name, generic, mfr, category, pack, pack_label, unit_label, gst, mrp, ptr, rack in SAMPLE_PRODUCTS:
        product = products.save(actor, {
            "name": name, "generic": generic, "manufacturer": mfr, "category": category,
            "pack_size": pack, "pack_label": pack_label, "unit_label": unit_label, "gst_rate": gst,
            "rack": rack, "reorder_level": pack * 2,
            "hsn": "9018" if category == "Surgical" else "3004"})
        created.append((product, mrp, ptr, pack))

    # One opening purchase so every medicine has stock in a real batch.
    purchases.create(actor, {
        "date": today(),
        "supplier_id": supplier["id"],
        "ref_no": "OPENING-01",
        "payment_mode": "Credit",
        "paid": 0,
        "notes": "Opening stock (sample data)",
        "items": [{
            "product_id": product["id"],
            "batch_no": f"B{1001 + index}",
            "expiry": add_months(today(), 14 + (index % 10))[:7],
            "mrp": mrp,
            "qty_units": pack * 10,
            "free_units": 0,
            "rate_per_unit": round(ptr / pack, 3),
            "disc_pct": 0,
            "gst_rate": product["gst_rate"],
        } for index, (product, mrp, ptr, pack) in enumerate(created)],
    })
    return {"products": len(created)}


def complete(actor, payload):
    store = {
        "store_name": v.text(payload.get("store_name"), "Store name", required=True, max_len=120),
        "store_tagline": v.text(payload.get("store_tagline"), "Tagline", max_len=80),
        "store_address": v.text(payload.get("store_address"), "Address", max_len=300),
        "store_city": v.text(payload.get("store_city"), "City", max_len=80),
        "store_state": v.text(payload.get("store_state"), "State", max_len=80),
        "store_pincode": v.text(payload.get("store_pincode"), "PIN code", max_len=10),
        "store_phone": v.phone(payload.get("store_phone"), "Phone"),
        "store_email": v.text(payload.get("store_email"), "Email", max_len=120),
        "store_gstin": v.gstin(payload["store_gstin"]) if payload.get("store_gstin") else "",
        "store_dl_no": v.text(payload.get("store_dl_no"), "Drug licence number", max_len=60),
        "store_fssai": v.text(payload.get("store_fssai"), "FSSAI number", max_len=30),
        "invoice_prefix": (v.text(payload.get("invoice_prefix"), "Invoice prefix", max_len=8) or "INV").upper(),
        "default_gst_rate": str(v.number(payload.get("default_gst_rate"), "Default GST %",
                                         minimum=0, maximum=28, fallback=12)),
        "print_format": v.one_of(payload.get("print_format"), "Print format", ("a4", "a5", "thermal"), "a5"),
        "expiry_alert_days": str(v.integer(payload.get("expiry_alert_days"), "Expiry alert (days)",
                                           minimum=7, maximum=365, fallback=90)),
    }
    password = str(payload.get("admin_password") or "")
    assert_that(len(password) >= 4, "Set an administrator password of at least 4 characters.")
    assert_that(password != "admin123", "Please choose a password other than the default one.")

    acting = actor or {"id": None, "username": "setup", "role": "admin"}
    with db.tx():
        for key, value in store.items():
            settings.put(key, value)
        auth.set_admin_password(password)
        settings.put("setup_complete", "1")
        audit.log(acting, "setup.complete", "settings", None, {"store": store["store_name"]})

    if payload.get("sample_data"):
        try:
            load_sample_data({"id": None, "username": acting.get("username", "setup"), "role": "admin"})
        except Exception as error:  # sample data is a convenience, never a blocker
            audit.log(acting, "setup.sample_failed", "settings", None, str(error))
    return {"ok": True, "settings": settings.all_settings()}
