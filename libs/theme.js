/* =====================================================================
   shared/theme.js  —  مدیریت مشترک تم در همه‌ی صفحه‌های آزمون‌یار

   فقط یک خط در <head> هر صفحه لازم است (قبل از بقیه‌ی اسکریپت‌ها):
       <link rel="stylesheet" href="shared/theme.css" />
       <script src="shared/theme.js"></script>
   (در پوشه‌های داخلی:  ../shared/theme.css  و  ../shared/theme.js)

   این فایل خودش این کارها را می‌کند:
     • تم ذخیره‌شده را همان لحظه‌ی لود روی صفحه اعمال می‌کند (بدون پرش رنگ)
     • دکمه‌ی پالت تم را می‌سازد:
         - اگر صفحه  <div class="theme-picker"></div>  خالی داشته باشد، داخل همان
         - وگرنه داخل  .header-controls  هدر
         - وگرنه یک دکمه‌ی شناور در گوشه‌ی صفحه
     • شبکه‌ی بزرگ انتخاب تم (تنظیمات ایندکس) را برای  [data-theme-grid]  می‌سازد
     • تغییر تم را بین صفحه‌ها و تب‌های باز همگام می‌کند (کلید appTheme)

   افزودن تم جدید: یک ردیف در THEMES پایین + یک بلوک [data-theme="..."] در theme.css

   API برای کد صفحه‌ها:
       AppTheme.get()            → شناسه‌ی تم فعلی
       AppTheme.set('galaxy')    → تغییر تم
       AppTheme.name('galaxy')   → نام فارسی
       AppTheme.themes           → فهرست تم‌ها
       document.addEventListener('themechange', e => e.detail.theme)
   ===================================================================== */
(function (global, doc) {
  "use strict";

  var STORAGE_KEY = "appTheme";
  var DEFAULT_THEME = "coal-mine";
  var ANIMATION_MS = 800;
  var FA_URL = "";
// مسیر پوشهٔ shared (کنار همین فایل)، برای پیدا کردن shared/vendor
  var SHARED_BASE = (function () {
    try {
      var src = (doc.currentScript && doc.currentScript.src) || "";
      return src.replace(/theme\.js(\?.*)?$/, "");
    } catch (e) {
      return "";
    }
  })();

  var THEMES = [
    {
      id: "coal-mine",
      name: "مشکی فیروزه‌ای",
      title: "تم مشکی فیروزه‌ای",
      icon: "fa-mountain",
    },
    { id: "ocean", name: "آبی فیروزه‌ای", title: "تم آبی فیروزه‌ای", icon: "fa-water" },
  ];

  /* ---------- ابزارهای کوچک ---------- */
  function find(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  function readStored() {
    try {
      if (!global.localStorage.getItem("appThemeV2")) {
        global.localStorage.setItem("appThemeV2", "1");
        global.localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
        return DEFAULT_THEME;
      }
      var v = global.localStorage.getItem(STORAGE_KEY);
      if (find(v)) return v;
    } catch (e) {}
    return DEFAULT_THEME;
  }

  var current = readStored();
  var pickers = [];

  /* ---------- اعمال تم روی صفحه ---------- */
  function paint(id) {
    doc.documentElement.setAttribute("data-theme", id);
    if (doc.body) doc.body.setAttribute("data-theme", id);

    var buttons = doc.querySelectorAll(
      ".theme-btn[data-theme], .theme-btn-large[data-theme]",
    );
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle(
        "active",
        buttons[i].getAttribute("data-theme") === id,
      );
    }
  }

  // تم را روی <html> بگذار تا قبل از اولین رندر اعمال شود
  doc.documentElement.setAttribute("data-theme", current);

  // به محض ساخته شدن <body> هم همان تم را روی آن بگذار
  if (!doc.body && global.MutationObserver) {
    var bodyWatcher = new MutationObserver(function () {
      if (doc.body) {
        doc.body.setAttribute("data-theme", current);
        bodyWatcher.disconnect();
      }
    });
    bodyWatcher.observe(doc.documentElement, { childList: true });
  }

  /**
   * opts.save     (پیش‌فرض true)  ذخیره در localStorage
   * opts.animate  اجرای انیمیشن تغییر تم
   * opts.notify   نمایش پیام «تم ... اعمال شد» (اگر صفحه showNotification دارد)
   */
  function setTheme(id, opts) {
    opts = opts || {};
    if (!find(id)) id = DEFAULT_THEME;
    var changed = id !== current;
    current = id;

    if (opts.animate && changed && doc.body) {
      doc.body.classList.add("theme-change-animation");
      setTimeout(function () {
        doc.body.classList.remove("theme-change-animation");
      }, ANIMATION_MS);
    }

    paint(id);

    if (opts.save !== false) {
      try {
        global.localStorage.setItem(STORAGE_KEY, id);
      } catch (e) {}
    }

    if (opts.notify && typeof global.showNotification === "function") {
      global.showNotification("تم " + find(id).name + " اعمال شد.", "success");
    }

    if (changed) {
      try {
        doc.dispatchEvent(new CustomEvent("themechange", { detail: { theme: id } }));
      } catch (e) {}
    }
  }

  /* ---------- Font Awesome (برای صفحه‌هایی که خودشان لود نکرده‌اند) ---------- */
  function ensureIcons() {
    if (doc.querySelector('link[href*="font-awesome"]')) return;
    var link = doc.createElement("link");
    link.rel = "stylesheet";
    // اول نسخهٔ محلی (shared/vendor)، اگر نبود CDN
    link.href = SHARED_BASE + "fontawesome/css/all.min.css";
    link.onerror = function () { link.onerror = null; if (link.parentNode) link.parentNode.removeChild(link); };
    (doc.head || doc.documentElement).appendChild(link);
  }

  /* ---------- پالت تم (دکمه + پنل) ---------- */
  function optionButtons() {
    return THEMES.map(function (t) {
      return (
        '<button type="button" class="theme-btn' +
        (t.id === current ? " active" : "") +
        '" data-theme="' + t.id +
        '" data-icon="' + t.icon +
        '" title="' + t.title +
        '"><i class="fas ' + t.icon + '"></i></button>'
      );
    }).join("");
  }

  function mountPicker(host) {
    if (host.__themePicker) return host.__themePicker;
    host.classList.add("theme-picker");
    host.innerHTML =
      '<button type="button" class="theme-toggle-btn" title="انتخاب تم" aria-expanded="false">' +
      '<i class="fas fa-palette"></i></button>' +
      '<div class="theme-panel">' +
      '<div class="theme-panel-progress"><div class="theme-panel-progress-bar"></div></div>' +
      '<div class="theme-panel-options">' + optionButtons() + "</div>" +
      '<button type="button" class="theme-panel-scroll-btn theme-panel-scroll-left" aria-label="اسکرول به چپ"><i class="fas fa-chevron-left"></i></button>' +
      '<button type="button" class="theme-panel-scroll-btn theme-panel-scroll-right" aria-label="اسکرول به راست"><i class="fas fa-chevron-right"></i></button>' +
      "</div>";

    var toggle = host.querySelector(".theme-toggle-btn");
    var panel = host.querySelector(".theme-panel");
    var options = host.querySelector(".theme-panel-options");
    var bar = host.querySelector(".theme-panel-progress-bar");
    var scrollLeft = host.querySelector(".theme-panel-scroll-left");
    var scrollRight = host.querySelector(".theme-panel-scroll-right");
    var timers = [];

    function clearTimers() {
      while (timers.length) clearTimeout(timers.pop());
    }

    function updateScrollButtons() {
      var max = options.scrollWidth - options.clientWidth;
      if (max <= 2) {
        scrollLeft.classList.remove("is-visible");
        scrollRight.classList.remove("is-visible");
        return;
      }
      var pos = Math.abs(options.scrollLeft);
      var atStart = pos < 2;
      var atEnd = Math.abs(pos - max) < 2;
      scrollLeft.classList.toggle("is-visible", !atEnd);
      scrollRight.classList.toggle("is-visible", !atStart);
    }

    function open() {
      panel.classList.add("active");
      toggle.classList.add("active");
      toggle.setAttribute("aria-expanded", "true");

      clearTimers();
      bar.style.transition = "width 0.4s ease";
      bar.style.width = "0%";
      timers.push(setTimeout(function () { bar.style.width = "100%"; }, 50));
      timers.push(
        setTimeout(function () {
          bar.style.transition = "width 0.8s ease";
          bar.style.width = "0%";
        }, 4000),
      );
      timers.push(setTimeout(updateScrollButtons, 360));
    }

    function close() {
      panel.classList.remove("active");
      toggle.classList.remove("active");
      toggle.setAttribute("aria-expanded", "false");

      clearTimers();
      bar.style.transition = "none";
      bar.style.width = "0%";
      timers.push(setTimeout(function () { bar.style.transition = "width 0.4s ease"; }, 50));
    }

    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (panel.classList.contains("active")) close();
      else open();
    });

    options.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".theme-btn") : null;
      if (!btn || !options.contains(btn)) return;
      setTheme(btn.getAttribute("data-theme"), { animate: true, notify: true });
      setTimeout(close, 350);
    });

    options.addEventListener("scroll", updateScrollButtons);
    scrollLeft.addEventListener("click", function (e) {
      e.stopPropagation();
      options.scrollBy({ left: -90, behavior: "smooth" });
    });
    scrollRight.addEventListener("click", function (e) {
      e.stopPropagation();
      options.scrollBy({ left: 90, behavior: "smooth" });
    });

    var api = { host: host, open: open, close: close, updateScrollButtons: updateScrollButtons };
    host.__themePicker = api;
    pickers.push(api);
    return api;
  }

  // بستن پنل با کلیک بیرون و کلید Esc (یک بار برای همه‌ی پالت‌ها)
  doc.addEventListener("click", function (e) {
    pickers.forEach(function (p) {
      if (!p.host.contains(e.target)) p.close();
    });
  });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape") pickers.forEach(function (p) { p.close(); });
  });
  global.addEventListener("resize", function () {
    pickers.forEach(function (p) { p.updateScrollButtons(); });
  });

  /* ---------- شبکه‌ی بزرگ انتخاب تم (صفحه‌ی تنظیمات) ---------- */
  function mountGrid(host) {
    if (host.__themeGrid) return;
    host.__themeGrid = true;
    host.classList.add("theme-selector-large");

    var frag = doc.createDocumentFragment();
    THEMES.forEach(function (t) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "theme-btn-large" + (t.id === current ? " active" : "");
      b.setAttribute("data-theme", t.id);
      b.innerHTML = '<i class="fas ' + t.icon + '"></i><span>' + t.name + "</span>";
      b.addEventListener("click", function () {
        setTheme(t.id, { animate: true, notify: true });
      });
      frag.appendChild(b);
    });
    host.insertBefore(frag, host.firstChild);
  }

  /* ---------- ساخت خودکار اجزا هنگام لود صفحه ---------- */
  function init() {
    ensureIcons();

    var root = doc.documentElement;
    var optedOut = root.hasAttribute("data-no-theme-picker");

    // ۱) جای خالی که خود صفحه گذاشته
    var hosts = doc.querySelectorAll(".theme-picker, [data-theme-picker]");
    for (var i = 0; i < hosts.length; i++) {
      if (!hosts[i].children.length) mountPicker(hosts[i]);
    }

    // ۲) اگر صفحه جایی نگذاشته بود: هدر یا دکمه‌ی شناور
    if (!pickers.length && !optedOut) {
      var host = doc.createElement("div");
      // کنار دکمه‌های خود هدر (تا دکمهٔ پالت روی آن‌ها نیفتد)؛ فقط اگر هدری نبود، شناور
      var bar =
        doc.querySelector(".header-controls") ||
        doc.querySelector(".header-actions") ||
        doc.querySelector(".header .header-content") ||
        doc.querySelector(".top");
      if (bar) {
        bar.appendChild(host);
      } else {
        host.className = "theme-picker-floating";
        host.classList.add("theme-picker");
        (doc.body || root).appendChild(host);
      }
      mountPicker(host);
    }

    var grids = doc.querySelectorAll("[data-theme-grid]");
    for (var g = 0; g < grids.length; g++) mountGrid(grids[g]);

    setTheme(current, { save: false });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();

  /* ---------- همگام‌سازی بین تب‌ها و صفحه‌ها ---------- */
  global.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY && find(e.newValue)) setTheme(e.newValue, { save: false });
  });
  global.addEventListener("pageshow", function (e) {
    if (e.persisted) setTheme(readStored(), { save: false });
  });

  /* ---------- API عمومی ---------- */
  global.AppTheme = {
    themes: THEMES,
    get: function () { return current; },
    set: function (id, opts) { setTheme(id, opts); },
    name: function (id) { var t = find(id); return t ? t.name : "ناشناخته"; },
  };

  // سازگاری با کدهای قدیمی صفحه‌ها
  global.getThemeName = global.AppTheme.name;
  global.openThemePanel = function () { if (pickers[0]) pickers[0].open(); };
  global.closeThemePanel = function () { pickers.forEach(function (p) { p.close(); }); };
})(window, document);

/* =====================================================================
   کتابخانه‌های خارجی (Chart.js / html2canvas) در حالت لوکالِ بدون اینترنت
   اگر نه فایل محلی در shared/vendor بود و نه CDN در دسترس، به‌جای
   «ReferenceError» و از کار افتادن صفحه، یک پیام روشن نشان می‌دهیم و
   نمودارها خالی می‌مانند. (پس از لود کامل صفحه تعریف می‌شود تا
   گاردهای typeof Chart در زمان پارس صفحه به‌هم نخورند.)
   ===================================================================== */
(function (global) {
  "use strict";
  var warned = false;
  function warn(what) {
    if (warned) return;
    warned = true;
    var msg =
      "کتابخانهٔ «" + what + "» بارگذاری نشد (اینترنت در دسترس نیست و فایل محلی هم در shared/vendor وجود ندارد). " +
      "نمودارها یا خروجی‌های وابسته کار نمی‌کنند. برای حل دائمی، یک‌بار با اینترنت فایل Download_Libs.bat را اجرا کنید.";
    try {
      if (typeof global.showNotification === "function") global.showNotification(msg, "warning");
      else console.warn(msg);
    } catch (e) {
      console.warn(msg);
    }
  }
  global.addEventListener("load", function () {
    if (typeof global.Chart === "undefined") {
      var C = function () {
        warn("Chart.js");
        this.destroy = this.update = this.resize = this.render = this.stop = function () {};
        this.data = { labels: [], datasets: [] };
        this.options = {};
      };
      C.register = function () {};
      C.defaults = { font: {}, plugins: {}, scale: {}, elements: {} };
      C.getChart = function () { return undefined; };
      C.__stub = true;
      global.Chart = C;
    }
    if (typeof global.html2canvas === "undefined") {
      global.html2canvas = function () {
        warn("html2canvas");
        return Promise.reject(new Error("کتابخانهٔ html2canvas در دسترس نیست (آفلاین)."));
      };
    }
  });
})(window);
