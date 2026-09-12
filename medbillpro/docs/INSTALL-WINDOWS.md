# Installing MedV on a Windows computer

Two situations. Pick yours.

---

> **Before anything else:** if you received this as a zip, right-click it →
> **Properties** → tick **Unblock** → OK, and *then* extract it. Windows marks
> every file inside a downloaded zip as untrusted, and Smart App Control will
> refuse to run them. See [WINDOWS-SECURITY.md](WINDOWS-SECURITY.md).

## A. You already have `MedBillPro_Setup.exe`

1. Right-click **MedBillPro_Setup.exe** → Properties → tick **Unblock** → OK.
2. Double-click it.
3. Windows may show *"Windows protected your PC"* because the installer is not
   code-signed. Click **More info → Run anyway**.
   If instead you get *"Smart App Control blocked a file that may be unsafe"*,
   there is no Run-anyway button — read
   [WINDOWS-SECURITY.md](WINDOWS-SECURITY.md) §1, which covers your options
   (signing, USB + Unblock, portable build, or turning SAC off).
3. Choose the folder — the default `C:\Users\<you>\AppData\Local\Programs\MedV`
   installs for the current user and needs no administrator rights.
4. Finish. **MedV** is on the desktop and in the Start menu.
5. Start it and complete the setup wizard (shop name, GSTIN, drug licence,
   invoice prefix, administrator password).

Nothing else to configure. No internet, no account, no licence key.

> Prefer not to install anything? Use **MedBillPro_Portable.exe** — it runs from
> a folder or a pen drive. It still keeps its database in `%APPDATA%\MedBillPro`
> on whichever computer it runs on.

---

## B. You have this source folder and need to build the installer

Do this **once**, on any Windows PC with internet. The result works on shop PCs
that never go online.

1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Unzip this folder somewhere simple, e.g. `C:\medv`.
3. Open that folder in Explorer, click the address bar, type `cmd`, press Enter,
   and run:

   ```bat
   npm install
   npm run dist
   ```

   (`build-windows.bat` runs exactly these two commands if you prefer to
   double-click. Smart App Control blocks `.bat` files that came from a
   downloaded zip, so if it refuses, type the commands instead — typed commands
   are never blocked.)
4. Wait — the first run downloads Electron (~100 MB) and compiles the SQLite
   driver. Five to fifteen minutes is normal.
5. When it finishes you will have:

```
dist\MedBillPro_Setup.exe       the installer
dist\MedBillPro_Portable.exe    a single-file portable build
```

6. Copy the installer to each shop computer and follow section A.

---

## Where MedV keeps things

| What | Where |
|---|---|
| Database | `%APPDATA%\MedBillPro\data\medbill.db` |
| Automatic backups | `%APPDATA%\MedBillPro\backups\` |
| CSV exports | wherever you save them (default: Documents) |
| Program files | `...\Programs\MedV\` |

`%APPDATA%` is usually `C:\Users\<your name>\AppData\Roaming`. Paste the path into
Explorer's address bar to open it, or use **Settings → About → Open data folder**.

Uninstalling MedV **does not** delete your database or backups.

---

## Moving to a new computer

1. On the old PC: **Backup → Backup to…**, save to a pen drive.
2. On the new PC: install MedV, complete the setup wizard with any details.
3. **Backup → Restore from file…**, choose the file from the pen drive, confirm.
4. Sign in again. Everything — bills, stock, patients, GST history — is there.

---

## Two computers at the counter?

MedV is deliberately one-computer-one-database. Copying the `.db` file between two
PCs does **not** merge them; whichever file you restore last wins. If you need two
counters billing at the same time, ask Vormir Tech about the LAN/server version —
the application is structured so that it can be added without redoing the shop's
data.

---

## Troubleshooting the build

| Message | Fix |
|---|---|
| `node is not recognised` | Node.js is not installed, or the Command Prompt was open before installing it. Close and reopen. |
| `npm install` fails with network errors | You are offline or behind a proxy. The build step needs internet; the finished app does not. |
| `Cannot find module 'better-sqlite3'` | Run `npm install` again — its native driver did not finish preparing. |
| `gyp ERR!` / `MSBuild.exe failed` | The SQLite driver had to compile from source and Windows has no C++ toolchain. Install **Visual Studio Build Tools** with the *Desktop development with C++* workload, then run `npm install` again. This only affects the build machine. |
| Antivirus blocks the packaged exe | Unsigned installers are a common false positive. Whitelist the folder, or have the installer code-signed — see [WINDOWS-SECURITY.md](WINDOWS-SECURITY.md). |
| `Smart App Control blocked a file` | The file carries the "from the internet" mark, or is unsigned. See [WINDOWS-SECURITY.md](WINDOWS-SECURITY.md) §1. |
| `... is not digitally signed` / SmartScreen warning | Expected on an unsigned build. Click **More info → Run anyway**, or sign the installer ([§3](WINDOWS-SECURITY.md)). |
