# Lavi Billing — Flutter edition

A Flutter app for the tablet. It hosts the offline billing system from
`../billing-app` and adds the parts a web page cannot do on Android: printing a
bill, saving a backup, and picking a backup to restore.

There are now two Android apps in this repository that do the same job:

| | `../android` (native) | `flutter_app` (this one) |
| --- | --- | --- |
| Language | Java | Dart + Java |
| APK size | roughly 2–3 MB | roughly 15–20 MB (Flutter engine) |
| Dependencies | none | `webview_flutter` |
| Toolchain to build | Android SDK | Android SDK **and** Flutter |

They are functionally identical. The native one is smaller and simpler; this one
is here because it was asked for, and because a Flutter shell is easier to grow
into native screens later if you ever want them.

Pick one and install only that. They use different package names
(`com.lavidhawa.pos` and `com.lavidhawa.lavi_billing`), so installing both gives
you **two separate sets of data** — which is almost certainly not what you want.

## Why a WebView and not a Dart rewrite

The billing system is about 5,000 lines of tested JavaScript: the menu, the bill
maths, GST, udhaar allocation, payroll, stock movements. Rewriting it in Dart
would mean re-deriving every one of those rules and re-testing them from
scratch. Wrapping it keeps the tested engine and the same data on the same
device. If you would rather have native Flutter screens, that is a rewrite worth
planning deliberately — say so and it can be scoped.

## What it guarantees

* **No internet.** `tool/prepare.py` strips the `INTERNET` permission from the
  manifest, so the operating system will not let the app open a network
  connection.
* **No cloud backup.** `allowBackup="false"` plus explicit Android 12+
  extraction rules.
* Every bill, expense, udhaar entry, attendance mark and staff kharcha lives in
  this app's private storage on this one tablet.

## Getting the APK

### Let GitHub build it

1. Repository → **Actions** → **Build Flutter APK** → **Run workflow**.
2. When it finishes, open the run and download the **lavi-billing-flutter-apk**
   artifact.
3. Unzip it to get `lavi-billing-flutter-v1.0.0.apk`, copy it to the tablet and
   open it.

Publishing a GitHub **Release** does the same and attaches the APK to the
release, which gives you a permanent download link.

### Build it locally

Needs Flutter and the Android SDK (Android Studio installs both):

```bash
flutter create --org com.lavidhawa --project-name lavi_billing --platforms=android build/flutter_shell
python3 flutter_app/tool/prepare.py build/flutter_shell
cd build/flutter_shell
flutter build apk --release
# → build/app/outputs/flutter-apk/app-release.apk
```

## How the project is put together

The Android host — Gradle files, manifest, resources — is **not** kept in this
repository. `flutter create` generates it at build time so it always matches the
Flutter version doing the building, which is what stops the project rotting.
`tool/prepare.py` then layers this app on top of that shell:

1. copies `pubspec.yaml`, `analysis_options.yaml` and `lib/` in
2. copies `../billing-app` to `assets/www` and **rewrites the asset list from
   what is actually on disk**, so a new file cannot be left out of the APK
3. swaps the generated `MainActivity` for `android_host/MainActivity.java`
4. patches the manifest — app name, backups off, no `INTERNET` permission
5. draws the launcher icons from the restaurant's signboard emblem

```
flutter_app/
  pubspec.yaml              app metadata and the single webview dependency
  analysis_options.yaml     lints
  lib/main.dart             the Flutter shell and the JS bridge
  android_host/
    MainActivity.java       print, save and pick-a-file over a method channel
    data_rules.xml          backup exclusions
  tool/
    prepare.py              assembles a buildable project
    enable_signing.py       points release builds at your signing key
```

## How the two halves talk

The web app looks for `window.LaviNative`. The shell registers a single
JavaScript channel, `LaviBridge`, and injects a shim that defines `LaviNative`
in terms of it. Each call becomes one JSON message:

```json
{ "op": "print", "title": "LD-1042", "html": "<!doctype html>…" }
{ "op": "save",  "name": "lavi-backup.json", "mime": "application/json", "content": "…" }
```

Dart decodes it and forwards it to `MainActivity` over the `lavi.dhawa/native`
method channel, which uses Android's print service and the system file picker.
Restoring a backup goes the other way: the web app's file input triggers
`setOnShowFileSelector`, which asks the same activity to open a document.

## Signing

Without a key, Flutter signs release builds with the debug key. The APK installs
and runs, but a later build **cannot install over it** — uninstall first, which
deletes the data, so take a backup.

For a stable signature, create a key once and add four repository secrets. The
commands and the secret names are the same as for the native app; see
`../android/README.md`. `tool/enable_signing.py` wires them into the generated
Gradle files during the build.

## Updating

Change anything in `../billing-app` and build again. There is only ever one copy
of the billing system in this repository. Bump `version:` in `pubspec.yaml` for
each release you hand out — the number after the `+` is the Android
`versionCode`.

Minimum Android 5.0 (API 21). Built and analysed against Flutter 3.47.3 / Dart 3.13.3.
