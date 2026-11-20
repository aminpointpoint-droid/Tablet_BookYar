@echo off
chcp 65001 >nul
setlocal
rem سرور فقط با کتابخانه‌ی استاندارد پایتون اجرا می‌شود؛ نسخه‌ی مناسب ویندوز ۷ حداکثر ۳.۸ است.
set "PYCMD="
where py >nul 2>&1
if not errorlevel 1 (
  py -3.8 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,8) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYCMD=py -3.8"
  if not defined PYCMD (
    py -3.7 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,7) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYCMD=py -3.7"
  )
)
if not defined PYCMD (
  where python >nul 2>&1
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[:2] in ((3,7),(3,8)) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYCMD=python"
  )
)

rem اگر سرور قبلی از اجرای قبلی مانده است، پورت آزاد شود.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

if defined PYCMD (
  start "School server - do not close" /min cmd /k %PYCMD% "%~dp0Digital_yar\school_server.py"
  echo سرور محلی در حال اجراست. پنجره‌ی کوچک سرور را نبندید.
) else (
  echo [هشدار] پایتون سازگار ۳.۷ یا ۳.۸ پیدا نشد.
  echo برنامه باز می‌شود، اما فهرست آزمون‌های آماده و دریافت تصاویر محلی ممکن است کار نکند.
  echo پایتون ۳.۸ را برای ویندوز ۷ نصب کنید و سپس Start_Weak.bat را دوباره اجرا کنید.
  pause
)
start "" "%~dp0Weak_Panel.html"
endlocal
