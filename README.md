# Half Shekel Value Calculator

## Repository Purpose

A web app that calculates the Half Shekel value in ILS based on the live silver price and USD/ILS exchange rate.

## Run Locally

```bash
npm install
npm start
```

Open in browser: `http://localhost:3000`

## Data Sources

- Silver (XAG/USD): `gold-api.com`, `metals.live`, `stooq.com` (with fallback).
- USD/ILS: `Bank of Israel Public API (representative)`, `Bank of Israel XML (representative)`, `Bank of Israel edge API (representative)`, `frankfurter.app`, `open.er-api.com`, `exchangerate.host` (with fallback).

## Visit Tracking (Simple Logs)

- Home page visits are counted server-side (`GET /` and `GET /index.html`).
- Counter is persisted in `data/visit-stats.json`.
- Each visit is also logged to stdout (example: `[analytics] Visit #12 from 1.2.3.4`).
- `GET /api/visits` is protected and available only with admin token auth:
  - Set env var: `ADMIN_STATS_TOKEN=<your-secret-token>`
  - Send header: `Authorization: Bearer <your-secret-token>`
  - Example: `curl -H "Authorization: Bearer $ADMIN_STATS_TOKEN" http://localhost:3000/api/visits`
  - Without a valid token, endpoint returns `404`.
- Browser page (shareable with tokenized URL):
  - `https://<your-domain>/admin/visits?token=<your-secret-token>`

## Deployment

Build:
```bash
docker build -t half-shekel-app .
```

Run:
```bash
docker run -p 3000:3000 --name half-shekel-app half-shekel-app
```
