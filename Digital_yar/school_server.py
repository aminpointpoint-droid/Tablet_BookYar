# -*- coding: utf-8 -*-
"""سرور فقط-محلی نسخه‌ی مغازه؛ سازگار با Python 3.8 و کتابخانه‌ی استاندارد."""
import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, quote

PORT = 8765
BASE = os.path.dirname(os.path.abspath(__file__))
try:
    from validate_exam_pack import validate_manifest
except ImportError:
    # در بسته‌ی نهایی فایل اعتبارسنج کنار همین اسکریپت قرار می‌گیرد.
    validate_manifest = None


def _within(parent, candidate):
    try:
        return os.path.commonpath([os.path.realpath(parent), os.path.realpath(candidate)]) == os.path.realpath(parent)
    except (ValueError, OSError):
        return False


class SchoolHandler(SimpleHTTPRequestHandler):
    server_version = "DigitalYarSchool/2.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        requested_path = urlparse(self.path).path.lower()
        if requested_path.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")):
            self.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _exam_listing(self):
        root = os.path.join(self.directory, "cropped_questions")
        if not os.path.isdir(root):
            return []
        exams = []
        try:
            folder_names = sorted(os.listdir(root), key=lambda name: name.lower())
        except OSError:
            return [{"folderName": "", "examName": "آزمون‌ها", "status": "invalid", "canRun": False,
                     "complete": False, "questionCount": 0, "availableCount": 0, "missingCount": 0,
                     "errors": ["خواندن پوشه‌ی cropped_questions ناموفق بود."]}]

        for folder_name in folder_names:
            exam_dir = os.path.join(root, folder_name)
            if not os.path.isdir(exam_dir) or os.path.islink(exam_dir) or not _within(root, exam_dir):
                continue
            item = {"folderName": folder_name, "examName": folder_name, "status": "invalid", "canRun": False,
                    "complete": False, "questionCount": 0, "availableCount": 0, "missingCount": 0,
                    "errors": [], "warnings": [], "questions": []}
            manifest_path = os.path.join(exam_dir, "manifest.json")
            if not os.path.isfile(manifest_path) or os.path.islink(manifest_path) or not _within(exam_dir, manifest_path):
                item["errors"] = ["فایل manifest.json در پوشه‌ی آزمون پیدا نشد؛ آزمون با این ساختار قابل شناسایی نیست."]
                exams.append(item)
                continue
            try:
                with open(manifest_path, "r", encoding="utf-8-sig") as source:
                    manifest = json.load(source)
            except (OSError, UnicodeDecodeError, ValueError):
                item["errors"] = ["manifest.json خراب است یا JSON معتبر نیست؛ بسته را دوباره از نسخه‌ی خانه دریافت کنید."]
                exams.append(item)
                continue

            item["manifest"] = manifest
            if isinstance(manifest, dict) and isinstance(manifest.get("examName"), str):
                item["examName"] = manifest["examName"]
            questions = manifest.get("questions", []) if isinstance(manifest, dict) else []
            if isinstance(manifest, dict) and isinstance(manifest.get("questionCount"), int) and not isinstance(manifest.get("questionCount"), bool):
                item["questionCount"] = manifest["questionCount"]

            try:
                child_names = os.listdir(exam_dir)
            except OSError:
                item["errors"] = ["خواندن فایل‌های این آزمون ناموفق بود."]
                exams.append(item)
                continue
            if any(os.path.isdir(os.path.join(exam_dir, n)) for n in child_names):
                item["errors"].append("ساختار پوشه نادرست است؛ فایل‌های آزمون باید مستقیم در پوشه‌ی نام آزمون باشند و زیرپوشه نداشته باشند.")
            if any(os.path.islink(os.path.join(exam_dir, n)) for n in child_names):
                item["errors"].append("فایل پیوندی (symlink) در بسته‌ی آزمون مجاز نیست.")
            file_names = [n for n in child_names if os.path.isfile(os.path.join(exam_dir, n)) and not os.path.islink(os.path.join(exam_dir, n))]
            if validate_manifest is not None:
                manifest_errors = validate_manifest(manifest, ["manifest.json"] + [n for n in file_names if n != "manifest.json"])
                # نبودن تصویر، بسته را ناقص می‌کند؛ ولی تا وقتی ساختار manifest امن است
                # تصویرهای سالم برای اجرا باقی می‌مانند.
                for error in manifest_errors:
                    if error.startswith("فایل سؤال ") and " پیدا نشد: " in error:
                        item["warnings"].append(error)
                    else:
                        item["errors"].append(error)
            else:
                item["errors"].append("اعتبارسنج بسته در کنار سرور نصب نشده است.")

            if item["examName"] != folder_name:
                item["errors"].append("نام پوشه‌ی آزمون با examName داخل manifest.json برابر نیست.")

            referenced = {"manifest.json"}
            missing_numbers = []
            available_count = 0
            output_questions = []
            if isinstance(questions, list):
                for index, question in enumerate(questions, 1):
                    if not isinstance(question, dict):
                        continue
                    number = question.get("number", index)
                    file_name = question.get("file", "")
                    missing_flag = question.get("missing") is True
                    safe_file = isinstance(file_name, str) and bool(file_name) and "/" not in file_name and "\\" not in file_name and file_name not in (".", "..")
                    image_path = os.path.join(exam_dir, file_name) if safe_file else ""
                    available = bool(safe_file and not missing_flag and os.path.isfile(image_path) and not os.path.islink(image_path) and _within(exam_dir, image_path))
                    if safe_file:
                        referenced.add(file_name)
                    if available:
                        available_count += 1
                        image_url = "http://127.0.0.1:%d/cropped_questions/%s/%s" % (getattr(self.server, "server_address", ("127.0.0.1", PORT))[1], quote(folder_name, safe=""), quote(file_name, safe=""))
                    else:
                        image_url = ""
                        if isinstance(number, int) and not isinstance(number, bool):
                            missing_numbers.append(number)
                    output_questions.append({"number": number, "file": file_name if isinstance(file_name, str) else "",
                                             "missing": not available, "available": available, "imageUrl": image_url})

            extras = sorted(set(file_names) - referenced)
            if extras:
                item["errors"].append("فایل‌های اضافیِ معرفی‌نشده در manifest وجود دارد: " + ", ".join(extras[:8]))
            item["questions"] = output_questions
            item["availableCount"] = available_count
            item["missingCount"] = len(set(missing_numbers))
            if item["missingCount"]:
                item["warnings"].append("تصویر %d سؤال موجود نیست؛ سؤال‌های سالم قابل استفاده‌اند و آزمون کامل نیست." % item["missingCount"])
            item["canRun"] = not item["errors"] and bool(output_questions)
            item["complete"] = item["canRun"] and item["missingCount"] == 0 and item["availableCount"] == item["questionCount"]
            item["status"] = "invalid" if item["errors"] else ("complete" if item["complete"] else "incomplete")
            exams.append(item)
        return exams

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/api/status":
            self._json(200, {"ok": True, "service": "digitalyar-school", "version": 2,
                             "canCrop": False, "examDiscovery": True})
            return
        if route == "/api/exams":
            self._json(200, {"ok": True, "root": "cropped_questions", "exams": self._exam_listing()})
            return
        return super().do_GET()

    def do_POST(self):
        self._json(405, {"ok": False, "error": "این نسخه فقط فهرست آزمون‌های آماده و فایل‌های محلی را ارائه می‌کند."})


def main():
    def handler(*args, **kwargs):
        return SchoolHandler(*args, directory=BASE, **kwargs)
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as exc:
        print("درگاه %d در حال استفاده است (%s). ممکن است سرور مغازه از قبل اجرا باشد." % (PORT, exc))
        return
    print("سرور محلی دیجیتال‌یار روی 127.0.0.1:%d فعال است. برای نمایش آزمون‌ها و تصاویر این پنجره را نبندید." % PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
