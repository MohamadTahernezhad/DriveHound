<div dir="rtl">

# راهنمای انتشار DriveHound در GitHub (قدم‌به‌قدم)

این راهنما از صفر تا انتشار نسخه‌ی نصبی روی GitHub را توضیح می‌دهد: ساخت مخزن، آپلود کد، ساخت خودکار فایل نصبی، جذاب‌کردن صفحه‌ی مخزن، و نصب روی سیستم خودتان.

> همه‌ی دستورها را در **PowerShell** و داخل پوشه‌ی پروژه اجرا کنید.
> راه سریع: در File Explorer وارد پوشه‌ی پروژه شوید، در نوار آدرس بنویسید `powershell` و Enter بزنید.

---

## ۰. چه چیزهایی آماده است؟

| مسیر | توضیح |
|---|---|
| `README.md` و `README.en.md` | صفحه‌ی اصلی مخزن به فارسی و انگلیسی، با بنر، نشان‌ها (badge) و اسکرین‌شات |
| `docs/banner.png` و `docs/social-preview.png` | بنر بالای README و تصویری که هنگام اشتراک لینک در تلگرام، توییتر و... دیده می‌شود |
| `docs/screenshots/` | ۱۳ اسکرین‌شات از برنامه و تصویر showcase (اطلاعات شخصی حذف شده) |
| `docs/release-notes/v2.1.0.md` | متن آماده‌ی صفحه‌ی Release |
| `.github/workflows/ci.yml` | با هر push تست‌ها را روی ویندوز اجرا می‌کند |
| `.github/workflows/release.yml` | با هر تگ نسخه (مثل `v2.1.0`) فایل نصبی را می‌سازد و Release منتشر می‌کند |
| `.github/ISSUE_TEMPLATE/`، `pull_request_template.md`، `dependabot.yml` | فرم گزارش باگ و پیشنهاد، قالب PR و به‌روزرسانی خودکار وابستگی‌ها |
| `SECURITY.md`، `CONTRIBUTING.md`، `CODE_OF_CONDUCT.md`، `CHANGELOG.md`، `LICENSE` | فایل‌های استاندارد یک پروژه‌ی متن‌باز حرفه‌ای |
| `scripts/setup-dev.ps1` | آماده‌سازی محیط توسعه با یک دستور |
| `scripts/build-installer.ps1` | ساخت فایل نصبی با یک دستور |
| `scripts/publish-github.ps1` | آپلود کامل پروژه در GitHub با یک دستور |

---

## ۱. پیش‌نیازها (فقط یک‌بار)

1. **حساب GitHub:** اگر ندارید در [github.com/signup](https://github.com/signup) بسازید.
2. **Git:** از [git-scm.com/download/win](https://git-scm.com/download/win) نصب کنید. گزینه‌های پیش‌فرض نصب مناسب‌اند.
3. **Node.js نسخه‌ی ۲۲ یا جدیدتر:** از [nodejs.org](https://nodejs.org)، نسخه‌ی LTS.
4. بعد از نصب، **یک PowerShell جدید** باز کنید و نام و ایمیل خود را به Git معرفی کنید:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

> ایمیلی که اینجا می‌نویسید در تاریخچه‌ی commitها عمومی می‌شود. اگر نمی‌خواهید ایمیل اصلی‌تان دیده شود، از ایمیل
> `ID+USERNAME@users.noreply.github.com` استفاده کنید. آن را در GitHub از مسیر **Settings ← Emails** پیدا می‌کنید.

**اختیاری:** با نصب [GitHub CLI](https://cli.github.com) و یک‌بار اجرای `gh auth login`، اسکریپت انتشار خودش مخزن را می‌سازد و موضوع‌ها (topics) را هم تنظیم می‌کند.

---

## ۲. ساخت مخزن خالی در GitHub

(اگر GitHub CLI نصب دارید، از این مرحله رد شوید.)

1. به [github.com/new](https://github.com/new) بروید.
2. **Repository name:** `drivehound`
3. **Description:** `Smart disk space analyzer for Windows — see what fills your drive and what is safe to delete.`
4. **Public** را انتخاب کنید.
5. ⚠️ هیچ‌کدام از گزینه‌های *Add a README*، *.gitignore* و *license* را تیک نزنید؛ همه‌شان از قبل در پروژه هستند.
6. **Create repository** را بزنید.

---

## ۳. آپلود پروژه با یک دستور

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1
```

اسکریپت به‌ترتیب:
1. نام کاربری GitHub شما را می‌پرسد.
2. نام کاربری نمونه (your-username) را در لینک‌های READMEها و فایل‌ها با نام شما جایگزین می‌کند تا لینک‌ها و نشان‌ها درست کار کنند.
3. لینک مخزن و تنظیم **به‌روزرسانی خودکار** را به `package.json` اضافه می‌کند.
4. مخزن git را می‌سازد و commit اول را ثبت می‌کند.
5. **قبل از push تأیید می‌گیرد** و سپس کد را آپلود می‌کند.

بار اول، Git یک پنجره‌ی مرورگر برای ورود به GitHub باز می‌کند. وارد شوید و **Authorize** را بزنید.

> فایل‌های `node_modules`، `release` و `release-files` و فایل‌های شخصی مثل `START-HERE` در `.gitignore` هستند و آپلود **نمی‌شوند**.

---

## ۴. انتشار نسخه‌ی نصبی (Release)

### روش الف: خودکار با GitHub Actions (پیشنهادی)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1 -Release
```

(یا اگر کد را قبلاً push کرده‌اید: `git tag v2.1.0` و بعد `git push origin v2.1.0`)

بعد از آن:
1. در صفحه‌ی مخزن به تب **Actions** بروید. کار **Release** در حال اجراست (حدود ۵ تا ۱۰ دقیقه).
2. وقتی تیک سبز خورد، در تب **Releases** نسخه‌ی `v2.1.0` با این فایل‌ها آماده است:
   - `DriveHound-Setup-2.1.0.exe` (نصبی)
   - `DriveHound-Portable-2.1.0.exe` (قابل‌حمل)
   - `latest.yml` و `*.blockmap` (برای به‌روزرسانی خودکار؛ پاک نکنید)
   - `SHA256SUMS.txt` (برای بررسی سالم‌بودن فایل‌ها)
3. متن Release به‌طور خودکار از `docs/release-notes/v2.1.0.md` برداشته می‌شود.

**چرا این روش بهتر است؟** فایل نصبی روی سرور تمیز GitHub و پس از قبول‌شدن تست‌ها ساخته می‌شود، به‌روزرسانی خودکار برنامه فعال است، و هر کسی می‌تواند ببیند فایل دقیقاً از همین کد ساخته شده.

### روش ب: آپلود دستی

فایل‌های آماده در پوشه‌ی `release-files` هستند.
1. در مخزن: **Releases ← Draft a new release**
2. **Choose a tag:** بنویسید `v2.1.0` و *Create new tag* را بزنید.
3. **Release title:** `DriveHound v2.1.0`
4. متن `docs/release-notes/v2.1.0.md` را کپی کنید و در توضیحات بچسبانید.
5. فایل‌های `release-files` را بکشید و رها کنید.
6. **Publish release** را بزنید.

> فایل‌های `release-files` قبل از مشخص‌شدن نام کاربری شما ساخته شده‌اند. پس برنامه کامل کار می‌کند اما **به‌روزرسانی خودکار ندارد**.
> اگر روش دستی را انتخاب کردید، بعد از اجرای اسکریپت انتشار یک‌بار `scripts\build-installer.ps1` را اجرا کنید و فایل‌های پوشه‌ی `release` را آپلود کنید، شامل `latest.yml` و `.blockmap`.

---

## ۵. جذاب‌کردن صفحه‌ی مخزن

1. **About** (چرخ‌دنده‌ی کنار About در صفحه‌ی اصلی مخزن):
   - **Description:** `Smart disk space analyzer for Windows — see what fills your drive and what is safe to delete. فارسی / English`
   - **Website:** لینک `https://github.com/USERNAME/drivehound/releases/latest`
   - **Topics:** `windows` `disk-space` `disk-analyzer` `storage` `cleanup` `electron` `ntfs` `mft` `docker` `wsl` `persian` `ai`
   - تیک **Releases** را بزنید و تیک *Packages* و *Deployments* را بردارید.
2. **Social preview** (تصویر هنگام اشتراک لینک): **Settings ← General ← Social preview ← Edit ← Upload an image** و فایل `docs/social-preview.png` را انتخاب کنید.
3. **گزارش خصوصی مشکلات امنیتی:** **Settings ← Code security ← Private vulnerability reporting ← Enable**. لینک `SECURITY.md` به همین بخش اشاره می‌کند.
4. **Pin:** در پروفایل خود بخش **Customize your pins** را باز کنید و `drivehound` را انتخاب کنید تا اولین چیزی باشد که بازدیدکننده‌ها می‌بینند.
5. **اختیاری:** **Settings ← General ← Features ← Discussions** برای پرسش و پاسخ کاربران.

---

## ۶. نصب روی سیستم خودتان

یکی از این سه راه را انتخاب کنید:

- **از GitHub:** صفحه‌ی **Releases** ← فایل `DriveHound-Setup-2.1.0.exe` را دانلود و اجرا کنید.
- **فایل آماده:** `release-files\DriveHound-Setup-2.1.0.exe` را اجرا کنید.
- **ساخت از سورس:**

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -Install
  ```

  این دستور پکیج‌ها را نصب می‌کند، تست‌ها را اجرا می‌کند، فایل نصبی را می‌سازد و در پایان نصب را شروع می‌کند.

در نصب‌کننده مسیر نصب را انتخاب کنید و **Install** را بزنید. میانبر روی دسکتاپ و منوی استارت ساخته می‌شود.
اگر ویندوز هشدار **Windows protected your PC** داد: **More info ← Run anyway**. علت هشدار نداشتن امضای دیجیتال تجاری است.

**حذف برنامه:** از **Settings ← Apps** یا **Control Panel ← Programs**. منوی راست‌کلیک و اجرای خودکار هم پاک می‌شوند.
تنظیمات و تاریخچه در `%APPDATA%\DriveHound` می‌مانند. اگر نیاز ندارید، دستی پاکش کنید.

---

## ۷. انتشار نسخه‌های بعدی

```powershell
npm version 2.1.1 --no-git-tag-version      # شماره‌ی نسخه در package.json
```

1. تغییرات را در `CHANGELOG.md` بنویسید.
2. فایل `docs/release-notes/v2.1.1.md` را بسازید. می‌توانید از روی نسخه‌ی قبل کپی کنید.
3. این دستورها را اجرا کنید:

```powershell
git add -A
git commit -m "Release v2.1.1"
git push
git tag v2.1.1
git push origin v2.1.1
```

GitHub Actions نسخه‌ی جدید را می‌سازد. برنامه‌هایی که از نسخه‌ی نصبی GitHub نصب شده‌اند، به‌روزرسانی را خودشان پیدا می‌کنند.

> ⚠️ تگ باید با نسخه‌ی `package.json` یکی باشد. اگر یکی نباشد، Action عمداً متوقف می‌شود تا نسخه‌ی اشتباه منتشر نشود.

---

## ۸. عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| `running scripts is disabled on this system` | اسکریپت را حتماً با `powershell -ExecutionPolicy Bypass -File ...` اجرا کنید. |
| `git` یا `node` شناخته نمی‌شود | بعد از نصب، PowerShell را ببندید و دوباره باز کنید. |
| برنامه از ترمینال VS Code باز نمی‌شود | `Remove-Item Env:ELECTRON_RUN_AS_NODE` را اجرا کنید. اسکریپت‌ها این کار را خودکار انجام می‌دهند. |
| push با خطای `rejected` | مخزن GitHub خالی نبوده (README یا license داشته). یک مخزن خالی جدید بسازید، یا `git pull --rebase origin main` و بعد دوباره push کنید. |
| push با خطای احراز هویت | Git را دوباره نصب کنید و گزینه‌ی *Git Credential Manager* را فعال نگه دارید، یا `gh auth login` را اجرا کنید. |
| Action قرمز شد | روی آن کلیک کنید تا مرحله‌ی خطادار را ببینید. اگر خطا *Tag does not match* است، نسخه‌ی `package.json` را با تگ یکی کنید. |
| نشان‌های README تصویر شکسته نشان می‌دهند | نشان‌های Release و Downloads بعد از اولین Release درست می‌شوند. اگر هنوز عبارت your-username در لینک‌های README هست، اسکریپت انتشار را اجرا کنید. |
| هشدار SmartScreen | طبیعی است. برای حذف کامل باید گواهی امضای کد (Code Signing) بخرید و متغیرهای `CSC_LINK` و `CSC_KEY_PASSWORD` را تنظیم کنید. |

</div>
