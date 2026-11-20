/* اعتبارسنج مرورگری بسته‌ی آزمون آزمون‌یار (بدون اینترنت، مناسب Chromium 109). */
(function (global) {
  "use strict";
  var FORMAT = "azmoonyar-exam-pack";
  var VERSION = 1;
  var IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];
  var WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

  function safePath(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    var s = value.replace(/\\/g, "/").trim();
    if (s.charAt(0) === "/" || /^[A-Za-z]:/.test(s)) return null;
    var parts = s.split("/");
    for (var i = 0; i < parts.length; i++) if (!parts[i] || parts[i] === "." || parts[i] === "..") return null;
    return parts.join("/");
  }
  function validateManifest(manifest, fileNames) {
    var errors = [];
    var available = Object.create(null);
    (fileNames || []).forEach(function (name) {
      var normalized = String(name).replace(/\\/g, "/").replace(/^\.\//, "");
      if (normalized && normalized.charAt(normalized.length - 1) !== "/") available[normalized] = true;
    });
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { valid: false, errors: ["manifest.json باید یک شیء JSON باشد."], message: "manifest.json نامعتبر است." };
    }
    if (manifest.format !== FORMAT) errors.push("فیلد format نادرست است.");
    if (typeof manifest.v !== "number" || Math.floor(manifest.v) !== manifest.v || manifest.v !== VERSION) errors.push("نسخه‌ی قرارداد پشتیبانی نمی‌شود؛ v باید ۱ باشد.");
    if (typeof manifest.examName !== "string" || !manifest.examName.trim()) errors.push("examName باید نام آزمون غیرخالی باشد.");
    else if (manifest.examName === "." || manifest.examName === ".." || /[\\/<>:\"|?*]/.test(manifest.examName) || /[. ]$/.test(manifest.examName) || /[\x00-\x1f]/.test(manifest.examName) || WINDOWS_RESERVED.test(manifest.examName)) errors.push("examName باید نام پوشه‌ی ساده و بدون نویسه‌ی نامعتبر ویندوز باشد.");
    if (typeof manifest.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(manifest.createdAt) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(manifest.createdAt) || isNaN(Date.parse(manifest.createdAt))) errors.push("createdAt باید تاریخ و ساعت ISO 8601 همراه منطقه‌ی زمانی باشد.");
    if (manifest.source !== "shop-prep") errors.push("source باید دقیقاً «shop-prep» باشد.");
    var count = manifest.questionCount;
    if (typeof count !== "number" || count < 0 || Math.floor(count) !== count) errors.push("questionCount باید عدد صحیحِ صفر یا بزرگ‌تر باشد.");
    var questions = manifest.questions;
    if (!Array.isArray(questions)) { errors.push("questions باید آرایه باشد."); questions = []; }
    if (typeof count === "number" && count !== questions.length) errors.push("questionCount با تعداد رکوردهای questions برابر نیست.");
    var seenNums = Object.create(null), seenFiles = Object.create(null), nums = [], missingNumbers = [];
    questions.forEach(function (q, index) {
      var label = "رکورد سؤال شماره‌ی " + (index + 1);
      if (!q || typeof q !== "object" || Array.isArray(q)) { errors.push(label + " باید شیء باشد."); return; }
      if (typeof q.number !== "number" || q.number < 1 || Math.floor(q.number) !== q.number) errors.push(label + ": number باید عدد صحیح مثبت باشد.");
      else {
        if (seenNums[q.number]) errors.push("شماره‌ی سؤال " + q.number + " تکراری است.");
        seenNums[q.number] = true; nums.push(q.number);
        if (q.number !== index + 1) errors.push("شماره‌ی سؤال‌ها باید به‌ترتیب از ۱ تا تعداد سؤال‌ها باشند.");
      }
      var missing = q.missing === true;
      if (q.missing !== undefined && typeof q.missing !== "boolean") errors.push(label + ": missing باید true یا false باشد.");
      if (q.file == null || q.file === "") {
        if (!missing) errors.push(label + ": فایل خالی است، اما missing=true نیست.");
        else missingNumbers.push(q.number || index + 1);
        return;
      }
      if (missing) errors.push(label + ": وقتی missing=true است، file باید خالی باشد.");
      var f = safePath(q.file);
      if (!f || f.indexOf("/") >= 0) { errors.push(label + ": نام تصویر باید مسیر نسبی امن و مستقیماً در ریشه‌ی بسته باشد."); return; }
      if (seenFiles[f]) errors.push("فایل " + f + " برای چند سؤال تکرار شده است.");
      seenFiles[f] = true;
      var dot = f.lastIndexOf("."); var ext = dot >= 0 ? f.slice(dot).toLowerCase() : "";
      if (IMAGE_EXTS.indexOf(ext) < 0) errors.push("پسوند تصویر برای " + f + " پشتیبانی نمی‌شود.");
      if (!available[f] && !missing) { errors.push("فایل سؤال " + (q.number || index + 1) + " پیدا نشد: " + f); missingNumbers.push(q.number || index + 1); }
    });
    if (nums.length) {
      var max = Math.max.apply(Math, nums);
      for (var n = 1; n <= max; n++) if (!seenNums[n]) { errors.push("شماره‌ی سؤال‌ها پیوسته نیست؛ شماره‌ی " + n + " وجود ندارد."); break; }
      if (typeof count === "number" && max > count) errors.push("شماره‌ی سؤال از questionCount بزرگ‌تر است.");
    }
    var valid = errors.length === 0;
    var complete = valid && missingNumbers.length === 0;
    return { valid: valid, complete: complete, missingNumbers: missingNumbers, errors: errors, message: !valid ? "بسته‌ی آزمون نامعتبر است؛ " + errors.length + " ایراد پیدا شد." : (!complete ? "بسته از نظر ساختار معتبر است، اما ناقص است؛ تصویر بعضی سؤال‌ها موجود نیست." : "بسته‌ی آزمون معتبر و کامل است؛ manifest و همه‌ی تصاویر بررسی شدند."), manifest: manifest };
  }
  async function validateZip(source) {
    if (!global.JSZip) throw new Error("کتابخانه‌ی محلی JSZip بارگذاری نشده است.");
    var zip = await global.JSZip.loadAsync(source);
    var dirEntries = Object.keys(zip.files).filter(function (name) { return zip.files[name].dir; });
    if (dirEntries.length) return { valid: false, errors: ["بسته باید فایل‌ها را مستقیماً در ریشه داشته باشد؛ پوشه‌ی اضافی مجاز نیست."], message: "بسته‌ی آزمون نامعتبر است." };
    var manifests = Object.keys(zip.files).filter(function (name) { return name.replace(/\\/g, "/").replace(/^\.\//, "") === "manifest.json" && !zip.files[name].dir; });
    if (manifests.length !== 1) return { valid: false, errors: ["ZIP باید دقیقاً یک manifest.json در ریشه داشته باشد."], message: "manifest.json نامعتبر است." };
    var raw = await zip.file(manifests[0]).async("string");
    var manifest;
    try { manifest = JSON.parse(raw.replace(/^\uFEFF/, "")); }
    catch (e) { return { valid: false, errors: ["محتوای manifest.json، JSON معتبر نیست."], message: "manifest.json نامعتبر است." }; }
    var names = Object.keys(zip.files).filter(function (name) { return !zip.files[name].dir; });
    var invalidPath = names.find(function (name) {
      var normalized = name.replace(/\\/g, "/");
      return safePath(normalized) === null || normalized.indexOf("/") >= 0;
    });
    if (invalidPath) return { valid: false, errors: ["مسیر داخل ZIP ناامن است یا فایل باید در ریشه‌ی بسته باشد: " + invalidPath], message: "بسته‌ی آزمون نامعتبر است." };
    var result = validateManifest(manifest, names);
    if (result.valid) {
      var referenced = { "manifest.json": true };
      (manifest.questions || []).forEach(function (q) { if (q && typeof q.file === "string" && q.file) referenced[q.file] = true; });
      var extra = names.filter(function (name) { return !referenced[name]; });
      if (extra.length) {
        result.valid = false;
        result.errors.push("فایل‌های اضافیِ معرفی‌نشده در بسته وجود دارد: " + extra.slice(0, 8).join(", "));
        result.message = "بسته‌ی آزمون نامعتبر است؛ فایل اضافی پیدا شد.";
      }
    }
    return result;
  }
  global.AzExamPackValidator = { validateManifest: validateManifest, validateZip: validateZip };
})(typeof window !== "undefined" ? window : this);
