// Renders the data-driven parts of the page from data/*.json.
// Pure helpers are exported so test/site.test.mjs can check them.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthlyFromDays(days) {
  const by = new Map();
  for (const [date, n] of days) by.set(date.slice(0, 7), (by.get(date.slice(0, 7)) || 0) + n);
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12);
}

// Sum products into one monthly series. Products in another currency than the first are skipped.
export function combineRevenue(rev) {
  const products = Object.values(rev?.products || {});
  if (!products.length) return null;
  const currency = products[0].currency;
  const by = new Map();
  for (const p of products) {
    if (p.currency !== currency) continue;
    for (const [k, v] of p.months) by.set(k, (by.get(k) || 0) + v);
  }
  const months = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { currency, months, total: months.reduce((s, m) => s + m[1], 0) };
}

export function money(cents, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function heatLevel(n, max) {
  if (!n) return 0;
  const r = n / max;
  return r > 0.6 ? 4 : r > 0.3 ? 3 : r > 0.1 ? 2 : 1;
}

async function load(path) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

function drawBars(svg, months, fmt) {
  const draw = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = svg.clientWidth || 700, H = svg.clientHeight || 220;
    const left = 52, bottom = 22, top = 8;
    const max = Math.max(1, ...months.map((m) => m[1]));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const ceil = Math.ceil(max / step) * step;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const f of [0, 0.5, 1]) {
      const y = top + (H - top - bottom) * (1 - f);
      svg.appendChild(el('line', { x1: left, x2: W, y1: y, y2: y, class: 'grid' }));
      svg.appendChild(el('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, fmt(ceil * f, true)));
    }
    const slot = (W - left) / months.length;
    const bw = Math.min(36, slot * 0.62);
    months.forEach((m, i) => {
      const h = Math.max(2, ((H - top - bottom) * Math.max(0, m[1])) / ceil);
      const x = left + slot * i + (slot - bw) / 2;
      const r = el('rect', { x, y: H - bottom - h, width: bw, height: h, rx: 4, class: m[1] > 0 ? 'bar' : 'bar zero' });
      r.appendChild(el('title', {}, `${m[0]}: ${fmt(m[1])}`));
      svg.appendChild(r);
      svg.appendChild(el('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, MONTHS[+m[0].slice(5) - 1]));
    });
  };
  draw();
  addEventListener('resize', draw);
}

function renderTop(gh, rev) {
  const combined = combineRevenue(rev);
  const svg = document.getElementById('chart');
  if (combined) {
    const fmt = (v) => money(v, combined.currency);
    document.getElementById('total').textContent = fmt(combined.total);
    document.getElementById('chart-sub').textContent = 'revenue in 12 months, from Stripe';
    document.getElementById('asof').textContent = rev.asOf;
    drawBars(svg, combined.months, fmt);
  } else if (gh) {
    const months = monthlyFromDays(gh.days);
    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    document.getElementById('total').textContent = fmt(months.reduce((s, m) => s + m[1], 0));
    document.getElementById('asof').textContent = gh.asOf;
    drawBars(svg, months, fmt);
  }
}

function renderProductBadges(rev) {
  for (const [id, p] of Object.entries(rev?.products || {})) {
    const badge = document.querySelector(`[data-product="${id}"] .badge`);
    if (!badge) continue;
    badge.textContent = `${money(p.last30, p.currency)}/30d`;
    badge.classList.remove('live');
    badge.classList.add('money');
  }
}

function renderHeat(gh) {
  if (!gh) return;
  const box = document.getElementById('heat');
  const max = Math.max(1, ...gh.days.map((d) => d[1]));
  const first = new Date(gh.days[0][0] + 'T00:00:00Z').getUTCDay();
  for (let i = 0; i < first; i++) box.appendChild(Object.assign(document.createElement('i'), { style: 'visibility:hidden' }));
  for (const [date, n] of gh.days) {
    const c = document.createElement('i');
    const lvl = heatLevel(n, max);
    if (lvl) c.className = 'l' + lvl;
    c.title = `${date}: ${n}`;
    box.appendChild(c);
  }
  const total = gh.total.toLocaleString('en-US');
  document.getElementById('gh-count').textContent = total;
  box.parentElement.scrollLeft = box.parentElement.scrollWidth;
}

async function renderTravel(travel) {
  if (!travel) return;
  const n = travel.countries.length;
  document.getElementById('travel-count').textContent = n;
  document.getElementById('travel-big').textContent = `${n} countries`;
  const ul = document.getElementById('flags');
  for (const c of travel.countries) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="f">${c.flag}</span><span></span>${c.code === travel.basedIn ? '<span class="home">Home</span>' : ''}`;
    li.children[1].textContent = c.name;
    ul.appendChild(li);
  }

  const canvas = document.getElementById('globe');
  let createGlobe;
  try { ({ default: createGlobe } = await import('https://cdn.jsdelivr.net/npm/cobe@0.6.3/+esm')); } catch { return; }
  const home = travel.countries.find((c) => c.code === travel.basedIn) || travel.countries[0];
  let phi = -home.lng * Math.PI / 180 - Math.PI / 2;
  let drag = null, dragPhi = 0, width = 0;
  const resize = () => { width = canvas.offsetWidth; };
  resize(); addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX - dragPhi; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => { if (drag !== null) dragPhi = e.clientX - drag; });
  createGlobe(canvas, {
    devicePixelRatio: 2, width: width * 2, height: width * 2,
    phi, theta: 0.3, dark: 1, diffuse: 1.2, mapSamples: 16000, mapBrightness: 6,
    baseColor: [0.4, 0.4, 0.4], markerColor: [0.98, 0.98, 0.98], glowColor: [0.15, 0.15, 0.15],
    markers: travel.countries.map((c) => ({ location: [c.lat, c.lng], size: c.code === travel.basedIn ? 0.09 : 0.06 })),
    onRender(state) {
      if (drag === null) phi += 0.003;
      state.phi = phi + dragPhi / 200;
      state.width = width * 2;
      state.height = width * 2;
    },
  });
  canvas.classList.add('on');
}

export function visibleSections(filter, ids) {
  return ids.filter((id) => filter === 'all' || id === filter);
}

function setupFilters() {
  const buttons = [...document.querySelectorAll('.filters button')];
  const sections = [...document.querySelectorAll('.proj')];
  const ids = sections.map((s) => s.dataset.section);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const show = new Set(visibleSections(b.dataset.filter, ids));
      for (const s of sections) s.hidden = !show.has(s.dataset.section);
      for (const x of buttons) x.classList.toggle('on', x === b);
    });
  }
}

if (typeof document !== 'undefined') {
  setupFilters();
  const [gh, rev, travel] = await Promise.all([load('data/github.json'), load('data/revenue.json'), load('data/travel.json')]);
  renderTop(gh, rev);
  renderProductBadges(rev);
  renderHeat(gh);
  renderTravel(travel);
}
