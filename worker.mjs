const warehouse = 'listvennaya';
const maxBytes = 6_000_000;
const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});
const error = (status, message) => json({ error: message }, status);
const note = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\u0000-\u0009\u000b-\u001f]/u.test(value);
const clean = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\u0000-\u001f]/u.test(value);
const skuKey = (a, c, z) => JSON.stringify([a.trim().toUpperCase(), c.trim().toLowerCase(), z.trim().toUpperCase()]);
const storeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value);
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 999999;

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  }
}

function actor(request, env) {
  const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
  const id = request.headers.get('oai-authenticated-user-id');
  const assignments = JSON.parse(env.PEAK_ACCESS || '{}');
  const account = email && id && Object.hasOwn(assignments, email) && assignments[email];
  if (account?.role === 'warehouse') return { id, role: 'warehouse', store: warehouse, name: 'Лиственная' };
  if (account?.role === 'store' && storeId(account.store) && account.store !== warehouse && clean(account.name, 100)) {
    return { id, role: 'store', store: account.store, name: account.name };
  }
  return null;
}

async function authorizedSync(request, env) {
  if (!env.PEAK_SYNC_TOKEN) return false;
  const presented = request.headers.get('authorization');
  if (!presented || presented.length > 512) return false;
  const hash = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [left, right] = await Promise.all([hash(presented), hash('Bearer ' + env.PEAK_SYNC_TOKEN)]);
  return left.reduce((diff, byte, i) => diff | (byte ^ right[i]), 0) === 0;
}

async function saveStock(request, env) {
  if (!await authorizedSync(request, env)) return error(403, 'Доступ к обмену закрыт');
  const body = await readBody(request);
  const updatedAt = typeof body?.updatedAt === 'string' && Date.parse(body.updatedAt);
  const expected = (env.PEAK_STOCK_LOCATIONS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!expected.includes(warehouse) || expected.length > 30 || new Set(expected).size !== expected.length || !expected.every(storeId)) {
    return error(503, 'Склады для обмена не настроены');
  }
  if (!updatedAt || updatedAt > Date.now() + 300_000 || updatedAt < Date.now() - 86_400_000 ||
      !Array.isArray(body.locations) || body.locations.length !== expected.length) {
    return error(400, 'Укажите дату выгрузки и полный набор складов');
  }
  const seen = new Set();
  const statements = [];
  for (const loc of body.locations) {
    if (!expected.includes(loc?.id) || seen.has(loc.id) || !Array.isArray(loc.rows) || loc.rows.length > 35000) {
      return error(400, 'Неверный или повторный код склада');
    }
    const keys = new Set();
    for (const row of loc.rows) {
      if (!Array.isArray(row) || row.length < 4 || row.length > 5 || !clean(row[0], 100) || !row[0].trim() ||
          !clean(row[1], 100) || !clean(row[2], 50) || !Number.isSafeInteger(row[3]) ||
          Math.abs(row[3]) > 999999 || (row.length === 5 && !clean(row[4], 250))) return error(400, 'Неверная строка остатков');
      const key = skuKey(...row);
      if (keys.has(key)) return error(400, 'Выгрузка содержит повтор товара, цвета и размера на одном складе');
      keys.add(key);
    }
    seen.add(loc.id);
    const rows = JSON.stringify(loc.rows);
    if (new TextEncoder().encode(rows).byteLength > 1_500_000) return error(413, 'Слишком много данных на одном складе');
    statements.push(env.DB.prepare(`INSERT INTO stock (location, updated, rows) VALUES (?, ?, ?)
      ON CONFLICT(location) DO UPDATE SET updated = excluded.updated, rows = excluded.rows
      WHERE stock.updated < excluded.updated`).bind(loc.id, updatedAt, rows));
  }
  const results = await env.DB.batch(statements);
  return json({ updatedAt: new Date(updatedAt).toISOString(), locations: statements.length,
    applied: results.some(item => item.meta.changes > 0) });
}

async function getStock(db, user) {
  const locations = user.role === 'warehouse' ? [warehouse, warehouse] : [warehouse, user.store];
  const { results } = await db.prepare('SELECT location, updated, rows FROM stock WHERE location IN (?, ?)').bind(...locations).all();
  const updated = results.length === new Set(locations).size && results.every(x => x.updated === results[0].updated)
    ? results[0].updated : null;
  return { updatedAt: updated ? new Date(updated).toISOString() : null,
    warehouse: updated ? JSON.parse(results.find(x => x.location === warehouse).rows) : [],
    store: updated && user.role === 'store' ? JSON.parse(results.find(x => x.location === user.store).rows) : [] };
}

// Названия складов для сводки по сети: PEAK_LOCATION_NAMES ({"kadyrova":"Магазин Кадырова"}) или имена из PEAK_ACCESS.
const defaultNames = { listvennaya: 'Лиственная', kadyrova: 'Кадырова', nalchik: 'Нальчик', vesna: 'ТЦ «Весна»', etazhi: 'ТЦ «Этажи»' };
function locationNames(env) {
  const names = { ...defaultNames };
  try {
    for (const account of Object.values(JSON.parse(env.PEAK_ACCESS || '{}'))) {
      if (account?.role === 'store' && storeId(account.store) && clean(account.name, 100)) names[account.store] = account.name;
    }
  } catch { /* настройка проверяется в actor() */ }
  try {
    for (const [id, name] of Object.entries(JSON.parse(env.PEAK_LOCATION_NAMES || '{}'))) if (storeId(id) && clean(name, 100)) names[id] = name;
  } catch { /* необязательная настройка */ }
  return names;
}

// Остатки для сайта. ?since=<updatedAt> — если выгрузка не менялась, ответ без данных (экономит трафик при опросе раз в минуту).
// network — остатки остальных магазинов той же выгрузки, только положительные: [артикул, цвет, размер, [[индекс магазина, шт.], ...]].
async function readStock(request, env, user) {
  const since = new URL(request.url).searchParams.get('since');
  const { results: heads } = await env.DB.prepare('SELECT location, updated FROM stock').all();
  const own = user.role === 'warehouse' ? [warehouse] : [warehouse, user.store];
  const mine = heads.filter(x => own.includes(x.location));
  const updated = mine.length === own.length && mine.every(x => x.updated === mine[0].updated) ? mine[0].updated : null;
  if (!updated) return json({ updatedAt: null, warehouse: [], store: [], network: null });
  const updatedAt = new Date(updated).toISOString();
  if (since === updatedAt) return json({ updatedAt, unchanged: true });
  const expected = new Set((env.PEAK_STOCK_LOCATIONS || '').split(',').map(x => x.trim()));
  const others = env.PEAK_NETWORK_STOCK === 'off' ? [] : heads
    .filter(x => !own.includes(x.location) && x.location !== warehouse && expected.has(x.location) && x.updated === updated)
    .map(x => x.location);
  const wanted = [...own, ...others];
  const { results } = await env.DB.prepare(`SELECT location, rows FROM stock WHERE location IN (${wanted.map(() => '?').join(', ')})`)
    .bind(...wanted).all();
  const rowsOf = id => JSON.parse(results.find(x => x.location === id)?.rows ?? '[]');
  const names = locationNames(env);
  const locations = others.map(id => ({ id, name: names[id] || id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const network = new Map();
  locations.forEach(({ id }, index) => {
    for (const [a, c, z, q] of rowsOf(id)) {
      if (!(q > 0)) continue;
      const k = skuKey(a, c, z);
      if (!network.has(k)) network.set(k, [a, c, z, []]);
      network.get(k)[3].push([index, q]);
    }
  });
  return json({ updatedAt, warehouse: rowsOf(warehouse), store: user.role === 'store' ? rowsOf(user.store) : [],
    network: locations.length ? { locations, rows: [...network.values()] } : null });
}

// Штрихкоды из 1С: полный список [штрихкод, артикул, цвет, размер]. Хранится частями по ~1,2 МБ.
async function saveBarcodes(request, env) {
  if (!await authorizedSync(request, env)) return error(403, 'Доступ к обмену закрыт');
  const body = await readBody(request);
  const updatedAt = typeof body?.updatedAt === 'string' && Date.parse(body.updatedAt);
  if (!updatedAt || updatedAt > Date.now() + 300_000 || updatedAt < Date.now() - 7 * 86_400_000 ||
      !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 200_000) {
    return error(400, 'Укажите дату выгрузки и список штрихкодов');
  }
  const seen = new Map();
  const rows = [];
  for (const row of body.rows) {
    if (!Array.isArray(row) || row.length !== 4 || !clean(row[0], 48) || !/^[\x21-\x7e]{4,48}$/.test(row[0]) ||
        !clean(row[1], 100) || !row[1].trim() || !clean(row[2], 100) || !clean(row[3], 50)) return error(400, 'Неверная строка штрихкодов');
    const target = skuKey(row[1], row[2], row[3]);
    if (seen.has(row[0])) {
      if (seen.get(row[0]) !== target) return error(400, 'Штрихкод ' + row[0] + ' привязан к разным товарам');
      continue;
    }
    seen.set(row[0], target);
    rows.push(row);
  }
  const current = await env.DB.prepare('SELECT MAX(updated) AS updated FROM barcodes').first();
  if (current?.updated >= updatedAt) return json({ updatedAt: new Date(updatedAt).toISOString(), rows: rows.length, applied: false });
  const parts = [];
  let part = [], size = 0;
  for (const row of rows) {
    const bytes = JSON.stringify(row).length * 2;
    if (size + bytes > 1_200_000 && part.length) { parts.push(part); part = []; size = 0; }
    part.push(row); size += bytes;
  }
  parts.push(part);
  await env.DB.batch([env.DB.prepare('DELETE FROM barcodes'),
    ...parts.map((list, i) => env.DB.prepare('INSERT INTO barcodes (part, updated, rows) VALUES (?, ?, ?)').bind(i, updatedAt, JSON.stringify(list)))]);
  return json({ updatedAt: new Date(updatedAt).toISOString(), rows: rows.length, parts: parts.length, applied: true });
}

async function readBarcodes(request, env) {
  const since = new URL(request.url).searchParams.get('since');
  const { results } = await env.DB.prepare('SELECT updated, rows FROM barcodes ORDER BY part').all();
  if (!results.length) return json({ updatedAt: null, rows: [] });
  const updatedAt = new Date(results[0].updated).toISOString();
  if (since === updatedAt) return json({ updatedAt, unchanged: true });
  return json({ updatedAt, rows: results.filter(x => x.updated === results[0].updated).flatMap(x => JSON.parse(x.rows)) });
}

function orderRow(row) {
  return { id: row.id, store: row.store, name: row.store_name, created: row.created,
    items: JSON.parse(row.items), status: row.status, document: row.document, note: row.note,
    comment: row.comment ?? '', processed: row.processed_at ?? null };
}

async function listOrders(db, user) {
  const query = 'SELECT * FROM orders ';
  const statement = user.role === 'warehouse'
    ? db.prepare(query + 'ORDER BY status = \'new\' DESC, created DESC LIMIT 100')
    : db.prepare(query + 'WHERE store = ? ORDER BY created DESC LIMIT 100').bind(user.store);
  return json({ orders: (await statement.all()).results.map(orderRow) });
}

async function createOrder(request, db, user) {
  if (user.role !== 'store') return error(403, 'Заявку отправляет директор магазина');
  const body = await readBody(request);
  if (!uuid(body?.id) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 250) {
    return error(400, 'Проверьте состав заявки: от 1 до 250 позиций');
  }
  const comment = (body.comment ?? '').replace(/\r\n?/g, '\n').trim();
  if (!note(comment, 500)) return error(400, 'Комментарий — не длиннее 500 символов');
  const existing = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(body.id).first();
  if (existing) return existing.store === user.store ? json(orderRow(existing)) : error(409, 'Номер заявки уже существует');
  const stock = await getStock(db, user);
  if (!stock.updatedAt || Date.now() - Date.parse(stock.updatedAt) > 75 * 60_000) {
    return error(409, 'Остатки устарели. Дождитесь следующей выгрузки из 1С');
  }
  const available = new Map(stock.warehouse.map(row => [skuKey(...row), row]));
  const seen = new Set();
  const items = [];
  for (const line of body.items) {
    if (!clean(line?.a, 100) || !clean(line?.color, 100) || !clean(line?.size, 50) || !positive(line?.qty)) {
      return error(400, 'Проверьте артикул и количество');
    }
    const key = skuKey(line.a, line.color, line.size);
    if (seen.has(key)) return error(400, 'Объедините одинаковые позиции');
    seen.add(key);
    const variant = available.get(key);
    if (!variant || variant[3] < line.qty) return error(409, 'Изменился остаток: ' + line.a + ', ' + line.size);
    items.push({ a: variant[0], color: variant[1], size: variant[2], qty: line.qty });
  }
  const saved = await db.prepare(`INSERT INTO orders (id, store, store_name, created, items, comment)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING *`)
    .bind(body.id, user.store, user.name, new Date().toISOString(), JSON.stringify(items), comment).first();
  if (saved) return json(orderRow(saved), 201);
  const retry = await db.prepare('SELECT * FROM orders WHERE id = ? AND store = ?').bind(body.id, user.store).first();
  return retry ? json(orderRow(retry)) : error(409, 'Номер заявки уже существует');
}

async function processOrder(request, db, user, id) {
  if (user.role !== 'warehouse') return error(403, 'Заявку обрабатывает главный склад');
  const body = await readBody(request);
  if (!uuid(id) || !['done', 'rejected'].includes(body?.status) ||
      !clean(body?.document ?? '', 100) || !clean(body?.note ?? '', 500) ||
      (body.status === 'done' && !body.document?.trim()) ||
      (body.status === 'rejected' && !body.note?.trim())) return error(400, 'Укажите номер перемещения или причину отказа');
  const updated = await db.prepare(`UPDATE orders SET status = ?, document = ?, note = ?, processed_by = ?, processed_at = ?
    WHERE id = ? AND status = 'new' RETURNING *`)
    .bind(body.status, body.document?.trim() || '', body.note?.trim() || '', user.id, new Date().toISOString(), id).first();
  return updated ? json(orderRow(updated)) : error(409, 'Заявка уже обработана или недоступна');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Статические файлы не подключены', { status: 503 });
    }
    try {
      const method = request.method;
      if (path === '/api/sync/stock' && method === 'POST') return await saveStock(request, env);
      if (path === '/api/sync/barcodes' && method === 'POST') return await saveBarcodes(request, env);
      const user = actor(request, env);
      if (!user && (path === '/api/session' || path === '/api/owner-preview')) {
        if (!env.PEAK_OWNER_EMAIL || (request.headers.get('oai-authenticated-user-email')||'').toLowerCase() !== env.PEAK_OWNER_EMAIL.toLowerCase()) return error(403,'Аккаунту ещё не назначен магазин.');
        return path === '/api/session' ? json({user:null}) : json(OWNER_SNAPSHOT);
      }
      // Склад видит каталог с остатками Лиственной: так при обработке заявки видно, хватает ли товара.
      if (path === '/api/session' && method === 'GET') return json({ user });
      if (!user) return error(403, 'Для аккаунта ещё не назначен магазин или роль склада');
      if (path === '/api/stock' && method === 'GET') return await readStock(request, env, user);
      if (path === '/api/barcodes' && method === 'GET') return await readBarcodes(request, env);
      if (path === '/api/orders') {
        if (method === 'GET') return await listOrders(env.DB, user);
        if (method === 'POST') return await createOrder(request, env.DB, user);
      }
      if (path.startsWith('/api/orders/') && method === 'PATCH') {
        return await processOrder(request, env.DB, user, path.split('/').at(-1));
      }
      return error(404, 'Страница не найдена');
    } catch (cause) {
      console.error('PEAK request failed', path, cause?.name);
      return error(503, 'Сервис временно недоступен');
    }
  }
};
