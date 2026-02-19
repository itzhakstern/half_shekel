import http from 'node:http';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const visitStatsFile = path.join(dataDir, 'visit-stats.json');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SILVER_GRAMS = 9;
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const HALF_SHEKEL_TROY_OUNCES = SILVER_GRAMS / GRAMS_PER_TROY_OUNCE;
const VAT_RATE = 0.18;
const ADMIN_STATS_TOKEN = process.env.ADMIN_STATS_TOKEN || '';

const FIVE_SECONDS = 5_000;
const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const EMPTY_VISIT_STATS = Object.freeze({
  totalVisits: 0,
  firstVisitAt: null,
  lastVisitAt: null,
  totalDonationClicks: 0,
  firstDonationClickAt: null,
  lastDonationClickAt: null,
  updatedAt: null
});

let visitStats = { ...EMPTY_VISIT_STATS };
let visitStatsLoadPromise = null;

function colorize(text, color) {
  if (process.env.NO_COLOR) return text;
  return `${color}${text}${ANSI_RESET}`;
}

function logAnalyticsEvent(type, message, color) {
  const prefix = colorize(`[analytics:${type}]`, color);
  console.log(`${prefix} ${message}`);
}

function normalizeVisitStats(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_VISIT_STATS };
  }

  const totalVisits = Number(raw.totalVisits);
  const totalDonationClicks = Number(raw.totalDonationClicks);
  return {
    totalVisits: Number.isFinite(totalVisits) && totalVisits >= 0 ? Math.floor(totalVisits) : 0,
    firstVisitAt: typeof raw.firstVisitAt === 'string' ? raw.firstVisitAt : null,
    lastVisitAt: typeof raw.lastVisitAt === 'string' ? raw.lastVisitAt : null,
    totalDonationClicks:
      Number.isFinite(totalDonationClicks) && totalDonationClicks >= 0 ? Math.floor(totalDonationClicks) : 0,
    firstDonationClickAt: typeof raw.firstDonationClickAt === 'string' ? raw.firstDonationClickAt : null,
    lastDonationClickAt: typeof raw.lastDonationClickAt === 'string' ? raw.lastDonationClickAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
  };
}

async function loadVisitStats() {
  if (!visitStatsLoadPromise) {
    visitStatsLoadPromise = (async () => {
      await mkdir(dataDir, { recursive: true });
      try {
        const saved = await readFile(visitStatsFile, 'utf8');
        const parsed = JSON.parse(saved);
        visitStats = normalizeVisitStats(parsed);
      } catch (error) {
        if (error && error.code !== 'ENOENT') {
          console.error('[analytics] Failed to read visit stats:', error);
        }
        visitStats = { ...EMPTY_VISIT_STATS };
      }
    })();
  }

  await visitStatsLoadPromise;
}

async function persistVisitStats() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(visitStatsFile, `${JSON.stringify(visitStats, null, 2)}\n`, 'utf8');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function shouldTrackVisit(req, pathname) {
  if (req.method !== 'GET') return false;
  if (pathname !== '/' && pathname !== '/index.html') return false;

  const accept = req.headers.accept;
  if (typeof accept === 'string' && !accept.includes('text/html')) return false;

  return true;
}

async function trackVisit(req) {
  await loadVisitStats();

  const now = new Date().toISOString();
  visitStats.totalVisits += 1;
  visitStats.lastVisitAt = now;
  visitStats.updatedAt = now;
  if (!visitStats.firstVisitAt) {
    visitStats.firstVisitAt = now;
  }

  await persistVisitStats();
  logAnalyticsEvent('visit', `#${visitStats.totalVisits} from ${getClientIp(req)}`, ANSI_GREEN);
}

async function trackDonationClick(req) {
  await loadVisitStats();

  const now = new Date().toISOString();
  visitStats.totalDonationClicks += 1;
  visitStats.lastDonationClickAt = now;
  visitStats.updatedAt = now;
  if (!visitStats.firstDonationClickAt) {
    visitStats.firstDonationClickAt = now;
  }

  await persistVisitStats();
  logAnalyticsEvent('donation-click', `#${visitStats.totalDonationClicks} from ${getClientIp(req)}`, ANSI_RED);
}

function secureEquals(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim();
}

function getQueryToken(req) {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const token = reqUrl.searchParams.get('token');
  if (typeof token !== 'string') return null;
  const normalized = token.trim();
  return normalized || null;
}

function isAuthorizedForVisitStats(req) {
  if (!ADMIN_STATS_TOKEN) return false;
  const providedToken = getBearerToken(req) || getQueryToken(req);
  if (!providedToken) return false;
  return secureEquals(providedToken, ADMIN_STATS_TOKEN);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIVE_SECONDS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Half-Shekel-App/1.0',
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIVE_SECONDS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Half-Shekel-App/1.0',
        Accept: 'text/plain,text/csv,*/*'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function toIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function getProviderUpdatedAt(...candidates) {
  for (const candidate of candidates) {
    const iso = toIsoTimestamp(candidate);
    if (iso) return iso;
  }

  return new Date().toISOString();
}

function normalizeNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;

  const raw = value.trim();
  if (!raw) return Number.NaN;

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma && hasDot) {
    return Number(raw.replaceAll(',', ''));
  }

  if (hasComma) {
    return Number(raw.replace(',', '.'));
  }

  return Number(raw);
}

function parseBoiRepresentativeUsdIls(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('empty Bank of Israel XML');
  }

  const usdBlockMatch = xml.match(
    /<CURRENCY>([\s\S]*?<CURRENCYCODE>\s*USD\s*<\/CURRENCYCODE>[\s\S]*?)<\/CURRENCY>/i
  );
  if (!usdBlockMatch) {
    throw new Error('USD currency block missing in Bank of Israel XML');
  }

  const usdBlock = usdBlockMatch[1];
  const rateText = usdBlock.match(/<RATE>\s*([^<]+)\s*<\/RATE>/i)?.[1];
  const rate = normalizeNumber(rateText);
  if (!Number.isFinite(rate)) {
    throw new Error('USD representative rate missing in Bank of Israel XML');
  }

  const lastUpdate = xml.match(/<LAST_UPDATE>\s*([^<]+)\s*<\/LAST_UPDATE>/i)?.[1];
  return { rate, lastUpdate };
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseBoiEdgeRepresentativeUsdIls(csv) {
  if (typeof csv !== 'string' || !csv.trim()) {
    throw new Error('empty BOI edge CSV');
  }

  const lines = csv
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('unexpected BOI edge CSV response');
  }

  const header = parseCsvLine(lines[0]).map((value) => value.toUpperCase());
  const row = parseCsvLine(lines[lines.length - 1]);

  const valueIndex = header.findIndex((name) => /(OBS_VALUE|VALUE|RATE)/.test(name));
  const dateIndex = header.findIndex((name) => /(TIME_PERIOD|DATE|TIME)/.test(name));

  let rate = Number.NaN;
  if (valueIndex >= 0 && valueIndex < row.length) {
    rate = normalizeNumber(row[valueIndex]);
  }

  if (!Number.isFinite(rate)) {
    for (let i = row.length - 1; i >= 0; i -= 1) {
      const candidate = normalizeNumber(row[i]);
      if (Number.isFinite(candidate)) {
        rate = candidate;
        break;
      }
    }
  }

  if (!Number.isFinite(rate)) {
    throw new Error('USD representative rate missing in BOI edge CSV');
  }

  const lastUpdate = dateIndex >= 0 && dateIndex < row.length ? row[dateIndex] : null;
  return { rate, lastUpdate };
}

function parseBoiPublicApiRepresentativeUsdIls(data) {
  const rates = Array.isArray(data?.exchangeRates) ? data.exchangeRates : [];
  const usd = rates.find((item) => item?.key === 'USD');
  const rate = normalizeNumber(usd?.currentExchangeRate);
  if (!Number.isFinite(rate)) {
    throw new Error('USD representative rate missing in BOI PublicApi response');
  }

  return { rate, lastUpdate: usd?.lastUpdate };
}

async function getSilverUsdPerOunce() {
  const providers = [
    async () => {
      const csv = await fetchText('https://stooq.com/q/l/?s=xagusd&i=5');
      const lines = csv
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        throw new Error('unexpected stooq response');
      }

      // Stooq may return either one data row or header + data row.
      const dataRow = lines[lines.length - 1];
      const values = dataRow.split(',');
      const close = Number(values[6]);
      if (!Number.isFinite(close)) {
        throw new Error('stooq close missing');
      }

      return { value: close, source: 'stooq.com', fetchedAt: new Date().toISOString() };
    },
    async () => {
      const data = await fetchJson('https://api.gold-api.com/price/XAG');
      if (typeof data.price !== 'number') {
        throw new Error('price not found');
      }
      return { value: data.price, source: 'gold-api.com', fetchedAt: new Date().toISOString() };
    },
    async () => {
      const data = await fetchJson('https://api.metals.live/v1/spot');
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('unexpected metals.live response');
      }

      const latest = data[0];
      const value = Number(latest.silver);
      if (!Number.isFinite(value)) {
        throw new Error('silver value missing');
      }

      return { value, source: 'metals.live', fetchedAt: new Date().toISOString() };
    }
  ];

  const errors = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Failed to fetch silver price. ${errors.join(' | ')}`);
}

async function getUsdIlsRate() {
  const providers = [
    async () => {
      const publicApiUrls = [
        'https://www.boi.org.il/PublicApi/GetExchangeRates',
        'https://boi.org.il/PublicApi/GetExchangeRates'
      ];

      const publicApiErrors = [];
      for (const url of publicApiUrls) {
        try {
          const data = await fetchJson(url);
          const { rate, lastUpdate } = parseBoiPublicApiRepresentativeUsdIls(data);
          return {
            value: rate,
            source: 'Bank of Israel Public API (representative)',
            fetchedAt: getProviderUpdatedAt(lastUpdate)
          };
        } catch (error) {
          publicApiErrors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`Bank of Israel Public API provider failed. ${publicApiErrors.join(' | ')}`);
    },
    async () => {
      const boiUrls = [
        'https://www.boi.org.il/currency.xml?curr=01',
        'https://www.boi.org.il/currency.xml',
        'https://boi.org.il/currency.xml?curr=01',
        'https://boi.org.il/currency.xml'
      ];

      const boiErrors = [];
      for (const url of boiUrls) {
        try {
          const xml = await fetchText(url);
          const { rate, lastUpdate } = parseBoiRepresentativeUsdIls(xml);
          return {
            value: rate,
            source: 'Bank of Israel XML (representative)',
            fetchedAt: getProviderUpdatedAt(lastUpdate)
          };
        } catch (error) {
          boiErrors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`Bank of Israel XML provider failed. ${boiErrors.join(' | ')}`);
    },
    async () => {
      const edgeUrls = [
        'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?lastNObservations=1&format=csv',
        'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?lastNObservations=1&format=csv'
      ];

      const edgeErrors = [];
      for (const url of edgeUrls) {
        try {
          const csv = await fetchText(url);
          const { rate, lastUpdate } = parseBoiEdgeRepresentativeUsdIls(csv);
          return {
            value: rate,
            source: 'Bank of Israel edge API (representative)',
            fetchedAt: getProviderUpdatedAt(lastUpdate)
          };
        } catch (error) {
          edgeErrors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      throw new Error(`Bank of Israel edge provider failed. ${edgeErrors.join(' | ')}`);
    },
    async () => {
      const data = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=ILS');
      const rate = data?.rates?.ILS;
      if (!Number.isFinite(rate)) {
        throw new Error('ILS rate missing');
      }
      return { value: rate, source: 'frankfurter.app', fetchedAt: getProviderUpdatedAt(data?.date) };
    },
    async () => {
      const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
      const rate = data?.rates?.ILS;
      if (!Number.isFinite(rate)) {
        throw new Error('ILS rate missing');
      }
      return {
        value: rate,
        source: 'open.er-api.com',
        fetchedAt: getProviderUpdatedAt(data?.time_last_update_unix, data?.time_last_update_utc)
      };
    },
    async () => {
      const data = await fetchJson('https://api.exchangerate.host/live?source=USD&currencies=ILS');
      const rate = data?.quotes?.USDILS;
      if (!Number.isFinite(rate)) {
        throw new Error('USDILS quote missing');
      }
      return { value: rate, source: 'exchangerate.host', fetchedAt: getProviderUpdatedAt(data?.timestamp) };
    }
  ];

  const errors = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Failed to fetch USD/ILS rate. ${errors.join(' | ')}`);
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function html(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(value);
}

function text(res, status, value, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300'
  });
  res.end(value);
}

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' && forwardedProto ? forwardedProto.split(',')[0].trim() : 'https';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function serveFile(req, res) {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const requestPath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const safePath = path.normalize(requestPath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname.replace(/\/+$/, '') || '/';

    if (shouldTrackVisit(req, pathname)) {
      try {
        await trackVisit(req);
      } catch (error) {
        console.error('[analytics] Failed to track visit:', error);
      }
    }

    if (pathname === '/robots.txt' && req.method === 'GET') {
      const baseUrl = getBaseUrl(req);
      const robots = `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
      text(res, 200, robots, 'text/plain; charset=utf-8');
      return;
    }

    if (pathname === '/sitemap.xml' && req.method === 'GET') {
      const baseUrl = getBaseUrl(req);
      const now = new Date().toISOString();
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${baseUrl}/</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
      text(res, 200, sitemap, 'application/xml; charset=utf-8');
      return;
    }

    if (pathname === '/api/half-shekel' && req.method === 'GET') {
      const [silver, usdIls] = await Promise.all([getSilverUsdPerOunce(), getUsdIlsRate()]);

      const halfShekelUsd = silver.value * HALF_SHEKEL_TROY_OUNCES;
      const halfShekelIlsNoVat = halfShekelUsd * usdIls.value;
      const halfShekelIlsWithVat = halfShekelIlsNoVat * (1 + VAT_RATE);

      json(res, 200, {
        success: true,
        updatedAt: new Date().toISOString(),
        constants: {
          silverGrams: SILVER_GRAMS,
          gramsPerTroyOunce: GRAMS_PER_TROY_OUNCE,
          troyOunces: HALF_SHEKEL_TROY_OUNCES,
          vatRate: VAT_RATE
        },
        market: {
          silverUsdPerOunce: silver.value,
          usdIls: usdIls.value,
          updatedAt: {
            silver: silver.fetchedAt,
            usdIls: usdIls.fetchedAt
          },
          sources: {
            silver: silver.source,
            usdIls: usdIls.source
          }
        },
        result: {
          halfShekelUsd,
          halfShekelIlsNoVat,
          halfShekelIlsWithVat
        }
      });
      return;
    }

    if (pathname === '/api/visits' && req.method === 'GET') {
      if (!isAuthorizedForVisitStats(req)) {
        // Hide the endpoint unless a valid admin token is provided.
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      await loadVisitStats();
      json(res, 200, {
        success: true,
        visits: visitStats
      });
      return;
    }

    if (pathname === '/api/donation-click' && req.method === 'POST') {
      try {
        await trackDonationClick(req);
      } catch (error) {
        console.error('[analytics] Failed to track donation click:', error);
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/admin/visits' && req.method === 'GET') {
      if (!isAuthorizedForVisitStats(req)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const page = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>סטטיסטיקות אתר</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f2f5f3; color: #123; }
      main { max-width: 760px; margin: 28px auto; padding: 0 16px; }
      .card { background: #fff; border: 1px solid #d8e2dc; border-radius: 14px; padding: 18px; }
      h1 { margin: 0 0 16px; font-size: 1.4rem; }
      h2 { margin: 0 0 14px; font-size: 1.08rem; color: #28443a; }
      .cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .item { border: 1px solid #e2e8e4; border-radius: 10px; padding: 12px; background: #fafcfa; }
      .label { margin: 0; color: #50645a; font-size: 0.88rem; }
      .value { margin: 8px 0 0; font-size: 1.1rem; font-weight: 700; }
      .value--accent { color: #0f766e; }
      .actions { margin-top: 14px; text-align: center; }
      button { border: none; border-radius: 999px; padding: 10px 14px; background: #0f766e; color: #fff; font-weight: 700; cursor: pointer; }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <h1>סטטיסטיקות אתר</h1>
      <div class="cards">
        <section class="card">
          <h2>כניסות לאתר</h2>
          <div class="grid">
            <article class="item"><p class="label">סה"כ כניסות</p><p id="total" class="value">--</p></article>
            <article class="item"><p class="label">כניסה ראשונה</p><p id="first" class="value">--</p></article>
            <article class="item"><p class="label">כניסה אחרונה</p><p id="last" class="value">--</p></article>
            <article class="item"><p class="label">עדכון אחרון</p><p id="updated" class="value">--</p></article>
          </div>
        </section>
        <section class="card">
          <h2>לחיצות על תרומה</h2>
          <div class="grid">
            <article class="item"><p class="label">סה"כ לחיצות</p><p id="donation-total" class="value value--accent">--</p></article>
            <article class="item"><p class="label">לחיצה ראשונה</p><p id="donation-first" class="value">--</p></article>
            <article class="item"><p class="label">לחיצה אחרונה</p><p id="donation-last" class="value">--</p></article>
          </div>
        </section>
      </div>
      <section class="actions">
        <button id="refresh-btn" type="button">רענון</button>
      </section>
    </main>
    <script>
      const els = {
        total: document.getElementById('total'),
        first: document.getElementById('first'),
        last: document.getElementById('last'),
        donationTotal: document.getElementById('donation-total'),
        donationFirst: document.getElementById('donation-first'),
        donationLast: document.getElementById('donation-last'),
        updated: document.getElementById('updated'),
        refreshBtn: document.getElementById('refresh-btn')
      };

      function format(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
      }

      async function loadStats() {
        const token = new URL(window.location.href).searchParams.get('token') || '';
        if (!token) {
          return;
        }

        els.refreshBtn.disabled = true;
        try {
          const response = await fetch('/api/visits?token=' + encodeURIComponent(token), { cache: 'no-store' });
          if (!response.ok) throw new Error('הגישה נדחתה או שהנתונים לא זמינים');
          const data = await response.json();
          const visits = data?.visits || {};
          els.total.textContent = String(visits.totalVisits ?? '--');
          els.first.textContent = format(visits.firstVisitAt);
          els.last.textContent = format(visits.lastVisitAt);
          els.donationTotal.textContent = String(visits.totalDonationClicks ?? '--');
          els.donationFirst.textContent = format(visits.firstDonationClickAt);
          els.donationLast.textContent = format(visits.lastDonationClickAt);
          els.updated.textContent = format(visits.updatedAt);
        } catch (error) {
          console.error('[admin-visits] Failed to load stats:', error);
        } finally {
          els.refreshBtn.disabled = false;
        }
      }

      els.refreshBtn.addEventListener('click', loadStats);
      loadStats();
    </script>
  </body>
</html>`;

      html(res, 200, page);
      return;
    }

    await serveFile(req, res);
  } catch (error) {
    json(res, 500, {
      success: false,
      error: 'Unable to load market data right now. Please try again in a minute.',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Half-shekel app running on http://${HOST}:${PORT}`);
});
