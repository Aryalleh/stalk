# سایت روی Cloudflare، ورودی از سرور ایران (پراکسی)

Cloudflare از داخل ایران فیلتر است، ولی سرور شما به Worker دسترسی دارد. پس سایت همان‌جا روی Cloudflare می‌ماند و
فقط یک **پراکسی** روی سرور ایران گذاشته می‌شود:

```
بازدیدکننده ← kadochie.ir (سرور ایران، Caddy) ← gift-shop.….workers.dev (Cloudflare)
```

همه چیز مثل قبل روی Cloudflare کار می‌کند و هیچ داده‌ای جابه‌جا نمی‌شود:

- D1، R2
- کار روزانه
- تلگرام و اینستاگرام (درخواست‌هایشان از Cloudflare می‌رود، نه از ایران)

Worker فقط درخواست‌هایی را که با **رمز مشترک** (`PROXY_SECRET`) از پراکسی خودتان می‌آیند با آدرس اصلی سایت
(`kadochie.ir`) پردازش می‌کند. بقیه درخواست‌ها مثل قبل پردازش می‌شوند. اگر رمز اشتباه باشد، درخواست رد می‌شود.

## راه‌اندازی

1. **کد را منتشر کنید** (روی لپ‌تاپ):

   ```bash
   npm run deploy
   ```

2. **روی سرور ایران** (Ubuntu 22.04+ یا Debian 12):

   ```bash
   scp deploy/proxy/install.sh root@SERVER_IP:
   ssh root@SERVER_IP
   sudo bash install.sh kadochie.ir gift-shop.m-cyber-warrior.workers.dev
   ```

   اگر nginx روی سرور باشد از همان استفاده می‌کند (HTTPS با certbot؛ بعد از تغییر DNS اسکریپت را دوباره اجرا کنید)، وگرنه Caddy را نصب می‌کند. در آخر یک رمز (`PROXY_SECRET`) چاپ می‌کند و نشان می‌دهد که سرور به Worker دسترسی دارد یا نه.

3. **رمز را روی Worker بگذارید** (روی لپ‌تاپ). این مرحله باید **قبل** از مرحله ۴ انجام شود:

   ```bash
   npx wrangler secret put PROXY_SECRET
   ```

   بعد رمزی را که اسکریپت چاپ کرد وارد کنید.

4. **دامنه را به سرور ایران وصل کنید:**

   1. در داشبورد Cloudflare به Workers & Pages ← gift-shop ← Settings ← Domains & Routes بروید و `kadochie.ir` را از
      Custom domains حذف کنید.
   2. در DNS دامنه، یک رکورد A برای `kadochie.ir` به IP سرور ایران بسازید و **Proxy را خاموش (DNS only، ابر خاکستری)** کنید.

   چند دقیقه بعد Caddy گواهی HTTPS را خودش می‌گیرد. برای دیدن نتیجه، اسکریپت را دوباره اجرا کنید.

5. «آدرس اصلی سایت» در `/admin/settings` باید `https://kadochie.ir` بماند.

## نکته‌ها

- **ترتیب مهم است.** اگر دامنه قبل از گذاشتن رمز روی Worker به سرور وصل شود، صفحه‌ها در یک ریدایرکت بی‌پایان گیر می‌کنند.
  کافی است رمز را بگذارید تا درست شود.
- **وب‌هوک‌ها:**
  - وب‌هوک بله، تلگرام و اینستاگرام به `kadochie.ir` اشاره می‌کنند و از همین پراکسی رد می‌شوند.
  - اگر سرور از خارج در دسترس نبود، وب‌هوک‌ها را مستقیم روی آدرس `workers.dev` بگذارید.
  - مسیرهای `/bot/` و `/ig/` روی هر دامنه‌ای جواب می‌دهند.
- **اگر روزی دسترسی سرور به Cloudflare قطع شد:** راه جایگزین اجرای کامل روی سرور خودتان است (`docs/self-hosted.md` در شاخه
  `self-hosted`).
- **بکاپ:** همان قبلی، `npx wrangler d1 export app --remote --output backup.sql`.

## راه دوم: پراکسی روی Edge Computing ابرآروان (بدون سرور)

همان کار nginx، این بار روی لبه آروان: فایل کوچک `deploy/arvan-proxy/proxy.mjs` هر درخواست را با همان رمز
`PROXY_SECRET` به Worker می‌فرستد. Worker تغییری لازم ندارد.

```
بازدیدکننده ← kadochie.ir (CDN و Edge Computing آروان) ← gift-shop.….workers.dev (Cloudflare)
```

### ۱. ساخت فایل

در پوشه پروژه یک فایل `.env.arvan-proxy` بسازید (در git نمی‌رود):

```bash
WORKER_HOST=gift-shop.m-cyber-warrior.workers.dev
PROXY_SECRET=همان-رمزی-که-روی-Worker-گذاشته‌اید
```

رمز فعلی همان مقدار `/etc/gift-shop-proxy/secret` روی سرور ایران است (`sudo cat /etc/gift-shop-proxy/secret`).

```bash
npm run arvan-proxy:build        # → dist/arvan-proxy.js (رمز داخل فایل است؛ جایی منتشرش نکنید)
```

اگر آروان قالب ES Module خواست: `npm run arvan-proxy:build -- --format=esm`.

### ۲. انتشار روی آروان

```bash
arvan ec deploy -f dist/arvan-proxy.js kadochie-proxy
arvan ec list
```

(یا در پنل: Edge Computing ← ساخت اپ ← کد `dist/arvan-proxy.js` را بارگذاری کنید.)

### ۳. وصل کردن دامنه

1. دامنه `kadochie.ir` را در CDN آروان اضافه کنید (اگر نیست) و رکوردها را روی **پروکسی آروان** (ابر روشن) بگذارید.
2. در تنظیمات دامنه، بخش Edge Computing، اپ `kadochie-proxy` را به مسیر `/*` وصل کنید.
3. **کش:** صفحه‌ها شخصی‌اند (ورود، سبد، پنل). در تنظیمات کش آروان حالت «بر اساس هدرهای سرور اصلی» را بگذارید یا کش را برای
   همه مسیرها به‌جز `/static/*` و `/img/*` خاموش کنید.
4. HTTPS دامنه را در آروان فعال کنید.

### ۴. آزمایش

- `https://kadochie.ir/__proxy/health` باید `ok` بدهد.
- `https://kadochie.ir/__proxy/check` زمان رسیدن آروان به Worker را نشان می‌دهد: یک دریافت صفحه (`get`) و یک ارسال
  ۲۰۰ کیلوبایتی (`upload_200kb`). اگر `upload_200kb` خطا یا عدد خیلی بزرگ (چند ده هزار میلی‌ثانیه) داد، آپلود عکس از
  این مسیر هم کند است.
- خطای اتصال به Worker در لاگ اپ آروان با `proxy_error` ثبت می‌شود.

پراکسی nginx روی سرور ایران را تا وقتی آروان را کامل امتحان نکرده‌اید نگه دارید؛ برگشتن فقط عوض کردن رکورد DNS است.
