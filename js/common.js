// Shared time logic for the guest page and the admin panel.
export const FIREBASE_VERSION = "10.12.2";
export const OPEN_DAYS = [5, 6, 0];   // пятница, суббота, воскресенье
export const OPEN_H = 8, CLOSE_H = 22;
export const DAY_IN = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
export const DAY_NAME = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = (n) => (n < 10 ? "0" : "") + n;
export const fmt = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
export const endOf = (e) => e.start + e.dur * 60000;
export const typeName = (t) => (t === "full" ? "Полное обновление" : "Промежуточный пар");
export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
export function durText(ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return ms <= 0 ? "сейчас" : "меньше минуты";
  if (m < 60) return m + " мин";
  const h = Math.floor(m / 60), r = m % 60;
  return h + " ч" + (r ? " " + r + " мин" : "");
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
    updatedAt: +s.updatedAt || 0,
    updatedBy: typeof s.updatedBy === "string" ? s.updatedBy : "",
  };
}
export const sortedEvents = (state) => state.events.slice().sort((a, b) => a.start - b.start);

export const isOpenDay = (d) => OPEN_DAYS.includes(d.getDay());
export function dayWindow(ms) {
  const a = new Date(ms); a.setHours(OPEN_H, 0, 0, 0);
  const b = new Date(ms); b.setHours(CLOSE_H, 0, 0, 0);
  return [a.getTime(), b.getTime()];
}
export function isOpenNow(now) {
  if (!isOpenDay(new Date(now))) return false;
  const [a, b] = dayWindow(now);
  return now >= a && now < b;
}
export function nextOpening(now) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    if (!isOpenDay(d)) continue;
    const [a] = dayWindow(d.getTime());
    if (a > now) return a;
  }
  return now;
}
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

// Returns { kind, title, html } for the big status card.
export function statusView(state, now) {
  const evs = sortedEvents(state);
  const cur = currentEvent(evs, now);
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
        '<p class="status__hint">Пока пар обновляется, в парилку заходить нельзя. Страница обновится сама, перезагружать её не нужно.</p>',
    };
  }

  if (isOpenNow(now)) {
    const [, close] = dayWindow(now);
    const next = evs.find((e) => e.start > now && sameDay(e.start, now));
    let last = null;
    for (const e of evs) if (endOf(e) <= now && sameDay(e.start, now)) last = e;
    let html = '<span class="pill">Баня открыта — можно заходить</span>';
    let line;
    if (next) {
      const after = chainEnd(evs, endOf(next));
      line = "Следующее обновление пара в " + fmt(next.start) + ", заход снова с " + fmt(after);
      html +=
        '<div class="status__label">Следующее обновление пара в</div>' +
        '<div class="status__time">' + fmt(next.start) + "</div>" +
        '<p class="status__sub">через <em>' + durText(next.start - now) + "</em> · " + (next.type === "full" ? "полное" : "промежуточное") + ", заход снова с " + fmt(after) + "</p>";
    } else {
      line = "Следующее обновление пара пока не назначено";
      html +=
        '<div class="status__label">Следующее обновление пара</div>' +
        '<div class="status__time"><small>пока не назначено</small></div>' +
        '<p class="status__sub">Банщик отметит время, как только решит обновлять пар. Оно сразу появится здесь.</p>';
    }
    if (last) html += '<div class="status__fresh">Пар обновлён в <strong class="num">' + fmt(endOf(last)) + "</strong> · " + durText(now - endOf(last)) + " назад</div>";
    else if (close - now < 3600000) html += '<div class="status__fresh">Сегодня работаем до <strong class="num">22:00</strong></div>';
    return { kind: "open", title: "Баня открыта — можно заходить", line, html };
  }

  const nx = nextOpening(now), d = new Date(nx);
  const when = sameDay(nx, now) ? "сегодня" : sameDay(nx, now + 86400000) ? "завтра" : DAY_IN[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
  return {
    kind: "closed",
    title: "Сейчас баня закрыта",
    line: "Откроемся " + when + " в " + fmt(nx),
    html:
      '<span class="pill">Сейчас баня закрыта</span>' +
      '<div class="status__label">Откроемся ' + when + " в</div>" +
      '<div class="status__time">' + fmt(nx) + "</div>" +
      '<p class="status__sub">через <em>' + durText(nx - now) + "</em></p>" +
      '<p class="status__hint">Работаем в пятницу, субботу и воскресенье с 8:00 до 22:00.</p>',
  };
}

const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const ICON_STEAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 20c-2.5-3 2.5-5.5 0-9M12 20c-2.5-3 2.5-5.5 0-9M16 20c-2.5-3 2.5-5.5 0-9"/></svg>';

export function timelineHTML(state, now) {
  const [w0, w1] = dayWindow(now), span = w1 - w0;
  const evs = sortedEvents(state).filter((e) => sameDay(e.start, now));
  if (!isOpenDay(new Date(now)) && !evs.length) {
    const nx = new Date(nextOpening(now));
    return '<div class="empty">' + ICON_CAL + "<span>Сегодня выходной. Ближайший рабочий день — " + DAY_NAME[nx.getDay()] + ", " + nx.getDate() + " " + MONTHS[nx.getMonth()] + ", с 8:00.</span></div>";
  }
  const pos = (t) => Math.max(0, Math.min(100, ((t - w0) / span) * 100));
  let html = '<div class="tl__track" role="img" aria-label="Обновления пара сегодня с 8:00 до 22:00">';
  html += '<div class="tl__past" style="width:' + pos(now).toFixed(2) + '%"></div>';
  for (const e of evs) {
    const a = pos(e.start), b = pos(endOf(e));
    if (b <= 0 || a >= 100) continue;
    html += '<div class="tl__blk' + (e.type === "mid" ? " tl__blk--mid" : "") + '" style="left:' + a.toFixed(2) + "%;width:" + Math.max(0.6, b - a).toFixed(2) + '%" title="' + fmt(e.start) + "–" + fmt(endOf(e)) + " " + typeName(e.type) + '"></div>';
  }
  if (now >= w0 && now <= w1) html += '<div class="tl__now" style="left:' + pos(now).toFixed(2) + '%"></div>';
  html += '</div><div class="tl__hours">';
  for (let h = OPEN_H; h <= CLOSE_H; h += 2) html += '<span style="left:' + (((h - OPEN_H) / (CLOSE_H - OPEN_H)) * 100).toFixed(2) + '%">' + pad(h) + ":00</span>";
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

let toastTimer = 0;
export function toast(msg, err) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle("err", !!err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3500);
}

export const configReady = (cfg) => !!(cfg && cfg.apiKey && !String(cfg.apiKey).startsWith("REPLACE"));
