# מחצית השקל - מחשבון בזמן אמת

אפליקציית ווב פשוטה (עמוד אחד) שמחשבת את שווי מחצית השקל בש"ח לפי:
- 9.6 גרם כסף טהור.
- מחיר כסף עדכני לאונקיית טרוי (USD).
- שער דולר/שקל עדכני.

## הרצה

```bash
npm install
npm start
```

לשימוש בספק שער דולר/שקל בתדירות גבוהה יותר (`Twelve Data`), אפשר להגדיר מפתח:

```bash
TWELVE_DATA_API_KEY=your_key_here npm start
```

אחר כך לפתוח בדפדפן:

- `http://localhost:3000`

## איך זה עובד

- השרת מריץ endpoint: `GET /api/half-shekel`
- בכל בקשה הוא מושך מחיר כסף ושער דולר/שקל מספקי API חיצוניים.
- יש מספר ספקים כגיבוי (fallback) לכל נתון.
- הלקוח מרענן אוטומטית כל דקה, עם כפתור רענון ידני.

## נוסחת חישוב

- אונקיות למחצית השקל: `9.6 / 31.1034768`
- מחיר מחצית השקל בדולר: `ounces * silver_usd_per_ounce`
- מחיר מחצית השקל בש"ח: `half_shekel_usd * usd_ils`

## פריסה (גישה מכל מחשב)

### אפשרות 1: Render (מומלץ ופשוט)

1. מעלים את הפרויקט ל־GitHub.
2. נכנסים ל־Render ובוחרים `New +` ואז `Blueprint`.
3. מחברים את הריפו ומאשרים יצירה לפי `render.yaml`.
4. אחרי הפריסה מתקבל URL ציבורי (`https://...onrender.com`) שנגיש מכל דפדפן.
5. אופציונלי: מגדירים משתנה סביבה `TWELVE_DATA_API_KEY` בתוך Render.

### אפשרות 2: Docker (לכל ספק שמריץ קונטיינרים)

Build:
```bash
docker build -t half-shekel-app .
```

Run:
```bash
docker run -p 3000:3000 --name half-shekel-app half-shekel-app
```

עם מפתח Twelve Data:
```bash
docker run -p 3000:3000 -e TWELVE_DATA_API_KEY=your_key_here --name half-shekel-app half-shekel-app
```
