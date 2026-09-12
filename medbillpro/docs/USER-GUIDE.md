# MedV — day-to-day guide

Written for the person at the counter. Nothing here needs an internet connection.

---

## Signing in

MedV opens with a sign-in screen. Use the username your administrator gave you.
The first account is always `admin`, with the password chosen during setup.

| Role | Can do |
|---|---|
| Administrator | Everything: users, settings, deleting bills, backup and restore |
| Pharmacist | Billing, medicines, batches, purchases, returns, reports, GST |
| Cashier | Billing, patients and receipts |

Change your own password from the name chip at the top-right.

---

## Making a bill — the 20-second routine

1. Press **F2** (or click *New Bill*).
2. Type part of the medicine name or the salt — e.g. `pcm` or `parace`.
3. **↑ ↓** to highlight, **Enter** to add it. The nearest-expiry batch with stock
   is chosen for you.
4. The cursor lands in the quantity box. Type strips, then tab to the loose box
   for single tablets (`2` strips `+` `3` tablets is a normal thing to sell).
5. Repeat from step 2 for the next medicine.
6. Optional: search the patient on the right, pick the doctor, set a refill
   reminder, add an extra discount.
7. **Ctrl + Enter** saves and prints. **Save bill** saves without printing.

Useful details:

* **Rate / pack** is pre-filled from the batch MRP. Change it and the line
  recalculates instantly; GST is always computed on what you actually charge.
* A red line means you have asked for more than the batch holds. Change the
  batch in the dropdown or reduce the quantity — MedV will not let stock go negative.
* **Credit** as the payment mode needs a patient selected, so the balance has
  somewhere to sit.
* Expired batches are never offered and cannot be billed.

---

## Purchases — two ways

**Type it (F4):** choose the supplier, enter the supplier's bill number, then add
each line: medicine, batch, expiry (`06/2028` or `6/28`), quantity, free quantity,
MRP, rate per pack, discount, GST. Save once — the bill, the batches, the stock
and the supplier payable all move together.

**Import it:** *Purchases → New purchase → Import bill from Excel / CSV*. MedV
reads the sheet, works out which column is which, matches the medicines against
your master and shows you everything before anything is saved. Rows it could not
match are marked "new medicine" and created on import; rows missing an expiry are
flagged so you can fill them in the table afterwards.

Tips:
* Enter the **supplier's own bill number** — MedV refuses a duplicate, which is
  how you avoid entering the same bill twice.
* Free goods are added to stock and lower the average cost, so your margin
  reports stay honest.

---

## Returns

*Returns → Sales returns*: type the bill number, press **Find bill**, enter how
many of each line are coming back. You can never return more than was sold, and
the remaining returnable quantity is shown on every line. Choose whether to
refund cash/UPI/bank or leave it against the patient's balance, then save — a
credit note is created and the stock goes back into its batch.

*Returns → Purchase returns*: pick the supplier, search the medicine, choose the
batch you are sending back, enter the quantity. Stock comes out and the payable
comes down.

---

## Stock, expiry and reordering

**Stock & Expiry** has three views:

* **Valuation** — every medicine, units on hand, value at cost and at MRP.
* **Expiry** — batches already expired (remove them from the shelf) and batches
  expiring inside your warning window (90 days by default; change it in Settings).
  Send near-expiry stock back with a purchase return.
* **Reorder** — everything at or below its reorder level, ready to hand to your
  distributor. Export it as CSV or print it.

To correct a physical count: **Medicines → click the medicine → Adjust** on the
batch, enter `-5` or `+5` and a reason. Every adjustment is logged.

---

## Money

**Cash & Bank** is the one place money is explained:

* **Cash & bank book** — every rupee in and out, with the opening and closing
  balance for the period.
* **Receipts & payments** — collect from a patient, pay a supplier.
* **Expenses** — rent, electricity, salary, transport… by category, from cash or bank.

Bills paid at the counter post here automatically, so the closing balance always
matches your drawer. Use **Cash ⇄ bank** when you deposit the day's cash.

---

## Refill reminders

While billing, set *Refill reminder* to 15/25/30/60 days. On the due date the
patient appears under **Refill Reminders → Due now**.

Click **Message** to see the text (edit it if you like), then **Open WhatsApp** —
MedV hands the message to your browser and marks the reminder sent. Nothing is
ever sent without you pressing that button, and the shop PC does not need to be
online to prepare it.

The **Suggested** tab lists regular patients who have not been in for a while,
based on their own buying history.

---

## GST time

**GST** gives you four screens for the month you pick:

* **GSTR-1** — B2C rate-wise (table 7), B2B invoice-wise (table 4) and the HSN
  summary (table 12). Bills become B2B automatically once the customer has a
  GSTIN saved.
* **GSTR-2** — purchase bills with the input tax on each; suppliers without a
  GSTIN are flagged because you cannot claim credit on those.
* **GSTR-3B** — output tax, ITC and net payable.
* **Reconciliation** — recomputes every bill from its own line items and reports
  anything that does not tie, before you file.

Every table exports to CSV and prints. MedV never talks to the GST portal —
check the figures there before filing.

---

## Backup — the one habit that matters

Your data is on this computer only. If the disk dies without a backup, it is gone.

1. **Backup → Backup to…**
2. Choose your pen drive (or `D:\MedV-Backups\`).
3. The file is named `MedBillPro_Backup_2026-09-13.db`. Keep a week of them.

MedV also writes an automatic copy each time you close it and keeps the last ten —
but those sit on the same disk as the original, so they do not replace a pen drive.

**Restoring:** *Backup → Restore from file…*, pick a `.db` file. MedV shows what
is inside it (shop name, number of bills, last bill date), asks you to confirm,
copies your current data aside as `before_restore_…​.db`, and then swaps it in.
So a restore can itself be undone.

---

## Printing

Set your paper once in **Settings → Invoice & billing**: A5 (half sheet), A4 or
80 mm thermal roll. Every bill, credit note, purchase entry and report uses it.
From an open bill you can also **Save PDF** to email later.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| **F1** | Show the shortcut list |
| **F2** | New bill |
| **F4** | New purchase |
| **Ctrl + 1 … 8** | Dashboard, Billing, Medicines, Purchases, Patients, Reports, GST, Settings |
| **Ctrl + B** | Backup screen |
| **Ctrl + P** | Print the open document |
| **Esc** | Close a dialog |
| In billing: **↑ ↓** | Move through search results |
| In billing: **Enter** | Add the highlighted medicine |
| In billing: **Ctrl + Enter** | Save and print |
| In billing: **Ctrl + Del** | Clear the bill |

---

## If something looks wrong

* **"Not enough stock"** — the batch has less than you typed. Pick another batch
  or check for a pending purchase entry.
* **"This bill has a sales return against it"** — delete the return first, or
  better, leave both as the audit trail.
* **A bill was entered twice** — an administrator can delete it from the bill
  view; stock and cash are put back automatically.
* **MedV will not start / "could not open its database"** — another copy is
  probably already running. Close it, or restore your latest backup.
* **Numbers do not tie** — run **GST → Reconciliation** and **Reports → Day book**;
  between them they show exactly which document disagrees.
