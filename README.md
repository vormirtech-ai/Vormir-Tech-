# PlayDen — Gaming Zone Manager (Android + web)

PS5 / PS4 / PC / VR / racing-sim stations in the open area and private cabins, with timers and pop-up alerts, food ordering with a kitchen list, cabin bookings, billing with payment QR and WhatsApp bills, khata, happy hours and reports. Works offline; data stays on the phone. Needs a 64-character activation key on first launch.

## Where it lives
- **Web app:** https://vormirtech-ai.github.io/Vormir-Tech-/playden/
- **Android APK (always the newest build):** https://github.com/vormirtech-ai/Vormir-Tech-/releases/download/playden-latest/PlayDen.apk
- **Source:** the `playden-app` branch of vormirtech-ai/Vormir-Tech-. Every push builds a new APK.
- Uses the same `CUEZONE_KEYSTORE` repo secret as CueZone to sign APKs, so updates install over older versions.

## Features
- Stations: open area and private cabins, each with type (PS5, PS4, Xbox, PC, VR, Racing Sim, Snooker, Pool), hourly rate, players included, extra-player rate, max players and minimum charge
- Sessions: open time or fixed time, pause, extend, move, change players mid-session (each part billed at its own rate), game played
- Alerts: warning before end, full-screen time-up pop-up with alarm and vibration, reminders on long sessions, booking reminders; system notifications even when the app is closed
- Food: menu with categories, order from any station or the counter, kitchen list (New → Preparing → Served), optional KOT to the cook on WhatsApp, counter/takeaway billing
- Bookings: reserve cabins or stations by date and time, clash check, advance payment, WhatsApp confirmation, start the session from the booking with the advance deducted, no-show / cancel
- Billing: per-minute or rounded, full booked time option, happy-hours discount, discount (₹ or %), split, Cash / UPI / Card / Credit (khata); uploaded payment QR or auto UPI QR with amount; WhatsApp bill and bill picture with QR
- Reports: today / yesterday / 7 / 30 days: gaming vs food, cabins vs open area, payment split, by console type, per station, busy hours, top games, top food; share or copy CSV
- Backup / restore, light and dark theme

## Build on your own PC
Node 22+, JDK 21 and Android Studio: `npm install`, `npm run sync`, `npx cap open android`.
