# MedV — pharmacy management in Python

Billing, batch-wise inventory with expiry tracking, purchase entry with Excel
import, GST returns, patient/doctor/supplier ledgers, refill reminders, reports
and local backup — for a medical store.

**Install Python once. Double-click. That is the whole setup.**

No `pip install`, no compiler, no build step, no internet. MedV uses only what
comes with Python: `sqlite3`, `http.server`, `zipfile`, `hashlib`. The
dependency list in `pyproject.toml` is deliberately empty.

```
Your data:  %APPDATA%\MedBillPro\data\medbill.db       (Windows)
            ~/Library/Application Support/MedBillPro/  (macOS)
            ~/.config/MedBillPro/                      (Linux)
```

---

## 1. Getting started

1. Install **Python 3.9 or newer** from <https://www.python.org/downloads/>.
   On Windows, tick **"Add python.exe to PATH"** on the first screen.
2. Extract this folder somewhere sensible, e.g. `C:\MedV`.
3. Double-click **`start-medv.bat`** (Windows) or run `./start-medv.sh`
   (macOS/Linux).

MedV starts a small server on this computer and opens your browser at
`http://127.0.0.1:8765/`. Complete the three-step setup wizard and start billing.

Keep the little black window open while you work — closing it stops MedV.

Prefer the command line?

```bash
python -m medv                 # start
python -m medv --no-browser    # start without opening a browser
python -m medv --port 9000     # a different port
python -m medv --data-dir D:\MedV-Data   # keep the database elsewhere
python -m unittest discover -s tests -t . # 51 tests
```

Optional, if you like installed commands: `pip install .` then just `medv`.

---

## 2. What it does

| Area | What you get |
|---|---|
| **Billing (F2)** | Keyboard-first counter sale: type a medicine, ↑↓ to pick, Enter to add. Strips **and** loose tablets, first-expiry-first-out batch picking, per-line and bill-level discount, Cash/UPI/Card/Cheque/Credit, A4 / A5 / 80 mm thermal invoice. |
| **Inventory** | Medicine master (salt, manufacturer, HSN, GST %, pack size, rack, drug schedule, reorder level), batch-wise stock with MRP and landed cost, stock adjustments with reasons, expiry and reorder reports, valuation at cost and MRP. |
| **Purchases (F4)** | Supplier bills with batch, expiry and free goods; duplicate-bill guard; last-rate prefill; and **import of a distributor bill from .xlsx or .csv** — columns detected automatically, shown for review before anything is saved. |
| **Returns** | Sales returns against a specific bill (never more than was sold) with refund or balance adjustment, and purchase returns to the supplier. |
| **People** | Patients with balance and history, doctors with referrals and commission, suppliers with payables. |
| **Money** | Cash & bank book, receipts, payments, expenses by category, cash⇄bank transfers — one ledger, so the closing balance always ties. |
| **GST** | GSTR-1 (B2B invoice-wise, B2C rate-wise, HSN summary), GSTR-2 with ITC, GSTR-3B, and a reconciliation pass that recomputes every document from its line items before you file. CSV export and print everywhere. |
| **Reports** | Sales and purchase registers, item movement with margin, profit & loss, day book, outstanding ageing. |
| **Reminders** | Refill reminders created while billing, plus suggestions from buying history. MedV prepares the WhatsApp message and opens it **only when you click**. |
| **Data safety** | Every document is written in one SQLite transaction — a failure rolls the whole thing back. Backup to any folder or pen drive, restore with a confirmation and an automatic safety copy, ten rolling automatic backups, and a full audit log. |
| **Users** | Administrator / Pharmacist / Cashier, enforced in the server rather than hidden in the menu. |

---

## 3. Why this edition is the easy one

Earlier editions of MedV were built on Electron. That meant Node.js, a 250 MB
download, a native SQLite driver that had to compile, and Windows Smart App
Control blocking the unsigned installer. This edition removes all of it:

| | Electron edition | **This Python edition** |
|---|---|---|
| Prerequisite | Node.js + 250 MB of packages | Python (one installer) |
| Build step | `npm install` && `npm run dist` | none |
| Native compilation | SQLite driver | none — `sqlite3` is built in |
| Windows security prompts | unsigned .exe blocked by Smart App Control | none — nothing is installed |
| Update | rebuild and reinstall | replace the folder |
| Runs offline | yes | yes |

The database file is identical in all editions, and so is the password hashing,
so a backup moves between them freely.

---

## 4. Where the data lives

Everything is one SQLite file on this computer. Nothing is uploaded; MedV makes
no outbound connections at all, and the server listens on `127.0.0.1` only —
other machines on the network cannot reach it.

* **Backup:** *Backup → Backup to…* writes a `.db` file into
  `Documents\MedV Backups\`. Copy it to a pen drive at the end of each day.
* **Restore:** *Backup → Restore from file…* — MedV copies your present data
  aside first, so a restore can itself be undone.
* MedV also keeps ten rolling automatic copies in the app folder and takes one
  every time you close it cleanly.

One computer, one database. Copying the file between two PCs does not merge
them; whichever you restore last wins.

---

## 5. How it is put together

```
medv/
  app.py             start-up, browser launch, clean shutdown
  server.py          the local HTTP server (standard library only)
  api.py             one dispatcher, 102 channels, holds the signed-in user
  db.py              connection, pragmas (WAL + FULL sync + foreign keys), transactions
  migrations.py      the schema, versioned with user_version
  paths.py           where data lives on Windows, macOS and Linux
  services/          auth, products, parties, purchases, sales, returns, payments,
                     ledger, gst, reports, reminders, importer, backup, setup, audit
  util/              money (paisa-exact rounding, GST split, amount in words), dates,
                     validation, errors, PBKDF2 hashing, a .xlsx/.csv reader
  web/               the interface: plain ES modules, no framework, no build step
tests/               51 tests, including the full offline acceptance scenario
```

Two things worth knowing:

* **The services never import the server.** Everything under `medv/services`
  works on the database alone, which is why the whole billing/GST/backup flow is
  tested headlessly in `tests/`.
* **Money is `Decimal`-rounded half-up**, never Python's banker's rounding, so
  ₹2.675 becomes ₹2.68 the way a shop expects — and matches the other editions
  to the paisa.

---

## 6. Licence

© 2026 Vormir Tech Solutions, Nagpur. Supplied for the client's own use.
