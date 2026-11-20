#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اعتبارسنجی و ورود امن بسته‌ی آزمون به Digital_yar/cropped_questions/<examName>."""
from __future__ import print_function
import argparse
import json
import os
import sys
import zipfile
from pathlib import Path

try:
    from validate_exam_pack import validate_path, _safe_path, missing_question_numbers
except ImportError:
    from tools.validate_exam_pack import validate_path, _safe_path, missing_question_numbers


def import_pack(zip_path, digital_yar_dir=None):
    zip_path = Path(zip_path).resolve()
    base = Path(digital_yar_dir).resolve() if digital_yar_dir else Path(__file__).resolve().parent
    errors = validate_path(zip_path)
    if errors:
        return False, ["بسته‌ی آزمون نامعتبر است:"] + ["- " + x for x in errors]
    with zipfile.ZipFile(str(zip_path), "r") as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
        exam_name = manifest["examName"]
        target_root = (base / "cropped_questions").resolve()
        target = (target_root / exam_name).resolve()
        if os.path.commonpath([str(target_root), str(target)]) != str(target_root):
            return False, ["مسیر مقصد آزمون امن نیست."]

        wanted = ["manifest.json"]
        wanted.extend(q["file"] for q in manifest["questions"] if isinstance(q, dict) and q.get("file") and q.get("missing") is not True)
        payloads = {}
        for name in wanted:
            safe = _safe_path(name)
            if safe is None or "/" in safe or "\\" in safe:
                return False, ["مسیر فایل داخل بسته امن نیست: " + str(name)]
            try:
                payloads[safe] = archive.read(safe)
            except KeyError:
                return False, ["فایل معرفی‌شده در ZIP پیدا نشد: " + safe]

        # برخورد با فایل موجود را قبل از نوشتن هر چیزی بررسی می‌کنیم تا ادغام نیمه‌کاره نشود.
        conflicts = []
        for name, data in payloads.items():
            dest = target / name
            if dest.exists():
                if not dest.is_file() or dest.read_bytes() != data:
                    conflicts.append(name)
        if conflicts:
            return False, ["ورود لغو شد؛ فایل هم‌نام با محتوای متفاوت از قبل وجود دارد و بازنویسی نشد:"] + ["- " + x for x in conflicts]

        target.mkdir(parents=True, exist_ok=True)
        added = 0
        for name, data in payloads.items():
            dest = target / name
            if dest.exists():
                continue
            dest.write_bytes(data)
            added += 1
    missing = missing_question_numbers(manifest, [p.name for p in target.iterdir() if p.is_file()])
    if missing:
        headline = "بسته وارد شد، اما ناقص است؛ تصویر سؤال‌های %s موجود نیست." % ", ".join(str(n) for n in missing[:30])
        completeness = "سؤال‌های سالم در دسترس می‌مانند؛ آزمون کامل نیست."
    else:
        headline = "بسته‌ی آزمون با موفقیت بررسی و به‌صورت کامل وارد شد."
        completeness = "همه‌ی تصاویر اعلام‌شده موجودند."
    return True, [headline, completeness, "مسیر: " + str(target), "فایل‌های تازه نوشته‌شده: " + str(added), "نکته: نبودن icon.jpg خطا محسوب نمی‌شود."]


def main():
    parser = argparse.ArgumentParser(description="اعتبارسنجی و ورود امن بسته‌ی آزمون آزمون‌یار")
    parser.add_argument("zip_path", help="مسیر ZIP دریافت‌شده از رایانه‌ی خانه")
    parser.add_argument("--digital-yar-dir", default=None, help="پوشه‌ی Digital_yar مقصد؛ پیش‌فرض پوشه‌ی همین فایل")
    args = parser.parse_args()
    try:
        ok, messages = import_pack(args.zip_path, args.digital_yar_dir)
    except (OSError, zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print("خطا در بررسی/ورود بسته: " + str(exc))
        return 2
    for message in messages:
        print(message)
    return 0 if ok else 1

if __name__ == "__main__":
    raise SystemExit(main())
