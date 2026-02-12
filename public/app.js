const REFRESH_INTERVAL_MS = 60_000;

const els = {
  ilsValueNoVat: document.getElementById('ils-value-no-vat'),
  ilsValueWithVat: document.getElementById('ils-value-with-vat'),
  silverValue: document.getElementById('silver-value'),
  silverIlsValue: document.getElementById('silver-ils-value'),
  usdIlsValue: document.getElementById('usd-ils-value'),
  vatFootnote: document.getElementById('vat-footnote'),
  statusText: document.getElementById('status-text'),
  refreshBtn: document.getElementById('refresh-btn')
};
let isLoading = false;

function formatMoney(value, currency, digits = 2) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatNumber(value, digits = 4) {
  return new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHalfShekelWithRetry(maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch('/api/half-shekel', { cache: 'no-store' });
      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }

      if (!response.ok || !data.success) {
        const details = data?.details ? ` (${data.details})` : '';
        throw new Error((data?.error || 'Failed to load') + details);
      }

      return data;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(900);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadHalfShekel() {
  if (isLoading) return;
  isLoading = true;
  els.refreshBtn.disabled = true;
  els.statusText.textContent = 'מעדכן נתונים מהשוק...';

  try {
    const data = await fetchHalfShekelWithRetry(3);

    els.ilsValueNoVat.textContent = formatMoney(data.result.halfShekelIlsNoVat, 'ILS', 2);
    els.ilsValueWithVat.textContent = formatMoney(data.result.halfShekelIlsWithVat, 'ILS', 2);
    els.silverValue.textContent = `${formatMoney(data.market.silverUsdPerOunce, 'USD', 3)} לאונקיה`;
    els.silverIlsValue.textContent = `(כ-${formatMoney(data.market.silverUsdPerOunce * data.market.usdIls, 'ILS', 2)} לאונקיה)`;
    els.usdIlsValue.textContent = `${formatNumber(data.market.usdIls, 4)} ₪`;
    els.vatFootnote.textContent = `לחומרא, כולל מע"מ לפי החוק (${formatNumber(data.constants.vatRate * 100, 0)}%).`;
    els.statusText.textContent = `עודכן לאחרונה: ${formatTime(data.updatedAt)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    els.statusText.textContent = `לא הצלחנו למשוך נתונים כרגע: ${message}`;
    els.ilsValueNoVat.textContent = '--';
    els.ilsValueWithVat.textContent = '--';
    els.silverIlsValue.textContent = '(--)';
  } finally {
    isLoading = false;
    els.refreshBtn.disabled = false;
  }
}

els.refreshBtn.addEventListener('click', loadHalfShekel);

loadHalfShekel();
setInterval(loadHalfShekel, REFRESH_INTERVAL_MS);
