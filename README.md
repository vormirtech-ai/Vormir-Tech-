# CueZone — Snooker Club Manager (Android)

Table timers, pop-up alerts, billing, canteen, credit (khata) and daily reports for a snooker / pool parlour. Works fully offline; all data stays on the phone.

## Where it lives
- **Web app (open or "Add to Home screen"):** https://vormirtech-ai.github.io/Vormir-Tech-/cuezone/
- **Android APK (always the newest build):** https://github.com/vormirtech-ai/Vormir-Tech-/releases/latest/download/CueZone.apk
- **Source:** the `cuezone-app` branch of vormirtech-ai/Vormir-Tech-. Every push to that branch builds a new APK (Actions tab) and publishes it as a release.
- The web copy sits in the `cuezone/` folder on `main`, which your existing Pages workflow deploys. Update it by running `npm run build` and copying `web/` into `cuezone/`.

## Build on your own PC instead
Needs Node 22+, JDK 21 and Android Studio.
```
npm install
npm run sync          # builds www/ and copies it into android/
npx cap open android  # then Build > Build APK(s)
```

## First-time setup on the phone
1. Allow notifications when asked. On Android 12+, if alerts arrive late, open
   Settings → Apps → CueZone → **Alarms & reminders** → Allow.
2. Settings tab → set club name, UPI ID (shows a payment QR with the amount filled in), tables & hourly rates, canteen menu.
3. Some phones (Xiaomi, Vivo, Oppo, Realme) kill background apps: Settings → Apps → CueZone → Battery → **No restrictions**.

## Features
- Live table board: free / playing / ending soon / time up / paused, colour-coded like snooker balls
- Open-time (count-up) and fixed-time (prepaid countdown) games, pause/resume, extend +15/+30/+60, move table
- Alerts: warning X min before end, time-up pop-up with alarm + vibration, reminders on long open games; system notifications even when the app is closed or the phone is locked
- Billing: per-minute or rounded (5/15/30 min), minimum charge, full booked time option, canteen items on the same tab, discount (₹ or %), split between players
- Payment: Cash / UPI (QR) / Card / Credit (khata) with "collect later" tracking
- WhatsApp bill to the customer; copy bill text
- Reports: today / yesterday / 7 / 30 days — takings, table vs canteen, payment split, earnings per table, busy hours, top items; share summary or copy CSV
- Backup / restore by copying text

## Project layout
- `src/app.html` — the whole app (UI + logic)
- `build.js` — builds `www/` (offline fonts and QR library) for Android
- `android/` — Capacitor 8 Android project (app id `com.vormirtech.cuezone`)
- `capacitor.config.json` — app name, notification icon, status bar
