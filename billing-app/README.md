# Lavi The Dhawa & Family Restaurant — Billing System

An offline-first billing, inventory and staff-attendance system built for
**Lavi The Dhawa & Family Restaurant**. It is a plain static web app: no
server, no database to install, no accounts and **no internet connection
required**. Everything you enter stays on the computer or tablet you enter it
on.

---

## 1. What it does

| Screen | What it is for |
| --- | --- |
| **Billing** | Take an order and print the bill. The three white-box sections of the menu card — **Rice, Roti & Papad, Paratha** — open first as **Quick Picks**. |
| **Bills** | Every bill ever made: search, filter by date, view, reprint, cancel, export to CSV. |
| **Udhaar** | Who owes the dhaba money, since when, and taking payment against it. |
| **Expenses** | Every rupee that leaves the counter — sabzi, gas, rent, repairs — and what is left after it. |
| **Reports** | Sales, kharcha, profit, top items, category share, payment split, printable day summary. |
| **Menu** | Add, edit, reprice or hide items; manage categories; print a fresh menu card. |
| **Inventory** | Kitchen stock with purchases, usage, wastage, stock counts, low-stock alerts and a full movement ledger. |
| **Attendance** | Mark the day, view the month sheet, calculate payroll and print salary slips. |
| **Staff** | Team records, wages, and the daily kharcha each person takes. |
| **Settings** | Shop details, GST, printing, backup and restore. |

The complete menu from the restaurant's card is already loaded — 72 items
across 10 categories, at the printed prices.

### Billing screen

* Tap a **price** to add that item (Half / Full / Plate / Tari / Masala) to the order.
* `F2` search · `F4` settle & print · `F6` hold · `Alt + 1…8` jump between screens.
* **Hold** parks a running table under a token number; tap the token to bring it back.
* Discounts can be a flat rupee amount or a percentage.
* An unfinished order survives an accidental refresh or power cut.
* Bills print as an **80 mm thermal receipt** or an **A4 invoice**.

### Udhaar (dues)

Settle a bill with payment mode **Due (Udhaar)** and the app asks who is taking
it. The name and phone are required — that is the whole point, so the amount can
be chased later.

* A part payment at the counter is fine: type what was received, the rest becomes
  the udhaar.
* The **Udhaar** screen lists every customer with an outstanding balance, how many
  bills, and how long it has been owing. Anything over 30 days is flagged.
* **Receive ₹** takes a payment and clears the **oldest bill first**, exactly the
  way a paper khata is settled. Part payments are allowed; paying more than is
  owed is refused.
* **Print Khata** produces the list to carry around while collecting.

### Expenses (kharcha)

Everything the dhaba spends. Four one-tap buttons cover the daily ones —
Vegetables, Grocery, Meat & Fish, Gas & Fuel — and **Add Expense** covers the
rest with a vendor, a payment mode and who spent it.

* The screen shows **sales − kharcha** for the period, so the day's real position
  is on one line.
* Buying stock on the **Inventory** screen offers to record the purchase here too,
  so the profit figure stays honest without double entry.
* Reports carry the same figures, and the printed day summary now shows the
  expense side and the profit.

### Staff kharcha

When a waiter takes ₹100 at noon, tap **Paisa diya** on the **Staff** screen — or
on the staff member's row in **Attendance**, which is usually closer to hand.
Preset buttons cover ₹50 / ₹100 / ₹200 / ₹500 / ₹1000.

* Each entry is dated and can carry a note ("doctor", "ghar bhejna").
* **Khata** shows the month's entries for one person, and any entry can be deleted.
* **Payroll** subtracts the month's total automatically — there is nothing to
  remember at month end. A **Bonus** entry adds instead of subtracts.
* The payslip prints the individual entries, so there is no argument about what
  was taken.

---

## 2. Running it

### Option A — on this computer (no internet at all)

1. Unzip the folder anywhere, e.g. `D:\lavi-billing`.
2. Open **`index.html`** in Chrome or Edge.

That is it. Nothing to install.

> A local web server is slightly better because it enables the offline cache
> and the fastest storage engine. If Python is installed:
> ```bash
> cd lavi-billing
> python3 -m http.server 8080      # then open http://localhost:8080
> ```
> The app works either way — without a server it automatically falls back to
> a different local storage engine and tells you which one is in use under
> **Settings → Data & backup**.

### Option B — GitHub Pages

1. Create a repository and upload **the contents of this folder** so that
   `index.html` sits at the top level.
2. **Settings → Pages → Source: Deploy from a branch**, pick `main` and
   `/ (root)`, save.
3. Open `https://<username>.github.io/<repo>/`.

Visit it once while online; after that it opens with the network switched off,
because a service worker keeps a copy of the app on the device.

### Option C — any other static host

Netlify, Vercel, cPanel, a shared-hosting `public_html` folder, a USB stick —
upload the files as they are. There is no build step.

### Option D — as an Android app on the tablet

There is a real Android app in `android/` that wraps this exact web app. See
`android/README.md` for how to get the APK. It runs offline, has no internet
permission at all, prints through Android's print service and saves backups
through the system file picker.

### Install it like an app

In Chrome or Edge, open the menu and choose **Install** (or *Add to Home
Screen* on a tablet). It then opens in its own window with no address bar —
this works today, without the APK.

---

## 3. Where the data lives — read this

All data is written to the browser's own local database (IndexedDB) on the
device you are using. It is **never** sent anywhere.

That has one consequence worth understanding:

* Data does **not** follow you to another computer, another browser, or a
  private/incognito window.
* Clearing the browser's "site data" or "cookies and cached files" **erases
  the records**.

So: **take a backup regularly.**

**Settings → Data & backup → Download backup** saves a single `.json` file with
every bill, staff record, attendance mark and stock movement. Keep it on a pen
drive. **Restore from backup** loads it back — on the same machine or a new one.
That same file is how you move the system to a new computer.

---

## 4. Everyday routine

**Every day**
1. **Attendance → All Present**, then correct anyone who is absent.
2. Bill through the day on the **Billing** screen.
3. Record kharcha as it happens — shop spending on **Expenses**, staff money with
   **Paisa diya**.
4. At closing: **Reports → Today → Print Summary** to tally the cash box.

**Every week**
* **Udhaar** — chase anything over a couple of weeks old, and record what comes in.

**Every week**
1. **Inventory → + Stock** as goods come in; **Use** and **Waste** as they go out.
2. **Inventory → Low Stock Report** before the market run.
3. **Settings → Download backup**.

**Every month**
1. **Attendance → Payroll**, check the days, print each **Payslip**.
2. Reset advances on the staff record after paying.

---

## 5. Settings worth setting first

* **Restaurant details** — address, phone, GSTIN and FSSAI print on every bill.
* **Bill number prefix** — `LD` by default, so bills run `LD-1001`, `LD-1002`…
* **GST** — off by default. Switch it on and set the rate to split CGST/SGST on the bill.
* **Number of tables** — fills the table list on the order screen.
* **Default print format** — 80 mm roll or A4.
* **Staff weekly off** — pre-marks that weekday on the attendance sheet.

---

## 6. Layout

```
index.html                 the app shell
manifest.webmanifest       makes it installable
sw.js                      offline cache
assets/
  css/app.css              design tokens, layout, print styles
  js/
    utils.js               money, dates, DOM helpers
    db.js                  IndexedDB with a localStorage fallback
    seed.js                the printed menu + a starter pantry
    store.js               domain layer: bills, payroll, stock
    ui.js                  toasts, modals, forms, tables, charts
    receipt.js             80 mm and A4 bill layouts
    app.js                 navigation and boot
    views/                 one file per screen
                           pos, bills, dues, expenses, reports,
                           menu, inventory, attendance, staff, settings
  icons/                   app icons
```

No frameworks, no CDN links, no fonts fetched over the network — which is
exactly why it keeps working when the internet does not.

Tested on Chrome, Edge and Firefox, on desktop and tablet.
