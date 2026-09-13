# Installing MedV (Python edition)

There is no installer. You install Python once, extract this folder, and run it.

---

## Windows

### 1. Install Python (once, per computer)

1. Go to <https://www.python.org/downloads/> and download the Windows installer.
2. On the **first** screen of the installer, tick **"Add python.exe to PATH"**.
3. Click **Install Now**, then **Close**.

Check it worked: press `Win + R`, type `cmd`, press Enter, and run

```bat
py -3 --version
```

You should see something like `Python 3.13.1`.

> Windows may offer "Python" from the Microsoft Store. That works too, but the
> python.org installer is the one to prefer — it always includes `tkinter`,
> `sqlite3` and the `py` launcher.

### 2. Extract MedV

1. Right-click the zip → **Properties** → tick **Unblock** → **OK**.
   Windows marks files from a downloaded zip as untrusted; unblocking first
   saves an argument later.
2. Right-click it again → **Extract All…** → extract to a short path such as
   `C:\MedV`.

**Do not run anything from the window that opens when you double-click the zip.**
That is a preview, not a folder — launching a file from it copies only that one
file into a temporary directory.

### 3. Start it

Open `C:\MedV` and double-click **`start-medv.bat`**.

A small black window appears and your browser opens at `http://127.0.0.1:8765/`.
Complete the setup wizard. Done.

### 4. Make it convenient

* **Desktop shortcut:** right-click `start-medv.bat` → *Send to* → *Desktop
  (create shortcut)*. Rename it "MedV". Right-click → Properties → *Change
  Icon…* → browse to `medv\web\assets\icon-256.png` if you want the logo.
* **Start with Windows:** press `Win + R`, type `shell:startup`, press Enter,
  and drop that shortcut into the folder that opens.
* **No black window:** double-click `MedV.pyw` instead. MedV then runs quietly;
  stop it from Task Manager (look for `pythonw.exe`) or use `start-medv.bat`
  when you want the window.

---

## macOS and Linux

```bash
cd /path/to/MedV
./start-medv.sh
```

macOS ships without a suitable Python on older versions; install it with
`brew install python` or from python.org. On Debian/Ubuntu:
`sudo apt install python3`.

---

## Where everything lives

| What | Where |
|---|---|
| Database | `%APPDATA%\MedBillPro\data\medbill.db` |
| Automatic backups | `%APPDATA%\MedBillPro\backups\` |
| Your backups | `Documents\MedV Backups\` |
| Program files | wherever you extracted the zip |

`%APPDATA%` is usually `C:\Users\<your name>\AppData\Roaming`. **Settings →
About → Open data folder** opens it for you.

Deleting the MedV folder does **not** delete your data. To remove everything,
delete `%APPDATA%\MedBillPro` as well — take a backup first.

---

## Moving to another computer

1. On the old PC: **Backup → Backup to…**, copy the file to a pen drive.
2. On the new PC: install Python, extract MedV, start it, complete the wizard
   with any details.
3. **Backup → Restore from file…**, choose the file from the pen drive, confirm.
4. Sign in. Everything — bills, stock, patients, GST history — is there.

---

## Updating MedV

Replace the `medv` folder (and the launchers) with the new version and start it
again. Your database is somewhere else entirely, so it is untouched, and any
schema change is applied automatically on the next start.

---

## Two computers at the counter?

MedV is deliberately one-computer-one-database. Copying the `.db` file between
two PCs does not merge them — whichever you restore last wins. If you need two
counters billing at once, ask Vormir Tech about the LAN version; the code is
laid out so it can be added without redoing the shop's data.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Python 3.9 or newer was not found` | Install Python from python.org and tick *Add python.exe to PATH*. Then close the window and run `start-medv.bat` again — a window opened before installing Python will not see it. |
| The black window flashes and disappears | Run it from a Command Prompt (`cd C:\MedV` then `start-medv.bat`) so the error stays on screen. |
| `STOP - the program files are not in this folder` | You ran the file from inside the zip preview. Extract the zip properly and run it from the extracted folder. |
| Browser says "MedV is not responding" | The black window was closed. Start MedV again, then reload the page. |
| `Address already in use` | MedV is already running. Use the window that is open, or start it on another port: `python -m medv --port 8790`. |
| Antivirus complains | Nothing is installed and no executable is created, so this is rare. If it happens, whitelist the MedV folder and `%APPDATA%\MedBillPro`. |
| The browser opens a blank page | Refresh once. If it persists, run `python -m medv --no-browser` and open `http://127.0.0.1:8765/` yourself — the terminal will show any error. |
