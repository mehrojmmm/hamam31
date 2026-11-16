import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { $, normalize, statusView, timelineHTML, configReady } from "./common.js";

let state = normalize({});
let loaded = false;
let offline = false;

let lastKey = "";
function renderStatus(now) {
  const el = $("status");
  if (!loaded && !offline) {
    const key = "loading";
    if (lastKey === key) return;
    lastKey = key;
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
}
function renderNotice() {
  const n = (state.notice || "").trim();
  $("notice").hidden = !n;
  $("notice-text").textContent = n;
}
function renderWeek(now) {
  const d = new Date(now).getDay();
  for (const li of $("week").children) li.classList.toggle("is-today", +li.dataset.day === d);
}
function renderTimeline(now) { $("timeline").innerHTML = timelineHTML(state, now); }

function renderAll() {
  const now = Date.now();
  lastKey = "";
  renderNotice(); renderStatus(now); renderTimeline(now); renderWeek(now);
}

let lastMinute = -1;
function tick() {
  const now = Date.now(), min = Math.floor(now / 60000);
  renderStatus(now);
  if (min !== lastMinute) { lastMinute = min; renderTimeline(now); renderWeek(now); }
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
