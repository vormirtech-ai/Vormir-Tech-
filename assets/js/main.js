/* =========================================================
   Vormir Tech Solutions — site behaviour
   Vanilla JS, no dependencies.
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FRAME_COUNT  = 120;
  var FRAME_PATH   = 'assets/frames/frame_';

  /* ---------------------------------------------------------
     Footer year
     --------------------------------------------------------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------------------------------------------------
     Navbar: pill transform + mobile menu
     --------------------------------------------------------- */
  var navbar = document.getElementById('navbar');
  var navToggle = document.getElementById('navToggle');
  var mobileMenu = document.getElementById('mobileMenu');

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      navToggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
      navToggle.querySelector('use').setAttribute('href', open ? '#i-menu' : '#i-close');
      mobileMenu.hidden = open;
    });
    mobileMenu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        mobileMenu.hidden = true;
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.setAttribute('aria-label', 'Open menu');
        navToggle.querySelector('use').setAttribute('href', '#i-menu');
      }
    });
  }

  /* ---------------------------------------------------------
     Starscape
     --------------------------------------------------------- */
  var starCanvas = document.getElementById('starscape');
  if (starCanvas) {
    var sctx = starCanvas.getContext('2d');
    var stars = [];
    var starW = 0, starH = 0;

    function seedStars() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      starW = window.innerWidth;
      starH = window.innerHeight;
      starCanvas.width = starW * dpr;
      starCanvas.height = starH * dpr;
      starCanvas.style.width = starW + 'px';
      starCanvas.style.height = starH + 'px';
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var count = window.innerWidth < 768 ? 90 : 180;
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * starW,
          y: Math.random() * starH,
          r: Math.random() * 1.2 + 0.3,
          o: Math.random() * 0.6 + 0.2,
          dx: (Math.random() - 0.5) * 0.04,
          dy: (Math.random() - 0.5) * 0.02,
          ts: Math.random() * 0.002 + 0.0005,
          tp: Math.random() * Math.PI * 2
        });
      }
    }

    function paintStars(animated) {
      sctx.clearRect(0, 0, starW, starH);
      var now = Date.now();
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (animated) {
          s.x += s.dx; s.y += s.dy;
          if (s.x < 0) s.x = starW; else if (s.x > starW) s.x = 0;
          if (s.y < 0) s.y = starH; else if (s.y > starH) s.y = 0;
        }
        var op = animated ? s.o + Math.sin(now * s.ts + s.tp) * 0.3 : s.o;
        if (op <= 0) continue;
        sctx.beginPath();
        sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        sctx.fillStyle = 'rgba(226,234,248,' + op.toFixed(3) + ')';
        sctx.fill();
      }
      if (animated) requestAnimationFrame(function () { paintStars(true); });
    }

    seedStars();
    paintStars(!reduceMotion);
    window.addEventListener('resize', function () {
      seedStars();
      if (reduceMotion) paintStars(false);
    });
  }

  /* ---------------------------------------------------------
     Scroll-driven frame sequence
     --------------------------------------------------------- */
  var section = document.querySelector('.scroll-animation');
  var canvas  = document.getElementById('frameCanvas');
  var loader  = document.getElementById('loader');
  var loaderBar = document.getElementById('loaderBar');
  var cards   = Array.prototype.slice.call(document.querySelectorAll('.annotation-card'));

  function finishLoading() {
    if (document.body.classList.contains('loaded')) return;
    document.body.classList.add('loaded');
    window.setTimeout(function () { if (loader) loader.style.display = 'none'; }, 650);
  }

  /* Reduced motion: skip the canvas entirely — CSS renders the final
     frame and all three cards as ordinary, readable content. */
  if (reduceMotion || !section || !canvas) {
    finishLoading();
  } else {
    var ctx = canvas.getContext('2d', { alpha: false });
    var frames = new Array(FRAME_COUNT);
    var ready  = new Array(FRAME_COUNT);
    var loadedCount = 0;
    var currentFrame = -1;

    /* --- dwell map: the frame sequence pauses while each annotation
       card is on screen, then resumes. Same "stop, read, go" rhythm as a
       scroll-lock, but the page never stops responding to the user. --- */
    var plateaus = cards.map(function (card) {
      var a = parseFloat(card.dataset.show);
      var b = parseFloat(card.dataset.hide);
      var mid = (a + b) / 2;
      return [Math.max(0, mid - 0.045), Math.min(1, mid + 0.045)];
    }).sort(function (x, y) { return x[0] - y[0]; });

    var plateauTotal = plateaus.reduce(function (t, z) { return t + (z[1] - z[0]); }, 0);
    var rate = 1 / Math.max(0.15, 1 - plateauTotal);

    function mapProgress(s) {
      var v = 0, prev = 0;
      for (var i = 0; i < plateaus.length; i++) {
        var a = plateaus[i][0], b = plateaus[i][1];
        if (s <= a) return Math.min(1, v + (s - prev) * rate);
        v += (a - prev) * rate;
        if (s <= b) return Math.min(1, v);
        prev = b;
      }
      return Math.min(1, v + (s - prev) * rate);
    }

    function resizeCanvas() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width  = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      drawFrame(currentFrame < 0 ? 0 : currentFrame, true);
    }

    function nearestReady(index) {
      if (ready[index]) return index;
      for (var d = 1; d < FRAME_COUNT; d++) {
        if (index - d >= 0 && ready[index - d]) return index - d;
        if (index + d < FRAME_COUNT && ready[index + d]) return index + d;
      }
      return -1;
    }

    function drawFrame(index, force) {
      var i = nearestReady(index);
      if (i < 0) return;
      if (!force && i === currentFrame) return;
      currentFrame = i;

      var img = frames[i];
      var cw = canvas.width, ch = canvas.height;
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, cw, ch);

      var imgRatio = img.width / img.height;
      var canvasRatio = cw / ch;
      var dw, dh;

      if (window.innerWidth > 768) {
        /* desktop: cover-fit, fills edge to edge */
        if (canvasRatio > imgRatio) { dw = cw; dh = cw / imgRatio; }
        else { dh = ch; dw = ch * imgRatio; }
      } else {
        /* mobile: the frame is 1.7:1 but the viewport is portrait, so a plain
           contain-fit shrinks the wordmark. The logo spans ~74% of the frame
           width, so zoom until it fills ~90% of the viewport. */
        var zoom = 1.22;
        if (canvasRatio > imgRatio) { dh = ch * zoom; dw = dh * imgRatio; }
        else { dw = cw * zoom; dh = dw / imgRatio; }
      }
      var dx = (cw - dw) / 2, dy = (ch - dh) / 2;

      /* Where the frame letterboxes (portrait phones), stretch its own top and
         bottom edge rows to fill the gap. The frame then fades into the page
         instead of ending on a hard seam, and it stays correct for every frame
         as the background brightens through the reveal. */
      if (dy > 0) {
        ctx.drawImage(img, 0, 0, img.width, 2, dx, 0, dw, dy + 1);
        ctx.drawImage(img, 0, img.height - 2, img.width, 2, dx, dy + dh - 1, dw, ch - dy - dh + 1);
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function updateCards(progress) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var visible = progress >= parseFloat(card.dataset.show) &&
                      progress <= parseFloat(card.dataset.hide);
        card.classList.toggle('visible', visible);
        card.setAttribute('aria-hidden', String(!visible));
      }
    }

    /* --- preload --- */
    var gateAt = Math.min(30, FRAME_COUNT);
    for (var i = 0; i < FRAME_COUNT; i++) {
      (function (idx) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          ready[idx] = true;
          loadedCount++;
          if (loaderBar) loaderBar.style.width = (loadedCount / FRAME_COUNT * 100) + '%';
          if (idx === 0 || loadedCount === 1) drawFrame(0, true);
          if (loadedCount >= gateAt) finishLoading();
        };
        img.onerror = function () {
          loadedCount++;
          if (loadedCount >= gateAt) finishLoading();
        };
        img.src = FRAME_PATH + String(idx + 1).padStart(4, '0') + '.jpg';
        frames[idx] = img;
      })(i);
    }
    /* never let a slow network hold the page hostage */
    window.setTimeout(finishLoading, 5000);

    /* --- scroll driver --- */
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var rect = section.getBoundingClientRect();
        var scrollable = section.offsetHeight - window.innerHeight;
        var raw = scrollable > 0 ? -rect.top / scrollable : 0;
        var s = Math.min(1, Math.max(0, raw));

        drawFrame(Math.min(FRAME_COUNT - 1, Math.floor(mapProgress(s) * FRAME_COUNT)));
        updateCards(s);

        var doc = document.documentElement;
        var total = doc.scrollHeight - window.innerHeight;
        var bar = document.getElementById('scrollProgress');
        if (bar) bar.style.width = (total > 0 ? (window.scrollY / total) * 100 : 0) + '%';

        if (navbar) navbar.classList.toggle('nav-scrolled', window.scrollY > 80);
        ticking = false;
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    onScroll();
  }

  /* Navbar pill still needs to react when the canvas path is skipped. */
  if (reduceMotion && navbar) {
    window.addEventListener('scroll', function () {
      navbar.classList.toggle('nav-scrolled', window.scrollY > 80);
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     Count-up stats
     --------------------------------------------------------- */
  function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function countUp(el, target, suffix, duration) {
    if (reduceMotion) { el.textContent = target + suffix; return; }
    var start = performance.now();
    el.classList.add('counting');
    (function step(now) {
      var p = Math.min((now - start) / duration, 1);
      var val = easeOutExpo(p) * target;
      el.textContent = (target % 1 === 0 ? Math.floor(val) : val.toFixed(1)) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = target + suffix; el.classList.remove('counting'); }
    })(start);
  }

  var specs = document.getElementById('specs');
  if (specs && reduceMotion) {
    /* no animation to wait for — show the final numbers straight away */
    specs.querySelectorAll('.spec-item').forEach(function (item) {
      item.querySelector('.spec-number').textContent =
        item.dataset.target + (item.dataset.suffix || '');
    });
  } else if (specs && 'IntersectionObserver' in window) {
    var specObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.querySelectorAll('.spec-item').forEach(function (item, i) {
          window.setTimeout(function () {
            countUp(item.querySelector('.spec-number'),
                    parseFloat(item.dataset.target),
                    item.dataset.suffix || '', 1800);
          }, i * 180);
        });
        specObserver.unobserve(entry.target);
      });
    }, { threshold: 0.3 });
    specObserver.observe(specs);
  } else if (specs) {
    specs.querySelectorAll('.spec-item').forEach(function (item) {
      item.querySelector('.spec-number').textContent = item.dataset.target + (item.dataset.suffix || '');
    });
  }

  /* ---------------------------------------------------------
     Scroll reveal
     --------------------------------------------------------- */
  var revealables = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealables.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('in'); });
  }
})();
