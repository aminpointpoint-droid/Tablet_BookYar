@echo off
chcp 65001 >nul
setlocal
rem ورود آسان بسته‌ی آزمون: فایل ZIP را روی همین فایل بکشید و رها کنید.
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

echo.
if "%~1"=="" (
  echo فایل ZIP آزمون را با ماوس بگیرید و روی همین فایل ^(Import_Exam^) رها کنید.
  echo.
  pause
  exit /b
)
if not defined PYCMD (
  echo پایتون ۳.۷ یا ۳.۸ پیدا نشد. اول پایتون را نصب کنید.
  echo.
  pause
  exit /b
)

echo در حال وارد کردن: %~1
echo.
%PYCMD% "%~dp0Digital_yar\import_exam_pack.py" "%~1"
echo.
echo اگر پیام خطا ندیدید، آزمون وارد شد. حالا Start_Weak.bat را اجرا کنید،
echo در دیجیتال‌یار روی «بازخوانی» بزنید و آزمون را انتخاب کنید.
echo.
pause
endlocal
