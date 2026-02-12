# מחצית השקל - מחשבון בזמן אמת

## מטרת הריפו

אפליקציית ווב שמחשבת את שווי מחצית השקל בש"ח לפי מחיר כסף עדכני ושער דולר/שקל.

## הרצה

```bash
npm install
npm start
```

פתיחה בדפדפן: `http://localhost:3000`

## מקורות נתונים

- כסף (XAG/USD): `gold-api.com`, `metals.live`, `stooq.com` (עם fallback).
- דולר/שקל (USD/ILS): `frankfurter.app`, `open.er-api.com`, `exchangerate.host` (עם fallback).

## פריסה

### Render

1. מעלים את הפרויקט ל־GitHub.
2. נכנסים ל־Render ובוחרים `New +` ואז `Blueprint`.
3. מחברים את הריפו ומאשרים יצירה לפי `render.yaml`.
4. אחרי הפריסה מתקבל URL ציבורי (`https://...onrender.com`) שנגיש מכל דפדפן.

### Docker

Build:
```bash
docker build -t half-shekel-app .
```

Run:
```bash
docker run -p 3000:3000 --name half-shekel-app half-shekel-app
```
