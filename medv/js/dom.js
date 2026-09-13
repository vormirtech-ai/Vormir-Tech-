/** Tiny hyperscript helper — `el('div.card#id', {onclick}, children)`. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'defs',
  'linearGradient', 'stop', 'tspan', 'clipPath', 'ellipse']);

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.setAttribute('class', `${node.getAttribute('class') ? `${node.getAttribute('class')} ` : ''}${value}`);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'ref' && typeof value === 'function') {
      value(node);
    } else if (key === 'value' && 'value' in node) {
      node.value = value;
    } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'readOnly') {
      node[key] = Boolean(value);
      if (value === true && key !== 'readOnly') node.setAttribute(key.toLowerCase(), '');
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
}

function appendChild(node, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(node, c);
  } else if (child instanceof Node) {
    node.appendChild(child);
  } else {
    node.appendChild(document.createTextNode(String(child)));
  }
}

export function el(spec, props, ...children) {
  const [head, ...classes] = String(spec).split('.');
  const [tag, id] = head.split('#');
  const name = tag || 'div';
  const node = SVG_TAGS.has(name) ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) node.id = id;
  if (classes.length) node.setAttribute('class', classes.join(' '));
  if (props && (props instanceof Node || Array.isArray(props) || typeof props !== 'object')) {
    children.unshift(props);
  } else if (props) {
    applyProps(node, props);
  }
  appendChild(node, children);
  return node;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  appendChild(f, children);
  return f;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(target, ...children) {
  clear(target);
  appendChild(target, children);
  return target;
}

export function qs(selector, scope = document) { return scope.querySelector(selector); }
export function qsa(selector, scope = document) { return [...scope.querySelectorAll(selector)]; }

/** Debounce used by the type-ahead boxes. */
export function debounce(fn, wait = 180) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
