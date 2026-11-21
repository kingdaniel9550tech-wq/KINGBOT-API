/**
 * Tools pack (public: your website can call these straight from the browser; /tools/translate needs your API key).
 *   /tools                      list of tools
 *   /tools/qr?text=...&size=512&format=png|svg
 *   /tools/weather?city=Lagos
 *   /tools/currency?from=USD&to=NGN,GHS&amount=100
 *   /tools/shorten?url=https://...
 *   /tools/calc?expr=2*(3+4)^2&mode=deg
 *   /tools/convert?value=5&from=km&to=mi
 *   /tools/time?tz=Africa/Lagos
 *   /tools/translate?text=Good morning&to=french      (key)
 */
const { ttlCache, request, httpError, isPrivateHost } = require('./util');

// ------------------------------------------------------------------ calculator (no eval: a small, safe parser)
function calculate(input, { deg = false } = {}) {
  if (/[\d.]\s+[\d.]/.test(String(input || ''))) throw httpError(400, 'Put an operator (+ - * /) between the numbers');
  const s = String(input || '').toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  const fail = (m) => { throw httpError(400, m || 'I could not understand that expression'); };
  if (!s) fail('Send an expression, for example expr=2*(3+4)');
  if (s.length > 200) fail('That expression is too long');
  let i = 0, depth = 0;
  const toRad = (x) => (deg ? (x * Math.PI) / 180 : x);
  const fromRad = (x) => (deg ? (x * 180) / Math.PI : x);
  const FN = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp, ln: Math.log, log: Math.log10,
    sin: (x) => Math.sin(toRad(x)), cos: (x) => Math.cos(toRad(x)), tan: (x) => Math.tan(toRad(x)),
    asin: (x) => fromRad(Math.asin(x)), acos: (x) => fromRad(Math.acos(x)), atan: (x) => fromRad(Math.atan(x)),
  };
  const number = () => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  function primary() {
    if (s[i] === '(') {
      i++;
      if (++depth > 40) fail('Too many brackets');
      const v = expr();
      if (s[i] !== ')') fail('A closing bracket is missing');
      i++; depth--;
      return v;
    }
    const n = number();
    if (n !== null) return n;
    const m = /^[a-z]+/.exec(s.slice(i));
    if (!m) fail();
    const name = m[0];
    i += name.length;
    if (name === 'pi') return Math.PI;
    if (name === 'e') return Math.E;
    if (s[i] !== '(') fail(`I don't know "${name}"`);
    i++;
    const args = [];
    if (s[i] !== ')') { do { args.push(expr()); } while (s[i] === ',' && ++i); }
    if (s[i] !== ')') fail('A closing bracket is missing');
    i++;
    if (FN[name]) { if (args.length !== 1) fail(`${name} takes one value`); return FN[name](args[0]); }
    if (name === 'min' || name === 'max') { if (!args.length) fail(); return Math[name](...args); }
    if (name === 'pow') { if (args.length !== 2) fail('pow takes two values'); return Math.pow(args[0], args[1]); }
    return fail(`I don't know the function "${name}"`);
  }
  const postfix = () => { let v = primary(); while (s[i] === '%') { i++; v /= 100; } return v; };
  const power = () => {
    const base = postfix();
    if (s[i] === '^') { i++; return Math.pow(base, unary()); }
    if (s[i] === '*' && s[i + 1] === '*') { i += 2; return Math.pow(base, unary()); }
    return base;
  };
  function unary() {
    if (s[i] === '-') { i++; return -unary(); }
    if (s[i] === '+') { i++; return unary(); }
    return power();
  }
  function term() {
    let v = unary();
    for (;;) {
      if (s[i] === '*' && s[i + 1] !== '*') { i++; v *= unary(); }
      else if (s[i] === '/') { i++; const d = unary(); if (d === 0) fail('You cannot divide by zero'); v /= d; }
      else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      if (s[i] === '+') { i++; v += term(); }
      else if (s[i] === '-') { i++; v -= term(); }
      else return v;
    }
  }
  const result = expr();
  if (i < s.length) fail();
  if (!Number.isFinite(result)) fail('The result is not a real number');
  return Number(result.toPrecision(12));
}

// ------------------------------------------------------------------ unit converter
const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125 },
  volume: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444 },
  data: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
  time: { s: 1, min: 60, h: 3600, d: 86400, wk: 604800 },
  area: { m2: 1, km2: 1e6, ha: 10000, ft2: 0.09290304, ac: 4046.8564224, mi2: 2589988.110336 },
};
const ALIAS = {
  meter: 'm', meters: 'm', metre: 'm', metres: 'm', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', centimeter: 'cm', centimeters: 'cm', mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd',
  foot: 'ft', feet: 'ft', inch: 'in', inches: 'in', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', tonne: 't', tonnes: 't',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', gallon: 'gal', gallons: 'gal', celsius: 'c', fahrenheit: 'f', kelvin: 'k', kmh: 'km/h', kph: 'km/h', mps: 'm/s',
  second: 's', seconds: 's', sec: 's', minute: 'min', minutes: 'min', hour: 'h', hours: 'h', hr: 'h', day: 'd', days: 'd', week: 'wk', weeks: 'wk', byte: 'b', bytes: 'b',
};
const unit = (u) => { const x = String(u || '').toLowerCase().replace(/[°\s]/g, ''); return ALIAS[x] || x; };

function convert(value, from, to) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw httpError(400, 'value must be a number');
  const f = unit(from), t = unit(to);
  const round = (n) => Number(n.toPrecision(10));
  const temps = ['c', 'f', 'k'];
  if (temps.includes(f) && temps.includes(t)) {
    const c = f === 'c' ? v : f === 'f' ? ((v - 32) * 5) / 9 : v - 273.15;
    const out = t === 'c' ? c : t === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
    return { value: v, from: f, to: t, result: round(out), category: 'temperature' };
  }
  for (const [category, table] of Object.entries(UNITS)) {
    if (table[f] != null && table[t] != null) return { value: v, from: f, to: t, result: round((v * table[f]) / table[t]), category };
  }
  throw httpError(400, `I can't convert ${from} to ${to}. Try units like km, mi, kg, lb, c, f, l, gal, mb, gb`);
}

// ------------------------------------------------------------------ weather
const WMO = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };

function createTools({ env = process.env, fetchImpl = (...a) => fetch(...a), complete, qr } = {}) {
  const wxCache = ttlCache(600000, 200);
  const fxCache = ttlCache(3600000, 60);
  const call = (url, opts = {}) => request(url, { fetchImpl, timeoutMs: 15000, ...opts });

  async function weather(city) {
    const name = String(city || '').trim().slice(0, 80);
    if (!name) throw httpError(400, 'city is required, for example city=Lagos');
    const key = name.toLowerCase();
    const hit = wxCache.get(key);
    if (hit) return hit;
    const geo = await call(`${env.GEOCODE_URL || 'https://geocoding-api.open-meteo.com/v1/search'}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
    const p = geo?.results?.[0];
    if (!p) throw httpError(404, `I could not find "${name}"`);
    const w = await call(`${env.WEATHER_URL || 'https://api.open-meteo.com/v1/forecast'}?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`);
    const c = w.current || {};
    const d = w.daily || {};
    const out = {
      city: p.name, country: p.country, latitude: p.latitude, longitude: p.longitude,
      current: { temp_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity: c.relative_humidity_2m, wind_kmh: c.wind_speed_10m, condition: WMO[c.weather_code] || 'Unknown' },
      daily: (d.time || []).map((date, k) => ({ date, condition: WMO[d.weather_code?.[k]] || 'Unknown', max_c: d.temperature_2m_max?.[k], min_c: d.temperature_2m_min?.[k], rain_chance: d.precipitation_probability_max?.[k] })),
    };
    wxCache.set(key, out);
    return out;
  }

  async function currency({ from = 'USD', to, amount = 1 }) {
    const base = String(from).toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(base)) throw httpError(400, 'from must be a 3-letter currency code, for example USD');
    const amt = Number(amount);
    if (!Number.isFinite(amt)) throw httpError(400, 'amount must be a number');
    let data = fxCache.get(base);
    if (!data) {
      data = await call(`${env.CURRENCY_URL || 'https://open.er-api.com/v6/latest'}/${base}`);
      if (data?.result !== 'success' || !data.rates) throw httpError(502, 'The exchange rate service is not answering');
      fxCache.set(base, data);
    }
    const wanted = (to ? String(to).split(',') : ['USD', 'NGN', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR']).map((x) => x.toUpperCase().trim()).filter((x) => x && x !== base);
    const rates = {};
    for (const code of wanted) {
      if (data.rates[code] == null) throw httpError(400, `I don't know the currency ${code}`);
      rates[code] = { rate: data.rates[code], result: Number((amt * data.rates[code]).toFixed(4)) };
    }
    const out = { from: base, amount: amt, updated: data.time_last_update_utc, rates };
    if (wanted.length === 1) { out.to = wanted[0]; out.rate = rates[wanted[0]].rate; out.result = rates[wanted[0]].result; }
    return out;
  }

  async function shorten(url) {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { throw httpError(400, 'url must be a full link, for example https://example.com/page'); }
    if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) throw httpError(400, 'That link is not allowed');
    const enc = encodeURIComponent(u.toString());
    const errors = [];
    try {
      const j = await call(`${env.ISGD_URL || 'https://is.gd/create.php'}?format=json&url=${enc}`);
      if (j?.shorturl) return { short: j.shorturl, original: u.toString(), provider: 'is.gd' };
      errors.push(j?.errormessage || 'is.gd failed');
    } catch (e) { errors.push(`is.gd ${e.message}`); }
    try {
      const t = String(await call(`${env.TINYURL_URL || 'https://tinyurl.com/api-create.php'}?url=${enc}`, { expect: 'text' })).trim();
      if (/^https?:\/\//.test(t)) return { short: t, original: u.toString(), provider: 'tinyurl' };
      errors.push('tinyurl failed');
    } catch (e) { errors.push(`tinyurl ${e.message}`); }
    throw httpError(502, `Could not shorten that link (${errors.join('; ')})`);
  }

  function timeIn(tz = 'UTC') {
    const zone = String(tz || 'UTC').trim();
    try {
      const now = new Date();
      const parts = (opts) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts }).formatToParts(now).map((p) => [p.type, p.value]));
      const p = parts({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long' });
      const off = parts({ timeZoneName: 'shortOffset' }).timeZoneName;
      return { tz: zone, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`, weekday: p.weekday, utc_offset: off, utc: now.toISOString() };
    } catch { throw httpError(400, 'Unknown time zone. Use a name like Africa/Lagos or Europe/London'); }
  }

  async function qrImage({ text, size = 512, format = 'png' }) {
    const t = String(text || '');
    if (!t) throw httpError(400, 'text is required, for example text=https://example.com');
    if (t.length > 1000) throw httpError(400, 'text is too long (max 1000 characters)');
    const lib = qr || (() => { try { return require('qrcode'); } catch { return null; } })();
    if (!lib) throw httpError(501, 'QR codes are not installed on this server (add "qrcode" to package.json)');
    const width = Math.min(1024, Math.max(128, Number(size) || 512));
    if (String(format).toLowerCase() === 'svg') return { body: await lib.toString(t, { type: 'svg', margin: 2 }), contentType: 'image/svg+xml' };
    return { body: await lib.toBuffer(t, { width, margin: 2, errorCorrectionLevel: 'M' }), contentType: 'image/png' };
  }

  async function translate(text, to) {
    const t = String(text || '').trim();
    const lang = String(to || '').trim().slice(0, 40);
    if (!t || !lang) throw httpError(400, 'text and to are required, for example text=Good morning&to=french');
    if (t.length > 3000) throw httpError(400, 'text is too long (max 3000 characters)');
    if (!complete) throw httpError(503, 'Translation is not available');
    const out = await complete([
      { role: 'system', content: 'You are a professional translator. Reply with the translation only: no notes, no quotes, no explanations.' },
      { role: 'user', content: `Translate the following text into ${lang}:\n\n${t}` },
    ], { temperature: 0.2 });
    return { to: lang, translation: String(out).trim() };
  }

  const cache60 = { 'Cache-Control': 'public, max-age=60' };
  const routes = [
    { method: 'get', path: '/tools', access: 'public', handler: async () => ({ json: { tools: [
      { path: '/tools/qr', example: '/tools/qr?text=https://example.com&size=512' },
      { path: '/tools/weather', example: '/tools/weather?city=Lagos' },
      { path: '/tools/currency', example: '/tools/currency?from=USD&to=NGN&amount=100' },
      { path: '/tools/shorten', example: '/tools/shorten?url=https://example.com/long/link' },
      { path: '/tools/calc', example: '/tools/calc?expr=2*(3%2B4)^2' },
      { path: '/tools/convert', example: '/tools/convert?value=5&from=km&to=mi' },
      { path: '/tools/time', example: '/tools/time?tz=Africa/Lagos' },
      { path: '/tools/translate', example: '/tools/translate?text=Good morning&to=french', needsKey: true },
    ] } }) },
    { method: 'get', path: '/tools/qr', access: 'public', handler: async (c) => ({ ...(await qrImage(c.query)), headers: { 'Cache-Control': 'public, max-age=86400' } }) },
    { method: 'get', path: '/tools/weather', access: 'public', handler: async (c) => ({ json: await weather(c.query.city || c.query.q), headers: cache60 }) },
    { method: 'get', path: '/tools/currency', access: 'public', handler: async (c) => ({ json: await currency(c.query), headers: cache60 }) },
    { method: ['get', 'post'], path: '/tools/shorten', access: 'public', handler: async (c) => ({ json: await shorten(c.query.url || c.body.url) }) },
    { method: ['get', 'post'], path: '/tools/calc', access: 'public', handler: async (c) => {
        const src = { ...c.query, ...c.body };
        const expression = src.expr || src.q;
        return { json: { expression, result: calculate(expression, { deg: String(src.mode || '').toLowerCase() === 'deg' }) } };
      } },
    { method: 'get', path: '/tools/convert', access: 'public', handler: async (c) => ({ json: convert(c.query.value, c.query.from, c.query.to) }) },
    { method: 'get', path: '/tools/time', access: 'public', handler: async (c) => ({ json: timeIn(c.query.tz) }) },
    { method: ['get', 'post'], path: '/tools/translate', access: 'key', handler: async (c) => {
        const src = { ...c.query, ...c.body };
        return { json: await translate(src.text, src.to) };
      } },
  ];

  return { routes, weather, currency, shorten, timeIn, qrImage, translate, calculate, convert };
}

module.exports = { createTools, calculate, convert };
