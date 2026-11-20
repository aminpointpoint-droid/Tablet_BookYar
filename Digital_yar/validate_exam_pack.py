#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اعتبارسنج امن و فارسی بسته‌ی آزمون؛ سازگار با Python 3.8 و کتابخانه‌ی استاندارد."""
from __future__ import annotations
import argparse
from datetime import datetime
import json
import re
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, List, Optional

FORMAT = "azmoonyar-exam-pack"
VERSION = 1
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
_WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {"COM%d" % i for i in range(1, 10)} | {"LPT%d" % i for i in range(1, 10)}


def _safe_path(value: Any) -> Optional[str]:
    """Only accept one portable relative path component for pack entries."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.replace("\\", "/").strip()
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        return None
    raw_parts = value.split("/")
    if any(part in ("", ".", "..") for part in raw_parts):
        return None
    parts = PurePosixPath(value).parts
    if not parts or any(part in (".", "..") for part in parts):
        return None
    return "/".join(parts)


def _safe_exam_name(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    if value in (".", "..") or any(ch in value for ch in '<>:\\"/|?*') or value.endswith((".", " ")):
        return False
    if value.split(".", 1)[0].upper() in _WINDOWS_RESERVED:
        return False
    return True


def validate_manifest(manifest: Any, names: Iterable[str]) -> List[str]:
    errors: List[str] = []
    available = set(str(n).replace("\\", "/") for n in names if not str(n).endswith(("/", "\\")))
    if not isinstance(manifest, dict):
        return ["manifest.json باید یک شیء JSON باشد."]

    if manifest.get("format") != FORMAT:
        errors.append("فیلد format باید «%s» باشد." % FORMAT)
    version = manifest.get("v")
    if isinstance(version, bool) or not isinstance(version, int) or version != VERSION:
        errors.append("نسخه‌ی قرارداد پشتیبانی نمی‌شود؛ v باید %d باشد." % VERSION)
    if not _safe_exam_name(manifest.get("examName")):
        errors.append("examName باید نام پوشه‌ی ساده و بدون جداکننده یا نویسه‌ی نامعتبر ویندوز باشد.")

    created_at = manifest.get("createdAt")
    if not isinstance(created_at, str) or not created_at.strip():
        errors.append("createdAt باید زمان ISO 8601 باشد.")
    else:
        try:
            if not re.match(r"^\d{4}-\d{2}-\d{2}T", created_at):
                raise ValueError("expected datetime")
            parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError("timezone is required")
        except ValueError:
            errors.append("createdAt باید تاریخ و ساعت ISO 8601 همراه منطقه‌ی زمانی باشد.")
    if manifest.get("source") != "shop-prep":
        errors.append('source باید دقیقاً «shop-prep» باشد.')

    count = manifest.get("questionCount")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        errors.append("questionCount باید عدد صحیحِ صفر یا بزرگ‌تر باشد.")
    questions = manifest.get("questions")
    if not isinstance(questions, list):
        errors.append("questions باید آرایه باشد.")
        questions = []
    if isinstance(count, int) and not isinstance(count, bool) and count >= 0 and count != len(questions):
        errors.append("questionCount برابر %d است، اما %d رکورد سؤال ثبت شده." % (count, len(questions)))

    seen_numbers = set()
    seen_files = set()
    for index, question in enumerate(questions, 1):
        label = "رکورد سؤال شماره‌ی %d" % index
        if not isinstance(question, dict):
            errors.append(label + " باید شیء باشد.")
            continue

        number = question.get("number")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            errors.append(label + ": number باید عدد صحیح مثبت باشد.")
        else:
            if number in seen_numbers:
                errors.append("شماره‌ی سؤال %d تکراری است." % number)
            seen_numbers.add(number)
            if number != index:
                errors.append("شماره‌ی سؤال‌ها باید به‌ترتیب از ۱ تا تعداد سؤال‌ها باشند؛ در رکورد %d شماره‌ی %s آمده است." % (index, number))

        missing = question.get("missing", False)
        if not isinstance(missing, bool):
            errors.append(label + ": missing باید true یا false باشد.")
            missing = False
        file_value = question.get("file")
        if file_value in (None, ""):
            if not missing:
                errors.append(label + ": فایل خالی است، اما missing=true نیست.")
            continue
        if missing:
            errors.append(label + ": وقتی missing=true است، file باید خالی باشد.")

        safe = _safe_path(file_value)
        if safe is None or len(PurePosixPath(safe).parts) != 1 or safe != file_value:
            errors.append(label + ": مسیر فایل ناامن است؛ نام تصویر باید مستقیماً در ریشه‌ی بسته باشد: %r" % file_value)
            continue
        if safe in seen_files:
            errors.append("فایل %s برای چند سؤال تکرار شده است." % safe)
        seen_files.add(safe)
        if Path(safe).suffix.lower() not in IMAGE_EXTS:
            errors.append("پسوند تصویر برای %s پشتیبانی نمی‌شود؛ یکی از این‌ها مجاز است: %s." % (safe, ", ".join(sorted(IMAGE_EXTS))))
        if safe not in available and not missing:
            errors.append("فایل سؤال %s پیدا نشد: %s" % (number if isinstance(number, int) and not isinstance(number, bool) else index, safe))

    if isinstance(count, int) and not isinstance(count, bool) and count >= 0 and seen_numbers and max(seen_numbers) > count:
        errors.append("شماره‌ی سؤال از questionCount بزرگ‌تر است.")
    return errors


def missing_question_numbers(manifest: Any, available_names: Optional[Iterable[str]] = None) -> List[int]:
    """Question numbers whose image is intentionally marked missing or absent on disk."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("questions"), list):
        return []
    available = None if available_names is None else set(str(n).replace("\\", "/") for n in available_names)
    result = []
    for index, question in enumerate(manifest["questions"], 1):
        if not isinstance(question, dict):
            continue
        number = question.get("number", index)
        file_name = question.get("file")
        is_missing = question.get("missing") is True or not isinstance(file_name, str) or not file_name
        if not is_missing and available is not None and file_name not in available:
            is_missing = True
        if is_missing and isinstance(number, int) and not isinstance(number, bool):
            result.append(number)
    return result


def _extra_files(manifest: Any, names: Iterable[str]) -> List[str]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("questions"), list):
        return []
    referenced = {"manifest.json"}
    for question in manifest["questions"]:
        if isinstance(question, dict) and isinstance(question.get("file"), str) and question.get("file"):
            safe = _safe_path(question.get("file"))
            if safe and len(PurePosixPath(safe).parts) == 1:
                referenced.add(safe)
    return sorted(set(names) - referenced)


def validate_path(path: Path) -> List[str]:
    path = Path(path)
    if path.is_dir():
        try:
            children = list(path.iterdir())
        except OSError as exc:
            return ["خواندن پوشه‌ی آزمون ناموفق بود: %s" % exc]
        if any(child.is_dir() for child in children):
            return ["فایل‌های بسته باید مستقیم در ریشه‌ی پوشه باشند؛ زیرپوشه‌ی اضافی مجاز نیست."]
        if any(child.is_symlink() for child in children):
            return ["فایل پیوندی (symlink) در پوشه‌ی بسته مجاز نیست."]
        manifest_path = path / "manifest.json"
        if not manifest_path.is_file():
            return ["فایل manifest.json در پوشه پیدا نشد."]
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return ["خواندن manifest.json ناموفق بود؛ JSON خراب یا فایل ناخواناست: %s" % exc]
        files = [child.name for child in children if child.is_file() and child.name != "manifest.json"]
        if any(_safe_path(name) is None or "/" in name or "\\" in name for name in files):
            return ["نام فایل در پوشه‌ی آزمون امن نیست؛ فایل‌ها باید مستقیماً در ریشه باشند."]
        errors = validate_manifest(manifest, ["manifest.json"] + files)
        if isinstance(manifest, dict) and manifest.get("examName") != path.name:
            errors.append("نام پوشه‌ی آزمون با examName داخل manifest.json برابر نیست.")
        extras = _extra_files(manifest, ["manifest.json"] + files)
        if extras:
            errors.append("فایل‌های اضافیِ معرفی‌نشده در manifest وجود دارد: " + ", ".join(extras[:8]))
        return errors

    if not path.is_file():
        return ["مسیر پیدا نشد: %s" % path]
    try:
        with zipfile.ZipFile(str(path), "r") as archive:
            bad = archive.testzip()
            if bad:
                return ["بسته‌ی ZIP خراب است؛ خطا در فایل %s." % bad]
            names = archive.namelist()
            if len(names) != len(set(names)):
                return ["بسته دارای نام فایل تکراری است؛ ZIP را دوباره از نسخه‌ی خانه بسازید."]
            for name in names:
                if name.endswith(("/", "\\")):
                    return ["بسته باید فایل‌ها را مستقیماً در ریشه داشته باشد؛ پوشه‌ی اضافی مجاز نیست: " + name]
            safe_files = []
            for name in names:
                safe = _safe_path(name)
                if safe is None or len(PurePosixPath(safe).parts) != 1 or name != safe:
                    return ["مسیر داخل ZIP ناامن است یا فایل باید با نام ساده در ریشه‌ی بسته باشد: " + name]
                safe_files.append(safe)
            if safe_files.count("manifest.json") != 1:
                return ["ZIP باید دقیقاً یک manifest.json در ریشه داشته باشد."]
            try:
                manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
            except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                return ["محتوای manifest.json، JSON معتبر نیست یا قابل خواندن نیست: %s" % exc]
            errors = validate_manifest(manifest, safe_files)
            extras = _extra_files(manifest, safe_files)
            if extras:
                errors.append("فایل‌های اضافیِ معرفی‌نشده در بسته وجود دارد: " + ", ".join(extras[:8]))
            return errors
    except zipfile.BadZipFile:
        return ["فایل انتخابی ZIP معتبر نیست؛ فایل ZIP تشخیص داده نشد."]
    except OSError as exc:
        return ["خواندن بسته ناموفق بود: %s" % exc]


def _read_manifest_and_files(path: Path):
    path = Path(path)
    if path.is_dir():
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8-sig"))
        names = [child.name for child in path.iterdir() if child.is_file()]
        return manifest, names
    with zipfile.ZipFile(str(path), "r") as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
        return manifest, archive.namelist()


def main() -> int:
    parser = argparse.ArgumentParser(description="اعتبارسنج فارسی بسته‌ی آزمون آزمون‌یار")
    parser.add_argument("path", type=Path, help="مسیر ZIP بسته یا پوشه‌ی استخراج‌شده")
    args = parser.parse_args()
    errors = validate_path(args.path)
    if errors:
        print("بسته‌ی آزمون نامعتبر است:")
        for error in errors:
            print(" - " + error)
        return 1
    try:
        manifest, names = _read_manifest_and_files(args.path)
        missing = missing_question_numbers(manifest, names)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        print("خواندن بسته ناموفق بود: %s" % exc)
        return 1
    if missing:
        print("بسته از نظر ساختار معتبر است، اما ناقص است؛ تصویر سؤال‌های %s موجود نیست." % ", ".join(str(n) for n in missing[:30]))
        print("سؤال‌های سالم قابل استفاده‌اند؛ این بسته آزمون کامل محسوب نمی‌شود.")
    else:
        print("بسته‌ی آزمون معتبر و کامل است؛ manifest و همه‌ی تصاویر معرفی‌شده بررسی شدند.")
    print("نکته: نبودن icon.jpg خطا محسوب نمی‌شود؛ فقط فایل‌های معرفی‌شده در manifest بررسی می‌شوند.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
