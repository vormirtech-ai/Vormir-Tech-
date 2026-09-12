# When Windows blocks MedV

Windows 11 has two separate gatekeepers. Neither is reacting to anything wrong
inside MedV — both react to *"this file came from the internet and nobody has
paid for a code-signing certificate."* This page tells you how to get past each
one, and the permanent fix.

---

## 1. "Smart App Control blocked a file that may be unsafe"

> *This file was blocked because files of this type from the internet can be
> dangerous.*

**Smart App Control (SAC)** is on by default on some clean Windows 11 installs.
Unlike the older SmartScreen prompt, it has **no "Run anyway" option**. It blocks:

* scripts (`.bat`, `.cmd`, `.ps1`) that carry the internet mark — this is what
  stops `build-windows.bat`;
* unsigned `.exe` files it has never seen before — this is what stops
  `MedBillPro_Setup.exe`.

### Fix A — don't use the .bat, type the two commands (best for building)

Nothing is blocked when you type commands yourself. Open **Command Prompt** in
the MedV folder (click the address bar in Explorer, type `cmd`, press Enter):

```bat
npm install
npm run dist
```

That is exactly what `build-windows.bat` does. The installer lands in
`dist\MedBillPro_Setup.exe`.

### Fix B — clear the internet mark, then extract

Do this **before** unzipping, and every extracted file comes out clean:

1. Right-click `MedV_MedBillPro_v1.0.0.zip` → **Properties**.
2. At the bottom of the *General* tab, tick **Unblock**.
3. **OK**, then extract the zip as usual.

Already extracted? Clear the whole folder at once — right-click the folder,
**Open in Terminal**, then:

```powershell
Get-ChildItem -Recurse | Unblock-File
```

### Fix C — for the installer on a shop PC

`MedBillPro_Setup.exe` is unsigned, so SAC will block it on a PC that has SAC on.
In order of preference:

1. **Sign it** — the permanent answer, see §3 below.
2. **Copy it by USB stick** rather than downloading it, then *Unblock* it as in
   Fix B. This clears the internet mark; on many machines that is enough.
3. **Use the portable build** — `MedBillPro_Portable.exe` from an unblocked local
   folder.
4. **Turn Smart App Control off** on that one computer:
   *Windows Security → App & browser control → Smart App Control → Off.*

   > ⚠️ Read this before you do it: **turning SAC off is permanent.** Windows
   > will not let you switch it back on without resetting or reinstalling
   > Windows. If the shop PC is only ever going to run MedV and a browser, that
   > is a defensible trade; if you are unsure, sign the installer instead.

---

## 2. "Windows protected your PC" (SmartScreen)

The older, friendlier one — a blue dialog on an unsigned installer.

Click **More info → Run anyway.** That is all. It appears because the installer
has no reputation yet, and it stops appearing once enough people have installed a
signed build.

---

## 3. The permanent fix: code-sign the installer

Signing removes every dialog above, on every PC, forever. You buy a certificate
once; the build then signs automatically.

**Option 1 — Azure Trusted Signing** (cheapest, and trusted by SAC immediately).
A Microsoft subscription service, roughly US $10/month, no hardware token. Needs
electron-builder 26 or newer (`npm install -D electron-builder@latest`), then add
`azureSignOptions` to `electron-builder.yml` per the
[electron-builder code-signing docs](https://www.electron.build/code-signing).

**Option 2 — an OV or EV certificate** from a certificate authority (Sectigo,
DigiCert and others; roughly US $200–600 per year, and since June 2023 the key
must live on a hardware token or HSM). EV certificates get SmartScreen trust
immediately; OV certificates build reputation over a few weeks.

With a `.pfx` file exported from the token, no config change is needed — set two
environment variables and build:

```bat
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=your-certificate-password
npm run dist
```

electron-builder picks those up and signs both the application and the installer.

**Option 3 — no certificate.** Perfectly workable when you are installing on a
handful of shop machines yourself: use Fix A to build, carry the installer on a
USB stick, Unblock it, and accept the one-time SmartScreen prompt. This is what
most small in-house Windows tools do.

---

## 4. Antivirus quarantining the app

Some engines flag any unsigned Electron app. If that happens:

* Add an exclusion for the install folder
  (`...\AppData\Local\Programs\MedV`) and for `%APPDATA%\MedBillPro`.
* Never exclude your whole `C:\` drive.
* Signing (§3) also makes most of these false positives go away.

MedV itself makes no network connections at all — a launch of the packaged app
loads only its own `app://` files — so anything a firewall reports is not MedV.
