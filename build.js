// Builds two outputs from src/app.html:
//  www/index.html       -> the Android app (offline: local fonts + local QR library)
//  dist/preview.html    -> browser preview with sample data
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync('src/app.html', 'utf8');
const fontLink = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*data-fonts>/;

// ---- Android www ----
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www/fonts', { recursive: true });
fs.mkdirSync('www/lib', { recursive: true });
let css = '';
const faces = [['barlow-condensed', 'Barlow Condensed', [500, 600, 700]], ['figtree', 'Figtree', [400, 500, 600, 700]]];
for (const [pkg, fam, weights] of faces) {
  for (const w of weights) {
    const f = `${pkg}-latin-${w}-normal.woff2`;
    fs.copyFileSync(path.join('node_modules/@fontsource', pkg, 'files', f), path.join('www/fonts', f));
    css += `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(${f}) format("woff2")}\n`;
  }
}
fs.writeFileSync('www/fonts/fonts.css', css);
fs.copyFileSync('node_modules/qrcode-generator/qrcode.js', 'www/lib/qrcode.js');

const titleMatch = src.match(/<title>.*?<\/title>/)[0];
let body = src.replace(/env\(safe-area-inset-(top|bottom|left|right),0px\)/g, 'var(--safe-area-inset-$1,env(safe-area-inset-$1,0px))').replace(titleMatch, '').replace(/<meta name="claude:[^>]*>\n?/, '').replace(fontLink, '');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0B6B4C">
${titleMatch}
<link rel="stylesheet" href="fonts/fonts.css">
<script src="lib/qrcode.js"></script>
<style>:root{padding-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));padding-bottom:0}body{-webkit-user-select:none;user-select:none}input,textarea{-webkit-user-select:text;user-select:text}</style>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync('www/index.html', html);

// ---- Web app for GitHub Pages (installable, works offline) ----
const APK = 'https://github.com/vormirtech-ai/Vormir-Tech-/releases/latest/download/CueZone.apk';
fs.rmSync('web', { recursive: true, force: true });
fs.cpSync('www', 'web', { recursive: true });
fs.mkdirSync('web/icons', { recursive: true });
for (const n of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join('assets', n), path.join('web/icons', n));
fs.writeFileSync('web/manifest.webmanifest', JSON.stringify({
  name: 'CueZone Snooker Club', short_name: 'CueZone', start_url: './', scope: './', display: 'standalone',
  orientation: 'portrait', background_color: '#0B6B4C', theme_color: '#0B6B4C',
  description: 'Table timers, time-up alerts, billing and reports for snooker and pool clubs.',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
const cacheFiles = ['./', 'index.html', 'fonts/fonts.css', 'lib/qrcode.js', 'manifest.webmanifest', 'icons/icon-192.png',
  ...fs.readdirSync('www/fonts').filter(f => f.endsWith('.woff2')).map(f => 'fonts/' + f)];
const ver = Date.now().toString(36);
fs.writeFileSync('web/sw.js', `const C='cuezone-${ver}',F=${JSON.stringify(cacheFiles)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
`);
const webHtml = html
  .replace('<link rel="stylesheet" href="fonts/fonts.css">',
    '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" href="icons/icon-192.png">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="description" content="Snooker club manager: table timers, time-up alerts, billing, canteen, khata and reports.">\n<link rel="stylesheet" href="fonts/fonts.css">\n<script>window.CUEZONE_APK=' + JSON.stringify(APK) + '</script>')
  .replace('</body>', '<script>if("serviceWorker" in navigator)addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})})</script>\n</body>');
fs.writeFileSync('web/index.html', webHtml);

// ---- Browser preview (artifact) ----
fs.mkdirSync('dist', { recursive: true });
const preview = src.replace(/(<style>)/, '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>\n<script>window.CUEZONE_DEMO=true;window.CUEZONE_APK=' + JSON.stringify(APK) + '</script>\n$1');
fs.writeFileSync('dist/preview.html', preview);
console.log('Built www/, web/ and dist/preview.html');
