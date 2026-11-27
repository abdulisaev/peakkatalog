// PEAK — каталог и пополнение магазинов с главного склада «Лиственная».
// Работает в трёх режимах: боевой (сервер + 1С), демо для владельца и офлайн-файл (file://).

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
const key = (article, color, size) => JSON.stringify([String(article).trim().toUpperCase(), String(color).trim().toLowerCase(), String(size).trim().toUpperCase()]);
const fmt = new Intl.NumberFormat('ru-RU');
const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });
const clock = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const timeOnly = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const offline = location.protocol === 'file:';
// Данные встроены в файл (офлайн-демо): работает и с диска, и в окне предпросмотра, и с любого адреса.
const embedded = Boolean(window.PEAK_DEMO_DATA?.catalog);
const WAREHOUSE = 'listvennaya';
const STALE_MINUTES = 75;
const PAGE = 24;
const MAX_LINES = 250; // столько позиций сервер принимает в одной заявке
const statusLabels = { new: 'Новая', done: 'Перемещение оформлено', rejected: 'Отклонена' };
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const icons = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 5H6a2 2 0 0 0-2 2v9"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  peak: '<svg viewBox="0 0 64 48" aria-hidden="true"><path fill="currentColor" d="M2 44 30 2h7l19 29H44L34 16 21 35h36l6 9z"/></svg>'
};

// ---------- Размеры и сезоны ----------
const LETTER_SIZES = ['3XS', '2XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', '6XL', '7XL', '8XL'];
function sizeRank(size) {
  const value = String(size).trim().toUpperCase();
  if (!value) return [3, 0, ''];
  if (/^\d+([.,]\d+)?$/.test(value)) return [0, Number(value.replace(',', '.')), value];
  const letter = LETTER_SIZES.indexOf(value);
  return letter >= 0 ? [1, letter, value] : [2, 0, value];
}
const sizeOrder = (a, b) => {
  const x = sizeRank(a), y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || collator.compare(x[2], y[2]);
};
const sizeName = size => size || 'Единый';
const seasonRank = season => { const m = /^(\d\d)Q(\d)$/i.exec(season || ''); return m ? Number(m[1]) * 10 + Number(m[2]) : 0; };

// Названия товаров, которых ещё нет в каталоге, приходят из 1С вида «Носки PEAK (W3252011) 6q2».
// Из них получаем чистое название, сезон и категорию, чтобы такие товары не падали в «Без категории».
const SHOES = /^(кроссовки|кроссовок|кеды|тапочки|сланцы|шлепанцы|сандали|сандалии|бутсы|ботинки|слипоны|мокасины|кеды-)/i;
const CLOTHES = /^(футболка|брюки|куртка|пуховик|шорты|свитер|ветровка|лонгслив|свитшот|жилетка|жилет|худи|майка|поло|штаны|кофта|тайтсы|лосины|леггинсы|юбка|платье|рубашка|рашгард|бомбер|толстовка|костюм|джинсы|форма|комбинезон|топ|олимпийка|бра)/i;
function describe(label, article) {
  let name = String(label || '').replace(/\s*\([^)]*\)\s*/g, ' ');
  let season = '';
  const code = /\s(\d)q(\d)\s*$/i.exec(name);
  if (code) { season = '2' + code[1] + 'Q' + code[2]; name = name.slice(0, code.index); }
  name = name.replace(/\s+/g, ' ').trim() || article;
  const kids = /\bkids\b|детск/i.test(name);
  const kind = SHOES.test(name) ? 'Обувь' : CLOTHES.test(name) ? 'Одежда' : 'Аксессуары';
  return { name, season, category: (kids ? 'Дети' : 'Взрослые') + ' · ' + kind };
}

// ---------- Состояние ----------
const state = {
  demo: false, demoLocations: [], user: null, catalog: [],
  products: [], byArticle: new Map(), filtered: [], shown: 0,
  stocks: { store: [], warehouse: [], network: null }, updated: null, hit: null, stockDenied: false, loadingStock: false,
  cart: new Map(), orderId: null, comment: '',
  orders: [], ordersLoaded: false,
  active: 'catalog',
  f: { q: '', aud: [], kind: [], season: [], size: [], absent: false, sort: '' }, base: [],
  of: { status: 'new', store: '', q: '' },
  current: null, draft: new Map()
};
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const productDialog = $('product-dialog');
const cartDialog = $('cart-dialog');
const photoDialog = $('photo-dialog');
let toastTimer;
let orderRead = 0;

// ---------- Общие функции ----------
async function api(path, body, method = 'POST') {
  if (embedded && path === '/api/session') return { user: null };
  if (embedded && path === '/data/catalog.json') return window.PEAK_DEMO_DATA.catalog;
  if (embedded && (path === '/data/stock-example.json' || path === '/api/owner-preview')) return window.PEAK_DEMO_DATA.stock;
  const options = body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(data?.error || 'Не удалось загрузить данные. Повторите попытку.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function storageRead(name, fallback) { try { return JSON.parse(localStorage.getItem(name)) ?? fallback; } catch { return fallback; } }
function storageWrite(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch { return false; } }
function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function banner(message, warn = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').classList.toggle('warn', warn);
}
const canOrder = () => state.user?.role === 'store';
const isWarehouse = () => state.user?.role === 'warehouse';
const hasStock = () => state.demo || Boolean(state.updated);
const stockFresh = () => state.demo || Boolean(state.updated && Date.now() - Date.parse(state.updated) <= STALE_MINUTES * 60_000);
const qty = value => value == null ? '—' : fmt.format(value);
const numClass = value => value == null ? '' : value < 0 ? 'neg' : value === 0 ? 'zero' : 'pos';
function photoSrc(kind, id) {
  if (id == null) return null;
  // Во встроенном файле лежат только крупные фото — их же браузер уменьшает для плиток.
  if (window.PEAK_PHOTOS) return window.PEAK_PHOTOS[kind + '-' + Number(id)] ?? window.PEAK_PHOTOS['detail-' + Number(id)] ?? null;
  return (offline ? './' : '/') + 'photo/' + kind + '-' + Number(id) + '.' + (window.PEAK_PHOTO_FORMAT || 'jpg');
}
function photoMarkup(id, kind, label, eager = false) {
  const src = photoSrc(kind, id);
  if (!src) return `<span class="no-photo">${icons.peak}Нет фото</span>`;
  // Плитки на телефонах и экранах с масштабом 125–200% получают фото 580 px вместо превью 250 px.
  const big = kind === 'thumb' ? photoSrc('detail', id) : null;
  const srcset = big && big !== src ? ` srcset="${safe(src)} 250w, ${safe(big)} 580w" sizes="(max-width: 760px) 48vw, 300px"` : '';
  const side = kind === 'thumb' ? 250 : 580;
  return `<img src="${safe(src)}"${srcset} width="${side}" height="${side}" alt="${safe(label)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(area); area.select();
    const done = document.execCommand?.('copy'); area.remove(); return Boolean(done);
  }
}
function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const csv = rows => rows.map(row => row.map(cell => {
  const text = String(cell ?? '');
  return /[;"\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}).join(';')).join('\r\n');
const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const confirmDialog = $('confirm-dialog');
function ask(text, yes = 'Да') {
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yes;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'yes'), { once: true }));
}

// ---------- Корзина в браузере ----------
const cartStoreKey = () => 'peak-cart-v2-' + (state.demo ? 'demo-' : state.user.id + '-') + state.user.store;
function restoreCart() {
  const saved = storageRead(cartStoreKey(), null) ?? storageRead(cartStoreKey().replace('-v2-', '-v1-'), { id: null, lines: [] });
  state.orderId = saved.id ?? null;
  state.comment = saved.comment ?? '';
  state.cart = new Map((saved.lines ?? []).map(line => [key(line.a, line.color, line.size), line]));
  updateCartCount();
}
function saveCart() { storageWrite(cartStoreKey(), { id: state.orderId, comment: state.comment, lines: [...state.cart.values()] }); }
function cartTotal() { return [...state.cart.values()].reduce((n, line) => n + line.qty, 0); }
function updateCartCount(bump = false) {
  $('cart-count').textContent = fmt.format(cartTotal());
  $('cart-fab-count').textContent = fmt.format(cartTotal());
  $('cart-count').hidden = !cartTotal();
  updateCartFab();
  if (bump) { const b = $('cart-button'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
}
function inCart(sku) { return state.cart.get(sku)?.qty ?? 0; }
function addToCart(lines) {
  let added = 0;
  for (const { a, color, size, qty: n } of lines) {
    if (!(n > 0)) continue;
    const sku = key(a, color, size);
    const line = state.cart.get(sku) ?? { a, color, size, qty: 0 };
    line.qty += n; added += n;
    state.cart.set(sku, line);
  }
  if (added) { state.orderId = null; saveCart(); updateCartCount(true); }
  return added;
}

// ---------- Индекс товаров ----------
// Отрицательные остатки из 1С показываем как 0: директору нужна наличность, а не ошибки учёта.
const pos = q => Math.max(0, Number(q) || 0);
function buildIndex() {
  const storeStock = new Map(state.stocks.store.map(row => [key(row[0], row[1], row[2]), pos(row[3])]));
  const whStock = new Map(state.stocks.warehouse.map(row => [key(row[0], row[1], row[2]), pos(row[3])]));
  const network = state.stocks.network;
  const netStock = new Map((network?.rows ?? []).map(row => [key(row[0], row[1], row[2]), row[3]]));
  const map = new Map();
  const ensureProduct = (article, info) => {
    const id = article.trim().toUpperCase();
    if (!map.has(id)) map.set(id, { a: article.trim(), n: info.name, s: info.season, c: info.category, photo: info.photo ?? null, colors: new Map() });
    return map.get(id);
  };
  const ensureColor = (product, name, photo = null) => {
    const id = name.trim().toLowerCase();
    if (!product.colors.has(id)) product.colors.set(id, { color: name, photo, sizes: new Map() });
    const color = product.colors.get(id);
    color.photo ??= photo;
    return color;
  };
  for (const item of state.catalog) {
    const product = ensureProduct(item.a, { name: item.n || item.a, season: item.s || '', category: item.c || 'Взрослые · Аксессуары', photo: item.photo });
    for (const variant of item.variants) {
      const color = ensureColor(product, variant.color, variant.photo);
      for (const size of variant.sizes) color.sizes.set(size.trim().toUpperCase(), size);
    }
  }
  const reported = state.demo ? state.demoLocations.flatMap(loc => loc.rows)
    : [...state.stocks.warehouse, ...state.stocks.store, ...(network?.rows ?? []).map(([a, c, z]) => [a, c, z, 0])];
  for (const [article, colorName, size, , label] of reported) {
    if (!map.has(article.trim().toUpperCase())) ensureProduct(article, describe(label, article));
    ensureColor(map.get(article.trim().toUpperCase()), colorName).sizes.set(size.trim().toUpperCase(), size);
  }
  const storeView = canOrder();
  const known = hasStock();
  state.products = [...map.values()].map((p, order) => {
    const colors = [...p.colors.values()].map(c => {
      const lines = [...c.sizes.values()].sort(sizeOrder).map(size => {
        const sku = key(p.a, c.color, size);
        const net = known && network ? (netStock.get(sku) ?? []) : null;
        return { size, sku, store: known && storeView ? (storeStock.get(sku) ?? 0) : null, wh: known ? (whStock.get(sku) ?? 0) : null,
          net, netQty: net ? net.reduce((t, [, q]) => t + q, 0) : null };
      });
      return { color: c.color, photo: c.photo, lines, wh: lines.reduce((t, l) => t + (l.wh ?? 0), 0) };
    })
      // Сначала цвета, которые есть на Лиственной.
      .sort((x, y) => (y.wh > 0) - (x.wh > 0));
    const lines = colors.flatMap(c => c.lines);
    const sum = field => lines.some(l => l[field] != null) ? lines.reduce((t, l) => t + (l[field] ?? 0), 0) : null;
    const inStore = storeView && lines.some(l => l.store > 0);
    const sizes = new Map();
    for (const l of lines) {
      if (known && !(l.wh > 0)) continue;
      const s = sizes.get(l.size) ?? { size: l.size, need: false };
      if (storeView && l.store <= 0) s.need = true;
      sizes.set(l.size, s);
    }
    for (const s of sizes.values()) if (storeView && lines.some(l => l.size === s.size && l.store > 0)) s.need = false;
    return {
      ...p, order, colors,
      photo: p.photo ?? colors.find(c => c.photo != null)?.photo ?? null,
      store: sum('store'), wh: sum('wh'), net: sum('netQty'),
      onWarehouse: lines.some(l => l.wh > 0),
      absent: storeView && !inStore && lines.some(l => l.wh > 0),
      sizes: [...sizes.values()].sort((x, y) => sizeOrder(x.size, y.size)),
      rank: seasonRank(p.s),
      hay: normalize([p.a, p.n, p.c, p.s, ...colors.map(c => c.color)].join(' '))
    };
  });
  state.byArticle = new Map(state.products.map(p => [p.a, p]));
  // Каталог — это ассортимент Лиственной: товары без остатка на складе не показываем.
  state.base = known ? state.products.filter(p => p.onWarehouse) : state.products;
  const seasons = new Set(state.base.map(p => p.s).filter(Boolean));
  const sizes = new Set(state.base.flatMap(p => p.sizes.map(s => s.size)).filter(Boolean));
  state.f.season = state.f.season.filter(s => seasons.has(s));
  state.f.size = state.f.size.filter(s => sizes.has(s));
}

// ---------- Фильтры: все в одной панели, в каждой группе можно выбрать несколько значений ----------
const SORTS = [['', 'По умолчанию'], ['new', 'Сначала новый сезон'], ['wh', 'Больше на Лиственной'], ['low', 'Меньше в моём магазине'], ['name', 'По названию']];
const AUDIENCES = ['Взрослые', 'Дети'];
const KINDS = ['Обувь', 'Одежда', 'Аксессуары'];
const emptyFilters = () => ({ q: '', aud: [], kind: [], season: [], size: [], absent: false, sort: '' });
function matches(p, f, terms) {
  if (f.aud.length && !f.aud.some(a => p.c.startsWith(a))) return false;
  if (f.kind.length && !f.kind.some(k => p.c.endsWith(k))) return false;
  if (f.season.length && !f.season.includes(p.s)) return false;
  if (!terms.every(term => p.hay.includes(term))) return false;
  if (f.size.length && !p.sizes.some(s => f.size.includes(s.size))) return false;
  if (f.absent && !p.absent) return false;
  return true;
}
const sorters = {
  new: (a, b) => b.rank - a.rank || a.order - b.order,
  wh: (a, b) => (b.wh ?? 0) - (a.wh ?? 0) || a.order - b.order,
  low: (a, b) => (a.store ?? 0) - (b.store ?? 0) || (b.wh ?? 0) - (a.wh ?? 0),
  name: (a, b) => collator.compare(a.n, b.n) || collator.compare(a.a, b.a)
};
function filterCount(f = state.f) { return f.aud.length + f.kind.length + f.season.length + f.size.length + (f.absent ? 1 : 0) + (f.sort ? 1 : 0); }
function filtered(f) {
  const terms = normalize(f.q).split(/\s+/).filter(Boolean);
  const found = (state.base ?? []).filter(p => matches(p, f, terms));
  if (f.sort && sorters[f.sort]) found.sort(sorters[f.sort]);
  return found;
}
function renderActiveFilters() {
  const f = state.f;
  const pills = [
    ...f.aud.map(v => ['aud', v, v]), ...f.kind.map(v => ['kind', v, v]), ...f.season.map(v => ['season', v, v]),
    ...f.size.map(v => ['size', v, 'Размер ' + sizeName(v)]), ...(f.absent ? [['absent', '1', 'Нет у меня']] : []),
    ...(f.sort ? [['sort', f.sort, SORTS.find(s => s[0] === f.sort)?.[1]]] : [])
  ];
  $('active-filters').innerHTML = pills.map(([group, value, label]) =>
    `<button type="button" class="pill" data-remove-filter="${group}" data-value="${safe(value)}" aria-label="Убрать фильтр ${safe(label)}">${safe(label)}<span aria-hidden="true">×</span></button>`).join('')
    + (pills.length > 1 ? '<button type="button" class="pill-clear" data-clear-filters>Сбросить всё</button>' : '');
  $('active-filters').hidden = !pills.length;
  const n = filterCount();
  $('filter-count').textContent = n;
  $('filter-count').hidden = !n;
}
$('active-filters').addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-clear-filters')) return setFilter({ ...emptyFilters(), q: state.f.q });
  const group = b.dataset.removeFilter, value = b.dataset.value;
  if (group === 'absent') setFilter({ absent: false });
  else if (group === 'sort') setFilter({ sort: '' });
  else setFilter({ [group]: state.f[group].filter(v => v !== value) });
});

// Панель фильтров работает с черновиком: число моделей обновляется сразу, применяется кнопкой «Показать».
const filterDialog = $('filter-dialog');
let draftFilters = null;
function openFilters() {
  draftFilters = structuredClone(state.f);
  renderFilterSheet();
  filterDialog.showModal();
}
function renderFilterSheet() {
  const f = draftFilters;
  const group = (name, title, values, label = v => v, wide = false) => values.length ? `<section class="fs-group">
    <h3>${title}</h3><div class="opts ${wide ? 'opts-grid' : ''}">${values.map(v => `<button type="button" class="opt" data-group="${name}" data-value="${safe(v)}" aria-pressed="${f[name].includes(v)}">${safe(label(v))}</button>`).join('')}</div></section>` : '';
  const seasons = [...new Set(state.base.map(p => p.s).filter(Boolean))].sort((a, b) => seasonRank(b) - seasonRank(a));
  const sizes = [...new Set(state.base.flatMap(p => p.sizes.map(s => s.size)))].sort(sizeOrder);
  const count = filtered(f).length;
  $('filter-body').innerHTML = `
    <section class="fs-group"><h3>Сортировка</h3><div class="opts">${SORTS.map(([v, l]) => `<button type="button" class="opt" data-sort="${v}" aria-pressed="${f.sort === v}">${l}</button>`).join('')}</div></section>
    ${canOrder() ? `<section class="fs-group"><label class="switch"><span><b>Нет в моём магазине</b><small>Модели, которых у вас нет совсем, а на Лиственной есть</small></span><input type="checkbox" id="fs-absent" ${f.absent ? 'checked' : ''}><i aria-hidden="true"></i></label></section>` : ''}
    ${group('aud', 'Для кого', AUDIENCES)}
    ${group('kind', 'Тип товара', KINDS)}
    ${group('season', 'Сезон', seasons)}
    ${group('size', 'Размер', sizes, sizeName, true)}`;
  $('filter-apply').textContent = count ? `Показать ${fmt.format(count)} ${plural(count, 'модель', 'модели', 'моделей')}` : 'Ничего не найдено';
  $('filter-apply').disabled = !count;
  $('filter-reset').disabled = !filterCount(f);
}
filterDialog.addEventListener('click', event => {
  if (event.target === filterDialog) return filterDialog.close();
  const b = event.target.closest('button');
  if (!b) return;
  const scroll = $('filter-body').scrollTop;
  if (b.dataset.group) {
    const list = draftFilters[b.dataset.group];
    const i = list.indexOf(b.dataset.value);
    if (i >= 0) list.splice(i, 1); else list.push(b.dataset.value);
  } else if (b.dataset.sort != null) draftFilters.sort = b.dataset.sort;
  else if (b.id === 'filter-reset') draftFilters = { ...emptyFilters(), q: draftFilters.q };
  else if (b.id === 'filter-apply') { state.f = draftFilters; filterDialog.close(); renderCatalog(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  else if (b.id === 'filter-close') return filterDialog.close();
  else return;
  renderFilterSheet();
  $('filter-body').scrollTop = scroll;
});
filterDialog.addEventListener('change', event => {
  if (event.target.id === 'fs-absent') { draftFilters.absent = event.target.checked; renderFilterSheet(); }
});
$('filter-button').onclick = openFilters;

// ---------- Адрес страницы: фильтры и открытый товар можно отправить ссылкой ----------
function writeHash() {
  const p = new URLSearchParams();
  for (const [name, value] of Object.entries(state.f)) {
    if (Array.isArray(value) ? value.length : value) p.set(name, Array.isArray(value) ? value.join('~') : value === true ? '1' : value);
  }
  p.set('tab', state.active);
  if (state.active === 'catalog' && !isWarehouse()) p.delete('tab');
  if (state.current) p.set('p', state.current.article);
  const hash = p.toString();
  try { history.replaceState(history.state, '', hash ? '#' + hash : location.pathname + location.search); } catch { /* file:// в некоторых браузерах */ }
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = emptyFilters();
  f.q = p.get('q') ?? '';
  for (const name of ['aud', 'kind', 'season', 'size']) f[name] = p.get(name) ? p.get(name).split('~') : [];
  f.absent = p.get('absent') === '1';
  f.sort = SORTS.some(s => s[0] === p.get('sort')) ? p.get('sort') : '';
  state.f = f;
  return { tab: p.get('tab'), product: p.get('p') };
}

// ---------- Каталог ----------
function tile(p, index) {
  const storeView = canOrder();
  const sizes = p.sizes.length > 1 || p.sizes[0]?.size ? p.sizes : [];
  const chips = sizes.slice(0, 8).map(s => `<i class="sz ${s.need ? 'need' : ''}">${safe(sizeName(s.size))}</i>`).join('')
    + (sizes.length > 8 ? `<i class="sz more">+${sizes.length - 8}</i>` : '');
  const colorsNote = p.colors.length > 1 ? `${p.colors.length} ${plural(p.colors.length, 'цвет', 'цвета', 'цветов')}` : safe(p.colors[0]?.color || '');
  const stat = (label, value) => value == null ? '' : `<span><small>${label}</small><b class="${value > 0 ? '' : 'zero'}">${qty(value)}</b></span>`;
  return `<button class="tile" type="button" data-product="${safe(p.a)}" style="--i:${index % PAGE}">
    <span class="photo">${photoMarkup(p.photo, 'thumb', p.n, index < 4)}
      ${p.s ? `<span class="tag season">${safe(p.s)}</span>` : ''}
      ${storeView && p.absent ? '<span class="tag absent">Нет у вас</span>' : ''}</span>
    <span class="tile-body">
      <span class="name">${safe(p.n)}</span>
      <span class="meta"><span class="code">${safe(p.a)}</span><span class="dot">·</span><span>${colorsNote}</span></span>
      ${chips ? `<span class="sizes">${chips}</span>` : ''}
      <span class="stats">${storeView ? stat('У вас', p.store) : ''}${stat('Лиственная', p.wh)}${stat('Сеть', p.net)}</span>
    </span></button>`;
}
function renderCatalog() {
  const found = filtered(state.f);
  state.filtered = found;
  state.shown = 0;
  const grid = $('grid');
  grid.replaceChildren();
  grid.setAttribute('aria-busy', 'false');
  $('result-count').textContent = fmt.format(found.length) + ' ' + plural(found.length, 'модель', 'модели', 'моделей');
  if (!found.length) grid.innerHTML = `<div class="empty"><b>Ничего не найдено</b>Измените запрос или <button type="button" class="link" data-reset>сбросьте фильтры</button></div>`;
  appendCards();
  if (document.activeElement !== $('search') && $('search').value !== state.f.q) $('search').value = state.f.q;
  $('search-clear').hidden = !state.f.q;
  renderActiveFilters();
  renderBulk();
  writeHash();
}
function appendCards() {
  const batch = state.filtered.slice(state.shown, state.shown + PAGE);
  $('grid').insertAdjacentHTML('beforeend', batch.map((p, i) => tile(p, state.shown + i)).join(''));
  state.shown += batch.length;
}
new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && state.shown < state.filtered.length) appendCards();
}, { rootMargin: '1200px' }).observe($('pager'));

// Массовое пополнение (при фильтре «Нет в моём магазине»): все размеры текущей выборки по одной штуке.
function bulkLines() {
  const lines = [];
  for (const p of state.filtered) for (const c of p.colors) for (const l of c.lines) {
    if (l.store <= 0 && l.wh > 0 && (!state.f.size.length || state.f.size.includes(l.size)) && !inCart(l.sku)) lines.push({ a: p.a, color: c.color, size: l.size, qty: 1 });
  }
  return lines;
}
function bulkRoom() { return Math.max(0, MAX_LINES - state.cart.size); }
function renderBulk() {
  const button = $('bulk-add');
  const lines = canOrder() && stockFresh() && state.f.absent ? bulkLines() : [];
  const n = Math.min(lines.length, bulkRoom());
  button.hidden = !n;
  button.textContent = `Добавить всё · ${fmt.format(n)} ${plural(n, 'размер', 'размера', 'размеров')}`;
}
$('bulk-add').onclick = async () => {
  const all = bulkLines();
  const lines = all.slice(0, bulkRoom());
  if (!lines.length) return;
  const models = new Set(lines.map(l => l.a)).size;
  const capped = lines.length < all.length ? ` В одной заявке не больше ${MAX_LINES} позиций — остальное добавьте следующей заявкой.` : '';
  if (!await ask(`Добавить в корзину ${fmt.format(lines.length)} ${plural(lines.length, 'размер', 'размера', 'размеров')} по 1 шт. из ${fmt.format(models)} ${plural(models, 'модели', 'моделей', 'моделей')}?${capped} Количество можно поправить в корзине.`, 'Добавить')) return;
  addToCart(lines);
  notify(`В корзине +${fmt.format(lines.length)} шт.`);
  renderCatalog();
};

function setFilter(changes) {
  Object.assign(state.f, changes);
  renderCatalog();
}
function resetFilters() { setFilter(emptyFilters()); }
{
  let timer;
  $('search').addEventListener('input', () => {
    $('search-clear').hidden = !$('search').value;
    clearTimeout(timer); timer = setTimeout(() => setFilter({ q: $('search').value }), 120);
  });
  $('search-clear').onclick = () => { $('search').value = ''; setFilter({ q: '' }); $('search').focus(); };
}
$('grid').addEventListener('click', event => {
  if (event.target.closest('[data-reset]')) return resetFilters();
  const card = event.target.closest('[data-product]');
  if (card) openProduct(card.dataset.product);
});

// ---------- Карточка товара ----------
let closingFromHistory = false;
function openProduct(article, colorIndex = null, { enter = 0 } = {}) {
  const p = state.byArticle.get(article);
  if (!p) return;
  const same = state.current?.article === article;
  if (!same) state.draft = new Map();
  const preferred = () => {
    if (state.hit) { const i = p.colors.findIndex(c => c.lines.some(l => l.sku === state.hit)); if (i >= 0) return i; }
    const size = state.f.size;
    const i = p.colors.findIndex(c => c.wh > 0 && (!size.length || c.lines.some(l => size.includes(l.size) && l.wh > 0)));
    return Math.max(0, i);
  };
  const ci = colorIndex ?? (same ? state.current.color : preferred());
  state.current = { article, color: ci };
  const c = p.colors[ci];
  const photo = c?.photo ?? p.photo;
  const position = state.filtered.findIndex(x => x.a === p.a);
  const storeView = canOrder();
  const ordering = storeView && stockFresh();
  const showNet = Boolean(state.stocks.network);
  const lines = (c?.lines ?? []).filter(l => !hasStock() || l.wh > 0 || l.store > 0);
  const rows = lines.map(l => {
    const has = inCart(l.sku);
    const max = Math.max(0, (l.wh ?? 0) - has);
    const draft = Math.min(state.draft.get(l.sku) ?? 0, max);
    const need = storeView && l.store <= 0 && l.wh > 0;
    const row = c.lines.indexOf(l);
    const stat = (label, value) => value == null ? '' : `<span><small>${label}</small><b class="${value > 0 ? '' : 'zero'}">${qty(value)}</b></span>`;
    return `<li class="size-row ${need ? 'need' : ''} ${l.sku === state.hit ? 'hit' : ''} ${!(l.wh > 0) ? 'off' : ''}">
      <span class="size-name">${safe(sizeName(l.size))}${need ? '<i class="need-dot" title="Нет в вашем магазине"></i>' : ''}</span>
      <span class="size-stats">${storeView ? stat('У вас', l.store) : ''}${stat('Лиственная', l.wh)}${showNet ? `<span title="${safe(netTitle(l))}"><small>Сеть</small><b class="${l.netQty > 0 ? '' : 'zero'}">${qty(l.netQty)}</b></span>` : ''}</span>
      <span class="size-order">${has ? `<span class="incart">в корзине ${has}</span>` : ''}${ordering && max > 0
        ? `<span class="stepper ${draft ? 'on' : ''}"><button type="button" data-step="-1" data-row="${row}" aria-label="Меньше, размер ${safe(sizeName(l.size))}" ${draft ? '' : 'disabled'}>−</button><input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="${max}" value="${draft}" data-row="${row}" aria-label="Количество, размер ${safe(sizeName(l.size))}"><button type="button" data-step="1" data-row="${row}" aria-label="Больше, размер ${safe(sizeName(l.size))}" ${draft >= max ? 'disabled' : ''}>+</button></span>`
        : ordering ? '<span class="none">нет на складе</span>' : ''}</span>
    </li>`;
  }).join('');
  const needCount = storeView ? lines.filter(l => l.store <= 0 && l.wh > 0 && inCart(l.sku) < l.wh).length : 0;
  const swatches = p.colors.length > 1 ? p.colors.map((x, i) => {
    const src = photoSrc('thumb', x.photo);
    return `<button type="button" class="swatch ${x.wh > 0 ? '' : 'off'}" data-color="${i}" aria-pressed="${i === ci}" aria-label="${safe(x.color || 'Без цвета')}, на Лиственной ${x.wh} шт.">${src ? `<img src="${safe(src)}" alt="" loading="lazy">` : `<span class="dot">${safe((x.color || '?').slice(0, 2))}</span>`}</button>`;
  }).join('') : '';
  const nav = d => `<button type="button" class="pd-nav ${d < 0 ? 'prev' : 'next'}" data-nav="${d}" aria-label="${d < 0 ? 'Предыдущий' : 'Следующий'} товар" ${d < 0 ? (position <= 0 ? 'disabled' : '') : (position < 0 || position >= state.filtered.length - 1 ? 'disabled' : '')}>${d < 0 ? icons.prev : icons.next}</button>`;
  const scrollBefore = same && productDialog.open ? productDialog.querySelector('.pd-scroll')?.scrollTop ?? 0 : 0;
  productDialog.innerHTML = `
    <div class="pd-float">
      <button type="button" class="round" data-share aria-label="Скопировать ссылку на товар" title="Ссылка на товар">${icons.link}</button>
      <button type="button" class="round" data-close aria-label="Закрыть">${icons.close}</button>
    </div>
    <div class="pd-scroll">
      <div class="pd">
        <div class="pd-media">
          <div class="pd-photo">
            ${photoMarkup(photo, 'detail', p.n, true)}
            ${photoSrc('detail', photo) ? '<button type="button" class="pd-zoom" data-zoom aria-label="Открыть фото на весь экран"></button>' : ''}
            ${nav(-1)}${nav(1)}
            ${position >= 0 ? `<span class="pd-pos">${position + 1} / ${fmt.format(state.filtered.length)}</span>` : ''}
          </div>
          ${swatches ? `<div class="pd-colors" role="group" aria-label="Цвет">${swatches}</div>` : ''}
        </div>
        <div class="pd-info">
          <p class="pd-eyebrow">${[p.s, ...p.c.split(' · ')].filter(Boolean).map(safe).join(' · ')}</p>
          <h2 id="product-title" tabindex="-1">${safe(p.n)}</h2>
          <button type="button" class="pd-code" data-copy="${safe(p.a)}" aria-label="Скопировать артикул ${safe(p.a)}">${safe(p.a)}${icons.copy}<span class="copy-status" role="status"></span></button>
          <p class="pd-color">Цвет <b>${safe(c?.color || '—')}</b>${c?.photo == null && p.photo != null ? ' · фото модели' : ''}</p>
          ${rows ? `<div class="pd-sizes-head"><h3>Размеры</h3>${storeView ? '<span><i class="need-dot"></i>нет у вас</span>' : ''}</div><ul class="size-list">${rows}</ul>`
            : '<p class="detail-note">Этого цвета сейчас нет на Лиственной.</p>'}
          ${storeView && !stockFresh() ? '<p class="inline-msg bad">Остатки устарели — заказ откроется после следующей выгрузки из 1С.</p>' : ''}
          <p class="inline-msg" role="status"></p>
          ${networkBlock(c)}
        </div>
      </div>
    </div>
    ${ordering && rows ? `<div class="pd-bar">
      ${needCount ? `<button type="button" class="secondary" data-fill>Всё недостающее · ${needCount}</button>` : ''}
      <button type="button" class="primary" data-add disabled>Выберите количество</button>
    </div>` : ''}`;
  updateDraftButton();
  if (!productDialog.open) {
    state.pageScroll = window.scrollY;
    productDialog.showModal();
    try { history.pushState({ modal: 'product' }, ''); } catch { /* без истории */ }
  }
  const scroller = productDialog.querySelector('.pd-scroll');
  scroller.scrollTop = scrollBefore;
  if (enter) {
    scroller.style.transition = 'none';
    scroller.style.transform = `translateX(${enter * 28}%)`;
    scroller.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { scroller.style.transition = ''; scroller.style.transform = ''; scroller.style.opacity = ''; }));
  }
  writeHash();
  if (!same) $('product-title').focus({ preventScroll: true });
  productDialog.querySelector('.size-row.hit')?.scrollIntoView({ block: 'center' });
}
// ---------- Остатки других магазинов ----------
function netTitle(l) {
  const locs = state.stocks.network?.locations ?? [];
  return (l.net ?? []).map(([i, q]) => `${locs[i]?.name ?? '?'}: ${q}`).join(', ');
}
function networkBlock(c) {
  const locs = state.stocks.network?.locations;
  if (!locs?.length || !c) return '';
  const lines = c.lines.filter(l => l.netQty > 0);
  const rows = locs.map((loc, i) => ({ loc, i, counts: lines.map(l => (l.net ?? []).find(([j]) => j === i)?.[1] ?? 0) }))
    .filter(r => r.counts.some(Boolean))
    .sort((a, b) => b.counts.reduce((t, q) => t + q, 0) - a.counts.reduce((t, q) => t + q, 0));
  if (!rows.length) return '';
  const storeView = canOrder();
  return `<details class="pd-network"><summary><span>В магазинах сети</span><small>${rows.length} ${plural(rows.length, 'магазин', 'магазина', 'магазинов')}</small></summary>
    <div class="table-wrap"><table class="data net-table"><thead><tr><th>Магазин</th>${lines.map(l => `<th class="n">${safe(sizeName(l.size))}</th>`).join('')}${storeView ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${safe(r.loc.name)}</td>${r.counts.map((q, k) => `<td class="n ${!q ? 'zero' : storeView && lines[k].store <= 0 ? 'hot' : ''}">${q || '·'}</td>`).join('')}
      ${storeView ? `<td><button type="button" class="ghost small" data-ask="${r.i}">Попросить</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div></details>`;
}
function askText(p, c, i) {
  const loc = state.stocks.network.locations[i];
  const has = l => (l.net ?? []).some(([j, q]) => j === i && q > 0);
  let lines = c.lines.filter(l => has(l) && l.store <= 0);
  if (!lines.length) lines = c.lines.filter(has);
  return `${loc.name}, здравствуйте! Для магазина ${state.user.name} нужен товар ${p.n}, артикул ${p.a}, цвет ${c.color || '—'}: `
    + lines.map(l => `${sizeName(l.size)} — 1 шт.`).join(', ')
    + `. По остаткам на сайте у вас есть${state.updated ? ` (выгрузка ${clock.format(new Date(state.updated))})` : ''}. Сможете передать?`;
}
function draftTotal() { return [...state.draft.values()].reduce((t, n) => t + n, 0); }
function updateDraftButton() {
  const button = productDialog.querySelector('[data-add]');
  if (!button) return;
  const n = draftTotal();
  button.disabled = !n;
  button.textContent = n ? `В корзину · ${fmt.format(n)} шт.` : 'Выберите количество';
}
function currentLines() {
  const p = state.byArticle.get(state.current.article);
  return { p, c: p.colors[state.current.color] };
}
function setDraft(row, value) {
  const { c } = currentLines();
  const l = c.lines[row];
  const max = Math.max(0, l.wh - inCart(l.sku));
  const n = Math.max(0, Math.min(max, Number.isFinite(value) ? Math.trunc(value) : 0));
  if (n) state.draft.set(l.sku, n); else state.draft.delete(l.sku);
  const input = productDialog.querySelector(`input[data-row="${row}"]`);
  if (input) {
    input.value = n;
    const stepper = input.closest('.stepper');
    stepper.classList.toggle('on', n > 0);
    stepper.querySelector('[data-step="-1"]').disabled = !n;
    stepper.querySelector('[data-step="1"]').disabled = n >= max;
  }
  updateDraftButton();
}
// Переход к соседнему товару с анимацией (стрелки, клавиатура, свайп).
function goTo(direction) {
  const i = state.filtered.findIndex(x => x.a === state.current?.article) + direction;
  const next = state.filtered[i];
  if (!next) return false;
  const scroller = productDialog.querySelector('.pd-scroll');
  scroller.style.transform = `translateX(${-direction * 28}%)`;
  scroller.style.opacity = '0';
  setTimeout(() => openProduct(next.a, null, { enter: direction }), 140);
  return true;
}
function closeProduct() {
  if (!productDialog.open) return;
  productDialog.classList.add('closing');
  setTimeout(() => { productDialog.classList.remove('closing'); productDialog.style.transform = ''; productDialog.close(); }, 200);
}
productDialog.addEventListener('click', async event => {
  if (event.target === productDialog) {
    const r = productDialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeProduct();
    return;
  }
  const b = event.target.closest('button');
  if (!b) return;
  const message = productDialog.querySelector('.inline-msg[role=status]:not(.bad)');
  if (b.hasAttribute('data-close')) closeProduct();
  else if (b.dataset.nav) goTo(Number(b.dataset.nav));
  else if (b.dataset.color) openProduct(state.current.article, Number(b.dataset.color));
  else if (b.dataset.step) {
    const row = Number(b.dataset.row);
    const input = productDialog.querySelector(`input[data-row="${row}"]`);
    setDraft(row, (input.valueAsNumber || 0) + Number(b.dataset.step));
    navigator.vibrate?.(8);
  } else if (b.hasAttribute('data-fill')) {
    const { c } = currentLines();
    c.lines.forEach((l, i) => { if (l.store <= 0 && l.wh > 0 && inCart(l.sku) < l.wh && !state.draft.get(l.sku)) setDraft(i, 1); });
  } else if (b.hasAttribute('data-add')) {
    const { p } = currentLines();
    const lines = [];
    for (const color of p.colors) for (const l of color.lines) {
      const n = state.draft.get(l.sku);
      if (n) lines.push({ a: p.a, color: color.color, size: l.size, qty: Math.min(n, l.wh - inCart(l.sku)) });
    }
    const added = addToCart(lines);
    state.draft = new Map();
    openProduct(p.a);
    notify(`В корзине +${fmt.format(added)} шт.`);
    renderBulk();
  } else if (b.dataset.copy) {
    const ok = await copyText(b.dataset.copy);
    productDialog.querySelector('.copy-status').textContent = ok ? 'скопирован' : '';
  } else if (b.hasAttribute('data-share')) {
    const ok = await copyText(location.href);
    notify(ok ? 'Ссылка на товар скопирована' : 'Не удалось скопировать ссылку');
  } else if (b.hasAttribute('data-zoom')) {
    const img = productDialog.querySelector('.pd-photo img');
    showPhoto(img.currentSrc || img.src, state.byArticle.get(state.current.article).n);
  } else if (b.dataset.ask) {
    const { p, c } = currentLines();
    const text = askText(p, c, Number(b.dataset.ask));
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    const ok = await copyText(text);
    notify(ok ? 'Сообщение скопировано — вставьте его в чат магазина' : 'Не удалось скопировать');
  }
});
productDialog.addEventListener('change', event => {
  const input = event.target.closest('input[data-row]');
  if (input) setDraft(Number(input.dataset.row), input.valueAsNumber);
});
productDialog.addEventListener('input', event => {
  const input = event.target.closest('input[data-row]');
  if (input && Number.isFinite(input.valueAsNumber)) {
    const { c } = currentLines();
    const l = c.lines[Number(input.dataset.row)];
    const n = Math.max(0, Math.min(l.wh - inCart(l.sku), Math.trunc(input.valueAsNumber)));
    if (n) state.draft.set(l.sku, n); else state.draft.delete(l.sku);
    input.closest('.stepper').classList.toggle('on', n > 0);
    updateDraftButton();
  }
});
productDialog.addEventListener('focusin', event => { if (event.target.matches('input[data-row]')) event.target.select(); });
productDialog.addEventListener('keydown', event => {
  if (event.target.matches('input')) { if (event.key === 'Enter') event.target.blur(); return; }
  if (event.key === 'ArrowLeft') goTo(-1);
  if (event.key === 'ArrowRight') goTo(1);
});
productDialog.addEventListener('cancel', event => { event.preventDefault(); closeProduct(); });
productDialog.addEventListener('close', () => {
  state.current = null;
  state.hit = null;
  state.draft = new Map();
  writeHash();
  if (!closingFromHistory && history.state?.modal === 'product') { try { history.back(); } catch { /* ignore */ } }
  closingFromHistory = false;
  // Возвращаем страницу туда, где был товар (браузер при «назад» может прыгнуть наверх).
  const y = state.pageScroll ?? window.scrollY;
  requestAnimationFrame(() => window.scrollTo(0, y));
  setTimeout(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); }, 80);
  updateCartFab();
});
window.addEventListener('popstate', () => {
  if (productDialog.open) { closingFromHistory = true; productDialog.close(); }
});
// Свайпы на телефоне: влево/вправо — соседний товар (карточка едет за пальцем), вниз от верха — закрыть.
{
  let t = null;
  productDialog.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('input,.stepper,.pd-colors,.table-wrap')) { t = null; return; }
    const scroller = productDialog.querySelector('.pd-scroll');
    t = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, dx: 0, dy: 0, top: scroller.scrollTop <= 0, scroller };
  }, { passive: true });
  productDialog.addEventListener('touchmove', e => {
    if (!t) return;
    t.dx = e.touches[0].clientX - t.x; t.dy = e.touches[0].clientY - t.y;
    if (!t.axis && Math.hypot(t.dx, t.dy) > 10) t.axis = Math.abs(t.dx) > Math.abs(t.dy) * 1.2 ? 'x' : t.dy > 0 && t.top ? 'y' : 'scroll';
    if (t.axis === 'x') {
      e.preventDefault();
      t.scroller.style.transition = 'none';
      t.scroller.style.transform = `translateX(${t.dx}px)`;
      t.scroller.style.opacity = String(1 - Math.min(0.5, Math.abs(t.dx) / 700));
    } else if (t.axis === 'y' && matchMedia('(max-width: 760px)').matches) {
      e.preventDefault();
      productDialog.style.transition = 'none';
      productDialog.style.transform = `translateY(${Math.max(0, t.dy)}px)`;
    }
  }, { passive: false });
  productDialog.addEventListener('touchend', () => {
    if (!t) return;
    const { axis, dx, dy, scroller } = t;
    t = null;
    scroller.style.transition = '';
    productDialog.style.transition = '';
    if (axis === 'x') {
      if (Math.abs(dx) > 70 && goTo(dx < 0 ? 1 : -1)) return;
      scroller.style.transform = ''; scroller.style.opacity = '';
    } else if (axis === 'y') {
      if (dy > 110) closeProduct();
      else productDialog.style.transform = '';
    }
  });
}

// ---------- Просмотр фото: колесо, щипок, двойной тап, перетаскивание ----------
const viewer = { scale: 1, x: 0, y: 0, pointers: new Map(), last: null, tap: 0 };
const frame = photoDialog.querySelector('.viewer-frame');
const full = $('photo-full');
function paintViewer() {
  const limitX = frame.clientWidth * (viewer.scale - 1) / 2, limitY = frame.clientHeight * (viewer.scale - 1) / 2;
  viewer.x = Math.max(-limitX, Math.min(limitX, viewer.x));
  viewer.y = Math.max(-limitY, Math.min(limitY, viewer.y));
  full.style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.scale})`;
  frame.classList.toggle('magnified', viewer.scale > 1);
}
function zoomAt(scale, cx, cy) {
  const r = frame.getBoundingClientRect();
  const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
  const target = Math.max(1, Math.min(5, scale));
  viewer.x = px - (px - viewer.x) * target / viewer.scale;
  viewer.y = py - (py - viewer.y) * target / viewer.scale;
  viewer.scale = target;
  paintViewer();
}
function showPhoto(src, title) {
  $('photo-title').textContent = title;
  full.src = src;
  Object.assign(viewer, { scale: 1, x: 0, y: 0 });
  paintViewer();
  photoDialog.showModal();
}
frame.addEventListener('wheel', e => { e.preventDefault(); zoomAt(viewer.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
frame.addEventListener('dblclick', e => zoomAt(viewer.scale > 1 ? 1 : 2.5, e.clientX, e.clientY));
frame.addEventListener('pointerdown', e => {
  frame.setPointerCapture(e.pointerId);
  viewer.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerType === 'touch' && viewer.pointers.size === 1) {
    const now = performance.now();
    if (now - viewer.tap < 300) zoomAt(viewer.scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
    viewer.tap = now;
  }
});
frame.addEventListener('pointermove', e => {
  if (!viewer.pointers.has(e.pointerId)) return;
  const before = [...viewer.pointers.values()];
  viewer.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const after = [...viewer.pointers.values()];
  if (after.length === 2) {
    const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
    const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
    if (d0 > 0) zoomAt(viewer.scale * d1 / d0, (after[0].x + after[1].x) / 2, (after[0].y + after[1].y) / 2);
  } else if (after.length === 1 && viewer.scale > 1) {
    viewer.x += after[0].x - before[0].x; viewer.y += after[0].y - before[0].y; paintViewer();
  }
});
for (const type of ['pointerup', 'pointercancel']) frame.addEventListener(type, e => viewer.pointers.delete(e.pointerId));
$('photo-close').onclick = () => photoDialog.close();

// ---------- Корзина ----------
function available(line) {
  const p = state.byArticle.get(line.a);
  const sku = key(line.a, line.color, line.size);
  for (const c of p?.colors ?? []) for (const l of c.lines) if (l.sku === sku) return Math.max(0, l.wh ?? 0);
  return 0;
}
function openCart() { renderCart(); cartDialog.showModal(); }
function renderCart() {
  const lines = [...state.cart.values()];
  const groups = new Map();
  for (const line of lines) {
    const id = line.a + '\u0000' + line.color.trim().toLowerCase();
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(line);
  }
  const total = cartTotal();
  const body = lines.length ? [...groups.values()].map(group => {
    const first = group[0];
    const p = state.byArticle.get(first.a);
    const color = p?.colors.find(c => c.color.trim().toLowerCase() === first.color.trim().toLowerCase());
    const src = photoSrc('thumb', color?.photo ?? p?.photo);
    group.sort((x, y) => sizeOrder(x.size, y.size));
    return `<div class="cart-group">
      ${src ? `<img class="thumb" src="${safe(src)}" alt="" loading="lazy">` : '<span class="thumb empty-thumb">нет фото</span>'}
      <div><h3>${safe(p?.n || first.a)}</h3><div class="meta"><span class="code">${safe(first.a)}</span>${seasonOf(first) ? `<span>· сезон ${safe(seasonOf(first))}</span>` : ''}<span>· ${safe(first.color || 'без цвета')}</span></div>
      <div class="cart-lines">${group.map(line => {
        const sku = key(line.a, line.color, line.size);
        const max = available(line);
        return `<div class="cart-line ${line.qty > max ? 'over' : ''}" data-sku="${safe(sku)}">
          <span class="what">Размер <b>${safe(sizeName(line.size))}</b><br><small>${line.qty > max ? `На Лиственной только ${max} шт.` : `На Лиственной ${max} шт.`}</small></span>
          <span class="stepper"><button type="button" data-cstep="-1" aria-label="Меньше">−</button><input type="number" inputmode="numeric" min="1" max="${Math.max(1, max)}" value="${line.qty}" aria-label="Количество, ${safe(line.a)}, размер ${safe(sizeName(line.size))}"><button type="button" data-cstep="1" aria-label="Больше">+</button></span>
          <button type="button" class="remove" data-remove aria-label="Убрать размер ${safe(sizeName(line.size))}">${icons.trash}</button>
        </div>`;
      }).join('')}</div></div></div>`;
  }).join('') + `<label class="cart-comment">Комментарий для склада<textarea id="cart-note" maxlength="500" placeholder="Например: срочно к выходным, витрина">${safe(state.comment)}</textarea></label>`
    : '<div class="empty"><b>Корзина пуста</b>Откройте товар и выберите размеры, или включите «Нет в магазине» в сводке.</div>';
  cartDialog.innerHTML = `
    <div class="modal-head"><div><div class="meta">Лиственная → ${safe(state.user.name)}</div><h2 id="cart-title">Заявка на пополнение</h2></div>
      <button class="close" type="button" data-close aria-label="Закрыть">×</button></div>
    <div class="cart-body">${body}<p id="cart-error" class="inline-msg bad" role="status">${lines.length > MAX_LINES ? `В одной заявке можно отправить не больше ${MAX_LINES} позиций, сейчас ${lines.length}. Уберите лишнее или отправьте частями.` : ''}</p></div>
    ${lines.length ? `<div class="cart-foot">
      <span class="total">${fmt.format(total)} шт.<small>${lines.length} ${plural(lines.length, 'позиция', 'позиции', 'позиций')} · ${new Set(lines.map(l => l.a)).size} ${plural(new Set(lines.map(l => l.a)).size, 'модель', 'модели', 'моделей')}</small></span>
      <button type="button" class="ghost small" data-clear>Очистить</button>
      <button type="button" class="secondary small" data-export>Скачать для Excel</button>
      <button type="button" class="primary" id="submit-order" ${lines.length > MAX_LINES ? 'disabled' : ''}>${state.demo ? 'Отправить тестовую заявку' : 'Отправить заявку'}</button>
    </div>` : ''}`;
}
function cartLineFrom(el) { return state.cart.get(el.closest('[data-sku]').dataset.sku); }
function setCartQty(line, value) {
  const max = available(line);
  const n = Math.max(1, Math.trunc(value) || 1);
  line.qty = Math.min(n, Math.max(1, max));
  state.orderId = null;
  saveCart(); updateCartCount(); renderCart();
  if (n > max) $('cart-error').textContent = `На Лиственной доступно ${max} шт. (${line.a}, ${sizeName(line.size)})`;
}
cartDialog.addEventListener('click', async event => {
  if (event.target === cartDialog) {
    const r = cartDialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) cartDialog.close();
    return;
  }
  const b = event.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-close')) cartDialog.close();
  else if (b.dataset.cstep) { const line = cartLineFrom(b); setCartQty(line, line.qty + Number(b.dataset.cstep)); }
  else if (b.hasAttribute('data-remove')) {
    state.cart.delete(b.closest('[data-sku]').dataset.sku);
    state.orderId = null; saveCart(); updateCartCount(); renderCart();
  } else if (b.hasAttribute('data-clear')) {
    if (!await ask('Очистить корзину полностью?', 'Очистить')) return;
    state.cart.clear(); state.orderId = null; state.comment = ''; saveCart(); updateCartCount(); renderCart();
  } else if (b.hasAttribute('data-export')) {
    const lines = [...state.cart.values()].sort((x, y) => collator.compare(x.a, y.a) || collator.compare(x.color, y.color) || sizeOrder(x.size, y.size));
    download(`PEAK-корзина-${state.user.store}-${fileStamp()}.csv`, csv([['Артикул', 'Сезон', 'Наименование', 'Цвет', 'Размер', 'Количество', 'На Лиственной'],
      ...lines.map(l => [l.a, seasonOf(l), state.byArticle.get(l.a)?.n ?? '', l.color, sizeName(l.size), l.qty, available(l)])]));
  } else if (b.id === 'submit-order') submitCart(b);
});
cartDialog.addEventListener('change', event => {
  if (event.target.id === 'cart-note') { state.comment = event.target.value.slice(0, 500); saveCart(); return; }
  const input = event.target.closest('[data-sku] input');
  if (input) setCartQty(cartLineFrom(input), input.valueAsNumber);
});
cartDialog.addEventListener('input', event => {
  if (event.target.id === 'cart-note') { state.comment = event.target.value.slice(0, 500); saveCart(); }
});
const demoOrdersKey = 'peak-demo-orders-v1';
async function submitCart(button) {
  const lines = [...state.cart.values()];
  const short = lines.find(line => line.qty > available(line));
  if (short || !stockFresh()) {
    $('cart-error').textContent = short ? `Остаток изменился: ${short.a}, размер ${sizeName(short.size)} — доступно ${available(short)} шт.` : 'Остатки устарели. Дождитесь следующей выгрузки из 1С.';
    return;
  }
  const controls = [...cartDialog.querySelectorAll('button,input,textarea')];
  controls.forEach(c => { c.disabled = true; });
  button.textContent = 'Отправляю…';
  state.orderId ||= crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));
  saveCart();
  const comment = state.comment.trim();
  try {
    if (state.demo) {
      const orders = storageRead(demoOrdersKey, []);
      const order = { id: state.orderId, store: state.user.store, name: state.user.name, items: lines.map(line => ({ ...line, s: seasonOf(line) })), comment, created: new Date().toISOString(), status: 'new' };
      if (!orders.some(x => x.id === order.id) && !storageWrite(demoOrdersKey, [order, ...orders].slice(0, 200))) throw new Error('Браузер не смог сохранить тестовую заявку.');
    } else await api('/api/orders', { id: state.orderId, items: lines.map(({ a, color, size, qty: n }) => ({ a, color, size, qty: n, s: seasonOf({ a }) })), ...(comment ? { comment } : {}) });
    state.cart.clear(); state.orderId = null; state.comment = '';
    saveCart(); updateCartCount();
    cartDialog.close();
    state.of.status = 'new';
    showSection('orders');
    renderCatalog();
    notify(state.demo ? 'Тестовая заявка создана' : 'Заявка отправлена на Лиственную');
  } catch (err) {
    $('cart-error').textContent = err.message;
    controls.forEach(c => { c.disabled = false; });
    button.textContent = state.demo ? 'Отправить тестовую заявку' : 'Отправить заявку';
  }
}

// ---------- Заявки ----------
function orderQty(order) { return order.items.reduce((n, i) => n + i.qty, 0); }
function whNow(line) { return hasStock() ? available(line) : null; }
// Сезон берётся из самой заявки; у старых заявок — из каталога.
function seasonOf(line) { return line.s || state.byArticle.get(line.a)?.s || ''; }
function orderSeasons(order) { return [...new Set(order.items.map(seasonOf).filter(Boolean))].sort((a, b) => seasonRank(b) - seasonRank(a)); }
function sortedItems(order) {
  return [...order.items].sort((x, y) => collator.compare(x.a, y.a) || collator.compare(x.color, y.color) || sizeOrder(x.size, y.size));
}
function renderOrders() {
  const all = state.orders;
  const counts = { new: 0, done: 0, rejected: 0 };
  for (const o of all) counts[o.status] = (counts[o.status] ?? 0) + 1;
  $('order-status').innerHTML = [['new', 'Новые'], ['done', 'Оформлены'], ['rejected', 'Отклонены'], ['all', 'Все']]
    .map(([id, label]) => `<button type="button" data-ostatus="${id}" aria-pressed="${state.of.status === id}">${label}<b>${fmt.format(id === 'all' ? all.length : counts[id])}</b></button>`).join('');
  const stores = [...new Map(all.map(o => [o.store, o.name])).entries()].sort((a, b) => collator.compare(a[1], b[1]));
  $('order-store-pick').hidden = !isWarehouse() || stores.length < 2;
  const select = $('order-store');
  select.replaceChildren(new Option('Все магазины', ''), ...stores.map(([id, name]) => new Option(name, id)));
  select.value = state.of.store;
  const q = normalize(state.of.q);
  const shown = all.filter(o => (state.of.status === 'all' || o.status === state.of.status) && (!state.of.store || o.store === state.of.store) &&
    (!q || normalize([o.document, o.note, o.comment, o.name, ...o.items.map(i => i.a)].join(' ')).includes(q)));
  const warehouseView = isWarehouse();
  $('order-list').innerHTML = shown.map(order => {
    const items = sortedItems(order);
    return `<details class="order" data-order="${safe(order.id)}" ${shown.length === 1 ? 'open' : ''}>
      <summary><div><b>${safe(order.name)}</b><small>${clock.format(new Date(order.created))} МСК · ${order.items.length} поз. · ${fmt.format(orderQty(order))} шт.${orderSeasons(order).length ? ' · ' + orderSeasons(order).map(safe).join(', ') : ''}${order.document ? ' · ' + safe(order.document) : ''}</small></div>
      <span class="status ${safe(order.status)}">${safe(statusLabels[order.status] ?? order.status)}</span></summary>
      <div class="order-body">
        <div class="order-meta">
          ${order.comment ? `<p class="quote">${safe(order.comment)}</p>` : ''}
          ${order.document ? `<p>Документ 1С: <b>${safe(order.document)}</b>${order.processed ? ' · ' + clock.format(new Date(order.processed)) + ' МСК' : ''}</p>` : ''}
          ${order.note ? `<p>Причина отказа: ${safe(order.note)}</p>` : ''}
        </div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Артикул</th><th>Сезон</th><th>Наименование</th><th>Цвет</th><th>Размер</th><th class="n">Шт.</th>${warehouseView && order.status === 'new' && hasStock() ? '<th class="n">На Лиственной</th>' : ''}</tr></thead><tbody>
        ${items.map(line => {
          const now = warehouseView && order.status === 'new' ? whNow(line) : null;
          return `<tr><td class="code">${safe(line.a)}</td><td>${safe(seasonOf(line) || '—')}</td><td class="nm">${safe(state.byArticle.get(line.a)?.n ?? '')}</td><td>${safe(line.color || '—')}</td><td>${safe(sizeName(line.size))}</td><td class="n">${line.qty}</td>${now != null ? `<td class="n ${now < line.qty ? 'short' : ''}">${now}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>
        <div class="order-tools">
          <button type="button" class="secondary small" data-print>Печать сборочного листа</button>
          <button type="button" class="secondary small" data-ocsv>Скачать для Excel</button>
          <button type="button" class="secondary small" data-ocopy>Скопировать списком</button>
          ${canOrder() ? '<button type="button" class="secondary small" data-repeat>Повторить заявку</button>' : ''}
        </div>
        ${warehouseView && order.status === 'new' ? `<div class="order-action">
          <input type="text" maxlength="100" placeholder="Номер перемещения в 1С или причина отказа" aria-label="Номер перемещения или причина отказа">
          <button class="primary small" data-status="done" type="button">Перемещение оформлено</button>
          <button class="secondary small" data-status="rejected" type="button">Отклонить</button>
          <p class="inline-msg bad" role="status"></p></div>` : ''}
      </div></details>`;
  }).join('') || `<div class="empty"><b>${all.length ? 'Нет заявок с такими условиями' : 'Заявок пока нет'}</b>${canOrder() && !all.length ? 'Соберите корзину в каталоге и отправьте заявку на Лиственную.' : ''}</div>`;
  updateOrdersBadge();
}
function updateOrdersBadge() {
  const count = isWarehouse() ? state.orders.filter(o => o.status === 'new').length : 0;
  $('orders-badge').hidden = !count;
  $('orders-badge').textContent = count;
  document.title = (count ? `(${count}) ` : '') + 'PEAK — каталог и пополнение';
}
async function loadOrders({ quiet = false } = {}) {
  const version = ++orderRead;
  if (!quiet) $('refresh-orders').disabled = true;
  try {
    const orders = state.demo
      ? storageRead(demoOrdersKey, []).filter(o => !canOrder() || o.store === state.user.store)
      : (await api('/api/orders')).orders;
    if (version !== orderRead) return;
    state.orders = orders;
    state.ordersLoaded = true;
    const typing = $('order-list').contains(document.activeElement) && document.activeElement.matches('input');
    if (!quiet || (state.active !== 'orders') || !typing) renderOrders(); else updateOrdersBadge();
  } catch (err) {
    if (version === orderRead && !quiet) $('order-list').innerHTML = `<div class="empty">${safe(err.message)}</div>`;
  } finally {
    if (version === orderRead) $('refresh-orders').disabled = false;
  }
}
function printOrder(order) {
  const items = sortedItems(order);
  $('print-area').innerHTML = `<h1>Сборочный лист: Лиственная → ${safe(order.name)}</h1>
    <p>Заявка от ${clock.format(new Date(order.created))} МСК · ${items.length} поз. · ${fmt.format(orderQty(order))} шт. · № ${safe(order.id.slice(0, 8))}${order.document ? ' · Документ 1С: ' + safe(order.document) : ''}</p>
    ${order.comment ? `<p>Комментарий: ${safe(order.comment)}</p>` : ''}
    <table><thead><tr><th>№</th><th>Артикул</th><th>Сезон</th><th>Наименование</th><th>Цвет</th><th>Размер</th><th class="n">Шт.</th><th>Собрано</th></tr></thead>
    <tbody>${items.map((l, i) => `<tr><td>${i + 1}</td><td>${safe(l.a)}</td><td>${safe(seasonOf(l) || '—')}</td><td>${safe(state.byArticle.get(l.a)?.n ?? '')}</td><td>${safe(l.color)}</td><td>${safe(sizeName(l.size))}</td><td class="n">${l.qty}</td><td class="box"></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="6">Итого</td><td class="n">${fmt.format(orderQty(order))}</td><td></td></tr></tfoot></table>
    <div class="sign"><span>Собрал: ____________________</span><span>Проверил: ____________________</span></div>`;
  window.print();
}
$('order-list').addEventListener('click', async event => {
  const b = event.target.closest('button');
  if (!b) return;
  const box = b.closest('[data-order]');
  const order = state.orders.find(o => o.id === box.dataset.order);
  if (!order) return;
  if (b.hasAttribute('data-print')) return printOrder(order);
  if (b.hasAttribute('data-ocsv')) {
    return download(`PEAK-заявка-${order.store}-${order.created.slice(0, 10)}.csv`, csv([['Артикул', 'Сезон', 'Наименование', 'Цвет', 'Размер', 'Количество'],
      ...sortedItems(order).map(l => [l.a, seasonOf(l), state.byArticle.get(l.a)?.n ?? '', l.color, sizeName(l.size), l.qty])]));
  }
  if (b.hasAttribute('data-ocopy')) {
    const text = `Заявка ${order.name}, ${clock.format(new Date(order.created))}\n` + sortedItems(order).map(l => `${l.a}${seasonOf(l) ? ' (' + seasonOf(l) + ')' : ''} ${l.color} ${sizeName(l.size)} — ${l.qty} шт.`).join('\n') + `\nИтого: ${orderQty(order)} шт.`;
    return notify(await copyText(text) ? 'Список скопирован' : 'Не удалось скопировать');
  }
  if (b.hasAttribute('data-repeat')) {
    if (!stockFresh()) return notify('Остатки устарели — дождитесь выгрузки из 1С');
    let skipped = 0;
    const lines = [];
    for (const item of order.items) {
      const room = available(item) - inCart(key(item.a, item.color, item.size));
      const n = Math.min(item.qty, room);
      if (n > 0) lines.push({ ...item, qty: n });
      if (n < item.qty) skipped += item.qty - Math.max(0, n);
    }
    const added = addToCart(lines);
    notify(added ? `В корзину добавлено ${added} шт.${skipped ? `, ${skipped} шт. нет на Лиственной` : ''}` : 'Этих товаров сейчас нет на Лиственной');
    if (added) openCart();
    return;
  }
  const status = b.dataset.status;
  if (!status) return;
  const form = b.closest('.order-action');
  const text = form.querySelector('input').value.trim();
  const message = form.querySelector('[role=status]');
  if (!text) { message.textContent = status === 'done' ? 'Укажите номер перемещения в 1С.' : 'Укажите причину отказа.'; form.querySelector('input').focus(); return; }
  const actions = [...form.querySelectorAll('button,input')];
  actions.forEach(x => { x.disabled = true; });
  const body = { status, document: status === 'done' ? text : '', note: status === 'rejected' ? text : '' };
  try {
    if (state.demo) {
      const orders = storageRead(demoOrdersKey, []);
      if (!storageWrite(demoOrdersKey, orders.map(o => o.id === order.id ? { ...o, ...body, processed: new Date().toISOString() } : o))) throw new Error('Браузер не смог сохранить изменения.');
    } else await api('/api/orders/' + order.id, body, 'PATCH');
    notify(status === 'done' ? 'Заявка закрыта: перемещение оформлено' : 'Заявка отклонена');
    void loadOrders();
  } catch (err) { message.textContent = err.message; actions.forEach(x => { x.disabled = false; }); }
});
$('order-status').addEventListener('click', event => {
  const b = event.target.closest('[data-ostatus]');
  if (b) { state.of.status = b.dataset.ostatus; renderOrders(); }
});
$('order-store').addEventListener('change', event => { state.of.store = event.target.value; renderOrders(); });
{
  let timer;
  $('order-search').addEventListener('input', event => { clearTimeout(timer); timer = setTimeout(() => { state.of.q = event.target.value; renderOrders(); }, 150); });
}

// ---------- Разделы, роли, свежесть ----------
function showSection(section) {
  if (section === 'catalog' && isWarehouse() && state.stockDenied) section = 'orders';
  state.active = section;
  for (const name of ['catalog', 'orders']) {
    $(name).hidden = name !== section;
    if (name === section) $(name + '-tab').setAttribute('aria-current', 'page');
    else $(name + '-tab').removeAttribute('aria-current');
  }
  if (section === 'orders' && state.user) void loadOrders();
  updateCartFab();
  writeHash();
  window.scrollTo({ top: 0 });
}
function updateAccount() {
  $('demo-role').hidden = !state.demo;
  $('account-name').textContent = !state.demo && state.user ? state.user.name : '';
  $('cart-button').hidden = !canOrder();
  $('catalog-tab').hidden = isWarehouse() && state.stockDenied;
  $('orders-title').textContent = canOrder() ? 'Заявки моего магазина' : 'Заявки магазинов на Лиственную';
  if (!canOrder()) state.f.absent = false;
  updateCartFab();
}
function renderSync() {
  const pill = $('sync');
  const text = pill.querySelector('span');
  pill.hidden = !state.user;
  pill.className = 'sync';
  if (state.demo) { pill.classList.add('demo'); text.textContent = 'Демо-данные'; pill.title = 'Остатки из примера «САЙТ.xlsx». Заявки сохраняются только в этом браузере.'; return; }
  if (!state.updated) { pill.classList.add('bad'); text.textContent = 'Нет выгрузки'; pill.title = 'Остатки из 1С ещё не загружены'; return; }
  const minutes = Math.round((Date.now() - Date.parse(state.updated)) / 60_000);
  pill.classList.add(minutes > STALE_MINUTES ? 'bad' : minutes > 35 ? 'warn' : 'ok');
  text.textContent = (minutes > STALE_MINUTES ? 'Устарели · ' : 'Остатки на ') + timeOnly.format(new Date(state.updated));
  pill.title = `Выгрузка из 1С: ${clock.format(new Date(state.updated))} МСК (${minutes} мин назад)`;
  banner(minutes > STALE_MINUTES ? `Остатки устарели: последняя выгрузка из 1С была ${clock.format(new Date(state.updated))} МСК. Заявки временно не принимаются.` : '', true);
}
function demoNetwork(own) {
  const others = state.demoLocations.filter(loc => loc.id !== WAREHOUSE && loc.id !== own);
  if (!others.length) return null;
  const rows = new Map();
  others.forEach((loc, i) => {
    for (const [a, c, z, q] of loc.rows) {
      if (!(q > 0)) continue;
      const k = key(a, c, z);
      if (!rows.has(k)) rows.set(k, [a, c, z, []]);
      rows.get(k)[3].push([i, q]);
    }
  });
  return { locations: others.map(loc => ({ id: loc.id, name: loc.name.replace(/^Магазин\s+/i, '') })), rows: [...rows.values()] };
}
function selectDemoLocation(id) {
  const warehouse = state.demoLocations.find(loc => loc.id === WAREHOUSE);
  const location = state.demoLocations.find(loc => loc.id === id) ?? state.demoLocations.find(loc => loc.id !== WAREHOUSE);
  if (!location || !warehouse) throw new Error('В примере отсутствует нужный склад.');
  const role = location.id === WAREHOUSE ? 'warehouse' : 'store';
  state.user = { role, store: location.id, name: location.name.replace(/^Магазин\s+/i, '') };
  state.stocks = { warehouse: warehouse.rows, store: role === 'store' ? location.rows : [], network: demoNetwork(location.id) };
  storageWrite('peak-demo-location', location.id);
  if (canOrder()) restoreCart(); else { state.cart = new Map(); updateCartCount(); }
  updateAccount();
  buildIndex();
  $('demo-role').value = location.id;
  renderSync();
  state.ordersLoaded = false;
  void loadOrders({ quiet: true });
  renderCatalog();
  if (role === 'warehouse') showSection('orders');
  else if (state.active === 'orders') void loadOrders();
}
async function refreshStock() {
  if (state.loadingStock || state.demo || !state.user) return;
  state.loadingStock = true;
  try {
    const stock = await api('/api/stock' + (state.updated ? '?since=' + encodeURIComponent(state.updated) : ''));
    state.stockDenied = false;
    if (!stock.unchanged && stock.updatedAt !== state.updated) {
      state.updated = stock.updatedAt;
      state.stocks = { warehouse: stock.warehouse ?? [], store: stock.store ?? [], network: stock.network ?? null };
      buildIndex();
      renderCatalog();
      if (state.current && productDialog.open) openProduct(state.current.article);
    }
    renderSync();
  } catch (err) {
    if (err.status === 403 && isWarehouse()) { state.stockDenied = true; updateAccount(); showSection('orders'); }
    else banner(err.message, true);
  } finally { state.loadingStock = false; }
}

// ---------- Штрихкоды ----------
// База штрихкодов приходит из 1С отдельно (/api/sync/barcodes) и загружается при первом поиске по штрихкоду.
const barcodes = { map: null, updatedAt: null, loadedAt: 0, loading: null };
function loadBarcodes() {
  if (barcodes.loading) return barcodes.loading;
  if (barcodes.map && (state.demo || Date.now() - barcodes.loadedAt < 30 * 60_000)) return Promise.resolve(barcodes.map);
  barcodes.loading = (async () => {
    try {
      const data = state.demo ? { rows: window.PEAK_DEMO_DATA?.barcodes ?? [] }
        : await api('/api/barcodes' + (barcodes.updatedAt ? '?since=' + encodeURIComponent(barcodes.updatedAt) : ''));
      if (!data.unchanged) {
        barcodes.map = new Map(data.rows.map(([code, a, color, size]) => [String(code), { a, color, size }]));
        barcodes.updatedAt = data.updatedAt ?? null;
      }
      barcodes.loadedAt = Date.now();
    } catch { barcodes.map ??= new Map(); }
    finally { barcodes.loading = null; }
    return barcodes.map;
  })();
  return barcodes.loading;
}
function findArticle(text) {
  const upper = text.trim().toUpperCase();
  let best = null;
  for (const p of state.products) {
    const a = p.a.toUpperCase();
    if (a === upper) return p;
    if (a.length >= 5 && upper.includes(a) && (!best || a.length > best.a.length)) best = p;
  }
  return best;
}
function openFound(p, color, size) {
  const ci = color == null ? null : Math.max(0, p.colors.findIndex(c => c.color.trim().toLowerCase() === String(color).trim().toLowerCase()));
  if (state.active !== 'catalog') showSection('catalog');
  state.hit = size == null ? null : key(p.a, color, size);
  if (productDialog.open && state.current?.article !== p.a) state.draft = new Map();
  openProduct(p.a, ci);
  return true;
}
// Ищет товар по штрихкоду (EAN/UPC) или по артикулу внутри кода (Code 128 и QR на бирках).
async function lookupCode(raw, { quiet = false } = {}) {
  const code = String(raw).trim();
  if (!code) return false;
  const map = await loadBarcodes();
  const tries = [code];
  if (/^\d{12}$/.test(code)) tries.push('0' + code);
  if (/^0\d{12}$/.test(code)) tries.push(code.slice(1));
  for (const value of tries) {
    const hit = map.get(value);
    if (!hit) continue;
    const p = state.byArticle.get(hit.a) ?? findArticle(hit.a);
    if (p) return openFound(p, hit.color, hit.size);
    if (!quiet) notify(`Штрихкод ${code}: артикула ${hit.a} нет в каталоге`);
    return false;
  }
  const p = /^\d+$/.test(code) ? null : findArticle(code);
  if (p) return openFound(p, null, null);
  if (!quiet) notify(map.size ? `Штрихкод ${code} не найден в базе` : 'База штрихкодов ещё не выгружена из 1С — ищите по артикулу');
  return false;
}
$('search').addEventListener('keydown', async event => {
  if (event.key !== 'Enter') return;
  const value = $('search').value.trim();
  if (/^\d{8,14}$/.test(value)) {
    event.preventDefault();
    if (await lookupCode(value)) { $('search').value = ''; setFilter({ q: '' }); }
  } else if (state.filtered.length === 1) openProduct(state.filtered[0].a);
});

// Свой декодер EAN-13 / EAN-8 / UPC-A для браузеров без BarcodeDetector (iPhone, компьютеры).
// Читает горизонтальные линии кадра и меряет расстояния между одноимёнными краями штрихов — так утолщение печати не мешает.
const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(p => [...p].map(Number));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const eanTable = (patterns, barsFirst) => patterns.map(p => ({ e1: p[0] + p[1], e2: p[1] + p[2], bars: barsFirst ? p[0] + p[2] : p[1] + p[3] }));
const EAN_SETS = { L: eanTable(EAN_L, false), G: eanTable(EAN_L.map(p => [...p].reverse()), false), R: eanTable(EAN_L, true) };
function eanDigit(w, at, set, barsFirst) {
  const a = w[at], b = w[at + 1], c = w[at + 2], d = w[at + 3];
  const k = 7 / (a + b + c + d);
  const e1 = Math.round((a + b) * k), e2 = Math.round((b + c) * k);
  const bars = (barsFirst ? a + c : b + d) * k;
  let best = -1, diff = 9;
  EAN_SETS[set].forEach((p, digit) => {
    if (p.e1 === e1 && p.e2 === e2 && Math.abs(p.bars - bars) < diff) { diff = Math.abs(p.bars - bars); best = digit; }
  });
  return best;
}
const guardOk = (w, at, count, m) => { for (let i = 0; i < count; i++) if (w[at + i] < 0.35 * m || w[at + i] > 2.3 * m) return false; return true; };
function eanCheck(digits) {
  const body = digits.slice(0, -1);
  const sum = body.reverse().reduce((t, d, i) => t + d * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === digits.at(-1);
}
function decodeRuns(w, firstDark) {
  for (let i = 1; i < w.length - 42; i++) {
    if (((i % 2 === 0) === firstDark) === false) continue; // нужен тёмный штрих
    for (const [runs, modules, half] of [[59, 95, 6], [43, 67, 4]]) {
      if (i + runs > w.length) continue;
      let total = 0;
      for (let k = 0; k < runs; k++) total += w[i + k];
      const m = total / modules;
      if (w[i - 1] < 2.5 * m || (i + runs < w.length && w[i + runs] < 2.5 * m)) continue;
      const mid = i + 3 + half * 4;
      if (!guardOk(w, i, 3, m) || !guardOk(w, mid, 5, m) || !guardOk(w, i + runs - 3, 3, m)) continue;
      const digits = [];
      let parity = '';
      for (let d = 0; d < half; d++) {
        const at = i + 3 + d * 4;
        let digit = eanDigit(w, at, 'L', false);
        let set = 'L';
        if (digit < 0 && half === 6) { digit = eanDigit(w, at, 'G', false); set = 'G'; }
        if (digit < 0) break;
        digits.push(digit); parity += set;
      }
      if (digits.length !== half) continue;
      for (let d = 0; d < half; d++) {
        const digit = eanDigit(w, mid + 5 + d * 4, 'R', true);
        if (digit < 0) break;
        digits.push(digit);
      }
      if (digits.length !== half * 2) continue;
      if (half === 6) {
        const first = EAN_PARITY.indexOf(parity);
        if (first < 0) continue;
        digits.unshift(first);
      }
      if (eanCheck(digits)) return digits.join('');
    }
  }
  return null;
}
function decodeLine(gray) {
  const n = gray.length;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (gray[Math.max(0, i - 1)] + 2 * gray[i] + gray[Math.min(n - 1, i + 1)]) / 4;
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) { if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i]; }
  if (hi - lo < 30) return null;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + s[i];
  const local = half => i => { const a = Math.max(0, i - half), b = Math.min(n, i + half); return (prefix[b] - prefix[a]) / (b - a); };
  const thresholds = [() => (lo + hi) / 2, local(Math.max(10, n >> 5)), local(Math.max(16, n >> 3)), () => lo + (hi - lo) * 0.4, () => lo + (hi - lo) * 0.6];
  for (const threshold of thresholds) {
    // Ширины штрихов с долями пикселя: край — точка, где яркость пересекает порог.
    const widths = [];
    let dark = s[0] < threshold(0), last = 0;
    const firstDark = dark;
    for (let i = 1; i < n; i++) {
      const t = threshold(i);
      const d = s[i] < t;
      if (d === dark) continue;
      const edge = i - 1 + (t - s[i - 1]) / ((s[i] - s[i - 1]) || 1);
      widths.push(Math.max(0.01, edge - last));
      last = edge; dark = d;
    }
    widths.push(n - last);
    if (widths.length < 45) continue;
    const forward = decodeRuns(widths, firstDark);
    if (forward) return forward;
    const lastDark = widths.length % 2 ? firstDark : !firstDark;
    const backward = decodeRuns(widths.slice().reverse(), lastDark);
    if (backward) return backward;
  }
  return null;
}
function decodeImageData(image, from = 0.3, to = 0.7, lines = 15) {
  const { data, width, height } = image;
  const gray = new Uint8ClampedArray(width);
  const votes = new Map();
  for (let k = 0; k < lines; k++) {
    const y = Math.round(height * (from + (to - from) * k / Math.max(1, lines - 1)));
    // Среднее по 5 соседним строкам гасит шум матрицы камеры.
    const y0 = Math.max(0, y - 2), y1 = Math.min(height - 1, y + 2);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let yy = y0; yy <= y1; yy++) { const o = (yy * width + x) * 4; sum += data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29; }
      gray[x] = (sum / (y1 - y0 + 1)) >> 8;
    }
    const code = decodeLine(gray);
    if (code) votes.set(code, (votes.get(code) ?? 0) + 1);
  }
  let best = null, count = 0;
  for (const [code, n] of votes) if (n > count) { best = code; count = n; }
  return best;
}
window.PEAK_SCAN = { decodeImageData, decodeLine, lookupCode };

// ---------- Сканер камерой ----------
const scanDialog = $('scan-dialog');
const scan = { stream: null, timer: 0, detector: null, hits: new Map(), canvas: document.createElement('canvas'), torch: false };
function scanStatus(text) { $('scan-status').textContent = text; }
async function openScanner() {
  $('scan-code').value = '';
  scanStatus('Включаю камеру…');
  scanDialog.showModal();
  void loadBarcodes();
  if (!navigator.mediaDevices?.getUserMedia) return scanStatus('Камера недоступна в этом браузере. Введите штрихкод вручную.');
  try {
    scan.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (err) {
    return scanStatus(err?.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите его в настройках браузера или введите штрихкод вручную.' : 'Не удалось включить камеру. Введите штрихкод вручную.');
  }
  if (!scanDialog.open) return stopScanner();
  const video = $('scan-video');
  video.srcObject = scan.stream;
  await video.play().catch(() => {});
  const track = scan.stream.getVideoTracks()[0];
  $('scan-torch').hidden = !track?.getCapabilities?.().torch;
  scan.detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'].filter(f => supported.includes(f));
      if (formats.length) scan.detector = new window.BarcodeDetector({ formats });
    } catch { scan.detector = null; }
  }
  scan.hits.clear();
  scanStatus('Наведите камеру на штрихкод на бирке.');
  void scanTick();
}
function stopScanner() {
  clearTimeout(scan.timer);
  scan.stream?.getTracks().forEach(t => t.stop());
  scan.stream = null;
  scan.torch = false;
  $('scan-torch').setAttribute('aria-pressed', 'false');
  $('scan-video').srcObject = null;
}
function confirmHit(code, need) {
  if (!code) return null;
  const now = performance.now();
  const last = scan.hits.get(code);
  const n = last && now - last.at < 1500 ? last.n + 1 : 1;
  scan.hits.set(code, { n, at: now });
  return n >= need ? code : null;
}
function videoFrame(video) {
  const scale = Math.min(1, 1280 / video.videoWidth);
  const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
  scan.canvas.width = w; scan.canvas.height = h;
  const ctx = scan.canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
async function scanTick() {
  if (!scan.stream) return;
  const video = $('scan-video');
  let code = null;
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      if (scan.detector) code = confirmHit((await scan.detector.detect(video))[0]?.rawValue ?? null, 1);
      else code = confirmHit(decodeImageData(videoFrame(video), 0.32, 0.68, 13), 2);
    } catch { scan.detector = null; }
  }
  if (code && scan.stream) {
    navigator.vibrate?.(60);
    stopScanner();
    scanDialog.close();
    await lookupCode(code);
    return;
  }
  scan.timer = setTimeout(scanTick, scan.detector ? 160 : 70);
}
$('scan-button').onclick = () => openScanner();
$('scan-close').onclick = () => scanDialog.close();
scanDialog.addEventListener('close', stopScanner);
$('scan-torch').onclick = async () => {
  const track = scan.stream?.getVideoTracks()[0];
  if (!track) return;
  scan.torch = !scan.torch;
  try { await track.applyConstraints({ advanced: [{ torch: scan.torch }] }); } catch { scan.torch = false; }
  $('scan-torch').setAttribute('aria-pressed', String(scan.torch));
};
$('scan-manual').addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('scan-code').value.trim();
  if (!value) return;
  scanStatus('Ищу…');
  if (await lookupCode(value, { quiet: true })) { scanDialog.close(); return; }
  scanStatus(barcodes.map?.size ? `«${value}» не найден. Проверьте цифры или ищите по артикулу.` : `«${value}» не найден: база штрихкодов ещё не выгружена из 1С. Можно ввести артикул.`);
});

// Шапка не едет за прокруткой; когда она скрылась, корзина доступна плавающей кнопкой.
let headerVisible = true;
function updateCartFab() {
  $('cart-fab').hidden = !(canOrder() && cartTotal() > 0 && !headerVisible && state.active === 'catalog');
}
new IntersectionObserver(entries => { headerVisible = entries[0].isIntersecting; updateCartFab(); }).observe(document.querySelector('.bar'));
$('cart-fab').onclick = () => openCart();

// ---------- Клавиатура ----------
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.target.closest('input,textarea,select') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    if (state.active !== 'catalog') showSection('catalog');
    $('search').focus();
    $('search').select();
  }
});
$('catalog-tab').onclick = () => showSection('catalog');
$('orders-tab').onclick = () => showSection('orders');
$('refresh-orders').onclick = () => loadOrders();
$('cart-button').onclick = openCart;
$('demo-role').onchange = event => selectDemoLocation(event.target.value);

// ---------- Запуск ----------
async function start() {
  const route = readHash();
  try {
    const [catalog, session] = await Promise.all([api('/data/catalog.json'), api('/api/session')]);
    state.catalog = catalog;
    state.demo = session.user === null;
    if (state.demo) {
      state.demoLocations = (await api(embedded ? '/data/stock-example.json' : '/api/owner-preview')).locations;
      for (const loc of state.demoLocations) $('demo-role').add(new Option(loc.name, loc.id));
      selectDemoLocation(storageRead('peak-demo-location', 'etazhi'));
    } else {
      state.user = session.user;
      if (canOrder()) restoreCart();
      updateAccount();
      buildIndex();
      renderSync();
      renderCatalog();
      await refreshStock();
      void loadOrders({ quiet: true });
      setInterval(refreshStock, 60_000);
      setInterval(renderSync, 60_000);
      setInterval(() => { if (isWarehouse()) void loadOrders({ quiet: true }); }, 60_000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refreshStock(); if (isWarehouse()) void loadOrders({ quiet: true }); } });
    }
    if (route.tab === 'orders' || (isWarehouse() && route.tab !== 'catalog')) showSection('orders');
    else if (route.tab === 'catalog') showSection('catalog');
    if (route.product && state.byArticle.has(route.product)) openProduct(route.product);
  } catch (err) {
    $('grid').setAttribute('aria-busy', 'false');
    $('grid').innerHTML = `<div class="empty"><b>Не удалось открыть каталог</b>${safe(err.message)}</div>`;
  }
}
void start();
