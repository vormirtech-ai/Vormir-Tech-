"""GSTR-1, GSTR-2, GSTR-3B and a reconciliation check before you file."""

from __future__ import annotations
from .. import db
from ..util.dates import financial_year, month_end, month_start, today
from ..util.money import r2
from . import settings


def period(from_date=None, to_date=None, month=None, **kwargs):
    from_date = from_date or kwargs.get("from")
    to_date = to_date or kwargs.get("to")
    if month:
        return {"from": f"{month}-01", "to": month_end(f"{month}-01")}
    return {"from": from_date or month_start(today()), "to": to_date or month_end(today())}


def _empty(rate):
    return {"rate": rate, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0, "invoices": 0}


def _add(bucket, row):
    bucket["taxable"] = r2(bucket["taxable"] + row.get("taxable", 0))
    bucket["cgst"] = r2(bucket["cgst"] + row.get("cgst", 0))
    bucket["sgst"] = r2(bucket["sgst"] + row.get("sgst", 0))
    bucket["igst"] = r2(bucket["igst"] + (row.get("igst") or 0))
    bucket["total"] = r2(bucket["taxable"] + bucket["cgst"] + bucket["sgst"] + bucket["igst"])
    return bucket


def gstr1(**params):
    """Outward supplies: B2B invoice-wise, B2C rate-wise, and the HSN summary."""
    span = period(**params)
    lines = db.all_rows(
        """SELECT si.*, s.no, s.date, s.inter_state, s.customer_id,
              c.name AS customer_name, c.gstin AS customer_gstin
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE s.date >= ? AND s.date <= ? ORDER BY s.date, s.id""", (span["from"], span["to"]))
    returns = db.all_rows(
        """SELECT ri.*, r.no, r.date FROM sale_return_items ri
           JOIN sale_returns r ON r.id = ri.return_id
           WHERE r.date >= ? AND r.date <= ?""", (span["from"], span["to"]))

    b2b: dict[str, dict] = {}
    b2c: dict[str, dict] = {}
    hsn: dict[str, dict] = {}
    invoices = set()

    for line in lines:
        invoices.add(line["no"])
        if line["customer_gstin"]:
            key = f"{line['customer_gstin']}|{line['no']}"
            entry = b2b.setdefault(key, {
                "gstin": line["customer_gstin"], "customer": line["customer_name"], "invoice": line["no"],
                "date": line["date"], "inter_state": bool(line["inter_state"]), "taxable": 0.0,
                "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "total": 0.0, "rates": set(),
            })
            entry["rates"].add(line["gst_rate"])
            _add(entry, line)
        else:
            bucket = b2c.setdefault(str(line["gst_rate"]), _empty(line["gst_rate"]))
            _add(bucket, line)
        hsn_key = f"{line['hsn'] or '-'}|{line['gst_rate']}"
        summary = hsn.setdefault(hsn_key, {"hsn": line["hsn"] or "-", "rate": line["gst_rate"],
                                           "qty": 0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0,
                                           "igst": 0.0, "total": 0.0})
        summary["qty"] += line["qty_units"]
        _add(summary, line)

    credit_notes: dict[str, dict] = {}
    for row in returns:
        bucket = credit_notes.setdefault(str(row["gst_rate"]), _empty(row["gst_rate"]))
        half = r2(row["gst_amount"] / 2)
        _add(bucket, {"taxable": row["taxable"], "cgst": half,
                      "sgst": r2(row["gst_amount"] - half), "igst": 0})

    b2b_rows = [{**e, "rates": sorted(e["rates"])} for e in b2b.values()]
    b2c_rows = sorted(b2c.values(), key=lambda b: b["rate"])
    cn_rows = sorted(credit_notes.values(), key=lambda b: b["rate"])

    totals = _empty("all")
    for row in b2b_rows + b2c_rows:
        _add(totals, row)
    cn_totals = _empty("all")
    for row in cn_rows:
        _add(cn_totals, row)

    return {
        "period": span,
        "store": settings.store_profile(),
        "invoiceCount": len(invoices),
        "b2b": b2b_rows,
        "b2c": b2c_rows,
        "creditNotes": cn_rows,
        "hsn": sorted(hsn.values(), key=lambda h: -h["taxable"]),
        "totals": totals,
        "creditNoteTotals": cn_totals,
        "net": {
            "taxable": r2(totals["taxable"] - cn_totals["taxable"]),
            "cgst": r2(totals["cgst"] - cn_totals["cgst"]),
            "sgst": r2(totals["sgst"] - cn_totals["sgst"]),
            "igst": r2(totals["igst"] - cn_totals["igst"]),
            "total": r2(totals["total"] - cn_totals["total"]),
        },
    }


def gstr2(**params):
    """Inward supplies with the input tax credit they carry."""
    span = period(**params)
    rows = db.all_rows(
        """SELECT p.id, p.no, p.ref_no, p.date, p.inter_state, p.subtotal, p.gst_amount, p.total,
              s.name AS supplier_name, s.gstin AS supplier_gstin
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.id""", (span["from"], span["to"]))
    rate_rows = db.all_rows(
        """SELECT pi.gst_rate, SUM(pi.taxable) AS taxable, SUM(pi.gst_amount) AS gst
           FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
           WHERE p.date >= ? AND p.date <= ? GROUP BY pi.gst_rate""", (span["from"], span["to"]))
    by_rate = []
    for row in rate_rows:
        half = r2(row["gst"] / 2)
        by_rate.append(_add(_empty(row["gst_rate"]),
                            {"taxable": row["taxable"], "cgst": half,
                             "sgst": r2(row["gst"] - half), "igst": 0}))
    debit_notes = db.all_rows(
        """SELECT ri.gst_rate, SUM(ri.taxable) AS taxable, SUM(ri.gst_amount) AS gst
           FROM purchase_return_items ri JOIN purchase_returns r ON r.id = ri.return_id
           WHERE r.date >= ? AND r.date <= ? GROUP BY ri.gst_rate""", (span["from"], span["to"]))

    totals = {
        "taxable": r2(sum(r["subtotal"] for r in rows)),
        "gst": r2(sum(r["gst_amount"] for r in rows)),
        "total": r2(sum(r["total"] for r in rows)),
    }
    dn_totals = {
        "taxable": r2(sum(r["taxable"] for r in debit_notes)),
        "gst": r2(sum(r["gst"] for r in debit_notes)),
    }
    without_gstin = [r for r in rows if not r["supplier_gstin"]]
    warnings = ([f"{len(without_gstin)} purchase bill(s) have a supplier without a GSTIN — "
                 "input credit cannot be claimed on these."] if without_gstin else [])
    return {
        "period": span,
        "store": settings.store_profile(),
        "rows": rows,
        "byRate": sorted(by_rate, key=lambda b: b["rate"]),
        "debitNotes": debit_notes,
        "totals": totals,
        "debitNoteTotals": dn_totals,
        "itc": {"available": r2(totals["gst"] - dn_totals["gst"])},
        "warnings": warnings,
    }


def gstr3b(**params):
    """The monthly summary and the net tax payable."""
    outward = gstr1(**params)
    inward = gstr2(**params)
    half_itc = r2(inward["itc"]["available"] / 2)
    payable = {
        "cgst": r2(outward["net"]["cgst"] - half_itc),
        "sgst": r2(outward["net"]["sgst"] - half_itc),
        "igst": r2(outward["net"]["igst"]),
    }
    payable["total"] = r2(sum(max(0.0, payable[k]) for k in ("cgst", "sgst", "igst")))
    return {
        "period": outward["period"],
        "store": outward["store"],
        "outward": outward["net"],
        "outwardByRate": outward["b2c"] + [{**b, "rate": ",".join(str(r) for r in b["rates"])}
                                           for b in outward["b2b"]],
        "inward": {"taxable": inward["totals"]["taxable"], "gst": inward["totals"]["gst"],
                   "itc": inward["itc"]["available"]},
        "payable": payable,
        "warnings": inward["warnings"],
    }


def reconcile(**params):
    """
    Recomputes tax from the saved line items and compares it with the document
    totals, so data-entry slips surface before filing.
    """
    span = period(**params)
    sales_rows = db.all_rows(
        """SELECT s.id, s.no, s.date, s.subtotal, s.gst_amount, s.total,
              ROUND(COALESCE(SUM(si.taxable),0),2) AS line_taxable,
              ROUND(COALESCE(SUM(si.cgst + si.sgst + si.igst),0),2) AS line_gst
           FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
           WHERE s.date >= ? AND s.date <= ? GROUP BY s.id""", (span["from"], span["to"]))
    purchase_rows = db.all_rows(
        """SELECT p.id, p.no, p.ref_no, p.date, p.subtotal, p.gst_amount,
              ROUND(COALESCE(SUM(pi.taxable),0),2) AS line_taxable,
              ROUND(COALESCE(SUM(pi.gst_amount),0),2) AS line_gst
           FROM purchases p LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
           WHERE p.date >= ? AND p.date <= ? GROUP BY p.id""", (span["from"], span["to"]))

    def flagged(rows, label):
        out = []
        for row in rows:
            if abs(row["subtotal"] - row["line_taxable"]) > 0.05 or abs(row["gst_amount"] - row["line_gst"]) > 0.05:
                out.append({"type": label, "no": row["no"], "date": row["date"],
                            "taxable_diff": r2(row["subtotal"] - row["line_taxable"]),
                            "gst_diff": r2(row["gst_amount"] - row["line_gst"])})
        return out

    mismatches = flagged(sales_rows, "Sale") + flagged(purchase_rows, "Purchase")
    missing_gstin = db.scalar(
        """SELECT COUNT(*) FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.date >= ? AND p.date <= ? AND (s.gstin IS NULL OR s.gstin = '')""",
        (span["from"], span["to"]), 0)
    b2b_without_gstin = db.scalar(
        """SELECT COUNT(*) FROM sales s JOIN customers c ON c.id = s.customer_id
           WHERE s.date >= ? AND s.date <= ? AND s.total > 250000 AND (c.gstin IS NULL OR c.gstin = '')""",
        (span["from"], span["to"]), 0)

    notes = []
    if missing_gstin:
        notes.append(f"{missing_gstin} purchase bill(s) in this period have no supplier GSTIN.")
    if b2b_without_gstin:
        notes.append(f"{b2b_without_gstin} high-value bill(s) have a customer without a GSTIN.")
    if not mismatches:
        notes.append("All documents in this period reconcile with their line items.")

    return {
        "period": span,
        "checked": {"sales": len(sales_rows), "purchases": len(purchase_rows)},
        "mismatches": mismatches,
        "notes": notes,
        "clean": not mismatches,
    }


def financial_year_range(date=None, **_):
    return financial_year(date or today())
