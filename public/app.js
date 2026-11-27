const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
const key = (article, color, size) => JSON.stringify([article.trim().toUpperCase(), color.trim().toLowerCase(), size.trim().toUpperCase()]);
const moneyless = new Intl.NumberFormat('ru-RU');
const sort = new Intl.Collator('ru-RU', { numeric: true });
const sizes = ['3XS','2XS','XXS','XS','S','M','L','XL','2XL','XXL','3XL','4XL','5XL','6XL','7XL','8XL'];
const sizeOrder = (a, b) => sizes.includes(a) && sizes.includes(b) ? sizes.indexOf(a) - sizes.indexOf(b) : sort.compare(a,b);
const clock = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const pageSize = 24;
const state = { demo: false, demoLocations: [], user: null, catalog: [], products: new Map(), front: [], cart: new Map(), orderId: null,
  page: 0, started: false, loadingStock: false, updated: null, stocks: { store: [], warehouse: [] }, active: 'catalog' };
const statusLabels = { new: 'Новая', done: 'Перемещение оформлено', rejected: 'Отклонена' };
const productDialog = $('product-dialog');
const cartDialog = $('cart-dialog');
cartDialog.classList.add('cart-dialog');
const offline = location.protocol === 'file:';
let toastTimer;
let orderRead = 0;

async function api(path, body, method = 'POST') {
  if (offline && path === '/api/session') return { user: null };
  if (offline && path === '/data/catalog.json') return window.PEAK_DEMO_DATA.catalog;
  if (offline && path === '/data/stock-example.json') return window.PEAK_DEMO_DATA.stock;
  const options = body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new Error(data?.error || 'Не удалось загрузить данные. Повторите попытку.');
  return data;
}

function storageRead(name, fallback) {
  try { return JSON.parse(localStorage.getItem(name)) ?? fallback; } catch { return fallback; }
}
function storageWrite(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch { return false; }
}
function cartStoreKey() { return 'peak-cart-v1-' + (state.demo ? 'demo-' : state.user.id + '-') + state.user.store; }
function restoreCart() {
  const result = storageRead(cartStoreKey(), { id: null, lines: [] });
  state.orderId = result.id;
  state.cart = new Map(result.lines.map(line => [key(line.a, line.color, line.size), line]));
  updateCartCount();
}
function saveCart() { storageWrite(cartStoreKey(), { id: state.orderId, lines: [...state.cart.values()] }); }
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
function canOrder() { return state.user?.role === 'store'; }
function currentStock() { return state.demo || Boolean(state.updated && Date.now() - Date.parse(state.updated) <= 75 * 60_000); }
function qty(value) { return value == null ? '—' : moneyless.format(value); }
function date(value) { return clock.format(new Date(value)); }
function updateCartCount() { $('cart-count').textContent = moneyless.format([...state.cart.values()].reduce((n, line) => n + line.qty, 0)); }
function updateAccount() {
  $('demo-role').hidden = !state.demo;
  $('account-name').textContent = !state.demo && state.user ? state.user.name : '';
  $('catalog-tab').hidden=!canOrder();
  $('cart-button').hidden = !canOrder();
  $('orders-title').textContent = canOrder() ? 'Заявки моего магазина' : 'Заявки на Лиственную';
}
function selectDemoLocation(id) {
  const warehouse = state.demoLocations.find(loc => loc.id === 'listvennaya');
  const location = state.demoLocations.find(loc => loc.id === id);
  if (!location || !warehouse) throw new Error('В примере отсутствует нужный склад.');
  const role = id === warehouse.id ? 'warehouse' : 'store';
  state.user = { role, store: id, name: location.name };
  state.stocks = { warehouse: warehouse.rows, store: role === 'store' ? location.rows : [] };
  if (canOrder()) restoreCart();
  updateAccount();
  buildIndex();
  renderCatalog();
  $('demo-role').value = id;
  if (!canOrder()) showSection('orders'); else if (state.active === 'orders') void loadOrders();
}

function buildIndex() {
  const storeStock = new Map(state.stocks.store.map(row => [key(...row), row[3]]));
  const warehouseStock = new Map(state.stocks.warehouse.map(row => [key(...row), row[3]]));
  const productMap = new Map();
  function ensureProduct(article, name, season = '', category = 'Без категории', photo = null) {
    const identifier = article.trim().toUpperCase();
    if (!productMap.has(identifier)) productMap.set(identifier, { a: article, n: name || article, s: season, c: category, photo, colors: new Map() });
    return productMap.get(identifier);
  }
  function ensureColor(product, name, photo = null) {
    const identifier = name.trim().toLowerCase();
    if (!product.colors.has(identifier)) product.colors.set(identifier, { color: name, photo, sizes: new Map() });
    return product.colors.get(identifier);
  }
  for (const product of state.catalog) {
    const model = ensureProduct(product.a, product.n, product.s, product.c, product.photo);
    for (const variant of product.variants) {
      const color = ensureColor(model, variant.color, variant.photo);
      for (const size of variant.sizes) color.sizes.set(size.trim().toUpperCase(), size);
    }
  }
  const reportedVariants = state.demo
    ? state.demoLocations.flatMap(location => location.rows)
    : [...state.stocks.warehouse, ...state.stocks.store];
  for (const [article, name, size, , label] of reportedVariants) {
    const color = ensureColor(ensureProduct(article, label), name);
    color.sizes.set(size.trim().toUpperCase(), size);
  }
  state.front = [...productMap.values()].map(p => {
    const colors = [...p.colors.values()].map(c => ({
      color: c.color, photo: c.photo,
      lines: [...c.sizes.values()].sort(sizeOrder).map(size => {
        const sku = key(p.a, c.color, size);
        return { size, store: (state.updated || state.demo) && canOrder() ? (storeStock.get(sku) ?? 0) : null,
          warehouse: state.updated || state.demo ? (warehouseStock.get(sku) ?? 0) : null };
      })
    }));
    return { ...p, colors, hay: normalize([p.a,p.n,...colors.map(c => c.color)].join(' ')) };
  });
  state.products = new Map(state.front.map(p => [p.a, p]));
  fillSelect('category', state.front.map(p => p.c));
  fillSelect('season', state.front.map(p => p.s), (a,b) => sort.compare(b,a));
  fillSelect('size', state.front.flatMap(p => p.colors.flatMap(c => c.lines.map(line => line.size))), sizeOrder);
}
function fillSelect(id, values, comparator = sort.compare) {
  const select = $(id);
  const selected = select.value;
  select.length = 1;
  for (const value of [...new Set(values.filter(Boolean))].sort(comparator)) select.add(new Option(value, value));
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
}

function showSync(){banner(!state.demo && state.updated && !currentStock() ? 'Остатки устарели.' : '');}

function photoMarkup(id, kind, label, fast = false) {
  return id == null ? '<span class="photo-placeholder">Нет фото</span>'
    : `<img src="${offline ? './' : '/'}photo/${kind}-${Number(id)}.jpg" width="${kind === 'thumb' ? 250 : 580}" height="${kind === 'thumb' ? 250 : 580}" alt="${safe(label)}" ${fast ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}
function sum(lines, field) {
  return lines.some(line => line[field] != null) ? lines.reduce((total, line) => total + (line[field] ?? 0), 0) : null;
}
function tile(p, lines, index) {
  const shop = sum(lines,'store');
  const warehouse = sum(lines,'warehouse');
  return `<button class="tile" type="button" data-product="${safe(p.a)}">
    <span class="photo">${photoMarkup(p.photo,'thumb',p.n,index < 3)}${p.s ? `<span class="season-badge">${safe(p.s)}</span>` : ''}</span>
    <span class="tile-body"><span class="name">${safe(p.n)}</span>
    <span class="variants">${safe(p.colors.map(c => c.color).filter(Boolean).join(' · ') || p.c)}</span>
    <span class="tile-code">${safe(p.a)}</span><span class="size-list">${[...new Set(lines.filter(l=>l.warehouse>0).map(l=>l.size))].slice(0,6).map(z=>"<i>"+safe(z||"Единый")+"</i>").join("")}</span><span class="stock-strip"><span>Мой магазин<b>${qty(shop)}</b></span><span>Лиственная<b class="${warehouse > 0 ? 'available' : ''}">${qty(warehouse)}</b></span></span></span>
  </button>`;
}
function replenishmentModel(model, mode, size) {
  if (!mode) return model;
  if (mode === 'article' && model.colors.some(c => c.lines.some(line => line.store !== 0))) return null;
  const colors = model.colors.map(color => ({
    ...color,
    lines: color.lines.filter(line => line.store === 0 && line.warehouse > 0 && (!size || line.size === size))
  })).filter(color => color.lines.length);
  return colors.length ? { ...model, colors, photo: colors[0].photo ?? model.photo } : null;
}
const displayedProducts = new Map();
function renderCatalog() {
  const terms = normalize($('search').value).split(/\s+/).filter(Boolean);
  const category = $('category').value;
  const season = $('season').value;
  const size = $('size').value;
  const inStock = $('in-stock').checked;
  const needs = $('store-needs').value;
  const found = [];
  displayedProducts.clear();
  for (const original of state.front) {
    const model = replenishmentModel(original, needs, size);
    if (!model) continue;
    if ((category && category !== model.c) || (season && season !== model.s) || !terms.every(term => model.hay.includes(term))) continue;
    const lines = model.colors.flatMap(c => c.lines).filter(line => !size || line.size === size);
    if ((size && !lines.length) || (inStock && !lines.some(line => line.warehouse > 0))) continue;
    displayedProducts.set(model.a, model);
    found.push({ model, lines });
  }
  filtered = found;
  shown = 0;
  $('grid').replaceChildren();
  $('grid').setAttribute('aria-busy','false');
  $('result-count').textContent = 'Найдено: '+moneyless.format(found.length);
  if (!found.length) $('grid').innerHTML='<p class="empty">Товары не найдены</p>';
  appendCards();
  const activeFilters = [category, season, size, inStock, needs].filter(Boolean).length;
  $('filter-toggle').textContent = activeFilters ? 'Фильтры · ' + activeFilters : 'Фильтры';
}
let filtered=[], shown=0;
function appendCards(){
  const batch=filtered.slice(shown,shown+pageSize);
  $('grid').insertAdjacentHTML('beforeend',batch.map((x,i)=>tile(x.model,x.lines,shown+i)).join(''));
  shown+=batch.length;
  $('pager').hidden=shown>=filtered.length;
}
new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)) appendCards()},{rootMargin:'650px'}).observe($('pager'));
const filterDialog = $('filter-dialog');
const filterFields = ['category','season','size','in-stock','store-needs'].map($);
let savedFilters = [];
$('filter-toggle').onclick = () => {
  savedFilters = filterFields.map(el => el.type === 'checkbox' ? el.checked : el.value);
  filterDialog.returnValue = '';
  filterDialog.showModal();
};
$('filter-reset').onclick = () => {
  for (const el of filterFields) {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  }
};
filterDialog.onclose = () => {
  if (filterDialog.returnValue !== 'apply') filterFields.forEach((el,i) => {
    if (el.type === 'checkbox') el.checked = savedFilters[i];
    else el.value = savedFilters[i];
  });
  renderCatalog();
};
const photoDialog = $('photo-dialog');
const frame = photoDialog.querySelector('.viewer-frame');
// Scale and pan only the image. Coordinates are relative to the centre of the frame.
function enablePhotoGestures(area, img) {
  let scale = 1, x = 0, y = 0, previous = null, suppressClickUntil = 0;
  const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n));
  function paint() {
    x = clamp(x, area.clientWidth * (scale - 1) / 2);
    y = clamp(y, area.clientHeight * (scale - 1) / 2);
    img.style.transform = "translate(" + x + "px," + y + "px) scale(" + scale + ")";
    area.classList.toggle('magnified', scale > 1);
  }
  function point(touches) {
    const a = touches[0], b = touches[1] || a, r = area.getBoundingClientRect();
    return { x: (a.clientX+b.clientX)/2-r.left-r.width/2, y: (a.clientY+b.clientY)/2-r.top-r.height/2,
      distance: Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY), count: touches.length };
  }
  area.addEventListener('touchstart', e => {
    previous = point(e.touches);
    if (e.touches.length >= 2) e.preventDefault();
  }, {passive:false});
  area.addEventListener('touchmove', e => {
    const next = point(e.touches);
    if (previous && next.count === previous.count && (next.count >= 2 || scale > 1)) {
      e.preventDefault();
      suppressClickUntil = performance.now() + 500;
      const target = next.count >= 2 && previous.distance > 0 ? Math.max(1, Math.min(5, scale*next.distance/previous.distance)) : scale;
      x = next.x - (previous.x-x)*target/scale;
      y = next.y - (previous.y-y)*target/scale;
      scale = target;
      paint();
    }
    previous = next;
  }, {passive:false});
  function end(e) { previous = e.touches.length ? point(e.touches) : null; }
  area.addEventListener('touchend',end);
  area.addEventListener('touchcancel',end);
  area.addEventListener('click', e => {
    if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  if (area === frame) area.addEventListener('dblclick', e => {
    const r = area.getBoundingClientRect();
    scale = scale > 1 ? 1 : 2;
    x = scale === 1 ? 0 : r.left + r.width / 2 - e.clientX;
    y = scale === 1 ? 0 : r.top + r.height / 2 - e.clientY;
    paint();
  });
  return () => { scale = 1; x = y = 0; paint(); };
}
const resetViewer = enablePhotoGestures(frame, $('photo-full'));
function showPhoto(img, title) {
  $('photo-title').textContent = title;
  $('photo-full').src = img.currentSrc || img.src;
  $('photo-full').alt = img.alt;
  photoDialog.showModal();
  resetViewer();
}
$('photo-close').onclick = () => photoDialog.close();
let swipe = null;
productDialog.addEventListener('touchstart', e => {
  const blocked = e.target.closest('input,button,select,.magnified');
  swipe = e.touches.length === 1 && !(blocked && !blocked.matches('.photo-open')) ?
    { x:e.touches[0].clientX, y:e.touches[0].clientY } : null;
  if (e.target.closest('.magnified')) swipe = null;
}, {passive:true});
productDialog.addEventListener('touchmove', e => {
  if (swipe && (e.touches.length !== 1 || Math.abs(e.touches[0].clientY-swipe.y) > 45)) swipe = null;
}, {passive:true});
productDialog.addEventListener('touchend', e => {
  if (swipe && !e.touches.length) {
    const dx = e.changedTouches[0].clientX-swipe.x, dy = e.changedTouches[0].clientY-swipe.y;
    if (dx > 80 && dx > 2*Math.abs(dy)) productDialog.close();
  }
  swipe = null;
});
productDialog.addEventListener('touchcancel', () => swipe = null);
function openProduct(article, selected = null) {
  const p = displayedProducts.get(article);
  if (!p) return;
  const sizeFilter = $('size').value;
  const colorIndex = selected ?? Math.max(0, p.colors.findIndex(c => sizeFilter ? c.lines.some(line => line.size === sizeFilter) : c.photo != null));
  const c = p.colors[colorIndex];
  const savedScroll = productDialog.open ? productDialog.scrollTop : 0;
  const heading = `<div class="modal-head"><div><h2 id="product-title" tabindex="-1" autofocus>${safe(p.n)}</h2></div>
    <button class="close" type="button" aria-label="Закрыть" data-close>×</button></div>`;
  const rows = c?.lines.map((line,i) => {
    const inCart = state.cart.get(key(p.a,c.color,line.size))?.qty ?? 0;
    const max = (line.warehouse || 0) - inCart;
    const sizeName = safe(line.size || 'Единый');
    const buying = canOrder() && max > 0 && currentStock();
    return `<section class="size-card"><h3>Размер <strong>${sizeName}</strong></h3>
      <dl><div><dt>Мой магазин</dt><dd>${qty(line.store)} шт.</dd></div><div><dt>Лиственная</dt><dd>${qty(line.warehouse)} шт.</dd></div></dl>
      ${inCart ? '<p class="size-cart-count">В корзине · '+qty(inCart)+' шт.</p>' : ''}
      ${buying ? `<div class="size-order"><div class="qty-stepper" role="group" aria-label="Количество к заказу"><button type="button" data-step="-1" aria-label="Уменьшить количество">−</button><input aria-label="Количество, размер ${sizeName}" data-qty="${i}" type="number" inputmode="numeric" min="1" max="${max}" step="1" required value="1"><button type="button" data-step="1" aria-label="Увеличить количество">+</button></div><button class="primary" aria-label="Добавить размер ${sizeName} в корзину" data-add="${i}" type="button">В корзину</button></div>` : ''}
    </section>`;
  }).join('');
  productDialog.innerHTML = heading + `<div class="detail"><div class="photo detail-image">${photoMarkup(c?.photo ?? p.photo,'detail',p.n,true)}${(c?.photo ?? p.photo) != null ? '<button class="photo-open" aria-label="Увеличить фотографию"><span aria-hidden="true">⛶</span></button>' : ''}</div><div class="detail-copy">
    <div class="chips" aria-label="Цвет">${p.colors.map((x,i) => `<button data-color="${i}" type="button" class="chip" aria-pressed="${i === colorIndex}">${safe(x.color || 'Без цвета')}</button>`).join('')}</div>
    ${rows ? `<div class="size-grid">${rows}</div>` : '<p class="detail-note">Размеры появятся после выгрузки.</p>'}
    ${c && c.photo == null && p.photo != null ? '<p class="detail-note">Показано фото модели.</p>' : ''}
    <div class="product-code"><button type="button" data-copy class="copy" title="Скопировать артикул" aria-label="Скопировать артикул ${safe(p.a)}"><span>${safe(p.a)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 5H6a2 2 0 0 0-2 2v9"/></svg></button><span class="copy-status" role="status"></span></div><p class="inline-msg" role="status"></p>${canOrder()?'<button class="primary go-cart" data-cart>Открыть корзину</button>':""}</div></div>`;
  if (!productDialog.open) productDialog.showModal();
  const image = productDialog.querySelector('.detail-image img');
  if (image) enablePhotoGestures(image.parentElement, image);
  productDialog.scrollTop = savedScroll;
  productDialog.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-copy')) {
      const feedback = productDialog.querySelector('.copy-status');
      if (navigator.clipboard) navigator.clipboard.writeText(p.a).then(() => feedback.textContent = 'Скопировано').catch(() => feedback.textContent = 'Не удалось скопировать');
      else feedback.textContent = 'Не удалось скопировать';
    }
    if (button.matches('.photo-open')) showPhoto(productDialog.querySelector('.detail-image img'), p.n);
    if (button.hasAttribute('data-step')) {
      const input = button.parentElement.querySelector('input');
      input.value = Math.min(Number(input.max), Math.max(1, (input.valueAsNumber || 0) + Number(button.dataset.step)));
    }
    if(button.hasAttribute('data-cart')) { productDialog.close();renderCart();cartDialog.showModal(); }
    if (button.hasAttribute('data-close')) productDialog.close();
    if (button.hasAttribute('data-color')) {
      openProduct(article, Number(button.dataset.color));
      productDialog.querySelector(`[data-color="${button.dataset.color}"]`)?.focus();
    }
    if (button.hasAttribute('data-add')) {
      const input = productDialog.querySelector(`[data-qty="${button.dataset.add}"]`);
      if (!input.reportValidity()) return;
      const line = c.lines[Number(button.dataset.add)];
      const sku = key(p.a,c.color,line.size);
      const requested = input.valueAsNumber + (state.cart.get(sku)?.qty ?? 0);
      if (!Number.isSafeInteger(requested) || requested < 1 || requested > line.warehouse) return;
      state.cart.set(sku,{ a:p.a, color:c.color, size:line.size, qty:requested });
      state.orderId = null;
      saveCart();
      updateCartCount();
      openProduct(article,colorIndex);
      const message = productDialog.querySelector('.inline-msg');
      message.textContent = 'В корзине: ' + requested + ' шт.';
      productDialog.querySelector(`[data-add="${button.dataset.add}"]`)?.focus({preventScroll:true});
    }
  };
}

function renderCart() {
  const lines = [...state.cart.values()];
  const total = lines.reduce((n, line) => n + line.qty, 0);
  cartDialog.innerHTML = `<div class="modal-head"><div><span class="article">Лиственная → ${safe(state.user.name)}</span><h2 id="cart-title">Корзина пополнения</h2></div>
    <button class="close" aria-label="Закрыть" type="button" data-close>×</button></div><div class="cart-body">
    ${lines.length ? `<div class="table-wrap"><table><thead><tr><th>Товар</th><th>Цвет / размер</th><th>Шт.</th><th><span class="sr">Действие</span></th></tr></thead><tbody>
      ${lines.map((line,i) => `<tr><td><span class="article">${safe(line.a)}</span><br>${safe(state.products.get(line.a)?.n || '')}</td>
        <td>${safe(line.color || '—')} / ${safe(line.size || 'единый')}</td>
        <td><input aria-label="Количество для ${safe(line.a)}, ${safe(line.size)}" data-change="${i}" type="number" min="1" max="999999" step="1" inputmode="numeric" value="${line.qty}"></td>
        <td><button class="secondary small" type="button" data-remove="${i}">Убрать</button></td></tr>`).join('')}
      </tbody></table></div><div class="cart-foot"><b id="cart-total">${lines.length} поз. · ${total} шт.</b><button class="primary" id="submit-order" type="button">${state.demo ? 'Отправить тестовую заявку' : 'Отправить заявку'}</button></div>
      <p id="cart-error" class="inline-msg danger" role="status"></p>` : '<p class="empty">Добавьте товары из каталога.</p>'}</div>`;
  cartDialog.onchange = event => {
    if (event.target.dataset.change == null) return;
    const line = lines[Number(event.target.dataset.change)];
    if (!event.target.reportValidity()) { event.target.value = line.qty; return; }
    const maximum = available(line);
    if (event.target.valueAsNumber > maximum) {
      $('cart-error').textContent = 'На Лиственной доступно ' + maximum + ' шт. для ' + line.a;
      event.target.value = line.qty;
      return;
    }
    line.qty = event.target.valueAsNumber;
    state.orderId = null;
    saveCart();
    updateCartCount();
    $('cart-error').textContent = '';
    $('cart-total').textContent = lines.length + ' поз. · ' + lines.reduce((n, item) => n + item.qty, 0) + ' шт.';
  };
  cartDialog.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-close')) cartDialog.close();
    if (button.hasAttribute('data-remove')) {
      const line = lines[Number(button.dataset.remove)];
      state.cart.delete(key(line.a,line.color,line.size));
      state.orderId = null;
      saveCart();
      updateCartCount();
      renderCart();
    }
    if (button.id === 'submit-order') void submitCart(button);
  };
}
function available(line) {
  const sku = key(line.a,line.color,line.size);
  const p = state.products.get(line.a);
  return Math.max(0, p?.colors.flatMap(c => c.lines.map(size => ({ ...size, color: c.color })))
    .find(x => key(line.a,x.color,x.size) === sku)?.warehouse ?? 0);
}
const demoOrdersKey = 'peak-demo-orders-v1';
async function submitCart(button) {
  const lines = [...state.cart.values()];
  const changed = lines.find(line => line.qty > available(line));
  if (changed || !currentStock()) {
    $('cart-error').textContent = changed ? 'Проверьте остаток товара ' + changed.a : 'Дождитесь следующей выгрузки остатков.';
    return;
  }
  button.disabled = true;
  const controls = [...cartDialog.querySelectorAll('input,[data-remove]')];
  controls.forEach(control => { control.disabled = true; });
  state.orderId ||= crypto.randomUUID();
  saveCart();
  try {
    if (state.demo) {
      const orders = storageRead(demoOrdersKey, []);
      const order = { id:state.orderId, store:state.user.store, name:state.user.name, items:lines, created:new Date().toISOString(), status:'new' };
      if (!orders.some(x => x.id === order.id) && !storageWrite(demoOrdersKey,[order,...orders].slice(0,100))) throw new Error('Браузер не смог сохранить тестовую заявку.');
    } else await api('/api/orders',{ id:state.orderId, items:lines });
    state.cart.clear();
    state.orderId = null;
    saveCart();
    updateCartCount();
    cartDialog.close();
    showSection('orders');
    notify(state.demo ? 'Тестовая заявка создана' : 'Заявка отправлена');
  } catch (err) {
    $('cart-error').textContent = err.message;
    button.disabled = false;
    controls.forEach(control => { control.disabled = false; });
  }
}

function renderOrders(orders) {
  $('order-list').innerHTML = orders.map(order => `<details class="order" data-order="${safe(order.id)}"><summary><span><b>${safe(order.name)}</b>
    <small>${date(order.created)} МСК · ${order.items.length} поз. · ${order.items.reduce((n,item) => n + item.qty, 0)} шт.</small></span>
    <span class="status ${safe(order.status)}">${safe(statusLabels[order.status])}</span></summary><div class="order-body">
    <div class="table-wrap"><table><thead><tr><th>Артикул</th><th>Цвет</th><th>Размер</th><th>Шт.</th></tr></thead><tbody>
    ${order.items.map(line => `<tr><td>${safe(line.a)}</td><td>${safe(line.color || '—')}</td><td>${safe(line.size || '—')}</td><td>${line.qty}</td></tr>`).join('')}</tbody></table></div>
    ${order.document ? '<p>Документ 1С: ' + safe(order.document) + '</p>' : ''}
    ${order.note ? '<p>' + safe(order.note) + '</p>' : ''}
    ${state.user.role === 'warehouse' && order.status === 'new' ? '<div class="order-action"><input aria-label="Номер перемещения или причина отказа" maxlength="100" placeholder="Номер перемещения или причина отказа"><button class="primary small" data-status="done" type="button">Перемещение оформлено</button><button class="secondary small" data-status="rejected" type="button">Отклонить</button><p class="inline-msg danger" role="status"></p></div>' : ''}
    </div></details>`).join('') || '<p class="empty">Заявок пока нет.</p>';
}
async function loadOrders() {
  const version = ++orderRead;
  $('refresh-orders').disabled = true;
  try {
    const orders = state.demo
      ? storageRead(demoOrdersKey, []).filter(order => !canOrder() || order.store === state.user.store)
      : (await api('/api/orders')).orders;
    if (version === orderRead) renderOrders(orders);
  } catch (err) {
    if (version === orderRead) $('order-list').innerHTML = '<p class="empty">' + safe(err.message) + '</p>';
  } finally {
    if (version === orderRead) $('refresh-orders').disabled = false;
  }
}
$('order-list').onclick = async event => {
  const button = event.target.closest('[data-status]');
  if (!button) return;
  const row = button.closest('[data-order]');
  const form = button.closest('.order-action');
  const text = form.querySelector('input').value.trim();
  const message = form.querySelector('[role=status]');
  const status = button.dataset.status;
  if (!text) {
    message.textContent = status === 'done' ? 'Укажите номер перемещения в 1С.' : 'Укажите причину отказа.';
    return;
  }
  const actions = [...form.querySelectorAll('button')];
  actions.forEach(x => { x.disabled = true; });
  const body = { status, document: status === 'done' ? text : '', note: status === 'rejected' ? text : '' };
  try {
    if (state.demo) {
      const orders = storageRead(demoOrdersKey, []);
      if (!storageWrite(demoOrdersKey,orders.map(order => order.id === row.dataset.order ? { ...order, ...body } : order))) throw new Error('Браузер не смог сохранить изменения.');
    } else await api('/api/orders/' + row.dataset.order,body,'PATCH');
    void loadOrders();
  } catch (err) { message.textContent = err.message; actions.forEach(x => { x.disabled = false; }); }
};
function showSection(section) {
  if(state.user?.role==='warehouse') section='orders';
  state.active = section;
  for (const name of ['catalog','orders']) {
    $(name).hidden = name !== section;
    if (name === section) $(name + '-tab').setAttribute('aria-current','page');
    else $(name + '-tab').removeAttribute('aria-current');
  }
  if (section === 'orders' && state.user) void loadOrders();
}
async function refreshStock() {
  if (state.loadingStock || state.demo || !state.user) return;
  state.loadingStock = true;
  try {
    const stock = await api('/api/stock');
    if (stock.updatedAt !== state.updated) {
      state.updated = stock.updatedAt;
      state.stocks = stock;
      buildIndex();
      renderCatalog();
    }
    showSync();
  } catch (err) { banner(err.message, true); }
  finally { state.loadingStock = false; }
}

$('grid').onclick = event => {
  const card = event.target.closest('[data-product]');
  if (card) openProduct(card.dataset.product);
};
$('catalog-tab').onclick = () => showSection('catalog');
$('orders-tab').onclick = () => showSection('orders');
$('refresh-orders').onclick = loadOrders;
$('cart-button').onclick = () => { renderCart(); cartDialog.showModal(); };
$('demo-role').onchange = event => selectDemoLocation(event.target.value);
for (const id of ['search']) {
  let scheduled;
  $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => { state.page = 0; renderCatalog(); }, id === 'search' ? 90 : 0);
  });
}

for (const dialog of [productDialog,cartDialog]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

async function start() {
  try {
    const [catalog, session] = await Promise.all([api('/data/catalog.json'),api('/api/session')]);
    state.catalog = catalog;
    state.demo = session.user === null;
    if (state.demo) {
      state.demoLocations = (await api(offline ? '/data/stock-example.json' : '/api/owner-preview')).locations;
      for (const location of state.demoLocations) $('demo-role').add(new Option(location.name, location.id));
      selectDemoLocation('etazhi');
      showSync();
      return;
    }
    state.user = session.user;
    if(state.user.role==='warehouse'){updateAccount();showSection('orders');return;}
    if (canOrder()) restoreCart();
    updateAccount();
    showSync();
    buildIndex();
    renderCatalog();
    await refreshStock();
    setInterval(refreshStock,60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshStock(); });
  } catch (err) {
    $('grid').setAttribute('aria-busy','false');
    $('grid').innerHTML = '<p class="empty">' + safe(err.message) + '</p>';
  }
}
void start();

