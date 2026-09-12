# MedV — Pharmacy Management (offline, local-first)

MedV is a Windows desktop application for medical stores and pharmacies: counter
billing, batch-wise inventory with expiry tracking, purchase entry with Excel
import, GST returns, patient/doctor/supplier ledgers, refill reminders and
local backup — **all of it working with the internet unplugged.**

Every byte of business data lives in one SQLite file on the shop's own computer.
There is no cloud account, no server to rent and no sync service.

```
%APPDATA%\MedBillPro\data\medbill.db      ← your database (Windows)
%APPDATA%\MedBillPro\backups\             ← automatic + manual backups
```

---

## 1. What's inside

| Area | What you get |
|---|---|
| **Billing (F2)** | Keyboard-first counter sale: type a medicine, ↑↓ to pick, Enter to add. Strips **and** loose tablets, batch auto-picked first-expiry-first-out, per-line and bill-level discount, Cash/UPI/Card/Cheque/Credit, instant A4 / A5 / 80 mm thermal invoice. |
| **Inventory** | Medicine master (salt, manufacturer, HSN, GST %, pack size, rack, drug schedule, reorder level), batch-wise stock with MRP and landed cost, stock adjustments with reasons, expiry and reorder reports, valuation at cost and at MRP. |
| **Purchases (F4)** | Supplier bill entry with batch + expiry + free goods, duplicate-bill guard, last-purchase-rate prefill, and **import of a distributor bill from .xlsx or .csv** — columns are detected automatically and shown for review before saving. |
| **Returns** | Sales returns against a specific bill (never more than was sold), refund in cash/UPI/bank or adjusted against the balance, and purchase returns to the supplier. Stock and money move both ways correctly. |
| **People** | Patients with balance, history and buying pattern; doctors with referral count and commission ledger; suppliers with payables and payment history. |
| **Money** | Cash & bank book, receipts and payments, expenses by category, cash⇄bank transfers — every entry posts to one ledger, so the closing balance always ties. |
| **GST** | GSTR-1 (B2B invoice-wise, B2C rate-wise, HSN summary), GSTR-2 with ITC, GSTR-3B summary and a reconciliation check that recomputes every document from its line items before you file. CSV export and print on every report. |
| **Reports** | Sales and purchase registers, item movement with margin, profit & loss, day book, outstanding receivable/payable ageing. |
| **Reminders** | Refill reminders created while billing, plus suggestions from buying history. MedV prepares the WhatsApp message and opens it **only when you click** — nothing is sent automatically. |
| **Data safety** | Every save is a single SQLite transaction; a failure rolls the whole thing back. Backup to any folder or pen drive, restore with a confirmation and an automatic safety copy, ten rolling automatic backups, and a full audit log of who did what. |
| **Users** | Administrator / Pharmacist / Cashier. Roles are enforced in the main process, not just hidden in the menu. |

---

## 2. Install on a Windows PC (for the shop)

If you were given **`MedBillPro_Setup.exe`**, just run it and skip to §4.

To build the installer from this folder you need [Node.js 18 or newer](https://nodejs.org)
installed **once**, on a machine with internet:

```bat
cd medbillpro
npm install
build-windows.bat
```

The installer appears in `dist\MedBillPro_Setup.exe` (plus a no-install
`MedBillPro_Portable.exe`). Copy it to any number of shop computers — the build
machine needs internet, the shop computer never does.

> `npm install` downloads Electron and compiles the SQLite driver. That is the
> only step that needs a connection; after it, `npm start` and the installed
> application run entirely offline.

---

## 3. Run it from source (developers)

```bash
npm install       # once
npm start         # launch the desktop app
npm test          # 25 logic tests, including the full offline acceptance scenario
npm run dev:web   # optional: same UI in a browser on 127.0.0.1 for quick iteration
```

`npm run dev:web` is a development harness only (`tools/devserver.js`); it is
excluded from the packaged application.

---

## 4. First launch

1. MedV creates `%APPDATA%\MedBillPro\data\medbill.db`, runs its migrations and
   creates the initial **admin** account automatically.
2. The setup wizard asks for the shop name, address, GSTIN, drug licence number
   and invoice prefix, and makes you replace the default admin password.
3. Optionally load a small sample catalogue to click around in — clear it later
   from **Backup → Clear transactions**.

No internet connection is needed for any of this.

---

## 5. Offline guarantees

MedV was written against a simple rule: *if the internet is gone, nothing
changes.* Verified behaviour:

* Login, billing, printing, stock, purchases, returns, reports, GST, backup and
  restore all read and write only the local SQLite file.
* The renderer loads from a private `app://` protocol with a strict CSP. There
  are **no** web fonts, no CDN scripts and no analytics — a launch of the packaged
  app makes 32 requests, every one of them `app://`.
* The only outward-facing feature is the WhatsApp reminder, which hands a
  prepared message to your browser when *you* press the button.
* One computer = one database. MedV never pretends two PCs are in sync; a LAN
  version would be a separate deployment.

---

## 6. How it is put together

```
src/
  main/main.js          Electron main process: window, app:// protocol, IPC, dialogs, printing
  main/menu.js          native menu and accelerators
  preload/preload.js    the only bridge to the renderer (contextIsolation, no Node in the page)
  core/                 all business logic — plain Node, no Electron, unit-testable
    api.js              one dispatcher, 102 channels, holds the signed-in user
    db/                 connection, pragmas (WAL + FULL sync + foreign keys), migrations
    services/           auth, products, parties, purchases, sales, returns, payments,
                        ledger, gst, reports, reminders, importer, backup, setup, audit
    util/               money (paisa-exact rounding, GST split, amount in words), dates,
                        validation, errors, and a dependency-free .xlsx/.csv reader
  renderer/             the interface: plain ES modules, no framework, no build step
    js/views/           one file per screen
    js/ui.js            components (tables, modals, forms, charts, toasts)
    css/                design tokens, app styles, print styles
tests/                  node:test suites for the core and the spreadsheet reader
tools/devserver.js      offline browser harness for development (not packaged)
```

Two deliberate choices worth knowing:

* **The core never imports Electron.** Everything in `src/core` runs under plain
  Node, which is why the whole billing/GST/backup flow can be tested headlessly.
* **No bundler.** The renderer ships the files you can read, so a pharmacist's
  IT person can fix a label without a toolchain.

---

## 7. Backup habits (please read)

A local database is only as safe as its copies.

* **Backup → Backup to…** and choose a pen drive at the end of every day.
* Keep the last 7 days; MedV also keeps ten automatic copies in the app folder,
  but those live on the same disk as the original.
* **Restore** always takes a safety copy of the current data first, so a restore
  can itself be undone.

---

## 8. Licence

© 2026 Vormir Tech Solutions, Nagpur. Supplied for the client's own use.
