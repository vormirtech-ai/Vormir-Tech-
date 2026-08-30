# Vormir Tech Solutions — Company Website

A static, dependency-free marketing site for Vormir Tech Solutions (Nagpur, India).
Nothing to build and nothing to install — it is plain HTML, CSS and JavaScript.

## Hosting it on GitHub Pages

1. Create a repository (for a root domain use `<username>.github.io`, otherwise any name works).
2. Upload **the contents of this folder** — `index.html` must sit at the top level of the
   repository, not inside a subfolder.
3. Go to **Settings → Pages**, set *Source* to **Deploy from a branch**, pick the `main`
   branch and the `/ (root)` folder, and save.
4. The site is live at `https://<username>.github.io/<repo>/` within a minute or two.

`.nojekyll` is included so GitHub Pages serves the files as-is.

### Testing locally

Open a terminal in this folder and run any static server — the scroll animation loads its
frames over HTTP, so opening `index.html` straight off the disk will not show it:

```bash
python3 -m http.server 8080     # then visit http://localhost:8080
```

## Layout

```
index.html              the whole page
assets/
  css/styles.css        design tokens + all styling
  js/main.js            scroll animation, counters, navigation
  frames/               120 JPEG frames driving the hero animation
  logo.png              wordmark, transparent background
  icon-256.png          app icon
  favicon.svg           browser tab icon
  og.jpg                link preview image
robots.txt, sitemap.xml, .nojekyll
```

## Editing the content

Everything you are likely to change is plain text in `index.html`:

| What | Where |
|---|---|
| Phone numbers | search for `9226406057` / `9834523160` — they appear in the contact cards, the footer, the WhatsApp link and the JSON-LD block near the top |
| Email address | search for `vormirtech@gmail.com` |
| Services | the six `<article class="card service-card">` blocks |
| Projects | the two `<article class="work-item">` blocks |
| Statistics | the `data-target` attributes in `<section id="specs">` |
| Company facts | the `<dl class="about-facts">` block |

Colours, spacing and fonts are CSS custom properties at the very top of
`assets/css/styles.css`. The theme is a deep cosmic navy (`--bg: #020617`) with silver
typography (`--accent: #C6D2E6`) and a brushed-metal gradient (`--silver`) used on the
hero italic, the counters and the primary buttons. The nebula colours behind the page are
`--neb-1/2/3`; the drifting starfield is drawn on a canvas in `assets/js/main.js`.
Change `--accent` and `--silver` together and the whole site re-tints.

### Replacing the project screenshots

The two project previews are inline SVG mockups, so they stay sharp at any size and add no
loading weight. To use real screenshots instead, drop your image into `assets/` and swap the
`<svg class="work-shot">…</svg>` block for:

```html
<img class="work-shot" src="assets/baruch-cafe.png" alt="The Baruch Cafe billing counter">
```

### Replacing the hero animation

The frames come from the logo-reveal video. To use a different video, re-extract with FFmpeg:

```bash
ffmpeg -i your-video.mov -vf "fps=15,scale=1440:-2" -q:v 6 assets/frames/frame_%04d.jpg
```

Then set `FRAME_COUNT` at the top of `assets/js/main.js` to the number of files produced.

## Notes

- Verify the figures in the statistics band and the "7+ clients" claims before publishing —
  they were written from the project brief and are yours to confirm.
- The site is dark-only by design, to match the logo.
- Accessibility: skip link, keyboard focus rings, 4.5:1+ contrast throughout, and a
  `prefers-reduced-motion` path that replaces the scroll animation with static content.
