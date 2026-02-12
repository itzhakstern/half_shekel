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
- USD/ILS: `frankfurter.app`, `open.er-api.com`, `exchangerate.host` (with fallback).

## Deployment

Build:
```bash
docker build -t half-shekel-app .
```

Run:
```bash
docker run -p 3000:3000 --name half-shekel-app half-shekel-app
```
