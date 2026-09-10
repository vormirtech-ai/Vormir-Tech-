# Lavi Billing — Android app

A native Android wrapper around the billing system in `../billing-app`. It is a
single full-screen WebView with the whole web app packaged inside the APK.

The web app is the product; this project exists to give it the three things a
browser tab cannot do on a tablet:

1. **Print** a bill through Android's print service — Bluetooth, USB, Wi-Fi
   printers and "save as PDF" all work.
2. **Save** a backup or CSV through the system file picker.
3. **Pick** a backup file to restore.

## What it guarantees

* **No internet.** The app declares **no `INTERNET` permission at all**. It is not
  a promise in a settings screen — the operating system will not let this app
  open a network connection, because it never asked for the ability.
* **No cloud backup.** `allowBackup="false"` plus explicit Android 12+ extraction
  rules, so the tablet's own backup service never copies the data off the device.
* **Nothing to configure.** No accounts, no server, no setup.

Every bill, staff record, attendance mark, expense and udhaar entry lives in this
app's private storage on this one tablet. Uninstalling the app deletes it, so
take backups (**Settings → Download backup**) and keep them on a pen drive or
send them to yourself.

## Getting the APK

### The easy way — let GitHub build it

The repository has a workflow at `.github/workflows/android.yml`. GitHub's build
machines already have the Android SDK, so nothing needs installing anywhere.

1. Open the repository on GitHub → **Actions** → **Build Android APK**.
2. Press **Run workflow** (it also runs automatically whenever `android/` or
   `billing-app/` changes).
3. When it finishes, open the run and download the **lavi-billing-apk** artifact.
   Unzip it to get `lavi-billing-v1.0.0.apk`.

For a permanent download link, publish a **Release** on GitHub — the workflow
attaches the APK to it automatically.

### The local way — Android Studio

```bash
cd android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Any machine with the Android SDK and JDK 17 will do; Android Studio installs both.

## Installing on the tablet

1. Copy the `.apk` to the tablet (USB cable, pen drive, or Google Drive).
2. Open it with the tablet's Files app.
3. Android will ask to allow installing from this source — allow it once.
4. Install, then open **Lavi Billing** from the home screen.

## Signing

Without a signing key the build uses Android's standard debug key. The APK
installs and runs perfectly, but a later build **cannot install over it** — the
signatures will not match, so the old version has to be uninstalled first (which
deletes its data, so take a backup).

To get a stable signature, make a key once and add it to the repository secrets:

```bash
keytool -genkeypair -v \
  -keystore lavi-release.keystore \
  -alias lavi \
  -keyalg RSA -keysize 2048 -validity 10000

base64 -w0 lavi-release.keystore   # copy the output
```

Then in GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | the base64 text from above |
| `KEYSTORE_PASSWORD` | the keystore password you chose |
| `KEY_ALIAS` | `lavi` |
| `KEY_PASSWORD` | the key password you chose |

Keep `lavi-release.keystore` somewhere safe and **never commit it**. Losing it
means future builds can no longer update an installed app.

## Updating the app

Change anything in `../billing-app` and build again — a Gradle task copies that
folder into the APK's assets at build time, so there is only ever one copy of the
billing system in this repository.

Bump `versionCode` and `versionName` in `app/build.gradle` for each release you
hand out.

## Project layout

```
settings.gradle, build.gradle, gradle.properties, gradlew    Gradle setup
app/build.gradle              build config + the assets sync task
app/src/main/
  AndroidManifest.xml         no permissions; backups disabled
  java/com/lavidhawa/pos/
    App.java                  application entry point
    MainActivity.java         the WebView, the JS bridge, print and save
  res/                        icons, theme, strings, backup rules
  (assets/www/ is generated at build time from ../billing-app)
```

Minimum Android 5.0 (API 21); built against API 34. No third-party libraries.
