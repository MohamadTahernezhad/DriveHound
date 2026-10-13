// Knowledge base: what a file/folder is, whether deleting it is safe, and how to clean it properly.
// Shared by renderer (classification) — plain script, attaches to globalThis.Knowledge.
//
// Rule fields
//   p      path patterns ('/' separators, %ENV% tokens, {D} = any drive root, * = one segment, ** = any depth)
//   n      basename matches (folder/file name anywhere), lowercase
//   ext    file extension matches (files only)
//   kind   'dir' | 'file' (optional)
//   test   (path, ctx) => bool  extra condition
//   markers  files expected next to the folder (in its parent) — used for confidence checks
//   cat    category id, safety: safe | caution | user | danger
//   mode   'item' (delete it) | 'contents' (empty it, keep folder) | 'none' (never delete directly)
//   action built-in cleanup action id (see ACTIONS)
//   t/d/i/h  title / description / impact of deleting / how to clean — { fa, en }
(function (root) {
  'use strict';

  const RULES = [];
  const R = (r) => RULES.push(r);

  // ───────────────────────── Container folders (describe themselves only, never inherited) ─────────────────────────
  const C = (r) => R(Object.assign({ container: true, mode: 'none', safety: 'danger' }, r));
  C({ id: 'c-users', p: ['{D}/Users'], cat: 'user',
    t: { fa: 'پوشه کاربران ویندوز', en: 'Windows user profiles' }, d: { fa: 'پروفایل همه کاربران ویندوز (دسکتاپ، اسناد، AppData و ...).', en: 'Profiles of all Windows users (Desktop, Documents, AppData…).' },
    i: { fa: 'هرگز کل این پوشه را حذف نکنید.', en: 'Never delete this folder.' }, h: { fa: 'داخل آن را با کاوشگر بررسی کنید.', en: 'Drill into it with the explorer.' } });
  C({ id: 'c-profile', p: ['%USERPROFILE%'], cat: 'user',
    t: { fa: 'پروفایل کاربری شما', en: 'Your user profile' }, d: { fa: 'همه فایل‌ها و تنظیمات حساب کاربری شما.', en: 'All files and settings of your Windows account.' },
    i: { fa: 'حذف = از دست رفتن حساب کاربری.', en: 'Deleting it destroys your account.' }, h: { fa: 'زیرپوشه‌ها را بررسی کنید.', en: 'Inspect its subfolders.' } });
  C({ id: 'c-appdata', p: ['%USERPROFILE%/AppData', '%LOCALAPPDATA%', '%APPDATA%', '%USERPROFILE%/AppData/LocalLow', '%LOCALAPPDATA%/Packages', '%PROGRAMDATA%'], cat: 'appdata',
    t: { fa: 'داده و تنظیمات برنامه‌ها (AppData)', en: 'Application data (AppData)' },
    d: { fa: 'محل ذخیره تنظیمات، کش و داده‌های همه برنامه‌ها. معمولاً بزرگ‌ترین منبع پر شدن درایو C است.', en: 'Where every program keeps settings, caches and data. Often the biggest reason drive C fills up.' },
    i: { fa: 'حذف کل پوشه همه برنامه‌ها را خراب می‌کند.', en: 'Deleting the whole folder breaks every program.' }, h: { fa: 'زیرپوشه‌های کش را از «پاکسازی هوشمند» پاک کنید.', en: 'Clean cache subfolders via Smart cleanup.' } });
  C({ id: 'c-progfiles', p: ['%PROGRAMFILES%', '%PROGRAMFILES86%', '%LOCALAPPDATA%/Programs'], cat: 'apps',
    t: { fa: 'پوشه برنامه‌های نصب‌شده', en: 'Installed programs folder' }, d: { fa: 'فایل‌های برنامه‌هایی که نصب کرده‌اید.', en: 'Files of the programs you installed.' },
    i: { fa: 'حذف دستی برنامه‌ها را خراب می‌کند.', en: 'Manual deletion breaks programs.' }, h: { fa: 'از صفحه «برنامه‌ها» برنامه‌های بلااستفاده را حذف کنید.', en: 'Uninstall unused programs from the Apps page.' } });
  C({ id: 'c-recovery', p: ['{D}/Recovery', '{D}/Boot', '{D}/EFI'], cat: 'system',
    t: { fa: 'بازیابی و بوت ویندوز', en: 'Windows recovery & boot' }, d: { fa: 'فایل‌های محیط بازیابی و بوت ویندوز.', en: 'Windows recovery environment and boot files.' },
    i: { fa: 'حذف = ویندوز ممکن است بوت نشود.', en: 'Deleting may make Windows unbootable.' }, h: { fa: 'دست نزنید.', en: 'Leave it alone.' } });

  // ───────────────────────── Windows system ─────────────────────────
  R({ id: 'hiberfil', p: ['{D}/hiberfil.sys'], kind: 'file', cat: 'system', safety: 'caution', mode: 'none', action: 'hibernateOff',
    t: { fa: 'فایل هایبرنیت ویندوز', en: 'Windows hibernation file' },
    d: { fa: 'ویندوز محتوای RAM را هنگام Hibernate و «Fast Startup» در این فایل ذخیره می‌کند. حجمش معمولاً ۴۰٪ تا ۷۵٪ حجم RAM است.', en: 'Windows stores RAM contents here for Hibernate and Fast Startup. Usually 40–75% of your RAM size.' },
    i: { fa: 'مستقیم قابل حذف نیست. با غیرفعال کردن Hibernate حذف می‌شود؛ فقط حالت Hibernate و Fast Startup از کار می‌افتد و بوت کمی کندتر می‌شود.', en: 'Cannot be deleted directly. Disabling hibernation removes it; you lose Hibernate and Fast Startup (slightly slower cold boots).' },
    h: { fa: 'دکمه «غیرفعال‌سازی Hibernate» را بزنید (اجرای powercfg -h off با دسترسی ادمین). یا برای کم‌کردن حجم: powercfg /h /type reduced', en: 'Use “Disable hibernation” (runs powercfg -h off as admin). To just shrink it: powercfg /h /type reduced' } });

  R({ id: 'pagefile', p: ['{D}/pagefile.sys', '{D}/swapfile.sys'], kind: 'file', cat: 'system', safety: 'danger', mode: 'none', action: 'openVirtualMemory',
    t: { fa: 'حافظه مجازی ویندوز (Page File)', en: 'Windows virtual memory (page file)' },
    d: { fa: 'وقتی RAM پر می‌شود ویندوز از این فایل به‌عنوان حافظه کمکی استفاده می‌کند.', en: 'Windows uses this file as overflow memory when RAM is full.' },
    i: { fa: 'حذف یا غیرفعال کردن آن می‌تواند باعث کرش برنامه‌ها و صفحه آبی شود.', en: 'Removing or disabling it can crash apps and cause blue screens.' },
    h: { fa: 'اگر خیلی بزرگ است، از تنظیمات Virtual Memory اندازه آن را مدیریت کنید (پیشنهاد: System managed).', en: 'If oversized, manage its size in Virtual Memory settings (recommended: System managed).' } });

  R({ id: 'winsxs', p: ['%WINDIR%/WinSxS'], cat: 'system', safety: 'danger', mode: 'none', action: 'dismCleanup',
    t: { fa: 'انبار کامپوننت‌های ویندوز (WinSxS)', en: 'Windows component store (WinSxS)' },
    d: { fa: 'نسخه‌های مختلف فایل‌های سیستمی برای آپدیت، تعمیر و بازگردانی ویندوز. بخش زیادی از فایل‌ها هاردلینک هستند و حجم واقعی کمتر از ظاهرش است.', en: 'Versions of system files used for updates, repair and rollback. Many files are hard links, so the real size is smaller than it looks.' },
    i: { fa: 'حذف دستی ویندوز را خراب می‌کند و آپدیت‌ها دیگر نصب نمی‌شوند.', en: 'Deleting manually breaks Windows and Windows Update.' },
    h: { fa: 'فقط با DISM پاکسازی کنید: Dism /Online /Cleanup-Image /StartComponentCleanup', en: 'Clean only with DISM: Dism /Online /Cleanup-Image /StartComponentCleanup' } });

  R({ id: 'driverstore', p: ['%WINDIR%/System32/DriverStore'], cat: 'system', safety: 'danger', mode: 'none',
    t: { fa: 'انبار درایورهای ویندوز', en: 'Windows driver store' },
    d: { fa: 'نسخه‌های نصب‌شده درایورها (کارت گرافیک، صدا و ...). درایورهای قدیمی NVIDIA/AMD اینجا جمع می‌شوند.', en: 'Installed driver packages (GPU, audio…). Old NVIDIA/AMD drivers pile up here.' },
    i: { fa: 'حذف دستی می‌تواند باعث از کار افتادن سخت‌افزار شود.', en: 'Manual deletion can break hardware devices.' },
    h: { fa: 'درایورهای قدیمی را با ابزار DriverStore Explorer یا دستور pnputil /delete-driver حذف کنید.', en: 'Remove old drivers with DriverStore Explorer or pnputil /delete-driver.' } });

  R({ id: 'win-installer', p: ['%WINDIR%/Installer'], cat: 'system', safety: 'danger', mode: 'none',
    t: { fa: 'کش نصب‌کننده‌های ویندوز (MSI)', en: 'Windows Installer cache (MSI)' },
    d: { fa: 'فایل‌های MSI/MSP برنامه‌های نصب‌شده که برای آپدیت، تعمیر و حذف برنامه لازم‌اند.', en: 'MSI/MSP packages of installed programs, needed to update, repair and uninstall them.' },
    i: { fa: 'حذف آن باعث می‌شود برنامه‌ها (مثل Office) قابل آپدیت یا حذف نباشند.', en: 'Deleting it makes programs (e.g. Office) impossible to update or uninstall.' },
    h: { fa: 'دست نزنید. برنامه‌های بلااستفاده را از بخش «برنامه‌ها» حذف کنید.', en: 'Leave it. Uninstall unused programs from the Apps page instead.' } });

  R({ id: 'sysvol', p: ['{D}/System Volume Information'], cat: 'system', safety: 'danger', mode: 'none', action: 'systemProtection',
    t: { fa: 'نقاط بازگردانی سیستم (Restore Points)', en: 'System Restore points & shadow copies' },
    d: { fa: 'نقاط بازگردانی ویندوز و Shadow Copyها. می‌تواند چند ده گیگ باشد.', en: 'System Restore points and volume shadow copies. Can be tens of GB.' },
    i: { fa: 'قابل حذف دستی نیست.', en: 'Cannot be deleted manually.' },
    h: { fa: 'در System Protection سقف فضای Restore را کم کنید یا نقاط قدیمی را حذف کنید. Disk Cleanup > More options هم همه به جز آخرین را حذف می‌کند.', en: 'Lower the max usage in System Protection or delete restore points. Disk Cleanup > More options removes all but the latest.' } });

  R({ id: 'sw-dist', p: ['%WINDIR%/SoftwareDistribution/Download'], cat: 'temp', safety: 'safe', mode: 'contents', action: 'diskCleanup',
    t: { fa: 'کش دانلود Windows Update', en: 'Windows Update download cache' },
    d: { fa: 'فایل‌های آپدیت دانلودشده که معمولاً بعد از نصب دیگر لازم نیستند.', en: 'Downloaded update files, usually no longer needed after installation.' },
    i: { fa: 'امن است. اگر آپدیتی در حال نصب باشد دوباره دانلود می‌شود.', en: 'Safe. Pending updates are simply downloaded again.' },
    h: { fa: 'از Disk Cleanup گزینه Windows Update Cleanup، یا پاک کردن محتویات این پوشه.', en: 'Use Disk Cleanup → Windows Update Cleanup, or empty this folder.' } });

  R({ id: 'win-temp', p: ['%WINDIR%/Temp', '%WINDIR%/SystemTemp', '%LOCALAPPDATA%/Temp'], cat: 'temp', safety: 'safe', mode: 'contents', action: 'cleanTemp',
    t: { fa: 'فایل‌های موقت (Temp)', en: 'Temporary files (Temp)' },
    d: { fa: 'فایل‌های موقتی که برنامه‌ها و نصب‌کننده‌ها ساخته‌اند و اغلب فراموش شده‌اند.', en: 'Temporary files created by apps and installers, often left behind.' },
    i: { fa: 'امن است. فایل‌هایی که در حال استفاده باشند خودکار رد می‌شوند.', en: 'Safe. Files that are in use are skipped automatically.' },
    h: { fa: 'محتویات پوشه را پاک کنید (خود پوشه نباید حذف شود).', en: 'Empty the folder contents (never delete the folder itself).' } });

  R({ id: 'win-old', p: ['{D}/Windows.old'], cat: 'system', safety: 'caution', mode: 'none', action: 'diskCleanup',
    t: { fa: 'ویندوز قبلی (Windows.old)', en: 'Previous Windows installation' },
    d: { fa: 'نسخه قبلی ویندوز بعد از آپگرید؛ برای برگشت به نسخه قبل استفاده می‌شود.', en: 'Your previous Windows version after an upgrade, used for rollback.' },
    i: { fa: 'بعد از حذف امکان برگشت به نسخه قبلی ویندوز را ندارید.', en: 'After removal you cannot roll back to the previous Windows version.' },
    h: { fa: 'از Disk Cleanup گزینه «Previous Windows installation(s)» را انتخاب کنید.', en: 'Disk Cleanup → “Previous Windows installation(s)”.' } });

  R({ id: 'win-bt', p: ['{D}/$WINDOWS.~BT', '{D}/$WINDOWS.~WS', '{D}/$GetCurrent', '{D}/ESD'], cat: 'temp', safety: 'safe', mode: 'none', action: 'diskCleanup',
    t: { fa: 'فایل‌های موقت آپگرید ویندوز', en: 'Windows upgrade temporary files' },
    d: { fa: 'فایل‌های باقی‌مانده از آپگرید یا نصب ویندوز.', en: 'Leftovers from a Windows upgrade or setup.' },
    i: { fa: 'بعد از اتمام آپگرید امن است.', en: 'Safe once the upgrade is finished.' },
    h: { fa: 'Disk Cleanup > Clean up system files > Temporary Windows installation files', en: 'Disk Cleanup > Clean up system files > Temporary Windows installation files' } });

  R({ id: 'win-logs', p: ['%WINDIR%/Logs', '%WINDIR%/Panther', '%WINDIR%/System32/LogFiles', '%WINDIR%/Logs/CBS'], cat: 'temp', safety: 'caution', mode: 'contents',
    t: { fa: 'لاگ‌های ویندوز', en: 'Windows log files' },
    d: { fa: 'لاگ‌های نصب، آپدیت و سرویس‌های ویندوز. گاهی (مثل CBS.log یا setupact.log) تا چند گیگ بزرگ می‌شوند.', en: 'Setup, update and service logs. Some (CBS.log, setupact.log) can grow to several GB.' },
    i: { fa: 'حذف لاگ‌های قدیمی مشکلی ایجاد نمی‌کند؛ فقط اطلاعات عیب‌یابی از بین می‌رود. فایل‌های در حال استفاده رد می‌شوند.', en: 'Removing old logs is harmless; you only lose troubleshooting info. In-use files are skipped.' },
    h: { fa: 'فایل‌های .log بزرگ و قدیمی را حذف کنید (نیاز به ادمین).', en: 'Delete large old .log files (requires admin).' } });

  R({ id: 'dumps', p: ['%WINDIR%/Minidump', '%WINDIR%/MEMORY.DMP', '%WINDIR%/LiveKernelReports', '%LOCALAPPDATA%/CrashDumps', '%PROGRAMDATA%/Microsoft/Windows/WER', '%LOCALAPPDATA%/Microsoft/Windows/WER'], cat: 'temp', safety: 'safe', mode: 'contents',
    t: { fa: 'گزارش‌ها و دامپ‌های کرش', en: 'Crash dumps & error reports' },
    d: { fa: 'فایل‌های دامپ حافظه که هنگام کرش برنامه یا صفحه آبی ساخته می‌شوند.', en: 'Memory dumps created when an app crashes or Windows blue-screens.' },
    i: { fa: 'امن است، مگر بخواهید علت کرش را بررسی کنید.', en: 'Safe unless you need them to diagnose a crash.' },
    h: { fa: 'محتویات را پاک کنید یا از Disk Cleanup استفاده کنید.', en: 'Empty the folder or use Disk Cleanup.' } });

  R({ id: 'delivery-opt', p: ['%WINDIR%/ServiceProfiles/NetworkService/AppData/Local/Microsoft/Windows/DeliveryOptimization', '%WINDIR%/SoftwareDistribution/DeliveryOptimization'], cat: 'temp', safety: 'safe', mode: 'none', action: 'diskCleanup',
    t: { fa: 'کش Delivery Optimization', en: 'Delivery Optimization cache' },
    d: { fa: 'کش اشتراک‌گذاری آپدیت‌های ویندوز بین کامپیوترها.', en: 'Cache used to share Windows updates between PCs.' },
    i: { fa: 'امن است.', en: 'Safe.' },
    h: { fa: 'Disk Cleanup > Delivery Optimization Files', en: 'Disk Cleanup > Delivery Optimization Files' } });

  R({ id: 'recycle', p: ['{D}/$Recycle.Bin'], cat: 'temp', safety: 'safe', mode: 'none', action: 'emptyRecycleBin',
    t: { fa: 'سطل بازیافت', en: 'Recycle Bin' },
    d: { fa: 'فایل‌هایی که حذف کرده‌اید ولی هنوز فضا اشغال می‌کنند.', en: 'Files you deleted that still take up space.' },
    i: { fa: 'بعد از خالی کردن، بازگردانی فایل‌ها ممکن نیست.', en: 'After emptying, files cannot be restored.' },
    h: { fa: 'دکمه «خالی کردن سطل بازیافت».', en: 'Use “Empty Recycle Bin”.' } });

  R({ id: 'windowsapps', p: ['%PROGRAMFILES%/WindowsApps'], cat: 'apps', safety: 'danger', mode: 'none', action: 'openApps',
    t: { fa: 'برنامه‌های Microsoft Store', en: 'Microsoft Store apps' },
    d: { fa: 'فایل‌های برنامه‌های نصب‌شده از Store و بازی‌های Xbox.', en: 'Installed Store apps and Xbox games.' },
    i: { fa: 'حذف دستی برنامه‌ها را خراب می‌کند.', en: 'Manual deletion breaks the apps.' },
    h: { fa: 'از Settings > Apps برنامه را Uninstall کنید.', en: 'Uninstall from Settings > Apps.' } });

  R({ id: 'pkg-cache', p: ['%PROGRAMDATA%/Package Cache'], cat: 'apps', safety: 'caution', mode: 'none',
    t: { fa: 'کش نصب‌کننده‌ها (Package Cache)', en: 'Installer Package Cache' },
    d: { fa: 'نسخه نصب‌کننده برنامه‌هایی مثل Visual Studio و Visual C++ Runtime برای تعمیر/حذف.', en: 'Installer copies for Visual Studio, VC++ runtimes etc., used for repair/uninstall.' },
    i: { fa: 'حذف آن ممکن است حذف/آپدیت برخی برنامه‌ها را با خطا مواجه کند.', en: 'Removing it may break repair/uninstall of some programs.' },
    h: { fa: 'بهتر است دست نزنید؛ اگر Visual Studio دارید از Visual Studio Installer نسخه‌های قدیمی را حذف کنید.', en: 'Best left alone; use Visual Studio Installer to remove old workloads.' } });

  R({ id: 'search-index', p: ['%PROGRAMDATA%/Microsoft/Search/Data'], cat: 'system', safety: 'caution', mode: 'none', action: 'openIndexing',
    t: { fa: 'ایندکس جستجوی ویندوز', en: 'Windows Search index' },
    d: { fa: 'پایگاه داده جستجوی سریع فایل‌ها.', en: 'Database used for fast file search.' },
    i: { fa: 'حذف دستی، جستجو را خراب می‌کند.', en: 'Manual deletion breaks search.' },
    h: { fa: 'در Indexing Options دکمه Rebuild را بزنید یا پوشه‌های کمتری را ایندکس کنید.', en: 'Use Indexing Options → Rebuild, or index fewer locations.' } });

  R({ id: 'thumbcache', p: ['%LOCALAPPDATA%/Microsoft/Windows/Explorer'], cat: 'cache', safety: 'safe', mode: 'none', action: 'diskCleanup',
    t: { fa: 'کش تصاویر بندانگشتی', en: 'Thumbnail cache' },
    d: { fa: 'پیش‌نمایش عکس‌ها و ویدیوها در File Explorer.', en: 'Picture/video previews shown by File Explorer.' },
    i: { fa: 'امن است، دوباره ساخته می‌شود.', en: 'Safe, rebuilt automatically.' },
    h: { fa: 'Disk Cleanup > Thumbnails', en: 'Disk Cleanup > Thumbnails' } });

  R({ id: 'inetcache', p: ['%LOCALAPPDATA%/Microsoft/Windows/INetCache', '%LOCALAPPDATA%/D3DSCache', '%LOCALAPPDATA%/NVIDIA/DXCache', '%LOCALAPPDATA%/NVIDIA/GLCache', '%LOCALAPPDATA%/AMD/DxCache', '%LOCALAPPDATA%/AMD/DxcCache', '%LOCALAPPDATA%/Intel/ShaderCache', '%LOCALAPPDATA%/NVIDIA Corporation/NV_Cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش اینترنت / شیدرهای گرافیکی', en: 'Internet / GPU shader cache' },
    d: { fa: 'کش‌هایی که ویندوز و درایور گرافیک برای سرعت بیشتر می‌سازند.', en: 'Caches Windows and GPU drivers build for speed.' },
    i: { fa: 'امن است؛ اولین اجرای بازی‌ها ممکن است کمی کندتر باشد.', en: 'Safe; first launch of games may be slightly slower.' },
    h: { fa: 'محتویات را پاک کنید.', en: 'Empty the folder.' } });

  // ───────────────────────── Vendors / drivers ─────────────────────────
  R({ id: 'nvidia-ota', p: ['%PROGRAMDATA%/NVIDIA Corporation/NVIDIA App/UpdateFramework/ota-artifacts', '%PROGRAMDATA%/NVIDIA Corporation/Downloader', '%PROGRAMDATA%/NVIDIA Corporation/NetService'], cat: 'temp', safety: 'safe', mode: 'contents',
    t: { fa: 'فایل‌های دانلودی درایور NVIDIA', en: 'NVIDIA driver downloads' },
    d: { fa: 'نصب‌کننده‌های درایور که NVIDIA App دانلود کرده است.', en: 'Driver installers downloaded by NVIDIA App.' },
    i: { fa: 'امن است؛ درایور نصب‌شده تحت تأثیر قرار نمی‌گیرد.', en: 'Safe; the installed driver is not affected.' },
    h: { fa: 'محتویات را پاک کنید.', en: 'Empty the folder.' } });

  R({ id: 'oem-setup', p: ['{D}/SWSetup', '{D}/AMD', '{D}/NVIDIA', '{D}/Drivers'], cat: 'temp', safety: 'caution', mode: 'item',
    t: { fa: 'فایل‌های استخراج‌شده نصب درایور', en: 'Extracted driver setup files' },
    d: { fa: 'پوشه‌ای که سازنده لپ‌تاپ (HP، AMD، NVIDIA ...) فایل‌های نصب درایور را در آن باز کرده است.', en: 'Folder where your OEM (HP, AMD, NVIDIA…) extracted driver installers.' },
    i: { fa: 'درایورهای نصب‌شده آسیبی نمی‌بینند؛ فقط برای نصب مجدد باید دوباره دانلود کنید. (در HP، ابزار Recovery ممکن است از آن استفاده کند.)', en: 'Installed drivers are unaffected; you would need to re-download for reinstall. (HP recovery tools may use it.)' },
    h: { fa: 'اگر سیستم پایدار است می‌توانید حذف کنید.', en: 'If the system is stable you can delete it.' } });

  R({ id: 'google-updater', p: ['%PROGRAMFILES86%/Google/GoogleUpdater/crx_cache', '%PROGRAMFILES%/Google/GoogleUpdater/crx_cache', '%LOCALAPPDATA%/Google/GoogleUpdater/crx_cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش آپدیت گوگل', en: 'Google Updater cache' },
    d: { fa: 'بسته‌های آپدیت دانلودشده Chrome.', en: 'Downloaded Chrome update packages.' },
    i: { fa: 'امن است.', en: 'Safe.' },
    h: { fa: 'محتویات را پاک کنید.', en: 'Empty the folder.' } });

  R({ id: 'edge-webview', p: ['%PROGRAMFILES86%/Microsoft/EdgeWebView', '%PROGRAMFILES86%/Microsoft/Edge', '%PROGRAMFILES86%/Microsoft/EdgeUpdate'], cat: 'apps', safety: 'danger', mode: 'none',
    t: { fa: 'Microsoft Edge / WebView2', en: 'Microsoft Edge / WebView2 runtime' },
    d: { fa: 'موتور WebView2 که برنامه‌های زیادی (Teams، Office، ابزارها) به آن وابسته‌اند. نسخه‌های قدیمی خودکار پاک می‌شوند.', en: 'WebView2 runtime many apps depend on (Teams, Office…). Old versions are removed automatically.' },
    i: { fa: 'حذف آن باعث از کار افتادن برنامه‌های وابسته می‌شود.', en: 'Removing it breaks dependent apps.' },
    h: { fa: 'دست نزنید.', en: 'Leave it alone.' } });

  // ───────────────────────── Virtual machines / containers ─────────────────────────
  R({ id: 'docker-vhdx', p: ['%LOCALAPPDATA%/Docker/wsl/disk/docker_data.vhdx', '%LOCALAPPDATA%/Docker/wsl/data/ext4.vhdx', '%LOCALAPPDATA%/Docker/wsl/main/ext4.vhdx'], kind: 'file', cat: 'vm', safety: 'danger', mode: 'none', action: 'dockerPrune',
    t: { fa: 'دیسک مجازی Docker Desktop', en: 'Docker Desktop virtual disk' },
    d: { fa: 'تمام ایمیج‌ها، کانتینرها، والیوم‌ها و کش بیلد Docker داخل این فایل است. این فایل خودکار بزرگ می‌شود ولی بعد از حذف ایمیج‌ها خودکار کوچک نمی‌شود!', en: 'All Docker images, containers, volumes and build cache live inside this file. It grows automatically but does NOT shrink when you delete images!' },
    i: { fa: 'حذف مستقیم = از دست رفتن همه کانتینرها، دیتابیس‌ها و والیوم‌ها.', en: 'Deleting it = losing all containers, databases and volumes.' },
    h: { fa: '۱) docker system df برای دیدن مصرف  ۲) docker system prune -a (و در صورت نیاز --volumes)  ۳) در Docker Desktop: Settings > Resources > Disk image یا Troubleshoot > Clean / Purge data. بعد از prune، فشرده‌سازی دیسک مجازی فضا را واقعاً آزاد می‌کند.', en: '1) docker system df to see usage 2) docker system prune -a (add --volumes if OK) 3) Docker Desktop: Settings > Resources > Disk image, or Troubleshoot > Clean / Purge data. After pruning, compacting the virtual disk actually frees the space.' } });

  R({ id: 'docker-dir', p: ['%LOCALAPPDATA%/Docker', '%PROGRAMDATA%/DockerDesktop', '%PROGRAMDATA%/Docker'], cat: 'vm', safety: 'caution', mode: 'none', action: 'dockerPrune',
    t: { fa: 'داده‌های Docker Desktop', en: 'Docker Desktop data' },
    d: { fa: 'داده‌ها و دیسک‌های مجازی Docker Desktop.', en: 'Docker Desktop data and virtual disks.' },
    i: { fa: 'حذف دستی Docker را خراب می‌کند و کانتینرها از بین می‌روند.', en: 'Manual deletion breaks Docker and loses containers.' },
    h: { fa: 'با docker system prune فضای ایمیج‌های بلااستفاده را آزاد کنید.', en: 'Free unused images with docker system prune.' } });

  R({ id: 'wsl-vhdx', p: ['%LOCALAPPDATA%/Packages/*/LocalState/ext4.vhdx', '%LOCALAPPDATA%/wsl/*/ext4.vhdx', '%USERPROFILE%/AppData/Local/Packages/*/LocalState/ext4.vhdx'], n: ['ext4.vhdx'], kind: 'file', cat: 'vm', safety: 'danger', mode: 'none', action: 'compactVhdx',
    t: { fa: 'دیسک مجازی لینوکس WSL', en: 'WSL Linux virtual disk' },
    d: { fa: 'کل فایل‌سیستم توزیع لینوکس شما (Ubuntu و ...) در این فایل است. بعد از حذف فایل‌ها داخل لینوکس، خودکار کوچک نمی‌شود.', en: 'Your entire Linux distro (Ubuntu…) filesystem. It does not shrink automatically after deleting files inside Linux.' },
    i: { fa: 'حذف = از دست رفتن کامل لینوکس و فایل‌های داخل آن.', en: 'Deleting = losing the entire Linux install and its files.' },
    h: { fa: 'داخل لینوکس فایل‌ها را پاک کنید، بعد wsl --shutdown و فشرده‌سازی دیسک (wsl --manage <distro> --set-sparse true یا diskpart compact vdisk).', en: 'Clean up inside Linux, then wsl --shutdown and compact the disk (wsl --manage <distro> --set-sparse true, or diskpart compact vdisk).' } });

  R({ id: 'claude-vm', p: ['%LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude/vm_bundles', '%APPDATA%/Claude/vm_bundles'], cat: 'vm', safety: 'caution', mode: 'item',
    t: { fa: 'ماشین مجازی Claude Desktop', en: 'Claude Desktop VM image' },
    d: { fa: 'تصویر ماشین مجازی که اپ Claude برای اجرای کد و قابلیت‌های agent استفاده می‌کند.', en: 'VM image the Claude desktop app uses for code execution and agent features.' },
    i: { fa: 'با بستن کامل Claude قابل حذف است و در صورت نیاز دوباره دانلود می‌شود (چند گیگ).', en: 'Can be removed with Claude fully closed; it is re-downloaded when needed (several GB).' },
    h: { fa: 'Claude را کامل ببندید و پوشه را حذف کنید.', en: 'Quit Claude completely, then delete the folder.' } });

  R({ id: 'avd', p: ['%USERPROFILE%/.android/avd/*.avd'], cat: 'vm', safety: 'caution', mode: 'item',
    t: { fa: 'شبیه‌ساز اندروید (AVD)', en: 'Android emulator (AVD)' },
    d: { fa: 'دیسک، اسنپ‌شات و اطلاعات یک شبیه‌ساز اندروید Android Studio. با استفاده، userdata بزرگ و بزرگ‌تر می‌شود.', en: 'Disk, snapshots and data of an Android Studio emulator. userdata grows as you use it.' },
    i: { fa: 'شبیه‌ساز و اپ‌های نصب‌شده داخل آن پاک می‌شوند؛ پروژه‌های شما آسیبی نمی‌بینند.', en: 'The emulator and apps installed inside it are lost; your projects are not affected.' },
    h: { fa: 'از Android Studio > Device Manager گزینه Wipe Data (کوچک‌کردن) یا Delete. شبیه‌سازهای بلااستفاده را حذف کنید.', en: 'Android Studio > Device Manager → Wipe Data (shrink) or Delete. Remove emulators you no longer use.' } });

  R({ id: 'avd-snapshots', p: ['%USERPROFILE%/.android/avd/*.avd/snapshots'], cat: 'vm', safety: 'safe', mode: 'contents',
    t: { fa: 'اسنپ‌شات شبیه‌ساز اندروید', en: 'Android emulator snapshots' },
    d: { fa: 'اسنپ‌شات Quick Boot شبیه‌ساز (کپی کامل RAM).', en: 'Emulator Quick Boot snapshot (full RAM image).' },
    i: { fa: 'امن است؛ فقط بوت بعدی شبیه‌ساز کامل (Cold boot) انجام می‌شود.', en: 'Safe; the next emulator start will be a cold boot.' },
    h: { fa: 'محتویات را پاک کنید (شبیه‌ساز باید بسته باشد).', en: 'Empty it (emulator must be closed).' } });

  R({ id: 'android-sysimg', p: ['%LOCALAPPDATA%/Android/Sdk/system-images', '%LOCALAPPDATA%/Android/Sdk/system-images/*'], cat: 'dev', safety: 'caution', mode: 'item',
    t: { fa: 'ایمیج‌های سیستم اندروید (SDK)', en: 'Android SDK system images' },
    d: { fa: 'ایمیج نسخه‌های اندروید برای شبیه‌سازها.', en: 'Android OS images used by emulators.' },
    i: { fa: 'شبیه‌سازهایی که از این نسخه استفاده می‌کنند دیگر اجرا نمی‌شوند تا دوباره دانلود کنید.', en: 'Emulators using this image will not start until it is re-downloaded.' },
    h: { fa: 'از Android Studio > SDK Manager نسخه‌های بلااستفاده را Uncheck کنید.', en: 'Uncheck unused images in Android Studio > SDK Manager.' } });

  R({ id: 'android-sdk', p: ['%LOCALAPPDATA%/Android/Sdk'], cat: 'dev', safety: 'danger', mode: 'none',
    t: { fa: 'Android SDK', en: 'Android SDK' },
    d: { fa: 'ابزارهای ساخت اندروید که Android Studio و Flutter به آن وابسته‌اند.', en: 'Android build tools that Android Studio and Flutter depend on.' },
    i: { fa: 'حذف = بیلد گرفتن پروژه‌های اندروید/فلاتر ممکن نیست.', en: 'Deleting it breaks Android/Flutter builds.' },
    h: { fa: 'از SDK Manager نسخه‌های قدیمی build-tools، platforms و system-images را حذف کنید.', en: 'Remove old build-tools, platforms and system images via SDK Manager.' } });

  R({ id: 'android-cache', p: ['%USERPROFILE%/.android/cache', '%USERPROFILE%/.android/build-cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش اندروید', en: 'Android cache' }, d: { fa: 'کش دانلود و بیلد ابزارهای اندروید.', en: 'Android tools download/build cache.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'vbox', p: ['%USERPROFILE%/VirtualBox VMs', '%USERPROFILE%/Documents/Virtual Machines', '%PUBLIC%/Documents/Hyper-V'], cat: 'vm', safety: 'user', mode: 'item',
    t: { fa: 'ماشین‌های مجازی', en: 'Virtual machines' }, d: { fa: 'ماشین‌های مجازی VirtualBox/VMware/Hyper-V.', en: 'VirtualBox/VMware/Hyper-V machines.' },
    i: { fa: 'کل ماشین مجازی و داده‌های داخل آن از بین می‌رود.', en: 'The whole VM and its data is lost.' },
    h: { fa: 'از داخل خود نرم‌افزار مجازی‌ساز ماشین‌های بلااستفاده را حذف کنید.', en: 'Delete unused VMs from within the hypervisor app.' } });

  // ───────────────────────── Developer tools ─────────────────────────
  R({ id: 'npm-global', p: ['%APPDATA%/npm/node_modules', '%APPDATA%/npm'], cat: 'dev', safety: 'caution', mode: 'none',
    t: { fa: 'پکیج‌های سراسری npm', en: 'Global npm packages' },
    d: { fa: 'ابزارهای خط فرمانی که با npm install -g نصب کرده‌اید (مثل claude، firebase، yarn).', en: 'CLI tools you installed with npm install -g (claude, firebase, yarn…).' },
    i: { fa: 'حذف = دستورات این ابزارها دیگر کار نمی‌کنند.', en: 'Deleting it breaks those commands.' },
    h: { fa: 'npm ls -g --depth=0 برای دیدن لیست، و npm uninstall -g <name> برای حذف.', en: 'npm ls -g --depth=0 to list, npm uninstall -g <name> to remove.' } });

  R({ id: 'node_modules', n: ['node_modules'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['package.json'],
    test: (p, ctx) => ctx.hasMarker(p, 'package.json'),
    t: { fa: 'وابستگی‌های پروژه Node.js', en: 'Node.js project dependencies' },
    d: { fa: 'پکیج‌های npm پروژه. با npm install کاملاً از روی package.json دوباره ساخته می‌شود.', en: 'npm packages of a project. Fully restorable from package.json with npm install.' },
    i: { fa: 'پروژه تا اجرای دوباره npm install اجرا نمی‌شود؛ کد شما آسیبی نمی‌بیند. برای پروژه‌هایی که فعلاً کار نمی‌کنید ایده‌آل است.', en: 'The project will not run until you npm install again; your code is untouched. Ideal for inactive projects.' },
    h: { fa: 'حذف کنید و هر وقت لازم شد npm install (یا yarn / pnpm install) بزنید.', en: 'Delete, then run npm install (or yarn/pnpm install) when needed.' } });

  R({ id: 'npm-cache', p: ['%LOCALAPPDATA%/npm-cache', '%APPDATA%/npm-cache'], cat: 'cache', safety: 'safe', mode: 'contents', action: 'npmCacheClean',
    t: { fa: 'کش npm', en: 'npm cache' },
    d: { fa: 'نسخه دانلودشده همه پکیج‌هایی که تا حالا نصب کرده‌اید. خیلی سریع چند گیگ می‌شود.', en: 'Every package you ever installed. Quickly grows to several GB.' },
    i: { fa: 'امن است؛ نصب‌های بعدی پکیج‌ها را دوباره دانلود می‌کنند. پروژه‌ها آسیبی نمی‌بینند.', en: 'Safe; future installs just re-download packages. Projects are not affected.' },
    h: { fa: 'npm cache clean --force', en: 'npm cache clean --force' } });

  R({ id: 'yarn-pnpm', p: ['%LOCALAPPDATA%/Yarn/Cache', '%LOCALAPPDATA%/Yarn/Berry/cache', '%LOCALAPPDATA%/pnpm-cache', '%LOCALAPPDATA%/pnpm/store', '%LOCALAPPDATA%/pnpm-store', '{D}/.pnpm-store', '%USERPROFILE%/.bun/install/cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Yarn / pnpm / Bun', en: 'Yarn / pnpm / Bun cache' },
    d: { fa: 'کش سراسری مدیر پکیج.', en: 'Global package manager cache.' },
    i: { fa: 'امن است. (در pnpm پروژه‌ها از هاردلینک استفاده می‌کنند؛ بعد از حذف باید pnpm install بزنید.)', en: 'Safe. (pnpm projects hard-link into the store; run pnpm install afterwards.)' },
    h: { fa: 'yarn cache clean  |  pnpm store prune', en: 'yarn cache clean  |  pnpm store prune' } });

  R({ id: 'gradle-caches', p: ['%USERPROFILE%/.gradle/caches', '%USERPROFILE%/.gradle/daemon', '%USERPROFILE%/.gradle/native', '%USERPROFILE%/.gradle/.tmp'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Gradle', en: 'Gradle cache' },
    d: { fa: 'وابستگی‌ها و خروجی‌های میانی بیلد پروژه‌های اندروید/جاوا/فلاتر.', en: 'Dependencies and intermediate build outputs for Android/Java/Flutter projects.' },
    i: { fa: 'امن است؛ بیلد بعدی کندتر است و وابستگی‌ها دوباره دانلود می‌شوند (اینترنت لازم است).', en: 'Safe; the next build is slower and re-downloads dependencies (needs internet).' },
    h: { fa: 'Android Studio را ببندید و محتویات را پاک کنید.', en: 'Close Android Studio, then empty it.' } });

  R({ id: 'gradle-wrapper', p: ['%USERPROFILE%/.gradle/wrapper/dists'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'نسخه‌های دانلودی Gradle', en: 'Downloaded Gradle distributions' },
    d: { fa: 'هر نسخه Gradle که پروژه‌ها خواسته‌اند (هرکدام ~۲۰۰ مگ).', en: 'Each Gradle version your projects requested (~200 MB each).' },
    i: { fa: 'امن است؛ در بیلد بعدی نسخه لازم دوباره دانلود می‌شود.', en: 'Safe; the needed version is re-downloaded on next build.' },
    h: { fa: 'نسخه‌های قدیمی را حذف کنید.', en: 'Delete old versions.' } });

  R({ id: 'maven', p: ['%USERPROFILE%/.m2/repository'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'مخزن محلی Maven', en: 'Maven local repository' }, d: { fa: 'کش وابستگی‌های جاوا.', en: 'Java dependency cache.' },
    i: { fa: 'امن است؛ دوباره دانلود می‌شود.', en: 'Safe; re-downloaded when needed.' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'nuget', p: ['%USERPROFILE%/.nuget/packages', '%LOCALAPPDATA%/NuGet/v3-cache', '%LOCALAPPDATA%/NuGet/Cache', '%LOCALAPPDATA%/NuGet/plugins-cache'], cat: 'cache', safety: 'safe', mode: 'none', action: 'nugetClean',
    t: { fa: 'کش NuGet (.NET)', en: 'NuGet cache (.NET)' }, d: { fa: 'پکیج‌های دانلودشده .NET.', en: 'Downloaded .NET packages.' },
    i: { fa: 'امن است؛ در restore بعدی دوباره دانلود می‌شوند.', en: 'Safe; restored on next build.' }, h: { fa: 'dotnet nuget locals all --clear', en: 'dotnet nuget locals all --clear' } });

  R({ id: 'pip', p: ['%LOCALAPPDATA%/pip/cache', '%LOCALAPPDATA%/pip/Cache', '%LOCALAPPDATA%/uv/cache', '%LOCALAPPDATA%/pypoetry/Cache', '%USERPROFILE%/.cache/pip'], cat: 'cache', safety: 'safe', mode: 'contents', action: 'pipPurge',
    t: { fa: 'کش pip / uv / Poetry (پایتون)', en: 'pip / uv / Poetry cache (Python)' }, d: { fa: 'پکیج‌های دانلودشده پایتون.', en: 'Downloaded Python packages.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'pip cache purge  |  uv cache clean', en: 'pip cache purge  |  uv cache clean' } });

  R({ id: 'conda-pkgs', p: ['%USERPROFILE%/anaconda3/pkgs', '%USERPROFILE%/miniconda3/pkgs', '%PROGRAMDATA%/anaconda3/pkgs', '%PROGRAMDATA%/miniconda3/pkgs', '%USERPROFILE%/.conda/pkgs'], cat: 'cache', safety: 'safe', mode: 'none', action: 'condaClean',
    t: { fa: 'کش پکیج‌های Conda', en: 'Conda package cache' }, d: { fa: 'آرشیو پکیج‌های Conda.', en: 'Conda package tarballs and extracted copies.' },
    i: { fa: 'با conda clean امن است؛ حذف دستی ممکن است محیط‌ها را خراب کند.', en: 'Safe via conda clean; manual deletion can break environments.' }, h: { fa: 'conda clean --all', en: 'conda clean --all' } });

  R({ id: 'venv', n: ['.venv', 'venv', 'env'], kind: 'dir', cat: 'dev', safety: 'caution', mode: 'item', markers: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'manage.py'],
    test: (p, ctx) => ctx.hasMarker(p, '>pyvenv.cfg'),
    t: { fa: 'محیط مجازی پایتون', en: 'Python virtual environment' },
    d: { fa: 'پکیج‌های پایتون نصب‌شده برای یک پروژه.', en: 'Python packages installed for one project.' },
    i: { fa: 'پروژه تا ساخت دوباره محیط اجرا نمی‌شود. اگر requirements.txt ندارید ممکن است نسخه‌ها را از دست بدهید.', en: 'Project won’t run until you recreate it. Without requirements.txt you may lose exact versions.' },
    h: { fa: 'قبل از حذف: pip freeze > requirements.txt ، بعد: python -m venv .venv و pip install -r requirements.txt', en: 'Before: pip freeze > requirements.txt; after: python -m venv .venv && pip install -r requirements.txt' } });

  R({ id: 'pycache', n: ['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'], kind: 'dir', cat: 'cache', safety: 'safe', mode: 'item',
    t: { fa: 'کش پایتون', en: 'Python cache' }, d: { fa: 'فایل‌های کامپایل‌شده و کش ابزارهای پایتون.', en: 'Compiled bytecode and tool caches.' },
    i: { fa: 'امن است، خودکار ساخته می‌شود.', en: 'Safe, regenerated automatically.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });

  R({ id: 'pub-cache', p: ['%LOCALAPPDATA%/Pub/Cache', '%APPDATA%/Pub/Cache'], cat: 'cache', safety: 'safe', mode: 'none', action: 'pubCacheClean',
    t: { fa: 'کش پکیج‌های Dart/Flutter', en: 'Dart/Flutter pub cache' },
    d: { fa: 'پکیج‌های pub.dev که پروژه‌های فلاتر از آن استفاده می‌کنند.', en: 'pub.dev packages used by your Flutter projects.' },
    i: { fa: 'امن است؛ در هر پروژه باید flutter pub get دوباره اجرا شود.', en: 'Safe; run flutter pub get again in each project.' },
    h: { fa: 'dart pub cache clean', en: 'dart pub cache clean' } });

  R({ id: 'flutter-build', n: ['build'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['pubspec.yaml'],
    test: (p, ctx) => ctx.hasMarker(p, 'pubspec.yaml'),
    t: { fa: 'خروجی بیلد پروژه Flutter', en: 'Flutter build output' },
    d: { fa: 'APK، فایل‌های میانی و خروجی بیلد فلاتر. با هر بیلد دوباره ساخته می‌شود.', en: 'APKs, intermediates and build artifacts. Regenerated on every build.' },
    i: { fa: 'امن است؛ بیلد بعدی کمی طولانی‌تر می‌شود. کد پروژه دست نمی‌خورد.', en: 'Safe; the next build takes a bit longer. Source code untouched.' },
    h: { fa: 'در پوشه پروژه: flutter clean', en: 'In the project folder: flutter clean' } });

  R({ id: 'dart-tool', n: ['.dart_tool'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item',
    t: { fa: 'کش ابزار Dart پروژه', en: 'Dart tool cache' }, d: { fa: 'کش پروژه فلاتر.', en: 'Flutter project cache.' },
    i: { fa: 'امن است؛ با flutter pub get بازسازی می‌شود.', en: 'Safe; rebuilt by flutter pub get.' }, h: { fa: 'flutter clean', en: 'flutter clean' } });

  R({ id: 'gradle-project', n: ['.gradle', '.cxx', '.externalNativeBuild'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item',
    test: (p, ctx) => !p.endsWith(ctx.userprofile + '/.gradle'),
    t: { fa: 'کش Gradle پروژه', en: 'Project Gradle cache' }, d: { fa: 'کش بیلد داخل پوشه پروژه.', en: 'Build cache inside a project folder.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'حذف کنید یا ./gradlew clean', en: 'Delete or ./gradlew clean' } });

  R({ id: 'android-build', n: ['build'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['build.gradle', 'build.gradle.kts'],
    test: (p, ctx) => ctx.hasMarker(p, 'build.gradle') || ctx.hasMarker(p, 'build.gradle.kts'),
    t: { fa: 'خروجی بیلد Gradle/Android', en: 'Gradle/Android build output' }, d: { fa: 'خروجی بیلد ماژول اندروید/جاوا.', en: 'Build output of an Android/Java module.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: './gradlew clean', en: './gradlew clean' } });

  R({ id: 'rust-target', n: ['target'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['Cargo.toml', 'pom.xml'],
    test: (p, ctx) => ctx.hasMarker(p, 'Cargo.toml') || ctx.hasMarker(p, 'pom.xml'),
    t: { fa: 'خروجی بیلد Rust/Maven', en: 'Rust/Maven build output' }, d: { fa: 'خروجی کامپایل؛ معمولاً خیلی بزرگ.', en: 'Compiler output; usually very large.' },
    i: { fa: 'امن است؛ کامپایل بعدی کامل انجام می‌شود.', en: 'Safe; next build is a full rebuild.' }, h: { fa: 'cargo clean  |  mvn clean', en: 'cargo clean  |  mvn clean' } });

  R({ id: 'dotnet-binobj', n: ['bin', 'obj'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['*.csproj'],
    test: (p, ctx) => ctx.hasMarker(p, '*.csproj') || ctx.hasMarker(p, '*.vbproj') || ctx.hasMarker(p, '*.fsproj'),
    t: { fa: 'خروجی بیلد .NET', en: '.NET build output' }, d: { fa: 'فایل‌های کامپایل‌شده پروژه .NET.', en: 'Compiled output of a .NET project.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'dotnet clean یا حذف پوشه', en: 'dotnet clean or delete' } });

  R({ id: 'js-build', n: ['.next', '.nuxt', '.angular', '.turbo', '.parcel-cache', '.svelte-kit', '.expo', '.vite'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item',
    t: { fa: 'کش بیلد فریم‌ورک JS', en: 'JS framework build cache' }, d: { fa: 'خروجی/کش Next.js، Nuxt، Angular و ...', en: 'Next.js / Nuxt / Angular… build cache.' },
    i: { fa: 'امن است، با build/dev بعدی ساخته می‌شود.', en: 'Safe, regenerated by the next build/dev run.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });

  R({ id: 'composer-vendor', n: ['vendor'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['composer.json'],
    test: (p, ctx) => ctx.hasMarker(p, 'composer.json'),
    t: { fa: 'وابستگی‌های پروژه PHP (Composer)', en: 'PHP project dependencies (Composer)' },
    d: { fa: 'پکیج‌های Composer (مثلاً لاراول). با composer install برمی‌گردد.', en: 'Composer packages (e.g. Laravel). Restored with composer install.' },
    i: { fa: 'پروژه تا اجرای composer install کار نمی‌کند.', en: 'The project won’t run until composer install.' }, h: { fa: 'composer install', en: 'composer install' } });

  R({ id: 'composer-cache', p: ['%LOCALAPPDATA%/Composer', '%APPDATA%/Composer/cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Composer', en: 'Composer cache' }, d: { fa: 'کش دانلود پکیج‌های PHP.', en: 'PHP package download cache.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'composer clear-cache', en: 'composer clear-cache' } });

  R({ id: 'go-mod', p: ['%USERPROFILE%/go/pkg/mod', '%LOCALAPPDATA%/go-build'], cat: 'cache', safety: 'safe', mode: 'none', action: 'goClean',
    t: { fa: 'کش ماژول‌های Go', en: 'Go module cache' }, d: { fa: 'ماژول‌ها و کش بیلد Go.', en: 'Go modules and build cache.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'go clean -modcache -cache', en: 'go clean -modcache -cache' } });

  R({ id: 'cargo-reg', p: ['%USERPROFILE%/.cargo/registry', '%USERPROFILE%/.cargo/git'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Cargo (Rust)', en: 'Cargo registry cache' }, d: { fa: 'کرِیت‌های دانلودشده Rust.', en: 'Downloaded Rust crates.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'flutter-sdk', p: ['{D}/src/flutter', '%USERPROFILE%/flutter', '{D}/flutter', '%USERPROFILE%/fvm/versions/*'], cat: 'dev', safety: 'danger', mode: 'none',
    t: { fa: 'Flutter SDK', en: 'Flutter SDK' }, d: { fa: 'خود SDK فلاتر؛ احتمالاً در PATH سیستم ثبت است.', en: 'The Flutter SDK itself; probably registered in your PATH.' },
    i: { fa: 'حذف = از کار افتادن دستور flutter و همه پروژه‌های فلاتر.', en: 'Deleting it breaks the flutter command and all Flutter projects.' },
    h: { fa: 'دست نزنید. برای فضای بیشتر flutter clean را در پروژه‌ها بزنید.', en: 'Keep it. Run flutter clean in projects to save space.' } });

  R({ id: 'jetbrains-old', p: ['%LOCALAPPDATA%/JetBrains/*', '%APPDATA%/JetBrains/*'], kind: 'dir', cat: 'cache', safety: 'safe', mode: 'item',
    test: (p, ctx) => ctx.isOldJetBrains(p),
    t: { fa: 'داده‌های نسخه قدیمی IDE جت‌برینز', en: 'Old JetBrains IDE version data' },
    d: { fa: 'کش و تنظیمات یک نسخه قدیمی (مثلاً PhpStorm 2025.3) در حالی که نسخه جدیدتر نصب شده است.', en: 'Caches/settings of an older IDE version (e.g. PhpStorm 2025.3) while a newer version is installed.' },
    i: { fa: 'امن است؛ نسخه جدید تنظیماتش را قبلاً منتقل کرده است.', en: 'Safe; the newer version already migrated its settings.' },
    h: { fa: 'حذف کنید. (JetBrains Toolbox هم گزینه حذف نسخه‌های قدیمی دارد.)', en: 'Delete it. (JetBrains Toolbox can also remove old versions.)' } });

  R({ id: 'jetbrains-cache', p: ['%LOCALAPPDATA%/JetBrains/*/caches', '%LOCALAPPDATA%/JetBrains/*/index', '%LOCALAPPDATA%/JetBrains/*/tmp', '%LOCALAPPDATA%/JetBrains/*/log', '%LOCALAPPDATA%/JetBrains/*/editor'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش و ایندکس IDE جت‌برینز', en: 'JetBrains IDE caches & index' }, d: { fa: 'ایندکس پروژه‌ها و فایل‌های موقت آپدیت IDE.', en: 'Project indexes and IDE update temp files.' },
    i: { fa: 'امن است؛ اولین باز کردن پروژه ایندکس دوباره ساخته می‌شود. IDE باید بسته باشد.', en: 'Safe; indexes rebuild on next open. Close the IDE first.' },
    h: { fa: 'File > Invalidate Caches، یا با IDE بسته محتویات را پاک کنید.', en: 'File > Invalidate Caches, or empty with the IDE closed.' } });

  R({ id: 'vscode-cache', p: ['%APPDATA%/Code/Cache', '%APPDATA%/Code/CachedData', '%APPDATA%/Code/CachedExtensionVSIXs', '%APPDATA%/Code/Code Cache', '%APPDATA%/Code/GPUCache', '%APPDATA%/Code/logs', '%APPDATA%/Code/Service Worker/CacheStorage', '%APPDATA%/Cursor/Cache', '%APPDATA%/Cursor/CachedData', '%APPDATA%/Cursor/logs', '%APPDATA%/Cursor/CachedExtensionVSIXs'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش VS Code / Cursor', en: 'VS Code / Cursor cache' }, d: { fa: 'کش، لاگ و نسخه‌های قدیمی دانلودشده ادیتور.', en: 'Editor cache, logs and old downloaded versions.' },
    i: { fa: 'امن است (ادیتور را ببندید).', en: 'Safe (close the editor first).' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'vscode-ws', p: ['%APPDATA%/Code/User/workspaceStorage', '%APPDATA%/Cursor/User/workspaceStorage'], cat: 'cache', safety: 'caution', mode: 'contents',
    t: { fa: 'حافظه ورک‌اسپیس VS Code', en: 'VS Code workspace storage' }, d: { fa: 'وضعیت هر پروژه (تب‌های باز، تاریخچه، داده افزونه‌ها). برای پروژه‌های قدیمی هم باقی می‌ماند.', en: 'Per-project state (open tabs, history, extension data). Kept even for old projects.' },
    i: { fa: 'تب‌های باز و برخی تنظیمات محلی پروژه‌ها فراموش می‌شوند؛ کد آسیبی نمی‌بیند.', en: 'Open tabs and some local per-project state are forgotten; code is safe.' }, h: { fa: 'با ادیتور بسته محتویات را پاک کنید.', en: 'Empty with the editor closed.' } });

  R({ id: 'vscode-ext', p: ['%USERPROFILE%/.vscode/extensions', '%USERPROFILE%/.cursor/extensions'], cat: 'dev', safety: 'caution', mode: 'none',
    t: { fa: 'افزونه‌های VS Code', en: 'VS Code extensions' }, d: { fa: 'افزونه‌های نصب‌شده. گاهی نسخه‌های قدیمی هم باقی می‌مانند.', en: 'Installed extensions; old versions sometimes linger.' },
    i: { fa: 'حذف دستی افزونه‌ها را از کار می‌اندازد.', en: 'Manual deletion breaks extensions.' }, h: { fa: 'افزونه‌های بلااستفاده را از داخل VS Code حذف کنید.', en: 'Uninstall unused extensions inside VS Code.' } });

  R({ id: 'vs-cache', p: ['%LOCALAPPDATA%/Microsoft/VisualStudio/*/ComponentModelCache', '%LOCALAPPDATA%/Microsoft/VSApplicationInsights', '%LOCALAPPDATA%/Temp/VSFeedbackIntelliCodeLogs'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Visual Studio', en: 'Visual Studio cache' }, d: { fa: 'کش داخلی Visual Studio.', en: 'Visual Studio internal cache.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'با VS بسته محتویات را پاک کنید.', en: 'Empty with VS closed.' } });

  R({ id: 'git', n: ['.git'], kind: 'dir', cat: 'dev', safety: 'danger', mode: 'none',
    t: { fa: 'مخزن Git پروژه', en: 'Git repository' }, d: { fa: 'تمام تاریخچه کامیت‌ها و برنچ‌های پروژه.', en: 'Entire commit history and branches of the project.' },
    i: { fa: 'حذف = از دست رفتن تاریخچه و تغییرات push نشده.', en: 'Deleting it loses history and unpushed work.' }, h: { fa: 'برای کوچک کردن: git gc --aggressive --prune=now', en: 'To shrink: git gc --aggressive --prune=now' } });

  R({ id: 'unity-lib', n: ['Library'], kind: 'dir', cat: 'dev', safety: 'safe', mode: 'item', markers: ['Assets'],
    test: (p, ctx) => ctx.hasMarker(p, 'Assets') && ctx.hasMarker(p, 'ProjectSettings'),
    t: { fa: 'کش پروژه Unity', en: 'Unity project Library cache' }, d: { fa: 'کش ایمپورت پروژه Unity.', en: 'Unity import cache.' },
    i: { fa: 'امن است؛ باز کردن بعدی پروژه طول می‌کشد.', en: 'Safe; next open re-imports (slow).' }, h: { fa: 'با Unity بسته حذف کنید.', en: 'Delete with Unity closed.' } });

  R({ id: 'laragon-tmp', p: ['{D}/laragon/tmp', '{D}/laragon/data/*/tmp', '{D}/xampp/tmp'], cat: 'temp', safety: 'safe', mode: 'contents',
    t: { fa: 'فایل‌های موقت Laragon/XAMPP', en: 'Laragon/XAMPP temp files' }, d: { fa: 'سشن‌ها و فایل‌های موقت وب‌سرور محلی.', en: 'Local web server sessions & temp files.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'laragon-www', p: ['{D}/laragon/www', '{D}/xampp/htdocs', '{D}/wamp64/www'], cat: 'user', safety: 'user', mode: 'none',
    t: { fa: 'پروژه‌های وب محلی', en: 'Local web projects' }, d: { fa: 'سورس پروژه‌های وب شما.', en: 'Your web project sources.' },
    i: { fa: 'کد پروژه‌ها! فقط پروژه‌هایی که بکاپ دارند را حذف کنید.', en: 'Your code! Only delete projects you have backed up.' }, h: { fa: 'داخل پروژه‌ها node_modules و vendor را بررسی کنید.', en: 'Check node_modules/vendor inside projects instead.' } });

  R({ id: 'claude-code', p: ['%USERPROFILE%/.claude/projects'], cat: 'ai', safety: 'caution', mode: 'none',
    t: { fa: 'تاریخچه گفتگوهای Claude Code', en: 'Claude Code session history' }, d: { fa: 'ترنسکریپت سشن‌های Claude Code برای ادامه دادن گفتگوها.', en: 'Claude Code session transcripts used to resume conversations.' },
    i: { fa: 'امکان resume سشن‌های قدیمی از بین می‌رود.', en: 'You can no longer resume old sessions.' }, h: { fa: 'پوشه پروژه‌های قدیمی را حذف کنید.', en: 'Delete folders of old projects.' } });

  // ───────────────────────── AI models ─────────────────────────
  R({ id: 'ai-models', p: ['%USERPROFILE%/.ollama/models', '%USERPROFILE%/.cache/huggingface', '%USERPROFILE%/.cache/lm-studio', '%USERPROFILE%/.lmstudio/models', '%USERPROFILE%/.cache/torch', '%USERPROFILE%/.cache/whisper'], cat: 'ai', safety: 'caution', mode: 'none',
    t: { fa: 'مدل‌های هوش مصنوعی', en: 'AI models' }, d: { fa: 'مدل‌های دانلودشده (Ollama، HuggingFace، LM Studio). هر مدل چند گیگ است.', en: 'Downloaded models (Ollama, HuggingFace, LM Studio). Each is several GB.' },
    i: { fa: 'مدل‌ها دوباره قابل دانلودند، ولی حجم دانلود زیاد است.', en: 'Models can be re-downloaded, but downloads are large.' }, h: { fa: 'ollama rm <model>  |  huggingface-cli delete-cache', en: 'ollama rm <model>  |  huggingface-cli delete-cache' } });

  // ───────────────────────── Browsers & apps ─────────────────────────
  R({ id: 'browser-cache', p: ['%LOCALAPPDATA%/Google/Chrome/User Data/*/Cache', '%LOCALAPPDATA%/Google/Chrome/User Data/*/Code Cache', '%LOCALAPPDATA%/Google/Chrome/User Data/*/GPUCache', '%LOCALAPPDATA%/Google/Chrome/User Data/*/Service Worker/CacheStorage', '%LOCALAPPDATA%/Google/Chrome/User Data/ShaderCache', '%LOCALAPPDATA%/Google/Chrome/User Data/GrShaderCache',
    '%LOCALAPPDATA%/Microsoft/Edge/User Data/*/Cache', '%LOCALAPPDATA%/Microsoft/Edge/User Data/*/Code Cache', '%LOCALAPPDATA%/Microsoft/Edge/User Data/*/Service Worker/CacheStorage', '%LOCALAPPDATA%/Microsoft/Edge/User Data/*/GPUCache',
    '%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/Cache', '%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/Code Cache', '%LOCALAPPDATA%/Mozilla/Firefox/Profiles/*/cache2', '%APPDATA%/Opera Software/*/Cache'], cat: 'browser', safety: 'safe', mode: 'contents',
    t: { fa: 'کش مرورگر', en: 'Browser cache' }, d: { fa: 'کش صفحات وب، اسکریپت‌ها و تصاویر.', en: 'Cached web pages, scripts and images.' },
    i: { fa: 'امن است؛ پسوردها، بوکمارک‌ها و لاگین‌ها حفظ می‌شوند. سایت‌ها اولین بار کمی کندتر باز می‌شوند.', en: 'Safe; passwords, bookmarks and logins are kept. Sites load a bit slower at first.' },
    h: { fa: 'مرورگر را ببندید و محتویات را پاک کنید (یا Ctrl+Shift+Del در مرورگر).', en: 'Close the browser and empty it (or Ctrl+Shift+Del in the browser).' } });

  R({ id: 'browser-profile', p: ['%LOCALAPPDATA%/Google/Chrome/User Data', '%LOCALAPPDATA%/Microsoft/Edge/User Data', '%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data', '%APPDATA%/Mozilla/Firefox/Profiles'], cat: 'browser', safety: 'danger', mode: 'none',
    t: { fa: 'پروفایل مرورگر', en: 'Browser profile' }, d: { fa: 'پسوردها، بوکمارک‌ها، تاریخچه، افزونه‌ها و کش مرورگر.', en: 'Passwords, bookmarks, history, extensions and cache.' },
    i: { fa: 'حذف = از دست رفتن همه اطلاعات مرورگر.', en: 'Deleting it loses all browser data.' }, h: { fa: 'فقط زیرپوشه‌های Cache را پاک کنید.', en: 'Only clean the Cache subfolders.' } });

  R({ id: 'app-caches', p: ['%APPDATA%/discord/Cache', '%APPDATA%/discord/Code Cache', '%APPDATA%/Slack/Cache', '%APPDATA%/Slack/Service Worker/CacheStorage', '%APPDATA%/Microsoft/Teams/Cache', '%APPDATA%/Microsoft/Teams/Service Worker/CacheStorage', '%LOCALAPPDATA%/Packages/MSTeams_*/LocalCache/Microsoft/MSTeams/EBWebView', '%LOCALAPPDATA%/Spotify/Storage', '%LOCALAPPDATA%/Spotify/Data', '%APPDATA%/Postman/Cache', '%APPDATA%/Notion/Cache', '%APPDATA%/obsidian/Cache', '%APPDATA%/WhatsApp/Cache', '%APPDATA%/Figma/DesktopProfile/*/Cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش برنامه‌ها (Discord، Spotify، Teams …)', en: 'App cache (Discord, Spotify, Teams…)' }, d: { fa: 'کش برنامه‌های مبتنی بر Electron و پخش آفلاین.', en: 'Cache of Electron-based apps and streaming apps.' },
    i: { fa: 'امن است؛ برنامه را ببندید. (در Spotify آهنگ‌های آفلاین دوباره دانلود می‌شوند.)', en: 'Safe; close the app first. (Spotify offline songs re-download.)' }, h: { fa: 'با برنامه بسته محتویات را پاک کنید.', en: 'Empty with the app closed.' } });

  R({ id: 'telegram', p: ['%APPDATA%/Telegram Desktop/tdata/user_data', '%APPDATA%/Telegram Desktop/tdata/emoji'], cat: 'cache', safety: 'safe', mode: 'none',
    t: { fa: 'کش تلگرام دسکتاپ', en: 'Telegram Desktop cache' }, d: { fa: 'عکس‌ها، ویدیوها و فایل‌هایی که در تلگرام دیده‌اید.', en: 'Photos, videos and files you viewed in Telegram.' },
    i: { fa: 'پیام‌ها روی سرور تلگرام هستند؛ فقط کش محلی پاک می‌شود.', en: 'Messages stay on Telegram servers; only the local cache is cleared.' }, h: { fa: 'Telegram > Settings > Advanced > Manage local storage > Clear all', en: 'Telegram > Settings > Advanced > Manage local storage > Clear all' } });

  R({ id: 'telegram-dl', p: ['%USERPROFILE%/Downloads/Telegram Desktop'], cat: 'user', safety: 'user', mode: 'item',
    t: { fa: 'دانلودهای تلگرام', en: 'Telegram downloads' }, d: { fa: 'فایل‌هایی که از تلگرام ذخیره کرده‌اید.', en: 'Files you saved from Telegram.' },
    i: { fa: 'فایل‌های شخصی؛ بررسی کنید.', en: 'Personal files; review first.' }, h: { fa: 'فایل‌های لازم را جابجا و بقیه را حذف کنید.', en: 'Move what you need, delete the rest.' } });

  R({ id: 'adobe-cache', p: ['%APPDATA%/Adobe/Common/Media Cache Files', '%APPDATA%/Adobe/Common/Media Cache', '%APPDATA%/Adobe/Common/Peak Files', '%LOCALAPPDATA%/Adobe/*/Cache', '%APPDATA%/Adobe/Adobe Photoshop */CT Font Cache'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش رسانه Adobe', en: 'Adobe media cache' }, d: { fa: 'کش Premiere / After Effects / Photoshop.', en: 'Premiere / After Effects / Photoshop cache.' },
    i: { fa: 'امن است؛ پروژه‌ها سالم می‌مانند.', en: 'Safe; projects stay intact.' }, h: { fa: 'از تنظیمات Media Cache در برنامه یا پاک کردن محتویات.', en: 'Use the app’s Media Cache settings or empty it.' } });

  R({ id: 'adobe-temp', p: ['%LOCALAPPDATA%/Temp/Photoshop Temp*', '%PROGRAMDATA%/Adobe/ARM', '%PROGRAMDATA%/Adobe/Setup'], cat: 'temp', safety: 'caution', mode: 'contents',
    t: { fa: 'فایل‌های موقت/نصب Adobe', en: 'Adobe temp/setup files' }, d: { fa: 'فایل‌های موقت و آپدیت Adobe.', en: 'Adobe temp and update files.' },
    i: { fa: 'معمولاً امن است وقتی برنامه‌های Adobe بسته‌اند.', en: 'Usually safe with Adobe apps closed.' }, h: { fa: 'با برنامه‌های بسته پاک کنید.', en: 'Clean with apps closed.' } });

  R({ id: 'steam-games', p: ['{D}/Program Files (x86)/Steam/steamapps/common/*', '{D}/SteamLibrary/steamapps/common/*', '{D}/Program Files/Epic Games/*', '{D}/XboxGames/*'], cat: 'games', safety: 'user', mode: 'none',
    t: { fa: 'بازی نصب‌شده', en: 'Installed game' }, d: { fa: 'فایل‌های یک بازی.', en: 'Files of an installed game.' },
    i: { fa: 'حذف دستی ممکن است لانچر را گیج کند.', en: 'Manual deletion can confuse the launcher.' }, h: { fa: 'از Steam/Epic/Xbox بازی را Uninstall کنید یا به درایو دیگری منتقل کنید.', en: 'Uninstall or move it to another drive from Steam/Epic/Xbox.' } });

  R({ id: 'steam-cache', p: ['{D}/Program Files (x86)/Steam/steamapps/shadercache', '{D}/Program Files (x86)/Steam/steamapps/downloading', '{D}/Program Files (x86)/Steam/appcache', '{D}/Program Files (x86)/Steam/logs', '{D}/Program Files (x86)/Steam/dumps'], cat: 'cache', safety: 'safe', mode: 'contents',
    t: { fa: 'کش Steam', en: 'Steam cache' }, d: { fa: 'کش شیدر و فایل‌های موقت Steam.', en: 'Steam shader cache and temp files.' },
    i: { fa: 'امن است (Steam را ببندید).', en: 'Safe (close Steam).' }, h: { fa: 'محتویات را پاک کنید.', en: 'Empty it.' } });

  R({ id: 'itunes-backup', p: ['%APPDATA%/Apple Computer/MobileSync/Backup', '%USERPROFILE%/Apple/MobileSync/Backup'], cat: 'backup', safety: 'user', mode: 'item',
    t: { fa: 'بکاپ آیفون/آیپد', en: 'iPhone/iPad backups' }, d: { fa: 'بکاپ‌های iTunes / Apple Devices.', en: 'iTunes / Apple Devices backups.' },
    i: { fa: 'اگر بکاپ دیگری ندارید اطلاعات گوشی از دست می‌رود.', en: 'If you have no other backup, phone data is lost.' }, h: { fa: 'بکاپ‌های قدیمی را از Apple Devices حذف کنید.', en: 'Delete old backups from Apple Devices.' } });

  R({ id: 'onedrive', p: ['%USERPROFILE%/OneDrive', '%USERPROFILE%/OneDrive - *'], cat: 'user', safety: 'user', mode: 'none',
    t: { fa: 'OneDrive', en: 'OneDrive' }, d: { fa: 'فایل‌های همگام‌شده با OneDrive.', en: 'Files synced with OneDrive.' },
    i: { fa: 'حذف اینجا = حذف از فضای ابری هم!', en: 'Deleting here also deletes from the cloud!' }, h: { fa: 'روی پوشه راست‌کلیک > «Free up space» تا فقط در فضای ابری بماند.', en: 'Right-click > “Free up space” to keep it cloud-only.' } });

  R({ id: 'downloads', p: ['%USERPROFILE%/Downloads'], cat: 'user', safety: 'user', mode: 'none',
    t: { fa: 'دانلودها', en: 'Downloads' }, d: { fa: 'فایل‌هایی که دانلود کرده‌اید؛ معمولاً پر از نصب‌کننده‌ها و فایل‌های فشرده قدیمی.', en: 'Your downloads; usually full of old installers and archives.' },
    i: { fa: 'فایل‌های شخصی؛ قبل از حذف بررسی کنید.', en: 'Personal files; review before deleting.' }, h: { fa: 'فایل‌های .exe / .msi / .zip نصب‌شده یا استخراج‌شده را حذف کنید.', en: 'Delete installers and archives you already installed/extracted.' } });

  R({ id: 'user-folders', p: ['%USERPROFILE%/Desktop', '%USERPROFILE%/Documents', '%USERPROFILE%/Pictures', '%USERPROFILE%/Videos', '%USERPROFILE%/Music'], cat: 'user', safety: 'user', mode: 'none',
    t: { fa: 'فایل‌های شخصی', en: 'Personal files' }, d: { fa: 'پوشه‌های شخصی شما.', en: 'Your personal folders.' },
    i: { fa: 'فقط خودتان می‌دانید چه چیزی لازم است.', en: 'Only you know what you need.' }, h: { fa: 'فایل‌های بزرگ را به درایو دیگر منتقل کنید.', en: 'Move large files to another drive.' } });

  // ───────────────────────── Generic extension rules (files) ─────────────────────────
  R({ id: 'ext-dmp', ext: ['dmp', 'hdmp', 'mdmp'], kind: 'file', cat: 'temp', safety: 'safe', mode: 'item',
    t: { fa: 'فایل دامپ کرش', en: 'Crash dump file' }, d: { fa: 'کپی حافظه یک برنامه هنگام کرش.', en: 'Memory snapshot written when a program crashed.' },
    i: { fa: 'امن است.', en: 'Safe.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });
  R({ id: 'ext-tmp', ext: ['tmp', 'temp', 'crdownload', 'partial'], kind: 'file', cat: 'temp', safety: 'safe', mode: 'item',
    t: { fa: 'فایل موقت', en: 'Temporary file' }, d: { fa: 'فایل موقت یا دانلود ناتمام.', en: 'Temporary file or unfinished download.' },
    i: { fa: 'معمولاً امن است.', en: 'Usually safe.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });
  R({ id: 'ext-vdisk', ext: ['vhdx', 'vhd', 'vmdk', 'vdi', 'qcow2', 'avhdx'], kind: 'file', cat: 'vm', safety: 'caution', mode: 'none', action: 'compactVhdx',
    t: { fa: 'دیسک مجازی', en: 'Virtual disk' }, d: { fa: 'هارد یک ماشین مجازی/کانتینر/شبیه‌ساز.', en: 'Hard disk of a VM, container or emulator.' },
    i: { fa: 'حذف = از دست رفتن کل محتوای آن ماشین مجازی.', en: 'Deleting loses the entire VM content.' }, h: { fa: 'از داخل نرم‌افزار مربوطه حذف یا فشرده کنید.', en: 'Delete or compact it from the owning app.' } });
  R({ id: 'ext-iso', ext: ['iso', 'img', 'esd', 'wim'], kind: 'file', cat: 'media', safety: 'user', mode: 'item',
    t: { fa: 'ایمیج دیسک', en: 'Disk image' }, d: { fa: 'فایل ایمیج (نصب ویندوز، بازی، نرم‌افزار).', en: 'Disk image (OS installer, game, software).' },
    i: { fa: 'اگر قبلاً نصب کرده‌اید معمولاً لازم نیست. (اگر جزو یک برنامه است دست نزنید.)', en: 'Usually not needed after installation. (Leave it if it belongs to an app.)' }, h: { fa: 'حذف یا انتقال به درایو دیگر.', en: 'Delete or move to another drive.' } });
  R({ id: 'ext-archive', ext: ['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'bz2'], kind: 'file', cat: 'media', safety: 'user', mode: 'item',
    t: { fa: 'فایل فشرده', en: 'Archive' }, d: { fa: 'آرشیو فشرده.', en: 'Compressed archive.' },
    i: { fa: 'اگر استخراج کرده‌اید، معمولاً نسخه فشرده لازم نیست.', en: 'If already extracted, the archive is usually redundant.' }, h: { fa: 'بررسی و حذف.', en: 'Review and delete.' } });
  R({ id: 'ext-installer', ext: ['msi', 'msix', 'exe', 'apk', 'aab'], kind: 'file', cat: 'media', safety: 'user', mode: 'item',
    test: (p, ctx) => p.startsWith(ctx.userprofile + '/downloads/') || p.startsWith(ctx.userprofile + '/desktop/'),
    t: { fa: 'فایل نصب‌کننده', en: 'Installer file' }, d: { fa: 'فایل نصب یک برنامه که دانلود کرده‌اید.', en: 'A downloaded installer.' },
    i: { fa: 'اگر برنامه نصب شده، نصب‌کننده دیگر لازم نیست.', en: 'Once installed, the installer is no longer needed.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });
  R({ id: 'ext-video', ext: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', 'ts'], kind: 'file', cat: 'media', safety: 'user', mode: 'item',
    t: { fa: 'ویدیو', en: 'Video' }, d: { fa: 'فایل ویدیویی.', en: 'Video file.' },
    i: { fa: 'فایل شخصی.', en: 'Personal file.' }, h: { fa: 'به درایو دیگر منتقل کنید.', en: 'Move to another drive.' } });
  R({ id: 'ext-log', ext: ['log', 'etl'], kind: 'file', cat: 'temp', safety: 'caution', mode: 'item',
    t: { fa: 'فایل لاگ', en: 'Log file' }, d: { fa: 'گزارش متنی یک برنامه یا سرویس.', en: 'Text log of a program or service.' },
    i: { fa: 'معمولاً امن است؛ اگر برنامه در حال نوشتن باشد قفل است.', en: 'Usually safe; locked if the program is writing to it.' }, h: { fa: 'حذف کنید.', en: 'Delete.' } });
  R({ id: 'ext-pst', ext: ['pst'], kind: 'file', cat: 'user', safety: 'danger', mode: 'none',
    t: { fa: 'آرشیو ایمیل Outlook', en: 'Outlook data file (PST)' }, d: { fa: 'ایمیل‌ها و تقویم Outlook.', en: 'Outlook mail and calendar.' },
    i: { fa: 'ممکن است ایمیل‌ها برای همیشه از دست بروند.', en: 'Mail may be lost permanently.' }, h: { fa: 'از Outlook آرشیو کنید.', en: 'Archive from Outlook.' } });
  R({ id: 'ext-ost', ext: ['ost'], kind: 'file', cat: 'cache', safety: 'caution', mode: 'none',
    t: { fa: 'کش ایمیل Outlook', en: 'Outlook offline cache (OST)' }, d: { fa: 'کپی آفلاین صندوق ایمیل.', en: 'Offline copy of your mailbox.' },
    i: { fa: 'از سرور دوباره دانلود می‌شود.', en: 'Re-downloaded from the server.' }, h: { fa: 'در Outlook بازه «Mail to keep offline» را کم کنید.', en: 'Reduce “Mail to keep offline” in Outlook.' } });
  R({ id: 'ext-ai', ext: ['gguf', 'safetensors', 'ckpt', 'onnx', 'pt', 'pth'], kind: 'file', cat: 'ai', safety: 'caution', mode: 'item',
    t: { fa: 'فایل مدل هوش مصنوعی', en: 'AI model file' }, d: { fa: 'وزن‌های یک مدل یادگیری ماشین.', en: 'Machine-learning model weights.' },
    i: { fa: 'قابل دانلود مجدد ولی حجیم.', en: 'Re-downloadable but large.' }, h: { fa: 'مدل‌های بلااستفاده را حذف کنید.', en: 'Remove unused models.' } });
  R({ id: 'ext-bak', ext: ['bak', 'old', 'backup'], kind: 'file', cat: 'backup', safety: 'caution', mode: 'item',
    t: { fa: 'فایل پشتیبان', en: 'Backup file' }, d: { fa: 'نسخه پشتیبان یک فایل.', en: 'Backup copy of a file.' },
    i: { fa: 'اگر نسخه اصلی سالم است معمولاً لازم نیست.', en: 'Usually unnecessary if the original is fine.' }, h: { fa: 'بررسی و حذف.', en: 'Review and delete.' } });

  // dmp / tmp are harmless wherever they live — they win over location-based protection
  for (const r of RULES) if (r.id === 'ext-dmp' || r.id === 'ext-tmp') r.strong = true;

  // ───────────────────────── Metadata ─────────────────────────
  const SAFETY = {
    safe:    { fa: 'حذف امن', en: 'Safe to delete', color: 'var(--safe)', rank: 0 },
    caution: { fa: 'با احتیاط', en: 'Use caution', color: 'var(--caution)', rank: 1 },
    user:    { fa: 'فایل شخصی', en: 'Personal data', color: 'var(--user)', rank: 2 },
    danger:  { fa: 'حذف نکنید', en: 'Do not delete', color: 'var(--danger)', rank: 3 },
    unknown: { fa: 'ناشناخته', en: 'Unknown', color: 'var(--muted)', rank: 2 },
  };

  const CATEGORIES = {
    system:  { fa: 'سیستم ویندوز', en: 'Windows system', color: '#7c8cff' },
    apps:    { fa: 'برنامه‌ها', en: 'Applications', color: '#4cc9f0' },
    vm:      { fa: 'ماشین مجازی و Docker', en: 'VMs & containers', color: '#f72585' },
    dev:     { fa: 'ابزار برنامه‌نویسی', en: 'Developer tools', color: '#b388ff' },
    cache:   { fa: 'کش‌ها', en: 'Caches', color: '#ffb703' },
    temp:    { fa: 'موقت و لاگ', en: 'Temp & logs', color: '#fb8500' },
    browser: { fa: 'مرورگرها', en: 'Browsers', color: '#06d6a0' },
    ai:      { fa: 'مدل‌های هوش مصنوعی', en: 'AI models', color: '#ff70a6' },
    games:   { fa: 'بازی‌ها', en: 'Games', color: '#80ed99' },
    media:   { fa: 'رسانه و آرشیو', en: 'Media & archives', color: '#48cae4' },
    backup:  { fa: 'پشتیبان', en: 'Backups', color: '#e9c46a' },
    user:    { fa: 'فایل‌های شخصی', en: 'Personal files', color: '#3a86ff' },
    appdata: { fa: 'داده برنامه‌ها', en: 'App data', color: '#2ec4b6' },
    other:   { fa: 'سایر', en: 'Other', color: '#6c757d' },
  };

  // Display text for built-in actions (execution lives in main.js — renderer only sends the id)
  const ACTIONS = {
    emptyRecycleBin: { admin: false, icon: 'trash', t: { fa: 'خالی کردن سطل بازیافت', en: 'Empty Recycle Bin' }, d: { fa: 'سطل بازیافت همه درایوها خالی می‌شود.', en: 'Empties the Recycle Bin on all drives.' } },
    cleanTemp: { admin: false, icon: 'broom', t: { fa: 'پاکسازی فایل‌های موقت', en: 'Clean temporary files' }, d: { fa: 'محتویات پوشه‌های Temp (فایل‌های در حال استفاده رد می‌شوند).', en: 'Empties Temp folders (in-use files are skipped).' } },
    diskCleanup: { admin: false, icon: 'disk', t: { fa: 'ابزار Disk Cleanup ویندوز', en: 'Windows Disk Cleanup' }, d: { fa: 'ابزار رسمی ویندوز برای پاکسازی آپدیت‌ها، Windows.old و ...', en: 'Official tool for update leftovers, Windows.old, etc.' }, cmd: 'cleanmgr.exe' },
    storageSense: { admin: false, icon: 'gear', t: { fa: 'Storage Sense', en: 'Storage Sense' }, d: { fa: 'پاکسازی خودکار ویندوز را فعال کنید.', en: 'Turn on Windows automatic cleanup.' } },
    dismCleanup: { admin: true, icon: 'shield', t: { fa: 'پاکسازی WinSxS با DISM', en: 'Clean WinSxS with DISM' }, d: { fa: 'نسخه‌های قدیمی کامپوننت‌های ویندوز به‌صورت امن حذف می‌شوند (چند دقیقه طول می‌کشد).', en: 'Safely removes superseded Windows components (takes a few minutes).' }, cmd: 'Dism.exe /Online /Cleanup-Image /StartComponentCleanup' },
    hibernateOff: { admin: true, icon: 'moon', t: { fa: 'غیرفعال‌سازی Hibernate', en: 'Disable hibernation' }, d: { fa: 'فایل hiberfil.sys حذف می‌شود. Fast Startup هم غیرفعال می‌شود.', en: 'Removes hiberfil.sys. Also disables Fast Startup.' }, cmd: 'powercfg -h off' },
    hibernateReduced: { admin: true, icon: 'moon', t: { fa: 'کوچک‌کردن فایل Hibernate', en: 'Shrink hibernation file' }, d: { fa: 'Fast Startup حفظ می‌شود ولی Hibernate کامل نه؛ حجم فایل نصف می‌شود.', en: 'Keeps Fast Startup, drops full Hibernate; file roughly halves.' }, cmd: 'powercfg /h /type reduced' },
    openVirtualMemory: { admin: false, icon: 'gear', t: { fa: 'تنظیمات حافظه مجازی', en: 'Virtual memory settings' }, d: { fa: 'Performance Options > Advanced > Virtual memory', en: 'Performance Options > Advanced > Virtual memory' } },
    systemProtection: { admin: false, icon: 'shield', t: { fa: 'تنظیمات System Restore', en: 'System Restore settings' }, d: { fa: 'مدیریت فضای نقاط بازگردانی.', en: 'Manage restore point disk usage.' } },
    openApps: { admin: false, icon: 'grid', t: { fa: 'برنامه‌های نصب‌شده ویندوز', en: 'Windows installed apps' }, d: { fa: 'Settings > Apps', en: 'Settings > Apps' } },
    openIndexing: { admin: false, icon: 'search', t: { fa: 'تنظیمات ایندکس جستجو', en: 'Indexing Options' }, d: { fa: 'بازسازی یا محدود کردن ایندکس.', en: 'Rebuild or limit the index.' } },
    dockerPrune: { admin: false, icon: 'box', t: { fa: 'پاکسازی Docker', en: 'Docker cleanup' }, d: { fa: 'ابتدا مصرف را نشان می‌دهد، سپس ایمیج‌ها/کانتینرهای بلااستفاده و کش بیلد را با تأیید شما حذف می‌کند (والیوم‌ها حفظ می‌شوند).', en: 'Shows usage, then removes unused images/containers and build cache after your confirmation (volumes kept).' }, cmd: 'docker system df && docker system prune -a' },
    compactVhdx: { admin: true, icon: 'compress', t: { fa: 'فشرده‌سازی دیسک مجازی', en: 'Compact virtual disk' }, d: { fa: 'WSL/Docker را خاموش می‌کند و فضای خالی داخل vhdx را به ویندوز برمی‌گرداند. قبلش Docker Desktop را کامل ببندید.', en: 'Shuts down WSL/Docker and returns free space inside the vhdx to Windows. Quit Docker Desktop first.' }, cmd: 'wsl --shutdown && diskpart compact vdisk' },
    npmCacheClean: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی کش npm', en: 'Clean npm cache' }, d: { fa: 'npm cache clean --force', en: 'npm cache clean --force' }, cmd: 'npm cache clean --force' },
    pipPurge: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی کش pip', en: 'Purge pip cache' }, d: { fa: 'pip cache purge', en: 'pip cache purge' }, cmd: 'pip cache purge' },
    nugetClean: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی کش NuGet', en: 'Clear NuGet caches' }, d: { fa: 'dotnet nuget locals all --clear', en: 'dotnet nuget locals all --clear' }, cmd: 'dotnet nuget locals all --clear' },
    condaClean: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی Conda', en: 'Conda clean' }, d: { fa: 'conda clean --all', en: 'conda clean --all' }, cmd: 'conda clean --all -y' },
    pubCacheClean: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی کش Pub', en: 'Clean pub cache' }, d: { fa: 'dart pub cache clean', en: 'dart pub cache clean' }, cmd: 'dart pub cache clean' },
    goClean: { admin: false, icon: 'terminal', t: { fa: 'پاکسازی کش Go', en: 'Clean Go caches' }, d: { fa: 'go clean -modcache -cache', en: 'go clean -modcache -cache' }, cmd: 'go clean -modcache -cache' },
  };

  // Short "what is this file type" descriptions
  const EXT_INFO = {
    dll: ['کتابخانه برنامه (DLL)', 'Program library (DLL)'], exe: ['فایل اجرایی', 'Executable'], sys: ['درایور / فایل سیستمی', 'Driver / system file'],
    vhdx: ['دیسک مجازی Hyper-V/WSL', 'Hyper-V/WSL virtual disk'], vhd: ['دیسک مجازی', 'Virtual disk'], qcow2: ['دیسک مجازی شبیه‌ساز', 'Emulator virtual disk'],
    img: ['ایمیج دیسک', 'Disk image'], iso: ['ایمیج CD/DVD', 'CD/DVD image'], jar: ['پکیج جاوا', 'Java archive'], so: ['کتابخانه بومی (لینوکس/اندروید)', 'Native library (Linux/Android)'],
    zip: ['فایل فشرده', 'ZIP archive'], rar: ['فایل فشرده', 'RAR archive'], '7z': ['فایل فشرده', '7-Zip archive'], msi: ['نصب‌کننده ویندوز', 'Windows installer'],
    mp4: ['ویدیو', 'Video'], mkv: ['ویدیو', 'Video'], mov: ['ویدیو', 'Video'], log: ['لاگ متنی', 'Text log'], etl: ['لاگ رویداد ویندوز', 'Windows event trace'],
    dmp: ['دامپ حافظه', 'Memory dump'], tmp: ['فایل موقت', 'Temporary file'], pak: ['بسته منابع برنامه', 'App resource pack'], db: ['پایگاه داده', 'Database'],
    sqlite: ['پایگاه داده SQLite', 'SQLite database'], dat: ['فایل داده', 'Data file'], bin: ['فایل باینری', 'Binary data'], apk: ['اپ اندروید', 'Android app'],
    psd: ['فایل فتوشاپ', 'Photoshop document'], pdf: ['سند PDF', 'PDF document'], cab: ['بسته فشرده ویندوز', 'Windows cabinet'], esd: ['ایمیج نصب ویندوز', 'Windows setup image'],
    wim: ['ایمیج نصب ویندوز', 'Windows image'], pdb: ['نمادهای دیباگ', 'Debug symbols'], pack: ['بسته Git', 'Git pack'], node: ['ماژول بومی Node.js', 'Native Node.js module'],
    lib: ['کتابخانه استاتیک', 'Static library'], gguf: ['مدل زبانی', 'LLM model'], safetensors: ['وزن مدل AI', 'AI model weights'], pst: ['داده Outlook', 'Outlook data'],
    ost: ['کش Outlook', 'Outlook cache'], edb: ['پایگاه داده ESE', 'ESE database'], blob: ['داده باینری', 'Binary blob'], ldb: ['پایگاه داده LevelDB', 'LevelDB data'],
    dill: ['کرنل کامپایل‌شده Dart', 'Compiled Dart kernel'], aab: ['باندل اندروید', 'Android app bundle'], wav: ['صوت', 'Audio'], mp3: ['صوت', 'Audio'],
    jpg: ['تصویر', 'Image'], png: ['تصویر', 'Image'], raw: ['تصویر خام', 'Raw image'], ttf: ['فونت', 'Font'], vmdk: ['دیسک مجازی VMware', 'VMware disk'], vdi: ['دیسک مجازی VirtualBox', 'VirtualBox disk'],
  };

  // ───────────────────────── Engine ─────────────────────────
  const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const esc = (s) => s.replace(/[.+^${}()|[\]]/g, '\\$&');
  let ENV = {};
  let ctx = null;
  const exactCache = new Map();
  const markerCache = new Map();      // folder path (norm) -> Set(lowercased names in its parent)
  let childIndex = new Map();         // parent (norm) -> Set(child basenames)

  function compile(pattern) {
    let s = pattern.replace(/%(\w+)%/g, (_, k) => '\u0001' + k + '\u0001');
    s = s.replace(/\u0001(\w+)\u0001/g, (_, k) => '\u0002' + (ENV[k] || ('%' + k + '%')) + '\u0003');
    s = s.toLowerCase().replace(/\\/g, '/');
    // escape everything except env blocks and wildcards
    let out = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\u0002') { const j = s.indexOf('\u0003', i); out += esc(s.slice(i + 1, j)).replace(/\*/g, '\\*'); i = j + 1; continue; }
      if (s.startsWith('{d}', i)) { out += '[a-z]:'; i += 3; continue; }
      if (s.startsWith('**', i)) { out += '.*'; i += 2; continue; }
      if (ch === '*') { out += '[^/]*'; i++; continue; }
      out += esc(ch);
      i++;
    }
    return new RegExp('^' + out + '$');
  }

  function init(env) {
    ENV = {};
    for (const k of Object.keys(env || {})) if (env[k]) ENV[k] = norm(env[k]);
    for (const r of RULES) {
      r._re = (r.p || []).map(compile);
      r._n = r.n ? new Set(r.n.map((x) => x.toLowerCase())) : null;
      r._ext = r.ext ? new Set(r.ext) : null;
    }
    exactCache.clear();
    ctx = {
      userprofile: ENV.USERPROFILE || 'c:/users/user',
      hasMarker(p, m) {
        const set = markerCache.get(p);
        if (!set) return false;
        m = m.toLowerCase();
        if (m.startsWith('*')) { const e = m.slice(1); for (const n of set) if (n.endsWith(e)) return true; return false; }
        return set.has(m);
      },
      isOldJetBrains(p) {
        const base = p.slice(p.lastIndexOf('/') + 1);
        const mm = base.match(/^([a-z]+)(\d{4})\.(\d)$/);
        if (!mm) return false;
        const parent = p.slice(0, p.lastIndexOf('/'));
        const sibs = childIndex.get(parent);
        if (!sibs) return false;
        const v = Number(mm[2]) * 10 + Number(mm[3]);
        for (const s of sibs) {
          const sm = s.match(/^([a-z]+)(\d{4})\.(\d)$/);
          if (sm && sm[1] === mm[1] && Number(sm[2]) * 10 + Number(sm[3]) > v) return true;
        }
        return false;
      },
    };
  }

  // Feed known folder paths so sibling-aware rules (JetBrains versions) work
  function setFolders(paths) {
    childIndex = new Map();
    for (const p of paths) {
      const n = norm(p);
      const k = n.lastIndexOf('/');
      if (k < 0) continue;
      const parent = n.slice(0, k);
      let set = childIndex.get(parent);
      if (!set) childIndex.set(parent, (set = new Set()));
      set.add(n.slice(k + 1));
    }
    exactCache.clear();
  }

  function setMarkers(map) {      // { folderPath: [names in parent] }
    for (const [p, names] of Object.entries(map)) markerCache.set(norm(p), new Set(names.map((x) => x.toLowerCase())));
    exactCache.clear();
  }

  // Folders whose rule needs a look at siblings (build/target/bin/...) — main checks the disk for these
  function markerCandidates(paths) {
    const names = new Set();
    for (const r of RULES) if (r.markers && r._n) for (const n of r._n) names.add(n);
    return paths.filter((p) => { const n = norm(p); return names.has(n.slice(n.lastIndexOf('/') + 1)) && !markerCache.has(n) && !isProtected(n); });
  }

  // Inside Windows / Program Files a "node_modules" or "build" folder belongs to an installed
  // program, never to a user project — name-based rules must not fire there.
  function isProtected(pn) {
    const E = ENV;
    return under(pn, E.WINDIR) || under(pn, E.PROGRAMFILES) || under(pn, E.PROGRAMFILES86) ||
      (E.LOCALAPPDATA && under(pn, E.LOCALAPPDATA + '/programs')) || /\/resources\/app(\.asar\.unpacked)?\//.test(pn + '/');
  }

  function ruleMatches(r, pn, base, isDir, allowExt) {
    if (r.kind === 'dir' && !isDir) return false;
    if (r.kind === 'file' && isDir) return false;
    let hit = false;
    if (r._re.length && r._re.some((re) => re.test(pn))) hit = true;
    else if (r._n && r._n.has(base) && !isProtected(pn)) hit = true;
    else if (allowExt && r._ext && !isDir) {
      const dot = base.lastIndexOf('.');
      if (dot > 0 && r._ext.has(base.slice(dot + 1))) hit = true;
    }
    if (!hit) return false;
    if (r.test && !r.test(pn, ctx)) return false;
    return true;
  }

  function exactRule(pn, isDir, extMode) {
    const key = (isDir ? 'd' : 'f') + extMode + pn;
    if (exactCache.has(key)) return exactCache.get(key);
    const base = pn.slice(pn.lastIndexOf('/') + 1);
    let found = null;
    for (const r of RULES) {
      const isExt = !!r._ext;
      if (extMode === 0 && isExt) continue;                 // path/name rules only
      if (extMode === 1 && !(isExt && r.strong)) continue;  // strong ext rules only
      if (extMode === 2 && !isExt) continue;                // any ext rules
      if (ruleMatches(r, pn, base, isDir, isExt)) { found = r; break; }
    }
    exactCache.set(key, found);
    return found;
  }

  function under(pn, base) { return base && (pn === base || pn.startsWith(base + '/')); }
  let ORIG = '';   // original-case path of the current classify() call, for display names
  function seg(pn, base) {
    const src = ORIG.length === pn.length ? ORIG : pn;
    const rest = src.slice(base.length + 1);
    return rest.split('/')[0] || '';
  }

  function locationInfo(pn) {
    const E = ENV;
    const T = (fa, en) => ({ fa, en });
    if (under(pn, E.WINDIR)) return { cat: 'system', safety: 'danger', mode: 'none',
      t: T('فایل سیستمی ویندوز', 'Windows system file'),
      d: T('بخشی از خود سیستم‌عامل ویندوز است.', 'Part of the Windows operating system itself.'),
      i: T('حذف آن می‌تواند ویندوز را ناپایدار کند یا از بوت بیندازد.', 'Deleting it can make Windows unstable or unbootable.'),
      h: T('برای پاکسازی سیستم از Disk Cleanup یا DISM استفاده کنید.', 'Use Disk Cleanup or DISM to clean system files.') };
    for (const pf of [E.PROGRAMFILES, E.PROGRAMFILES86, E.LOCALAPPDATA && E.LOCALAPPDATA + '/programs']) {
      if (pf && under(pn, pf) && pn !== pf) {
        const app = seg(pn, pf);
        return { cat: 'apps', safety: 'danger', mode: 'none', app,
          t: T('فایل‌های برنامه نصب‌شده: ' + app, 'Installed program files: ' + app),
          d: T('این فایل‌ها متعلق به برنامه «' + app + '» هستند.', 'These files belong to the installed program “' + app + '”.'),
          i: T('حذف دستی برنامه را خراب می‌کند و ردپای آن در رجیستری باقی می‌ماند.', 'Manual deletion breaks the program and leaves registry leftovers.'),
          h: T('اگر لازمش ندارید، از صفحه «برنامه‌ها» آن را Uninstall کنید.', 'If you don’t need it, uninstall it from the Apps page.') };
      }
    }
    if (E.PROGRAMDATA && under(pn, E.PROGRAMDATA) && pn !== E.PROGRAMDATA) {
      const app = seg(pn, E.PROGRAMDATA);
      return { cat: 'appdata', safety: 'caution', mode: 'item', app,
        t: T('داده مشترک برنامه: ' + app, 'Shared app data: ' + app),
        d: T('داده، تنظیمات یا کش برنامه «' + app + '» برای همه کاربران.', 'Data, settings or cache of “' + app + '” for all users.'),
        i: T('اگر برنامه هنوز نصب است، ممکن است تنظیمات یا لایسنس آن از بین برود.', 'If the app is still installed, its settings or license may be lost.'),
        h: T('اگر برنامه حذف شده، این پوشه باقیمانده است و می‌توانید حذفش کنید.', 'If the app was uninstalled, this is a leftover you can remove.') };
    }
    for (const ad of [E.LOCALAPPDATA, E.APPDATA]) {
      if (ad && under(pn, ad) && pn !== ad) {
        let app = seg(pn, ad);
        if (app.toLowerCase() === 'packages') { const src = ORIG.length === pn.length ? ORIG : pn; const s2 = src.slice(ad.length + 10).split('/')[0] || ''; app = s2.split('_')[0] || app; }
        return { cat: 'appdata', safety: 'caution', mode: 'item', app,
          t: T('داده برنامه: ' + app, 'App data: ' + app),
          d: T('تنظیمات، کش یا داده‌های کاربری برنامه «' + app + '».', 'Settings, cache or user data of “' + app + '”.'),
          i: T('اگر برنامه نصب است، ممکن است تنظیمات، لاگین یا داده‌های آن از بین برود. زیرپوشه‌های Cache معمولاً امن‌اند.', 'If the app is installed, you may lose its settings, login or data. Cache subfolders are usually safe.'),
          h: T('اگر برنامه را حذف کرده‌اید، این پوشه باقیمانده است و امن است.', 'If the app was uninstalled, this leftover is safe to remove.') };
      }
    }
    if (E.USERPROFILE && under(pn, E.USERPROFILE) && pn !== E.USERPROFILE) {
      const first = seg(pn, E.USERPROFILE);
      if (first.startsWith('.')) return { cat: 'dev', safety: 'caution', mode: 'item', app: first,
        t: T('داده ابزار: ' + first, 'Tool data: ' + first),
        d: T('پوشه تنظیمات/داده یک ابزار (معمولاً برنامه‌نویسی).', 'Settings/data folder of a (usually developer) tool.'),
        i: T('ممکن است تنظیمات یا داده آن ابزار از بین برود.', 'The tool may lose its settings or data.'),
        h: T('زیرپوشه‌های cache معمولاً امن‌اند.', 'Cache subfolders are usually safe.') };
      return { cat: 'user', safety: 'user', mode: 'item',
        t: T('فایل‌های شخصی کاربر', 'User files'),
        d: T('فایل‌هایی در پوشه کاربری شما.', 'Files in your user profile.'),
        i: T('فقط خودتان می‌دانید لازم است یا نه.', 'Only you know whether you need them.'),
        h: T('بررسی کنید و در صورت نیاز به درایو دیگری منتقل کنید.', 'Review and move to another drive if needed.') };
    }
    return null;
  }

  function finalize(base, extra) {
    const r = Object.assign({}, base, extra);
    if (!r.mode) r.mode = 'item';
    return r;
  }

  function fromRule(r, extra) {
    return finalize({ id: r.id, cat: r.cat, safety: r.safety, mode: r.mode, t: r.t, d: r.d, i: r.i, h: r.h, action: r.action, markers: r.markers, container: !!r.container }, extra);
  }

  // Classify a path. Returns { id, cat, safety, mode, t, d, i, h, action, via?, source }
  function classify(path, isDir) {
    const pn = norm(path);
    ORIG = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^[a-z]:$/.test(pn)) return { id: 'drive', cat: 'other', safety: 'danger', mode: 'none', source: 'root',
      t: { fa: 'ریشه درایو', en: 'Drive root' }, d: { fa: 'کل درایو', en: 'The whole drive' }, i: { fa: '', en: '' }, h: { fa: '', en: '' } };

    let r = exactRule(pn, isDir, 0);
    if (r) return fromRule(r, { source: 'rule' });
    if (!isDir) { r = exactRule(pn, false, 1); if (r) return fromRule(r, { source: 'ext' }); }

    // nearest ancestor with a rule
    let cur = pn;
    while (true) {
      const k = cur.lastIndexOf('/');
      if (k <= 2) break;
      cur = cur.slice(0, k);
      const ar = exactRule(cur, true, 0);
      if (ar && !ar.container) {
        // inside generic personal folders, the file type says more than "personal files"
        if (!isDir && (ar.id === 'downloads' || ar.id === 'user-folders')) {
          const er = exactRule(pn, false, 2);
          if (er) return fromRule(er, { source: 'ext', via: cur });
        }
        let safety = ar.safety, mode;
        if (ar.mode === 'contents' || ar.mode === 'item') mode = 'item';
        else mode = safety === 'safe' ? 'item' : 'none';
        if (ar.id === 'jetbrains-old') safety = 'safe';
        return fromRule(ar, { source: 'parent', via: cur, safety, mode });
      }
    }

    const loc = locationInfo(pn);
    if (loc && (loc.safety === 'danger')) return finalize(loc, { id: 'loc-' + loc.cat, source: 'location' });

    if (!isDir) { r = exactRule(pn, false, 2); if (r) return fromRule(r, { source: 'ext' }); }
    if (loc) return finalize(loc, { id: 'loc-' + loc.cat, source: 'location' });

    if (ENV.SYSTEMDRIVE && !pn.startsWith(ENV.SYSTEMDRIVE + '/')) return { id: 'loc-data', cat: 'user', safety: 'user', mode: 'item', source: 'location',
      t: { fa: 'داده روی درایو غیرسیستمی', en: 'Data on a non-system drive' },
      d: { fa: 'این درایو ویندوز را ندارد؛ محتوای آن معمولاً فایل‌های شخصی، بازی‌ها یا پروژه‌های شماست.', en: 'This drive does not hold Windows; its content is usually your files, games or projects.' },
      i: { fa: 'حذف روی سیستم‌عامل اثری ندارد، ولی ممکن است برنامه یا بازی نصب‌شده روی این درایو خراب شود.', en: 'Deleting will not affect Windows, but a program or game installed on this drive may break.' },
      h: { fa: 'ترجیحاً به سطل بازیافت منتقل کنید.', en: 'Prefer the Recycle Bin.' } };

    return { id: 'unknown', cat: 'other', safety: 'unknown', mode: 'item', source: 'unknown',
      t: { fa: isDir ? 'پوشه ناشناخته' : 'فایل ناشناخته', en: isDir ? 'Unrecognized folder' : 'Unrecognized file' },
      d: { fa: 'این مسیر در پایگاه دانش نیست. از «بررسی عمیق» برای دیدن وابستگی‌ها استفاده کنید.', en: 'This path is not in the knowledge base. Use “Deep check” to see dependencies.' },
      i: { fa: 'قبل از حذف مطمئن شوید متعلق به برنامه یا پروژه فعالی نیست.', en: 'Make sure it does not belong to an active program or project before deleting.' },
      h: { fa: 'ترجیحاً به سطل بازیافت منتقل کنید تا قابل بازگشت باشد.', en: 'Prefer moving to the Recycle Bin so it can be restored.' } };
  }

  function extInfo(name, lang) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    const e = EXT_INFO[name.slice(dot + 1).toLowerCase()];
    return e ? (lang === 'fa' ? e[0] : e[1]) : null;
  }

  // User-defined rules (Settings → Rules). They take priority over built-in rules.
  // Each: { id, match: 'path'|'name'|'ext', pattern, safety, cat, title, note }
  function validateUserRule(u) {
    if (!u || typeof u !== 'object') return null;
    const pattern = String(u.pattern || '').trim();
    if (!pattern || pattern.length > 300) return null;
    if (!['path', 'name', 'ext'].includes(u.match)) return null;
    if (!SAFETY[u.safety] || u.safety === 'unknown') return null;
    if (u.match === 'ext' && !/^[a-z0-9]{1,12}$/i.test(pattern.replace(/^\./, ''))) return null;
    if (u.match === 'name' && /[\\/]/.test(pattern)) return null;
    if (u.match === 'path' && !/^(%[A-Z0-9_()]+%|\{D\}|[a-zA-Z]:)/i.test(pattern)) return null;
    const title = String(u.title || pattern).slice(0, 120);
    const note = String(u.note || '').slice(0, 600);
    return { id: 'user-' + String(u.id || pattern).replace(/[^\w-]/g, '').slice(0, 40), match: u.match, pattern, safety: u.safety, cat: CATEGORIES[u.cat] ? u.cat : 'other', title, note };
  }
  function setUserRules(list) {
    for (let i = RULES.length - 1; i >= 0; i--) if (RULES[i].user) RULES.splice(i, 1);
    const add = [];
    for (const raw of list || []) {
      const u = validateUserRule(raw);
      if (!u) continue;
      const txt = (s) => ({ fa: s, en: s });
      const r = { id: u.id, user: true, cat: u.cat, safety: u.safety, mode: u.safety === 'danger' ? 'none' : 'item',
        t: txt(u.title), d: txt(u.note || u.title), i: txt(''), h: txt('') };
      if (u.match === 'path') r.p = [u.pattern.replace(/\\/g, '/')];
      else if (u.match === 'name') { r.n = [u.pattern.toLowerCase()]; }
      else { r.ext = [u.pattern.replace(/^\./, '').toLowerCase()]; r.kind = 'file'; r.strong = true; }
      r._re = (r.p || []).map(compile);
      r._n = r.n ? new Set(r.n) : null;
      r._ext = r.ext ? new Set(r.ext) : null;
      add.push(r);
    }
    RULES.unshift(...add);
    exactCache.clear();
    return add.length;
  }

  root.Knowledge = { RULES, SAFETY, CATEGORIES, ACTIONS, init, classify, setFolders, setMarkers, markerCandidates, extInfo, norm, setUserRules, validateUserRule };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Knowledge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
