import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, runTransaction, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, LOGIN_DOMAIN } from "./config.js";
import {
  $, esc, fmt, pad, endOf, sameDay, typeName, normalize, sortedEvents, statusView, toast, configReady, MONTHS,
  hoursFor, dateKey, keyToMs, nextOpening, dayLabel, hoursText, DAY_TITLE, DAY_SHORT, WEEK_ORDER, HM_RE, DATE_RE,
} from "./common.js";

const VIEWS = ["view-loading", "view-setup", "view-login", "view-denied", "view-panel"];
function show(id) { for (const v of VIEWS) $(v).hidden = v !== id; $("who").hidden = id !== "view-panel"; }

if (!configReady(firebaseConfig)) { show("view-setup"); throw new Error("Firebase config missing"); }

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const statusRef = doc(db, "public", "status");

const USER_RE = /^[a-z0-9._-]{3,32}$/;
const toEmail = (u) => u.trim().toLowerCase() + "@" + LOGIN_DOMAIN;
const ADMIN_URL = new URL("admin.html", location.href).href;

let me = null;          // { uid, username, role }
let state = normalize({});
let unsubs = [];
let busy = false;

function stopListeners() { unsubs.forEach((u) => u()); unsubs = []; }

/* ---------- auth flow ---------- */
onAuthStateChanged(auth, (user) => {
  stopListeners();
  me = null;
  if (!user) { show("view-login"); return; }
  show("view-loading");
  const meRef = doc(db, "admins", user.uid);
  let first = true;
  unsubs.push(onSnapshot(meRef, (snap) => {
    if (!snap.exists()) { stopListeners(); show("view-denied"); return; }
    const d = snap.data();
    me = { uid: user.uid, username: d.username || "", role: d.role === "owner" ? "owner" : "admin" };
    $("who-name").textContent = me.username;
    $("admins-card").hidden = me.role !== "owner";
    if (first) {
      first = false;
      show("view-panel");
      fillForms();
      unsubs.push(onSnapshot(statusRef, (s) => { state = normalize(s.exists() ? s.data() : {}); renderPanel(); }, (e) => toast(errText(e), true)));
      if (me.role === "owner") watchAdmins();
    } else if (me.role === "owner" && !adminsWatched) watchAdmins();
  }, () => { stopListeners(); show("view-denied"); }));
});

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const u = $("login-user").value.trim().toLowerCase(), p = $("login-pass").value;
  const err = $("login-err");
  err.hidden = true;
  if (!u || !p) { err.textContent = "Введите логин и пароль."; err.hidden = false; return; }
  $("login-btn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, toEmail(u), p);
    $("login-pass").value = "";
  } catch (e) {
    const c = e && e.code;
    err.textContent =
      c === "auth/too-many-requests" ? "Слишком много попыток. Подождите несколько минут и попробуйте снова."
      : c === "auth/network-request-failed" ? "Нет связи. Проверьте интернет."
      : "Неверный логин или пароль.";
    err.hidden = false;
  } finally { $("login-btn").disabled = false; }
});
$("logout").addEventListener("click", () => signOut(auth));
$("denied-logout").addEventListener("click", () => signOut(auth));

/* ---------- status editing ---------- */
function errText(e) {
  const c = e && e.code;
  if (c === "permission-denied") return "Нет прав на это действие.";
  if (c === "unavailable" || c === "auth/network-request-failed") return "Нет связи с сервером. Проверьте интернет и повторите.";
  return "Не получилось сохранить. Повторите ещё раз.";
}
function setBusy(on) {
  busy = on;
  $("busy").hidden = !on;
  for (const b of $("view-panel").querySelectorAll("button")) b.disabled = on;
}
function prune(s) {
  const cutoff = Date.now() - 3 * 86400000;
  s.events = s.events.filter((e) => endOf(e) > cutoff).sort((a, b) => a.start - b.start).slice(-150);
  const todayKey = dateKey(Date.now());
  s.specials = s.specials.filter((x) => x.date >= todayKey).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 120);
}
async function mutate(fn, okMsg) {
  if (busy || !me) return;
  setBusy(true);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(statusRef);
      const s = normalize(snap.exists() ? snap.data() : {});
      fn(s);
      prune(s);
      tx.set(statusRef, {
        events: s.events.map((e) => ({ id: String(e.id), type: e.type, start: e.start, dur: e.dur })),
        settings: s.settings, notice: s.notice,
        week: s.week.map((d) => ({ open: !!d.open, from: d.from, to: d.to })),
        specials: s.specials.map((x) => ({ date: x.date, open: !!x.open, from: x.from, to: x.to, note: x.note || "" })),
        updatedAt: Date.now(), updatedBy: me.username,
      });
    });
    toast(okMsg);
  } catch (e) { toast(errText(e), true); }
  finally { setBusy(false); }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function addEvent(type, start, dur) {
  mutate((s) => s.events.push({ id: newId(), type, start, dur }),
    (type === "full" ? "Полное обновление" : "Промежуточный пар") + " отмечено. Заход в баню с " + fmt(start + dur * 60000));
}

/* ---------- panel rendering ---------- */
function fillForms() {
  $("set-full").value = state.settings.fullMin;
  $("set-mid").value = state.settings.midMin;
  $("set-notice").value = state.notice;
  const d = new Date();
  $("ev-time").value = pad(d.getHours()) + ":" + pad(d.getMinutes());
  syncDur();
  fillWeek();
  if (!$("sp-date").value) $("sp-date").value = dateKey(Date.now());
  $("sp-date").min = dateKey(Date.now());
}
function fillWeek() {
  $("wk-rows").innerHTML = WEEK_ORDER.map((d) => {
    const w = state.week[d];
    return '<div class="wk-row' + (w.open ? "" : " off") + '" data-day="' + d + '">' +
      '<label class="switch"><input type="checkbox" id="wk-open-' + d + '"' + (w.open ? " checked" : "") + ">" + DAY_TITLE[d] + "</label>" +
      '<div class="wk-times"><input class="inp num" type="time" id="wk-from-' + d + '" value="' + w.from + '" aria-label="' + DAY_TITLE[d] + ', открытие">' +
      '<span aria-hidden="true">—</span><input class="inp num" type="time" id="wk-to-' + d + '" value="' + w.to + '" aria-label="' + DAY_TITLE[d] + ', закрытие"></div></div>';
  }).join("");
}

function renderSchedule(now) {
  const h = hoursFor(state, now);
  $("today-title").textContent = "Сегодня, " + DAY_TITLE[new Date(now).getDay()].toLowerCase() + ": " + (h.open ? "работаем " + hoursText(h) : "выходной");
  const nx = nextOpening(state, now);
  $("today-line").textContent = h.special
    ? "Особый день" + (h.note ? " · " + h.note : "") + ". Обычный график на сегодня отменён."
    : h.open ? "По обычному графику." : "По обычному графику." + (nx ? " Откроемся " + dayLabel(nx, now) + " в " + fmt(nx) + "." : "");
  const openNow = h.open && now < h.end;
  $("today-open").hidden = openNow;
  $("today-close").hidden = !h.open;
  $("today-reset").hidden = !h.special;

  const todayKey = dateKey(now);
  const list = state.specials.filter((x) => x.date >= todayKey);
  $("sp-list").innerHTML = list.length
    ? list.map((x) => {
        const d = new Date(keyToMs(x.date));
        return '<li><span class="t">' + DAY_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + "</span>" +
          (x.open ? '<span class="badge badge--owner">открыто ' + x.from + "–" + x.to + "</span>" : '<span class="badge badge--live">выходной</span>') +
          '<span class="k">' + esc(x.note) + "</span>" +
          '<span class="acts"><button class="btn btn--danger btn--sm" type="button" data-act="sp-delete" data-id="' + x.date + '">Удалить</button></span></li>';
      }).join("")
    : '<li><span class="k">Особых дней нет — работаем по обычной неделе.</span></li>';
}
let formsFilled = false;
function renderPanel() {
  if (!formsFilled && state.updatedAt) { formsFilled = true; fillForms(); }
  const now = Date.now();
  const v = statusView(state, now);
  $("mini").dataset.kind = v.kind;
  $("mini-title").textContent = v.title;
  $("mini-line").textContent = v.line;
  $("q-full-sub").textContent = "Сейчас, на " + state.settings.fullMin + " мин · заход с " + fmt(now + state.settings.fullMin * 60000);
  $("q-mid-sub").textContent = "Сейчас, на " + state.settings.midMin + " мин · заход с " + fmt(now + state.settings.midMin * 60000);
  renderEvList(now);
  renderSchedule(now);
}
function renderEvList(now) {
  const list = $("ev-list");
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const evs = sortedEvents(state).filter((e) => endOf(e) >= startToday.getTime());
  if (!evs.length) { list.innerHTML = '<li><span class="k">Сегодня записей нет. Нажмите «Полное обновление пара», когда начнёте.</span></li>'; return; }
  list.innerHTML = evs.map((e) => {
    const live = e.start <= now && now < endOf(e), past = endOf(e) <= now;
    const dayNote = sameDay(e.start, now) ? "" : " · " + new Date(e.start).getDate() + " " + MONTHS[new Date(e.start).getMonth()];
    let acts = "";
    if (live) acts += '<button class="btn btn--sm" type="button" data-act="finish" data-id="' + esc(e.id) + '">Закончить сейчас</button><button class="btn btn--ghost btn--sm" type="button" data-act="extend" data-id="' + esc(e.id) + '">+10 мин</button>';
    acts += '<button class="btn btn--danger btn--sm" type="button" data-act="delete" data-id="' + esc(e.id) + '">Удалить</button>';
    return '<li class="' + (live ? "is-live" : past ? "is-past" : "") + '"><span class="t">' + fmt(e.start) + "–" + fmt(endOf(e)) + "</span>" +
      (live ? '<span class="badge badge--live">идёт</span>' : past ? '<span class="badge">прошло</span>' : '<span class="badge">впереди</span>') +
      '<span class="k">' + typeName(e.type) + dayNote + '</span><span class="acts">' + acts + "</span></li>";
  }).join("");
}
let lastMinute = -1;
setInterval(() => {
  if (!me) return;
  const m = Math.floor(Date.now() / 60000);
  if (m !== lastMinute) { lastMinute = m; renderPanel(); }
}, 1000);

/* two-step confirm for destructive buttons */
let armed = null, armTimer = 0;
function confirmTwice(btn, label) {
  if (armed === btn) { armed = null; return true; }
  if (armed) { armed.classList.remove("is-armed"); armed.textContent = armed.dataset.label || "Удалить"; }
  armed = btn; btn.dataset.label = btn.textContent; btn.classList.add("is-armed"); btn.textContent = label;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { if (armed) { armed.classList.remove("is-armed"); armed.textContent = armed.dataset.label; armed = null; } }, 4000);
  return false;
}

$("view-panel").addEventListener("click", (ev) => {
  const q = ev.target.closest("[data-quick]");
  if (q) {
    const t = q.dataset.quick, d = new Date(); d.setSeconds(0, 0);
    addEvent(t, d.getTime(), t === "full" ? state.settings.fullMin : state.settings.midMin);
    return;
  }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === "delete") {
    if (!confirmTwice(b, "Точно удалить?")) return;
    mutate((s) => { s.events = s.events.filter((e) => e.id !== id); }, "Запись удалена");
  } else if (act === "finish") {
    mutate((s) => { for (const e of s.events) if (e.id === id) e.dur = Math.max(1, Math.round((Date.now() - e.start) / 60000)); }, "Готово: гости видят, что можно заходить");
  } else if (act === "extend") {
    mutate((s) => { for (const e of s.events) if (e.id === id) e.dur += 10; }, "Продлено на 10 минут");
  } else if (act === "remove-admin") {
    if (!confirmTwice(b, "Точно удалить?")) return;
    removeAdmin(id);
  } else if (act === "sp-delete") {
    if (!confirmTwice(b, "Точно удалить?")) return;
    mutate((s) => { s.specials = s.specials.filter((x) => x.date !== id); }, "Особый день удалён");
  } else if (act === "today-open") {
    const now = Date.now(), key = dateKey(now), base = state.week[new Date(now).getDay()];
    const d = new Date(now); d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
    const nowHM = pad(d.getHours()) + ":" + pad(d.getMinutes());
    const from = base.open && base.from < nowHM ? base.from : nowHM;
    const to = base.to > nowHM ? base.to : "22:00" > nowHM ? "22:00" : "23:55";
    mutate((s) => { s.specials = s.specials.filter((x) => x.date !== key); s.specials.push({ date: key, open: true, from, to, note: "" }); },
      "Баня открыта сегодня до " + to);
  } else if (act === "today-close") {
    if (!confirmTwice(b, "Закрыть на сегодня?")) return;
    const key = dateKey(Date.now());
    mutate((s) => { s.specials = s.specials.filter((x) => x.date !== key); s.specials.push({ date: key, open: false, from: "08:00", to: "22:00", note: "" }); },
      "Сегодня баня отмечена как выходной");
  } else if (act === "today-reset") {
    const key = dateKey(Date.now());
    mutate((s) => { s.specials = s.specials.filter((x) => x.date !== key); }, "Сегодня — снова по обычному графику");
  }
});

/* ---------- schedule forms ---------- */
$("wk-rows").addEventListener("change", (ev) => {
  const cb = ev.target.closest('input[type="checkbox"]');
  if (cb) cb.closest(".wk-row").classList.toggle("off", !cb.checked);
});
$("week-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const week = [];
  for (let d = 0; d < 7; d++) {
    const open = $("wk-open-" + d).checked, from = $("wk-from-" + d).value, to = $("wk-to-" + d).value;
    if (open && (!HM_RE.test(from) || !HM_RE.test(to) || from >= to)) { toast(DAY_TITLE[d] + ": время закрытия должно быть позже открытия.", true); return; }
    week.push({ open, from: HM_RE.test(from) ? from : state.week[d].from, to: HM_RE.test(to) ? to : state.week[d].to });
  }
  mutate((s) => { s.week = week; }, "Обычная неделя сохранена");
});
function syncSpMode() { $("sp-times").hidden = !$("sp-mode-open").checked; }
$("sp-mode-open").addEventListener("change", syncSpMode);
$("sp-mode-closed").addEventListener("change", syncSpMode);
$("sp-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const date = $("sp-date").value, open = $("sp-mode-open").checked;
  const from = $("sp-from").value, to = $("sp-to").value, note = $("sp-note").value.trim().slice(0, 80);
  if (!DATE_RE.test(date)) { toast("Выберите дату.", true); return; }
  if (date < dateKey(Date.now())) { toast("Эта дата уже прошла.", true); return; }
  if (open && (!HM_RE.test(from) || !HM_RE.test(to) || from >= to)) { toast("Время закрытия должно быть позже открытия.", true); return; }
  const d = new Date(keyToMs(date));
  mutate((s) => {
    s.specials = s.specials.filter((x) => x.date !== date);
    s.specials.push({ date, open, from: open ? from : "08:00", to: open ? to : "22:00", note });
  }, d.getDate() + " " + MONTHS[d.getMonth()] + ": " + (open ? "открыто " + from + "–" + to : "выходной"));
  $("sp-note").value = "";
});

const evType = () => ($("ev-type-mid").checked ? "mid" : "full");
function syncDur() { $("ev-dur").value = evType() === "full" ? state.settings.fullMin : state.settings.midMin; updatePreview(); }
function formStart() {
  const v = $("ev-time").value;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(); d.setHours(+v.slice(0, 2), +v.slice(3, 5), 0, 0);
  return d.getTime();
}
function updatePreview() {
  const s = formStart(), dur = Math.round(+$("ev-dur").value);
  $("ev-preview").textContent = s && dur > 0
    ? "С " + fmt(s) + " до " + fmt(s + dur * 60000) + " вход закрыт. Следующий заход в баню — в " + fmt(s + dur * 60000) + "."
    : "Укажите время начала и сколько минут вход будет закрыт.";
}
$("ev-type-full").addEventListener("change", syncDur);
$("ev-type-mid").addEventListener("change", syncDur);
$("ev-time").addEventListener("input", updatePreview);
$("ev-dur").addEventListener("input", updatePreview);
$("ev-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const s = formStart(), dur = Math.round(+$("ev-dur").value);
  if (!s) { toast("Укажите время начала, например 14:30.", true); return; }
  if (!(dur >= 1 && dur <= 240)) { toast("Длительность — от 1 до 240 минут.", true); return; }
  addEvent(evType(), s, dur);
});
$("settings-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = Math.round(+$("set-full").value), m = Math.round(+$("set-mid").value);
  if (!(f >= 5 && f <= 240) || !(m >= 1 && m <= 120)) { toast("Полное — от 5 до 240 минут, промежуточное — от 1 до 120.", true); return; }
  const n = $("set-notice").value.trim().slice(0, 160);
  mutate((s) => { s.settings.fullMin = f; s.settings.midMin = m; s.notice = n; }, "Настройки сохранены");
});

/* ---------- own password ---------- */
$("pass-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const oldP = $("pass-old").value, newP = $("pass-new").value;
  if (!oldP) { toast("Введите текущий пароль.", true); return; }
  if (newP.length < 8) { toast("Новый пароль — не короче 8 символов.", true); return; }
  setBusy(true);
  try {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldP));
    await updatePassword(user, newP);
    $("pass-old").value = ""; $("pass-new").value = "";
    toast("Пароль изменён");
  } catch (e) {
    const c = e && e.code;
    toast(c === "auth/wrong-password" || c === "auth/invalid-credential" ? "Текущий пароль неверный." : c === "auth/too-many-requests" ? "Слишком много попыток. Подождите несколько минут." : "Не получилось сменить пароль.", true);
  } finally { setBusy(false); }
});

/* ---------- admins (owner only) ---------- */
let adminsWatched = false;
let admins = [];
function watchAdmins() {
  adminsWatched = true;
  unsubs.push(onSnapshot(collection(db, "admins"), (snap) => {
    admins = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.role === b.role ? String(a.username).localeCompare(String(b.username)) : a.role === "owner" ? -1 : 1));
    renderAdmins();
  }, () => {}));
  unsubs.push(() => { adminsWatched = false; });
}
function renderAdmins() {
  $("admins-list").innerHTML = admins.map((a) => {
    const self = me && a.uid === me.uid;
    return '<li><span class="t">' + esc(a.username || "—") + "</span>" +
      (a.role === "owner" ? '<span class="badge badge--owner">главный</span>' : '<span class="badge">отмечает пар</span>') +
      '<span class="k">' + (self ? "это вы" : a.createdBy ? "добавил " + esc(a.createdBy) : "") + "</span>" +
      (self ? "" : '<span class="acts"><button class="btn btn--danger btn--sm" type="button" data-act="remove-admin" data-id="' + esc(a.uid) + '">Удалить</button></span>') +
      "</li>";
  }).join("");
}
async function removeAdmin(uid) {
  const a = admins.find((x) => x.uid === uid);
  setBusy(true);
  try { await deleteDoc(doc(db, "admins", uid)); toast("Доступ у " + (a ? a.username : "администратора") + " отключён"); }
  catch (e) { toast(errText(e), true); }
  finally { setBusy(false); }
}

function genPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10); crypto.getRandomValues(buf);
  let s = ""; for (const n of buf) s += abc[n % abc.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}
$("add-gen").addEventListener("click", () => { $("add-pass").value = genPassword(); });

$("add-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!me || me.role !== "owner") return;
  const username = $("add-user").value.trim().toLowerCase();
  const password = $("add-pass").value;
  const role = $("add-role-owner").checked ? "owner" : "admin";
  if (!USER_RE.test(username)) { toast("Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.", true); return; }
  if (password.length < 8) { toast("Пароль — не короче 8 символов. Нажмите «Придумать».", true); return; }
  setBusy(true);
  const sec = initializeApp(firebaseConfig, "add-" + Date.now());
  try {
    const secAuth = initializeAuth(sec, { persistence: inMemoryPersistence });
    const cred = await createUserWithEmailAndPassword(secAuth, toEmail(username), password);
    await setDoc(doc(db, "admins", cred.user.uid), { username, role, createdAt: Date.now(), createdBy: me.username });
    await signOut(secAuth);
    const text = "Hamam 31 — панель администратора\nСсылка: " + ADMIN_URL + "\nЛогин: " + username + "\nПароль: " + password + "\nПосле входа смените пароль в разделе «Мой пароль».";
    $("creds-text").textContent = text;
    $("creds").hidden = false;
    $("add-user").value = ""; $("add-pass").value = "";
    toast("Администратор " + username + " добавлен");
  } catch (e) {
    const c = e && e.code;
    toast(c === "auth/email-already-in-use" ? "Такой логин уже есть или был раньше. Придумайте другой." : c === "auth/weak-password" ? "Пароль слишком простой." : errText(e), true);
  } finally {
    deleteApp(sec).catch(() => {});
    setBusy(false);
  }
});
$("creds-copy").addEventListener("click", async () => {
  const text = $("creds-text").textContent;
  try { await navigator.clipboard.writeText(text); toast("Скопировано"); }
  catch { const r = document.createRange(); r.selectNodeContents($("creds-text")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Выделено — скопируйте вручную"); }
});
$("creds-share").addEventListener("click", async () => {
  const text = $("creds-text").textContent;
  if (navigator.share) { try { await navigator.share({ text }); } catch {} }
  else { $("creds-copy").click(); }
});
