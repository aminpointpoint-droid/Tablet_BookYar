/*
 * ExamFolderStore
 * ----------------
 * ماژول مشترک ذخیره‌سازی «پوشه آزمون‌ها» برای آزمون‌یار.
 * از IndexedDB استفاده می‌کند تا آزمون‌های برگه‌یار و دیجیتال‌یار،
 * چه دارای کلید و چه بدون کلید (در انتظار کلید)، داخل پوشه‌های
 * دلخواه کاربر ذخیره شوند و هر زمان قابل بازیابی و مشاهده‌ی کارنامه باشند.
 *
 * این فایل با تگ <script src="exam-folder-store.js"></script> (یا
 * مسیر نسبی معادل آن مثل ../exam-folder-store.js) در صفحات مختلف
 * بارگذاری می‌شود و یک شیء سراسری window.ExamFolderStore می‌سازد.
 */
(function (global) {
  "use strict";

  const DB_NAME = "AzmoonYarFoldersDB";
  const DB_VERSION = 3;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("exams")) {
          const store = db.createObjectStore("exams", { keyPath: "id" });
          store.createIndex("folderId", "folderId", { unique: false });
        }
        if (!db.objectStoreNames.contains("watched")) {
          db.createObjectStore("watched", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("blueprints")) {
          db.createObjectStore("blueprints", { keyPath: "id" });
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
      req.onerror = function (e) {
        reject(e.target.error);
      };
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function uid() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  // ==================== تاریخ شمسی ساده ====================
  function todayJalaliDisplay() {
    try {
      return new Date().toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return new Date().toLocaleDateString();
    }
  }

  // ==================== پوشه‌ها ====================
  function listFolders() {
    return tx("folders", "readonly")
      .then((s) => reqToPromise(s.getAll()))
      .then((folders) => folders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  function createFolder(name) {
    const clean = (name || "").trim();
    if (!clean) return Promise.reject(new Error("نام پوشه نمی‌تواند خالی باشد."));
    const folder = { id: uid(), name: clean, createdAt: Date.now() };
    return tx("folders", "readwrite")
      .then((s) => reqToPromise(s.put(folder)))
      .then(() => folder);
  }

  function renameFolder(id, name) {
    return tx("folders", "readwrite").then(
      (s) =>
        new Promise((resolve, reject) => {
          const getReq = s.get(id);
          getReq.onsuccess = () => {
            const f = getReq.result;
            if (!f) return resolve(null);
            f.name = (name || "").trim() || f.name;
            const putReq = s.put(f);
            putReq.onsuccess = () => resolve(f);
            putReq.onerror = () => reject(putReq.error);
          };
          getReq.onerror = () => reject(getReq.error);
        })
    );
  }

  function getFolder(id) {
    if (!id) return Promise.resolve(null);
    return tx("folders", "readonly").then((s) => reqToPromise(s.get(id)));
  }

  function deleteFolder(id) {
    return listExams(id)
      .then((exams) => tx("exams", "readwrite").then((s) => Promise.all(exams.map((e) => reqToPromise(s.delete(e.id))))))
      .then(() => tx("watched", "readwrite"))
      .then((s) => new Promise((resolve, reject) => {
        const req = s.getAll();
        req.onsuccess = () => Promise.all((req.result || []).filter((r) => r.folderId === id).map((r) => reqToPromise(s.delete(r.key)))).then(resolve, reject);
        req.onerror = () => reject(req.error);
      }))
      .then(() => tx("folders", "readwrite"))
      .then((s) => reqToPromise(s.delete(id)));
  }

  function computeStats(exams) {
    const subjectMap = new Map();
    const totals = { correct: 0, wrong: 0, empty: 0, total: 0 };
    (exams || []).filter((exam) => exam.status === "graded" && Array.isArray(exam.userAnswers) && Array.isArray(exam.correctAnswers)).forEach((exam) => {
      const totalQuestions = Math.min(Number(exam.totalQuestions) || Infinity, exam.userAnswers.length, exam.correctAnswers.length);
      const assigned = new Set();
      const metadata = Array.isArray(exam.metadata) ? exam.metadata : [];
      metadata.forEach((subject) => {
        const start = Math.max(1, Number(subject.start) || 1);
        const end = Math.min(totalQuestions, Number(subject.end) || totalQuestions);
        if (start > end) return;
        const name = String(subject.name || "بدون نام").trim();
        const type = subject.type === "تخصصی" ? "تخصصی" : "عمومی";
        const key = `${name}::${type}`;
        if (!subjectMap.has(key)) subjectMap.set(key, { key, name, type, correct: 0, wrong: 0, empty: 0, total: 0 });
        const row = subjectMap.get(key);
        for (let q = start; q <= end; q++) {
          if (assigned.has(q)) continue;
          assigned.add(q);
          const user = Number(exam.userAnswers[q - 1]) || 0;
          const correct = Number(exam.correctAnswers[q - 1]) || 0;
          row.total++; totals.total++;
          if (user === 0) { row.empty++; totals.empty++; }
          else if (user === correct) { row.correct++; totals.correct++; }
          else { row.wrong++; totals.wrong++; }
        }
      });
    });
    const subjects = [...subjectMap.values()].map((row) => ({ ...row, percentage: row.total ? Number(((3 * row.correct - row.wrong) / (3 * row.total) * 100).toFixed(1)) : 0 }));
    return { examCount: (exams || []).filter((e) => e.status === "graded").length, subjects, totals };
  }


  // ==================== آزمون‌ها ====================
  function listExams(folderId) {
    return tx("exams", "readonly")
      .then((s) => {
        const idx = s.index("folderId");
        return reqToPromise(idx.getAll(folderId));
      })
      .then((exams) => exams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  function listAllExams() {
    return tx("exams", "readonly")
      .then((s) => reqToPromise(s.getAll()))
      .then((exams) => exams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  function getExam(id) {
    if (!id) return Promise.resolve(null);
    return tx("exams", "readonly").then((s) => reqToPromise(s.get(id)));
  }

  function saveExam(exam) {
    if (!exam.id) exam.id = uid();
    if (!exam.createdAt) exam.createdAt = Date.now();
    if (!exam.date) exam.date = todayJalaliDisplay();
    if (!exam.status) exam.status = "pending";
    return tx("exams", "readwrite")
      .then((s) => reqToPromise(s.put(exam)))
      .then(() => exam);
  }

  function deleteExam(id) {
    return tx("exams", "readwrite").then((s) => reqToPromise(s.delete(id)));
  }

  // ==================== تنظیمات (پوشه پیش‌فرض) ====================
  function getSettings() {
    return tx("settings", "readonly")
      .then((s) => reqToPromise(s.get("main")))
      .then((v) => v || { id: "main", defaultFolderId: null });
  }

  function setDefaultFolder(folderId) {
    return getSettings().then((s) => {
      s.id = "main";
      s.defaultFolderId = folderId || null;
      s.updatedAt = Date.now();
      return tx("settings", "readwrite").then((st) => reqToPromise(st.put(s)));
    });
  }

  // ==================== بودجه‌بندی‌های آزمون (قالب‌های تعیین دفترچه/درس/بازه سوالات) ====================
  // هر بودجه‌بندی: { id, name, createdAt, booklets: [ { name, subjects: [ { name, type, start, end } ] } ] }
  function listBlueprints() {
    return tx("blueprints", "readonly")
      .then((s) => reqToPromise(s.getAll()))
      .then((list) => list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }

  function getBlueprint(id) {
    if (!id) return Promise.resolve(null);
    return tx("blueprints", "readonly").then((s) => reqToPromise(s.get(id)));
  }

  function saveBlueprint(blueprint) {
    if (!blueprint.id) blueprint.id = uid();
    if (!blueprint.createdAt) blueprint.createdAt = Date.now();
    if (!blueprint.booklets) blueprint.booklets = [];
    return tx("blueprints", "readwrite")
      .then((s) => reqToPromise(s.put(blueprint)))
      .then(() => blueprint);
  }

  function deleteBlueprint(id) {
    return tx("blueprints", "readwrite").then((s) => reqToPromise(s.delete(id)));
  }

  // تبدیل بودجه‌بندی (چند دفترچه‌ای) به آرایه‌ی metadata مسطح مورد نیاز کارنامه
  function blueprintToMetadata(blueprint, totalQuestions) {
    if (!blueprint || !blueprint.booklets || !blueprint.booklets.length) return null;
    const metadata = [];
    blueprint.booklets.forEach((booklet) => {
      (booklet.subjects || []).forEach((s) => {
        const start = parseInt(s.start, 10) || 1;
        let end = parseInt(s.end, 10) || start;
        if (totalQuestions && end > totalQuestions) end = totalQuestions;
        if (totalQuestions && start > totalQuestions) return;
        metadata.push({
          name: s.name || "بدون نام",
          type: s.type === "تخصصی" ? "تخصصی" : "عمومی",
          start,
          end,
          booklet: booklet.name || "",
        });
      });
    });
    return metadata.length ? metadata : null;
  }

  // ==================== کمک‌کننده‌های تبدیل رقم ====================
  function toEnglishDigits(str) {
    const fa = "۰۱۲۳۴۵۶۷۸۹";
    const ar = "٠١٢٣٤٥٦٧٨٩";
    return String(str || "")
      .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
  }

  // ==================== نمره‌گذاری عمومی ====================
  // userAnswers/correctAnswers: آرایه‌ی اعداد (۰ = نزده)
  function gradeAnswers(userAnswers, correctAnswers, totalQuestions) {
    let correct = 0,
      wrong = 0,
      empty = 0;
    for (let i = 0; i < totalQuestions; i++) {
      const u = userAnswers[i];
      if (!u || u === 0) empty++;
      else if (u === correctAnswers[i]) correct++;
      else wrong++;
    }
    const mainPercentage = totalQuestions > 0 ? (((correct * 3 - wrong) / (totalQuestions * 3)) * 100).toFixed(1) : "0.0";
    const potentialPercentage = totalQuestions > 0 ? (((correct * 3) / (totalQuestions * 3)) * 100).toFixed(1) : "0.0";
    return { correct, wrong, empty, mainPercentage, potentialPercentage };
  }

  function createDefaultMetadata(totalQuestions) {
    return [{ name: "همه دروس", type: "عمومی", start: 1, end: totalQuestions }];
  }

  // ---- پارس‌کننده‌ی کلید به سبک برگه‌یار (رشته رقمی + متادیتای اختیاری) ----
  function smartSplitMetadata(metaString) {
    const lines = [];
    let currentLine = "";
    for (let i = 0; i < metaString.length; i++) {
      const char = metaString[i];
      if (char === ":" && currentLine.includes("subject") && !currentLine.includes(":")) {
        if (currentLine) lines.push(currentLine);
        currentLine = char;
      } else if (char === "|") {
        if (currentLine) lines.push(currentLine);
        currentLine = "";
      } else {
        currentLine += char;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function parseBargehKeyCode(userCode, examKeyCode) {
    userCode = toEnglishDigits(userCode || "");
    examKeyCode = toEnglishDigits(examKeyCode || "");

    let userAnswers = userCode.split("").map((ch) => {
      const n = parseInt(ch, 10);
      return isNaN(n) ? 0 : n;
    });

    let correctAnswers = [];
    let metadata = [];
    let totalQuestions = 300;

    if (examKeyCode.includes("total_questions") || examKeyCode.includes("subject:")) {
      let keyString = "";
      let metaString = "";
      const metaStartIndex = Math.max(examKeyCode.indexOf("total_questions"), examKeyCode.indexOf("subject:"));

      if (metaStartIndex > 0) {
        keyString = examKeyCode.substring(0, metaStartIndex);
        metaString = examKeyCode.substring(metaStartIndex);
      } else {
        const numberMatch = examKeyCode.match(/^(\d+)/);
        if (numberMatch) {
          keyString = numberMatch[0];
          metaString = examKeyCode.substring(numberMatch[0].length);
        } else {
          metaString = examKeyCode;
        }
      }

      if (keyString) {
        correctAnswers = keyString.split("").map((ch) => {
          const n = parseInt(ch, 10);
          return isNaN(n) ? 0 : n;
        });
      }

      if (metaString) {
        let lines = metaString.includes("|") ? metaString.split("|") : smartSplitMetadata(metaString);
        let currentSubject = {};
        for (const line of lines) {
          if (line.startsWith("total_questions:")) {
            totalQuestions = parseInt(line.split(":")[1], 10) || totalQuestions;
          } else if (line.startsWith("subject:")) {
            if (Object.keys(currentSubject).length > 0) {
              metadata.push(currentSubject);
              currentSubject = {};
            }
            currentSubject.name = line.split(":")[1];
          } else if (line.startsWith("type:")) {
            currentSubject.type = line.split(":")[1];
          } else if (line.startsWith("start:")) {
            currentSubject.start = parseInt(line.split(":")[1], 10);
          } else if (line.startsWith("end:")) {
            currentSubject.end = parseInt(line.split(":")[1], 10);
          } else if (line.startsWith("chapters:")) {
            currentSubject.chapters = line.split(":")[1].split(",");
          }
        }
        if (Object.keys(currentSubject).length > 0) metadata.push(currentSubject);
      }
    } else {
      correctAnswers = examKeyCode.split("").map((ch) => {
        const n = parseInt(ch, 10);
        return isNaN(n) ? 0 : n;
      });
      totalQuestions = Math.min(userAnswers.length, correctAnswers.length, 300);
      metadata = createDefaultMetadata(totalQuestions);
    }

    totalQuestions = Math.min(totalQuestions, userAnswers.length, correctAnswers.length);
    if (!metadata.length) metadata = createDefaultMetadata(totalQuestions);

    return {
      userAnswers: userAnswers.slice(0, totalQuestions),
      correctAnswers: correctAnswers.slice(0, totalQuestions),
      metadata,
      totalQuestions,
    };
  }

  // ---- پارس‌کننده‌ی فایل کلید به سبک دیجیتال‌یار ----
  function parseDigitalKeyText(keyText) {
    const cleaned = toEnglishDigits(keyText || "").trim();
    const metaIndex = cleaned.indexOf("total_questions:");
    if (metaIndex === -1) {
      throw new Error("فرمت فایل کلید نامعتبر است. فایل باید حاوی total_questions باشد.");
    }
    const answersString = cleaned.slice(0, metaIndex).trim();
    const metaString = cleaned.slice(metaIndex);
    const fields = metaString.split("|").map((f) => f.trim());

    let totalQuestions = null;
    const subjects = [];
    let currentSubject = null;

    fields.forEach((field) => {
      const sepIndex = field.indexOf(":");
      if (sepIndex === -1) return;
      const key = field.slice(0, sepIndex).trim();
      const value = field.slice(sepIndex + 1).trim();
      if (key === "total_questions") {
        totalQuestions = parseInt(value, 10);
      } else if (key === "subject") {
        currentSubject = { subject: value };
        subjects.push(currentSubject);
      } else if (currentSubject) {
        currentSubject[key] = value;
      }
    });

    const answers = answersString.split("");
    if (!totalQuestions) totalQuestions = answers.length;

    return { raw: keyText, answers: answers, totalQuestions: totalQuestions, subjects: subjects };
  }

  // تبدیل subjects سبک دیجیتال‌یار (subject/type/start/end) به metadata سبک کارنامه
  function digitalSubjectsToMetadata(subjects, totalQuestions) {
    if (!subjects || !subjects.length) return createDefaultMetadata(totalQuestions);
    return subjects.map((s) => ({
      name: s.subject || s.name || "نامشخص",
      type: s.type || "عمومی",
      start: parseInt(s.start, 10) || 1,
      end: parseInt(s.end, 10) || totalQuestions,
      chapters: s.chapters ? String(s.chapters).split(",") : undefined,
    }));
  }

  function getWatched(folderId, videoName) {
    return tx("watched", "readonly").then((s) => reqToPromise(s.get(`${folderId}::${videoName}`))).then(Boolean);
  }

  function setWatched(folderId, videoName, watched) {
    const key = `${folderId}::${videoName}`;
    return tx("watched", "readwrite").then((s) => reqToPromise(watched ? s.put({ key, folderId, videoName, watchedAt: Date.now() }) : s.delete(key)));
  }

  global.ExamFolderStore = {
    openDB,
    uid,
    todayJalaliDisplay,
    // folders
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    getFolder,
    // exams
    listExams,
    listAllExams,
    getExam,
    saveExam,
    deleteExam,
    computeStats,
    getWatched,
    setWatched,
    // settings
    getSettings,
    setDefaultFolder,
    // blueprints (بودجه‌بندی)
    listBlueprints,
    getBlueprint,
    saveBlueprint,
    deleteBlueprint,
    blueprintToMetadata,
    // helpers
    toEnglishDigits,
    gradeAnswers,
    createDefaultMetadata,
    parseBargehKeyCode,
    parseDigitalKeyText,
    digitalSubjectsToMetadata,
  };
})(window);
