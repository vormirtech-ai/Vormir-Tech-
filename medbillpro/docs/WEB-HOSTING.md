# MedV on the web — hosting it from this repository

The same application, with nothing to install: staff open a link, and MedV runs
in the browser. Billing, stock, GST, reports and backup all work exactly as in
the desktop build, because it is the same code — only the storage underneath
differs.

**Live address once Pages is on:**

```
https://vormirtech-ai.github.io/Vormir-Tech-/medv/
```

---

## 1. Turn it on (once, about two minutes)

1. Merge this branch into **main**. The repository already has
   `.github/workflows/static.yml`, which publishes the whole repository to
   GitHub Pages on every push to `main`.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push (or merge). Watch the run under the **Actions** tab; it takes about a minute.
4. Open `https://vormirtech-ai.github.io/Vormir-Tech-/medv/` and complete the
   three-step setup wizard.

That is the whole deployment. No server, no database to provision, no runtime
cost — GitHub serves static files.

---

## 2. Install it like an app (recommended for the shop)

In Chrome or Edge, open the link and click the **install icon** in the address
bar (or ⋮ → *Cast, save and share* → *Install page as app*). MedV then:

* gets its own desktop icon and window, with no browser tabs or address bar;
* opens straight from the Start menu;
* keeps working with the internet disconnected, because a service worker keeps
  a copy of the app on the computer.

This is the closest thing to the installer, without any Windows security prompt.

---

## 3. Where the data lives — read this bit

The desktop build keeps a file at `%APPDATA%\MedBillPro\data\medbill.db`. The
web build keeps the same SQLite database **inside that browser's storage**
(IndexedDB) on that computer. It is still local — nothing is uploaded, and the
site works offline — but it comes with two rules:

| Rule | Why |
|---|---|
| **One browser on one computer = one shop.** | Opening the link on a different PC, or in a different browser, starts an empty database. They do not sync. |
| **Clearing browsing data deletes it.** | If someone clears *"Cookies and other site data"* for this site, the shop data goes with it. MedV asks the browser for persistent storage to reduce the risk, but it cannot prevent a manual clear. |

Two consequences worth taking seriously:

* **Never use a private / incognito window** — that data is thrown away on close.
* **Download a backup every day** (Backup → *Download backup*) and keep it on a
  pen drive. That file is a real SQLite database; it is your insurance.

---

## 4. The two editions are interchangeable

A backup downloaded from the web build opens in the desktop build, and the other
way round — same schema, same password hashing, same file format. So you can:

* start on the web today, and move to the installed desktop app later by
  restoring the backup there;
* run the desktop app in the shop and open the same backup on the web version
  to look at the numbers from elsewhere.

| | Web edition | Desktop edition |
|---|---|---|
| Install | none — open the link | `MedBillPro_Setup.exe` |
| Data | this browser's storage, on this PC | `%APPDATA%\MedBillPro\data\medbill.db` |
| Backup | downloads a `.db` file | writes a `.db` file anywhere you choose |
| Works offline | yes, after the first visit | yes, always |
| Printing | the browser's print dialog | direct, with paper size preset |
| Save as PDF | via the print dialog | one button |
| Risk | clearing site data erases it | none beyond normal disk loss |

---

## 5. Updating the hosted app

The published folder `/medv` is generated. Never edit it by hand:

```bash
cd medbillpro
npm run build:web     # regenerates /medv from src/
git add ../medv && git commit -m "Rebuild web app" && git push
```

Pages redeploys on push. Because the service worker caches aggressively, an open
tab keeps the old version until it is reloaded — MedV shows a small
**"A new version of MedV is ready"** prompt rather than reloading underneath a
half-finished bill.

`npm run build:web` needs Node.js, but only on the machine doing the build. It
takes about a second and downloads nothing.

---

## 6. What the build actually does

`tools/build-web.js` is 150 lines and has no dependencies:

1. copies `src/renderer` (the interface — identical to the desktop build);
2. concatenates the CommonJS modules in `src/core` into `js/core.bundle.js` with
   a small module registry, substituting three modules for browser versions
   (database, paths, backup);
3. copies sql.js — SQLite compiled to WebAssembly, MIT licensed, vendored in
   `medbillpro/vendor` so nothing is fetched from a CDN;
4. copies the page shell and writes the service worker's file list.

Nothing is minified or transpiled, so what runs in the browser is the code you
can read in this repository.

---

## 7. Privacy

The page loads only its own files from your GitHub Pages domain. There are no
analytics, no fonts from Google, no CDN scripts and no API calls — check the
Network tab. Business data never leaves the computer it was typed on.

The only outward-facing feature is the WhatsApp refill reminder, which opens
`wa.me` in a new tab when you press the button.
