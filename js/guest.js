import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import {
  $, esc, normalize, statusView, timelineHTML, configReady, hoursFor, weekSummary, dateKey, keyToMs, addDays,
  DAY_TITLE, DAY_SHORT, WEEK_ORDER, MONTHS, hoursText,
} from "./common.js";

let state = normalize({});
let loaded = false;
let offline = false;

/* ---------- status card ---------- */
let lastKey = "";
let prevKind = null;
let justTimer = 0;
function celebrate(el) {
  el.classList.remove("just");
  void el.offsetWidth; // restart the animation
  el.classList.add("just");
  clearTimeout(justTimer);
  justTimer = setTimeout(() => el.classList.remove("just"), 4500);
}
function renderStatus(now) {
  const el = $("status");
  if (!loaded && !offline) {
    if (lastKey === "loading") return;
    lastKey = "loading";
    el.dataset.kind = "loading";
    el.innerHTML = '<span class="pill">Загружаем статус пара…</span><div class="status__label">Секунду</div><div class="status__time">--:--</div>';
    return;
  }
  const v = statusView(state, now);
  let html = v.html;
  if (offline) html += '<p class="status__hint">Нет связи с сервером: показываем расписание без отметок банщика. Проверьте интернет и обновите страницу.</p>';
  const key = v.kind + html;
  if (key === lastKey) return;
  lastKey = key;
  el.dataset.kind = v.kind;
  el.innerHTML = html;
  // Green "можно заходить": animate when the wait has just ended, and once when the page opens in that state.
  if (v.kind === "ready" && prevKind !== "ready") celebrate(el);
  prevKind = v.kind;
}

function renderNotice() {
  const n = (state.notice || "").trim();
  $("notice").hidden = !n;
  $("notice-text").textContent = n;
}

/* ---------- schedule ---------- */
function renderSchedule(now) {
  const sum = weekSummary(state);
  $("fact-days").textContent = sum.days;
  $("fact-hours").textContent = sum.hours;
  $("fact-hours").hidden = !sum.hours;
  $("foot-hours").textContent = sum.days + (sum.hours ? ", " + sum.hours : "");

  // This week's rows (Mon..Sun of the current week), with special days applied.
  const today = new Date(now).getDay();
  const mondayOffset = (today + 6) % 7;
  $("week").innerHTML = WEEK_ORDER.map((d, i) => {
    const day = addDays(now, i - mondayOffset);
    const h = hoursFor(state, day);
    const cls = [h.open ? "on" : "off", d === today ? "is-today" : "", h.special ? "special" : ""].join(" ");
    const label = h.open ? hoursText(h) : "выходной";
    const note = h.special ? "<small>" + (h.note ? esc(h.note) : h.open ? "особый день" : "не работаем") + "</small>" : "";
    return '<li class="' + cls + '" data-day="' + d + '"><span class="d">' + DAY_TITLE[d] + '</span><span class="h">' + label + note + "</span></li>";
  }).join("");

  // Upcoming special days beyond this week.
  const weekEnd = dateKey(addDays(now, 6 - mondayOffset));
  const todayKey = dateKey(now);
  const upcoming = state.specials.filter((s) => s.date >= todayKey && s.date > weekEnd).slice(0, 8);
  $("specials").hidden = !upcoming.length;
  $("specials-list").innerHTML = upcoming.map((s) => {
    const d = new Date(keyToMs(s.date));
    return "<li><span><b>" + DAY_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + "</b>" + (s.note ? " · " + esc(s.note) : "") + "</span>" +
      (s.open ? '<span class="opened num">открыто ' + s.from + " — " + s.to + "</span>" : '<span class="closed">выходной</span>') + "</li>";
  }).join("");
}

function renderTimeline(now) { $("timeline").innerHTML = timelineHTML(state, now); }

function renderAll() {
  const now = Date.now();
  lastKey = "";
  renderNotice(); renderStatus(now); renderTimeline(now); renderSchedule(now);
}

let lastMinute = -1;
function tick() {
  const now = Date.now(), min = Math.floor(now / 60000);
  renderStatus(now);
  if (min !== lastMinute) { lastMinute = min; renderTimeline(now); renderSchedule(now); }
}

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-scroll]");
  if (!a) return;
  const target = $(a.dataset.scroll);
  if (target) { ev.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
});

renderAll();
setInterval(tick, 1000);

if (!configReady(firebaseConfig)) {
  offline = true; renderAll();
} else {
  const timer = setTimeout(() => { if (!loaded) { offline = true; renderAll(); } }, 10000);
  const db = getFirestore(initializeApp(firebaseConfig));
  onSnapshot(doc(db, "public", "status"), (snap) => {
    clearTimeout(timer);
    state = normalize(snap.exists() ? snap.data() : {});
    loaded = true; offline = false;
    renderAll();
  }, () => {
    clearTimeout(timer);
    offline = true;
    renderAll();
  });
}
