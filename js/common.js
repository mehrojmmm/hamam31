// Shared logic for the guest page and the admin panel: schedule, steam status, rendering helpers.
export const DAY_IN = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
export const DAY_NAME = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const DAY_TITLE = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
export const DAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const READY_MIN = 15; // minutes after a renewal ends during which the card shows "можно заходить"

export const DEFAULT_WEEK = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d === 5 || d === 6 || d === 0, from: "08:00", to: "22:00" }));

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = (n) => (n < 10 ? "0" : "") + n;
export const fmt = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
export const endOf = (e) => e.start + e.dur * 60000;
export const typeName = (t) => (t === "full" ? "Полное обновление" : "Промежуточный пар");
export const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
export function dateKey(ms) { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
export function keyToMs(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); }
export function at(ms, hm) { const d = new Date(ms); d.setHours(+hm.slice(0, 2), +hm.slice(3, 5), 0, 0); return d.getTime(); }
export function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
export function durText(ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return ms <= 0 ? "сейчас" : "меньше минуты";
  if (m < 60) return m + " мин";
  const h = Math.floor(m / 60), r = m % 60;
  return h + " ч" + (r ? " " + r + " мин" : "");
}
function agoText(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "только что";
  if (m < 60) return m + " мин назад";
  const h = Math.floor(m / 60), r = m % 60;
  return h + " ч" + (r ? " " + r + " мин" : "") + " назад";
}
// "сегодня", "вчера", "завтра", "в пятницу, 20 ноября"
export function dayLabel(ms, now) {
  if (sameDay(ms, now)) return "сегодня";
  if (sameDay(ms, addDays(now, -1))) return "вчера";
  if (sameDay(ms, addDays(now, 1))) return "завтра";
  const d = new Date(ms);
  return DAY_IN[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
}

/* ---------- state ---------- */
function normDay(x, def) {
  x = x || {};
  return { open: typeof x.open === "boolean" ? x.open : def.open, from: HM_RE.test(x.from) ? x.from : def.from, to: HM_RE.test(x.to) ? x.to : def.to };
}
export function normalize(raw) {
  const s = raw || {};
  const st = s.settings || {};
  return {
    events: Array.isArray(s.events)
      ? s.events.filter((e) => e && typeof e.start === "number" && typeof e.dur === "number" && (e.type === "full" || e.type === "mid"))
      : [],
    settings: { fullMin: +st.fullMin > 0 ? +st.fullMin : 60, midMin: +st.midMin > 0 ? +st.midMin : 15 },
    notice: typeof s.notice === "string" ? s.notice : "",
    week: Array.isArray(s.week) && s.week.length === 7 ? s.week.map((x, i) => normDay(x, DEFAULT_WEEK[i])) : DEFAULT_WEEK.map((d) => ({ ...d })),
    specials: Array.isArray(s.specials)
      ? s.specials.filter((x) => x && DATE_RE.test(x.date)).map((x) => ({
          date: x.date, open: !!x.open,
          from: HM_RE.test(x.from) ? x.from : "08:00", to: HM_RE.test(x.to) ? x.to : "22:00",
          note: typeof x.note === "string" ? x.note.slice(0, 80) : "",
        })).sort((a, b) => (a.date < b.date ? -1 : 1))
      : [],
    updatedAt: +s.updatedAt || 0,
    updatedBy: typeof s.updatedBy === "string" ? s.updatedBy : "",
  };
}
export const sortedEvents = (state) => state.events.slice().sort((a, b) => a.start - b.start);

/* ---------- schedule ---------- */
// Working hours for the calendar day that contains `ms`, with special days applied.
export function hoursFor(state, ms) {
  const key = dateKey(ms);
  const sp = state.specials.find((x) => x.date === key);
  const base = state.week[new Date(ms).getDay()];
  const h = sp
    ? { open: sp.open, from: sp.open ? sp.from : base.from, to: sp.open ? sp.to : base.to, note: sp.note, special: true }
    : { open: base.open, from: base.from, to: base.to, note: "", special: false };
  h.start = at(ms, h.from);
  h.end = at(ms, h.to);
  if (h.end <= h.start) h.open = false;
  return h;
}
export function isOpenNow(state, now) {
  const h = hoursFor(state, now);
  return h.open && now >= h.start && now < h.end;
}
export function nextOpening(state, now) {
  for (let i = 0; i < 90; i++) {
    const day = addDays(now, i);
    const h = hoursFor(state, day);
    if (h.open && h.start > now) return h.start;
  }
  return null;
}
export function hoursText(h) { return h.from + " — " + h.to; }
// Short summary of the regular week: { days: "Пт · Сб · Вс", hours: "08:00 — 22:00" }
export function weekSummary(state) {
  const open = WEEK_ORDER.filter((d) => state.week[d].open);
  if (!open.length) return { days: "Сейчас без постоянного графика", hours: "" };
  const same = open.every((d) => state.week[d].from === state.week[open[0]].from && state.week[d].to === state.week[open[0]].to);
  return {
    days: open.length === 7 ? "Каждый день" : open.map((d) => DAY_SHORT[d]).join(" · "),
    hours: same ? hoursText(state.week[open[0]]) : "часы — в расписании",
  };
}

/* ---------- steam status ---------- */
// If renewals follow one another, entry opens only after the last of them.
export function chainEnd(evs, t) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const e of evs) if (e.start <= t && endOf(e) > t) { t = endOf(e); moved = true; }
  }
  return t;
}
export function currentEvent(evs, now) {
  let cur = null;
  for (const e of evs) if (e.start <= now && now < endOf(e) && (!cur || endOf(e) > endOf(cur))) cur = e;
  return cur;
}
export function lastFinished(evs, now) {
  let last = null;
  for (const e of evs) if (endOf(e) <= now && (!last || endOf(e) > endOf(last))) last = e;
  return last;
}

const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function lastSteamHTML(evs, now) {
  const last = lastFinished(evs, now);
  if (!last) return '<div class="status__fresh">' + ICON_CLOCK + "<span>Последнее обновление пара пока не отмечено</span></div>";
  const end = endOf(last);
  const when = sameDay(end, now) ? "сегодня в " : dayLabel(end, now) + " в ";
  const ago = now - end < 12 * 3600000 ? " · " + agoText(now - end) : "";
  let html = '<div class="status__fresh">' + ICON_CLOCK + "<span>Последнее обновление пара: " + when + '<strong class="num">' + fmt(end) + "</strong>" + ago + " · " + (last.type === "full" ? "полное" : "промежуточное") + "</span></div>";
  if (last.type === "mid") {
    let full = null;
    for (const e of evs) if (e.type === "full" && endOf(e) <= now && (!full || endOf(e) > endOf(full))) full = e;
    if (full) html += '<div class="status__fresh status__fresh--sub">' + ICON_CLOCK + "<span>Последнее полное: " + (sameDay(endOf(full), now) ? "сегодня в " : dayLabel(endOf(full), now) + " в ") + '<strong class="num">' + fmt(endOf(full)) + "</strong></span></div>";
  }
  return html;
}

const ICON_GO = '<svg viewBox="0 0 64 64" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M19 33l9 9 18-20"/></svg>';

// Returns { kind, title, line, html } for the big status card.
// kind: renew | mid | ready | open | closed
export function statusView(state, now) {
  const evs = sortedEvents(state);
  const cur = currentEvent(evs, now);
  const last = lastSteamHTML(evs, now);

  if (cur) {
    const entry = chainEnd(evs, endOf(cur));
    const pct = Math.max(0, Math.min(100, ((now - cur.start) / (entry - cur.start)) * 100));
    const title = cur.type === "full" ? "Идёт полное обновление пара" : "Идёт промежуточный пар";
    return {
      kind: cur.type === "full" ? "renew" : "mid",
      title,
      line: "Следующий заход в баню — в " + fmt(entry) + " (через " + durText(entry - now) + ")",
      html:
        '<span class="pill">' + title + "</span>" +
        '<div class="status__label">Следующий заход в баню</div>' +
        '<div class="status__time">' + fmt(entry) + "</div>" +
        '<p class="status__sub">через <em>' + durText(entry - now) + "</em> · началось в " + fmt(cur.start) + "</p>" +
        '<div class="progress" aria-hidden="true"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<p class="status__hint">Пока пар обновляется, в парилку заходить нельзя. Страница обновится сама, перезагружать её не нужно.</p>' +
        last,
    };
  }

  const today = hoursFor(state, now);
  if (isOpenNow(state, now)) {
    const next = evs.find((e) => e.start > now && sameDay(e.start, now));
    const fin = lastFinished(evs, now);
    let nextHTML, line;
    if (next) {
      const after = chainEnd(evs, endOf(next));
      line = "Следующее обновление пара в " + fmt(next.start) + ", заход снова с " + fmt(after);
      nextHTML = '<p class="status__sub">Следующее обновление пара — в <em>' + fmt(next.start) + "</em> (через " + durText(next.start - now) + "), заход снова с " + fmt(after) + "</p>";
    } else {
      line = "Следующее обновление пара пока не назначено";
      nextHTML = "";
    }
    const closing = today.end - now < 3600000 ? '<p class="status__hint">Сегодня работаем до ' + today.to + ".</p>" : "";

    // Steam just finished: big green "можно заходить"
    if (fin && now - endOf(fin) < READY_MIN * 60000) {
      return {
        kind: "ready",
        title: "Пар готов — можно заходить",
        line: "Можно заходить. " + line,
        html:
          '<span class="pill">Пар готов</span>' +
          '<div class="go">' + ICON_GO + "<b>Можно заходить!</b></div>" +
          '<p class="status__sub">Свежий пар: обновление закончилось в ' + fmt(endOf(fin)) + ".</p>" +
          nextHTML + closing + last,
      };
    }

    let html = '<span class="pill">Баня открыта — можно заходить</span>';
    if (next) {
      html +=
        '<div class="status__label">Следующее обновление пара в</div>' +
        '<div class="status__time">' + fmt(next.start) + "</div>" +
        '<p class="status__sub">через <em>' + durText(next.start - now) + "</em> · " + (next.type === "full" ? "полное" : "промежуточное") + ", заход снова с " + fmt(chainEnd(evs, endOf(next))) + "</p>";
    } else {
      html +=
        '<div class="status__label">Следующее обновление пара</div>' +
        '<div class="status__time"><small>пока не назначено</small></div>' +
        '<p class="status__sub">Банщик отметит время, как только решит обновлять пар. Оно сразу появится здесь.</p>';
    }
    return { kind: "open", title: "Баня открыта — можно заходить", line, html: html + closing + last };
  }

  // Closed
  const nx = nextOpening(state, now);
  let head;
  if (!today.open && today.special) head = "Сегодня баня не работает" + (today.note ? ": " + today.note : "");
  else head = "Сейчас баня закрыта";
  let html = '<span class="pill">' + esc(head) + "</span>";
  let line;
  if (nx) {
    const nh = hoursFor(state, nx);
    line = "Откроемся " + dayLabel(nx, now) + " в " + fmt(nx);
    html +=
      '<div class="status__label">Откроемся ' + dayLabel(nx, now) + " в</div>" +
      '<div class="status__time">' + fmt(nx) + "</div>" +
      '<p class="status__sub">через <em>' + durText(nx - now) + "</em>" + (nh.note ? " · " + esc(nh.note) : "") + "</p>";
  } else {
    line = "Дата открытия уточняется";
    html += '<div class="status__label">Дата открытия</div><div class="status__time"><small>уточняется</small></div>';
  }
  return { kind: "closed", title: head, line, html: html + last };
}

/* ---------- timeline ---------- */
const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const ICON_STEAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 20c-2.5-3 2.5-5.5 0-9M12 20c-2.5-3 2.5-5.5 0-9M16 20c-2.5-3 2.5-5.5 0-9"/></svg>';

export function timelineHTML(state, now) {
  const h = hoursFor(state, now);
  const evs = sortedEvents(state).filter((e) => sameDay(e.start, now));
  if (!h.open && !evs.length) {
    const nx = nextOpening(state, now);
    const why = h.special ? "Сегодня баня не работает" + (h.note ? " (" + esc(h.note) + ")" : "") + "." : "Сегодня выходной.";
    return '<div class="empty">' + ICON_CAL + "<span>" + why + (nx ? " Откроемся " + dayLabel(nx, now) + " в " + fmt(nx) + "." : "") + "</span></div>";
  }
  const w0 = h.open ? h.start : at(now, "08:00"), w1 = h.open ? h.end : at(now, "22:00");
  const span = w1 - w0;
  const pos = (t) => Math.max(0, Math.min(100, ((t - w0) / span) * 100));
  let html = '<div class="tl__track" role="img" aria-label="Обновления пара сегодня с ' + fmt(w0) + " до " + fmt(w1) + '">';
  html += '<div class="tl__past" style="width:' + pos(now).toFixed(2) + '%"></div>';
  for (const e of evs) {
    const a = pos(e.start), b = pos(endOf(e));
    if (b <= 0 || a >= 100) continue;
    html += '<div class="tl__blk' + (e.type === "mid" ? " tl__blk--mid" : "") + '" style="left:' + a.toFixed(2) + "%;width:" + Math.max(0.6, b - a).toFixed(2) + '%" title="' + fmt(e.start) + "–" + fmt(endOf(e)) + " " + typeName(e.type) + '"></div>';
  }
  if (now >= w0 && now <= w1) html += '<div class="tl__now" style="left:' + pos(now).toFixed(2) + '%"></div>';
  html += '</div><div class="tl__hours">';
  const firstH = Math.ceil((w0 - at(now, "00:00")) / 3600000), lastH = Math.floor((w1 - at(now, "00:00")) / 3600000);
  const step = lastH - firstH > 8 ? 2 : 1;
  const labels = [w0];
  for (let hh = firstH; hh <= lastH; hh += step) { const t = at(now, pad(Math.min(hh, 23)) + ":00"); if (t > w0 + 1800000 && t < w1 - 1800000) labels.push(t); }
  labels.push(w1);
  for (const t of labels) html += '<span style="left:' + pos(t).toFixed(2) + '%">' + fmt(t) + "</span>";
  html += '</div><div class="legend"><span><i></i>Полное обновление</span><span><i class="mid"></i>Промежуточный пар</span><span><i class="now"></i>Сейчас</span></div>';
  if (evs.length) {
    html += '<ul class="evlist">';
    for (const e of evs) {
      const live = e.start <= now && now < endOf(e), past = endOf(e) <= now;
      html += '<li class="' + (live ? "is-live" : past ? "is-past" : "") + '"><span class="t">' + fmt(e.start) + "–" + fmt(endOf(e)) + '</span><span class="k">' + typeName(e.type) + (live ? " · идёт сейчас" : past ? "" : " · впереди") + "</span></li>";
    }
    html += "</ul>";
  } else {
    html += '<div class="empty" style="margin-top:18px">' + ICON_STEAM + "<span>Сегодня обновлений пара ещё не отмечали. Как только банщик начнёт, время появится на этой линии.</span></div>";
  }
  return html;
}

/* ---------- misc ---------- */
let toastTimer = 0;
export function toast(msg, err) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle("err", !!err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3500);
}

export const configReady = (cfg) => !!(cfg && cfg.apiKey && !String(cfg.apiKey).startsWith("REPLACE"));
