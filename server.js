import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SILVER_GRAMS = 9;
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const HALF_SHEKEL_TROY_OUNCES = SILVER_GRAMS / GRAMS_PER_TROY_OUNCE;
const VAT_RATE = 0.18;

const FIVE_SECONDS = 5_000;

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
