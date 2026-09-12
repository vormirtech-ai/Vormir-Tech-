/** Hash router. Routes are declared as '#/name' or '#/name/:id'. */
const routes = [];
let onRender = null;
let current = null;

export function register(pattern, view, meta = {}) {
  const parts = pattern.replace(/^#\//, '').split('/');
  routes.push({ pattern, parts, view, meta });
}

function match(hash) {
  const clean = (hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0];
  const parts = clean.split('/').filter((p) => p !== '');
  for (const route of routes) {
    if (route.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    route.parts.forEach((piece, i) => {
      if (piece.startsWith(':')) params[piece.slice(1)] = decodeURIComponent(parts[i]);
      else if (piece !== parts[i]) ok = false;
    });
    if (ok) return { route, params };
  }
  return null;
}

function query(hash) {
  const q = (hash.split('?')[1] || '');
  return Object.fromEntries(new URLSearchParams(q));
}

export function start(renderer) {
  onRender = renderer;
  window.addEventListener('hashchange', () => resolve());
  resolve();
}

export function resolve() {
  const hash = window.location.hash || '#/dashboard';
  const found = match(hash);
  current = { hash, ...(found || {}) };
  if (!found) {
    onRender({ notFound: true, hash });
    return;
  }
  onRender({ route: found.route, params: found.params, query: query(hash), hash });
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === target) {
    resolve();
    return;
  }
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function reload() { resolve(); }
export function currentRoute() { return current; }
export function allRoutes() { return routes.slice(); }
