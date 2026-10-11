// Wordies 화면과 제스처. 학습 규칙은 engine.js에 있다.
import { createEngine, createSession, emptyState, typoCount, dayKey, RULES } from "./engine.js";

const KEY = "wordies.v1";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let words = [], state, engine, session = null, current = null, screen = null;

// ---------- 저장 ----------
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch {}
  return emptyState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

// ---------- 화면 전환 ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  const el = document.getElementById(id);
  el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  screen = id;
  ({ home: renderHome, settings: renderSettings }[id] || (() => {}))();
}

// ---------- 제스처 ----------
// onSwipe(dir) 가 true를 돌려주면 그 방향으로 확정, 아니면 제자리로.
function gestures(el, { onTap, onSwipe, onDrag, onRelease, axis = "both" }) {
  let sx, sy, st, id = null, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, button, label, .choice, .speak, select")) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now(); moved = false;
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 10) { moved = true; try { el.setPointerCapture(id); } catch {} }
    if (moved && onDrag) onDrag(axis === "x" ? dx : dx, axis === "x" ? 0 : dy);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - sx, dy = e.clientY - sy, dt = performance.now() - st;
    if (!moved) { if (e.type === "pointerup" && dt < 500) onTap?.(e); onRelease?.(null); return; }
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    const vx = Math.abs(dx) / dt, vy = Math.abs(dy) / dt;
    let dir = null;
    if (Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > w * 0.25 || (vx > 0.6 && Math.abs(dx) > 40)) dir = dx > 0 ? "right" : "left"; }
    else if (axis !== "x") { if (Math.abs(dy) > h * 0.16 || (vy > 0.6 && Math.abs(dy) > 40)) dir = dy > 0 ? "down" : "up"; }
    if (e.type === "pointercancel") dir = null;
    const accepted = dir ? onSwipe?.(dir) : false;
    onRelease?.(accepted ? dir : null);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// ---------- 발음 ----------
function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.settings.voice; u.rate = 0.9;
    const v = speechSynthesis.getVoices().find((v) => v.lang === u.lang);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}
const speakerSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

// ---------- 온보딩 ----------
let obIndex = 0;
function renderOnboard() {
  document.querySelectorAll(".ob-slide").forEach((s, i) => s.classList.toggle("on", i === obIndex));
  document.querySelectorAll(".ob-dots i").forEach((d, i) => d.classList.toggle("on", i === obIndex));
}
function obNext() {
  obIndex += 1;
  if (obIndex > 2) {
    state.settings.onboarded = true;
    state.settings.firstDay ||= dayKey(new Date());
    save(); show("home");
  } else renderOnboard();
}

// ---------- 홈 ----------
function renderHome() {
  engine = createEngine(words, state);
  const s = engine.stats(), p = engine.plan();
  save();
  const sec = s.today.sec, budget = s.today.budgetSec;
  const r = 86, C = 2 * Math.PI * r, frac = Math.min(1, sec / budget);
  const fg = $("#ring-fg");
  fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C;
  requestAnimationFrame(() => (fg.style.strokeDashoffset = C * (1 - frac)));
  $("#ring-num").textContent = Math.floor(sec / 60);
  $("#ring-sub").textContent = `/ ${state.settings.minutes}분`;
  $("#streak").textContent = s.streak ? `연속 ${s.streak}일` : "오늘 시작해요";
  const todo = p.reviews.length + p.newIds.length;
  $("#today-line").innerHTML = todo
    ? `오늘 할 것 · 복습 <b>${p.reviews.length}</b> · 새 단어 <b>${p.newIds.length}</b>`
    : s.totalLearned >= s.totalWords && !p.reviews.length ? `준비된 단어를 모두 시작했어요. 복습이 생기면 알려 드려요.` : `오늘 할 일을 마쳤어요. 내일 또 만나요.`;
  if (p.deferred) $("#today-line").innerHTML += `<br><span class="small">밀린 복습 ${p.deferred}개는 내일로 나눴어요</span>`;
  const names = ["월", "화", "수", "목", "금", "토", "일"], t = engine.today();
  $("#week").innerHTML = s.week.map((d, i) => {
    const pct = Math.min(100, (d.sec / budget) * 100);
    const hit = d.sec >= budget * 0.8;
    return `<div class="wd ${hit ? "hit" : ""} ${d.key === t ? "today" : ""} ${d.future ? "future" : ""}"><div class="col"><i style="height:${pct}%"></i></div><span>${names[i]}</span></div>`;
  }).join("");
  $("#today-card").classList.toggle("done", !todo);
  $("#start-hint").textContent = todo ? "탭해서 시작" : "오늘 완료";
  renderGoals(s);
}

// ---------- 학습 ----------
let shownAt = 0, revealAt = 0, revealed = false, locked = false, pendingSpell = null, statsBefore = null;

function startSession() {
  engine = createEngine(words, state);
  session = createSession(engine);
  statsBefore = engine.stats();
  const first = session.next();
  if (!first) { toastHome(); return; }
  show("study");
  render(first);
}
function toastHome() {
  const el = $("#today-card");
  el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 300 });
}

const MODE_LABEL = { intro: "새 단어", choice: "뜻 고르기", cloze: "빈칸 채우기", recall: "뜻 떠올리기", reverse: "영어로 떠올리기", spell: "직접 쓰기", quiz: "마무리 퀴즈" };

function exampleHtml(w, blank) {
  const i = w.ex.indexOf(w.exForm);
  const pre = esc(w.ex.slice(0, i)), post = esc(w.ex.slice(i + w.exForm.length));
  const mid = blank ? `<span class="blank">${esc(w.exForm)}</span>` : `<mark>${esc(w.exForm)}</mark>`;
  return `<div class="ex"><div class="en">${pre}${mid}${post}</div><div class="ko">${esc(w.exKo)}</div></div>`;
}
function backHtml(w, onlyMore = false) {
  const fam = w.family?.length ? `<div><div class="lbl">단어 가족</div><div class="fam-list">${w.family.map(([a, b]) => `<span><b>${esc(a)}</b> ${esc(b)}</span>`).join("")}</div></div>` : "";
  const root = w.root ? `<div><div class="lbl">기억 단서</div>${esc(w.root)}</div>` : "";
  const more = root || fam ? `<div class="more">${root}${fam}</div>` : "";
  if (onlyMore) return `<div class="back">${more}</div>`;
  return `<div class="back"><div class="meaning">${w.meaning.map(esc).join(", ")}</div>${exampleHtml(w, false)}${more}</div>`;
}
function frontHtml(w, extra = "") {
  return `<div class="front"><div class="word">${esc(w.word)}</div><div class="ipa">${esc(w.ipa)}</div><span class="pos">${esc(w.pos)}</span>${extra}</div>`;
}
function distractors(w, n, field) {
  const others = words.filter((x) => x.id !== w.id && (!w.group || x.group !== w.group));
  const pool = [...shuffle(others.filter((x) => x.pos === w.pos)), ...shuffle(others.filter((x) => x.pos !== w.pos))];
  const out = [], seen = new Set([field(w)]);
  for (const x of pool) { const v = field(x); if (!seen.has(v)) { seen.add(v); out.push(v); } if (out.length >= n) break; }
  return out;
}

function render(item) {
  current = item; revealed = false; locked = false; pendingSpell = null;
  shownAt = performance.now(); revealAt = 0;
  const w = engine.byId[item.id], c = engine.state.cards[item.id];
  const card = $("#card");
  card.className = "card dragging"; card.style.transform = ""; card.style.opacity = "";
  void card.offsetWidth; card.classList.remove("dragging");
  card.animate?.([{ transform: "scale(.96)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "ease-out" });
  $("#mode-label").textContent = MODE_LABEL[item.mode] + (c?.help ? " · 도움 모드" : "");
  const speakBtn = `<button class="speak" aria-label="발음 듣기" data-say="${esc(w.word)}">${speakerSvg}</button>`;
  let html = "", ghost = ["← 몰라요", "알아요 →"];

  if (item.mode === "intro") {
    html = speakBtn + frontHtml(w) + backHtml(w);
    card.classList.add("revealed"); revealed = true;
    ghost = ["", "밀어서 다음 →"];
    speak(w.word);
  } else if (item.mode === "choice") {
    const opts = shuffle([w.meaning[0], ...distractors(w, 3, (x) => x.meaning[0])]);
    html = speakBtn + frontHtml(w) + `<div class="choices">${opts.map((o) => `<div class="choice" role="button" tabindex="0" data-v="${esc(o)}">${esc(o)}</div>`).join("")}</div>`;
    ghost = ["", "알맞은 뜻을 탭"];
    speak(w.word);
  } else if (item.mode === "recall") {
    const help = c?.help && w.root ? `<div class="help-hint">${esc(w.root)}</div>` : "";
    html = speakBtn + frontHtml(w, help + `<div class="tap-hint">탭해서 뜻 보기</div>`);
    speak(w.word);
  } else if (item.mode === "reverse") {
    html = `<div class="front"><div class="prompt-ko">${w.meaning.map(esc).join(", ")}</div>${exampleHtml(w, true)}<div class="tap-hint">영어 단어를 떠올리고 탭</div></div>`;
  } else if (item.mode === "spell") {
    html = `<div class="front"><div class="prompt-ko">${w.meaning.map(esc).join(", ")}</div>${exampleHtml(w, true)}
      <input class="spell-input" id="spell" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="빈칸에 들어갈 영어 단어" placeholder="${w.word[0]}…">
      <div class="tap-hint">입력하고 엔터</div></div>`;
    ghost = ["", ""];
  } else if (item.mode === "quiz" || item.mode === "cloze") {
    const opts = shuffle([w.word, ...distractors(w, 3, (x) => x.word)]);
    html = `<div class="front">${exampleHtml(w, true)}</div><div class="choices">${opts.map((o) => `<div class="choice en" role="button" tabindex="0" data-v="${esc(o)}">${esc(o)}</div>`).join("")}</div>`;
    ghost = ["", "빈칸에 맞는 단어를 탭"];
  }
  card.innerHTML = html;
  setGhost(ghost);
  progress();

  card.querySelectorAll(".choice").forEach((el) => {
    const pick = () => choose(el, item, w);
    el.addEventListener("click", pick);
    el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && pick());
  });
  card.querySelector(".speak")?.addEventListener("click", (e) => { e.stopPropagation(); speak(e.currentTarget.dataset.say); });
  const inp = card.querySelector("#spell");
  if (inp) {
    setTimeout(() => inp.focus(), 250);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitSpell(inp, w); } });
  }
}

function setGhost([l, r]) {
  const g = $("#ghost");
  const first = state.settings.firstDay;
  const days = first ? (new Date(engine.today()) - new Date(first)) / 86400000 : 0;
  g.classList.toggle("off", days >= 7);
  g.innerHTML = `<span class="l">${l}</span><span class="r">${r}</span>`;
}
function progress() {
  const d = session.done, r = session.remaining();
  $("#prog").style.width = `${Math.round((d / Math.max(1, d + r)) * 100)}%`;
}

function reveal() {
  if (revealed || !current) return;
  const w = engine.byId[current.id];
  revealAt = performance.now(); revealed = true;
  const card = $("#card");
  card.classList.add("revealed");
  if (current.mode === "reverse") {
    card.innerHTML = `<button class="speak" aria-label="발음 듣기" data-say="${esc(w.word)}">${speakerSvg}</button>` + frontHtml(w) + backHtml(w);
    card.querySelector(".speak").addEventListener("click", (e) => { e.stopPropagation(); speak(w.word); });
    speak(w.word);
  } else {
    card.querySelector(".tap-hint")?.remove();
    card.querySelector(".help-hint")?.remove();
    card.insertAdjacentHTML("beforeend", backHtml(w));
  }
  setGhost(["← 몰라요", "알아요 →"]);
}

function choose(el, item, w) {
  if (locked) return;
  locked = true;
  const ms = performance.now() - shownAt;
  const right = item.mode === "choice" ? w.meaning[0] : w.word;
  const ok = el.dataset.v === right;
  el.classList.add(ok ? "right" : "wrong");
  if (!ok) $("#card").querySelectorAll(".choice").forEach((c) => c.dataset.v === right && c.classList.add("right"));
  if (item.mode !== "choice") speak(w.word);
  setTimeout(() => commit(ok ? "know" : "again", { ms }), ok ? 550 : 1300);
}

function submitSpell(inp, w) {
  if (pendingSpell) return;
  const t = Math.min(typoCount(inp.value, w.exForm), typoCount(inp.value, w.word));
  pendingSpell = { typos: t };
  inp.blur(); inp.disabled = true;
  const card = $("#card");
  card.classList.add("revealed"); revealed = true;
  const msg = t === 0 ? `<div class="spell-result good">정확해요</div>` : t === 1 ? `<div class="spell-result good">거의 맞았어요 · ${esc(w.exForm)}</div>` : `<div class="spell-result bad">정답은 ${esc(w.exForm)}</div>`;
  card.querySelector(".tap-hint")?.remove();
  const blank = card.querySelector(".ex .blank");
  if (blank) blank.outerHTML = `<mark>${esc(w.exForm)}</mark>`;
  inp.insertAdjacentHTML("afterend", msg);
  card.insertAdjacentHTML("beforeend", backHtml(w, true));
  speak(w.word);
  setGhost(["", "밀어서 다음 →"]);
}

function commit(result, extra = {}) {
  if (!current) return;
  const now = performance.now();
  engine.addTime(Math.min(60, (now - shownAt) / 1000));
  const input = { result, ms: extra.ms ?? (revealAt ? revealAt - shownAt : now - shownAt), typos: pendingSpell?.typos ?? 0 };
  session.answer(current, input);
  save();
  const next = session.next();
  if (next) render(next); else finish();
}

function finish() {
  current = null; save();
  engine = createEngine(words, state);
  const s = engine.stats();
  const budget = s.today.budgetSec, hit = s.today.sec >= budget * 0.8;
  $("#done-title").textContent = hit ? "오늘 목표 달성!" : "오늘 학습 완료";
  $("#done-badge").style.opacity = hit ? 1 : 0.7;
  $("#done-stats").innerHTML = `
    <div><b>${s.today.rev}</b><span>푼 문제</span></div>
    <div><b>${s.today.newc}</b><span>새 단어</span></div>
    <div><b>${Math.round(s.today.sec / 60)}</b><span>분</span></div>`;
  const pc = (a, b) => Math.round((a / Math.max(1, b)) * 100);
  const rows = [
    ["이번 주 목표", pc(statsBefore.weekNew, s.weekGoal), pc(s.weekNew, s.weekGoal)],
    ["이번 달 목표", pc(statsBefore.monthNew, s.monthGoal), pc(s.monthNew, s.monthGoal)],
    [`전체 숙달 ${s.totalMastered}/${s.totalWords}`, pc(statsBefore.totalMastered, s.totalWords), pc(s.totalMastered, s.totalWords)],
  ];
  $("#goal-move").innerHTML = rows.map(([label, a, b], i) =>
    `<div><div class="goal-row"><span>${label}</span><b>${a === b ? `${b}%` : `${a}% → ${b}%`}</b></div><div class="bar"><i data-to="${Math.min(100, b)}" style="width:${Math.min(100, a)}%"></i></div></div>`).join("");
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); tmr.setHours(23, 59, 59);
  const dueTmr = Object.values(state.cards).filter((c) => new Date(c.fsrs.due) <= tmr).length;
  $("#next-review").textContent = dueTmr ? `내일 복습할 단어 ${dueTmr}개가 준비돼 있어요.` : "내일은 새 단어로 시작해요.";
  show("done");
  requestAnimationFrame(() => setTimeout(() => document.querySelectorAll("#goal-move i").forEach((b) => (b.style.width = b.dataset.to + "%")), 300));
  if (hit && !matchMedia("(prefers-reduced-motion: reduce)").matches) confetti();
}
function confetti() {
  const box = $("#done");
  const colors = ["var(--accent)", "#ffc233", "#ffffff", "#f5a623"];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "%";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.4 + "s";
    c.style.animationDelay = Math.random() * 0.4 + "s";
    box.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

// 카드 드래그 + 도장
function setupCardGestures() {
  const stage = $("#stage"), card = $("#card");
  const stamps = { right: $(".stamp.know"), left: $(".stamp.again"), up: $(".stamp.easy"), down: $(".stamp.undo") };
  const clearStamps = () => Object.values(stamps).forEach((s) => (s.style.opacity = 0));
  const allowed = (dir) => {
    if (!current) return false;
    if (dir === "down") return session.canUndo();
    const m = current.mode;
    if (m === "choice" || m === "quiz" || m === "cloze") return false;
    if (m === "spell") return !!pendingSpell && (dir === "right" || dir === "up");
    if (m === "intro") return dir === "right" || dir === "up";
    return revealed;
  };
  gestures(stage, {
    onTap: () => {
      if (!current || locked) return;
      if (current.mode === "intro" || (current.mode === "spell" && pendingSpell)) return swipeOut("right");
      if (current.mode === "recall" || current.mode === "reverse") reveal();
    },
    onDrag: (dx, dy) => {
      if (!current || locked) return;
      card.classList.add("dragging");
      const horiz = Math.abs(dx) > Math.abs(dy);
      card.style.transform = `translate(${dx}px, ${dy * (horiz ? 0.3 : 1)}px) rotate(${dx / 20}deg)`;
      clearStamps();
      const dir = horiz ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      const mag = Math.min(1, (horiz ? Math.abs(dx) : Math.abs(dy)) / 120);
      if (allowed(dir)) stamps[dir].style.opacity = mag;
    },
    onSwipe: (dir) => {
      if (!current || locked) return false;
      if (!allowed(dir)) {
        if ((current.mode === "recall" || current.mode === "reverse") && !revealed && dir !== "down") reveal();
        return false;
      }
      swipeOut(dir);
      return true;
    },
    onRelease: (dir) => {
      card.classList.remove("dragging");
      if (!dir) { card.style.transform = ""; clearStamps(); }
    },
  });
  function swipeOut(dir) {
    locked = true;
    const card = $("#card");
    card.classList.remove("dragging");
    const off = { right: "translate(130%, 0) rotate(18deg)", left: "translate(-130%, 0) rotate(-18deg)", up: "translate(0, -120%)", down: "translate(0, 120%)" }[dir];
    if (dir === "down") {
      card.style.transform = off; card.style.opacity = 0;
      setTimeout(() => { clearStamps(); const it = session.undo(); save(); if (it) render(it); else locked = false; toast("되돌렸어요"); }, 180);
      return;
    }
    card.style.transform = off; card.style.opacity = 0;
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    setTimeout(() => { clearStamps(); commit(dir === "right" ? "know" : dir === "left" ? "again" : "easy"); }, 200);
  }
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 1200);
}

// ---------- 목표 ----------
function renderGoals(s) {
  const pct = (a, b) => Math.min(100, Math.round((a / Math.max(1, b)) * 100));
  $("#g-week-num").textContent = `${s.weekNew} / ${s.weekGoal}`;
  $("#g-month-num").textContent = `${s.monthNew} / ${s.monthGoal}`;
  requestAnimationFrame(() => {
    $("#g-week").style.width = pct(s.weekNew, s.weekGoal) + "%";
    $("#g-month").style.width = pct(s.monthNew, s.monthGoal) + "%";
  });
  $("#g-total").textContent = `${s.totalMastered} / ${s.totalWords}`;
  const levels = ["A1", "A2", "B1", "B2"];
  $("#stairs").innerHTML = levels.map((L, i) => {
    const v = s.levels[L];
    const h = 40 + i * 20; // 계단 높이
    if (!v) return `<div class="step"><div class="tower" style="height:${h}%"></div><b>${L}</b><span>준비 중</span></div>`;
    return `<div class="step"><div class="tower" style="height:${h}%"><em style="height:${(v.learned / v.total) * 100}%"></em><i style="height:${(v.mastered / v.total) * 100}%"></i></div><b>${L}</b><span>${pct(v.mastered, v.total)}%</span></div>`;
  }).join("");
  const a1 = s.levels.A1;
  $("#milestone").textContent = a1 && a1.mastered < a1.total
    ? `A1 숙달까지 ${a1.total - a1.mastered}단어 · 진한 색은 숙달(21일 이상 기억), 연한 색은 학습 시작`
    : "A1을 모두 숙달했어요!";
  const t = engine.today(), budget = state.settings.minutes * 60;
  const now = new Date();
  $("#cal-title").textContent = `${now.getMonth() + 1}월`;
  $("#cal-days").textContent = `이번 달 ${s.calendar.filter((d) => d.sec > 0).length}일 학습 · 진할수록 목표 시간에 가까워요`;
  $("#cal").innerHTML = "<span style=\"visibility:hidden\"></span>".repeat(s.firstWeekday) + s.calendar.map((d) => {
    const lv = d.sec === 0 ? "" : d.sec >= budget * 0.8 ? "l3" : d.sec >= budget * 0.4 ? "l2" : "l1";
    return `<span class="${lv} ${d.key === t ? "today" : ""} ${d.future ? "future" : ""}">${d.day}</span>`;
  }).join("");
}

// ---------- 설정 ----------
function renderSettings() {
  const st = state.settings;
  document.querySelectorAll("#set-minutes button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.v === st.minutes)));
  document.querySelectorAll("#set-voice button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === st.voice)));
  $("#set-week").value = st.weeklyGoal;
  $("#set-month").value = st.monthlyGoal;
}
function setupSettings() {
  $("#set-minutes").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.settings.minutes = +b.dataset.v;
    const lg = state.log[dayKey(new Date())]; if (lg) lg.planNew = null; // 오늘 계획 다시 계산
    save(); renderSettings();
  });
  $("#set-voice").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.settings.voice = b.dataset.v; save(); renderSettings(); speak("Hello");
  });
  $("#set-week").addEventListener("change", (e) => { state.settings.weeklyGoal = Math.max(5, +e.target.value || 50); save(); });
  $("#set-month").addEventListener("change", (e) => { state.settings.monthlyGoal = Math.max(20, +e.target.value || 200); save(); });
  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `wordies-${dayKey(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("#file-import").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.cards || !data.settings) throw new Error();
      state = { ...emptyState(), ...data }; save(); toastSettings("불러왔어요");
    } catch { toastSettings("Wordies에서 내보낸 파일이 아니에요"); }
    e.target.value = "";
  });
  $("#btn-reset").addEventListener("click", () => ($("#reset-confirm").hidden = false));
  $("#btn-reset-no").addEventListener("click", () => ($("#reset-confirm").hidden = true));
  $("#btn-reset-yes").addEventListener("click", () => {
    const keep = { ...state.settings };
    state = emptyState(); state.settings = { ...state.settings, ...keep };
    save(); $("#reset-confirm").hidden = true; toastSettings("기록을 지웠어요");
  });
}
function toastSettings(msg) { const p = $("#reset-confirm"); p.hidden = false; p.textContent = msg; setTimeout(() => location.reload(), 900); }

// ---------- 시작 ----------
async function boot() {
  state = load();
  const res = await fetch("data/words.json");
  words = (await res.json()).words;
  engine = createEngine(words, state);

  gestures($("#onboard"), { onTap: obNext, onSwipe: (d) => (d === "left" ? (obNext(), true) : false) });
  const startTap = () => ($("#today-card").classList.contains("done") ? toastHome() : startSession());
  $("#today-card").addEventListener("click", startTap);
  const toSettings = () => show("settings"), toHome = () => show("home");
  $("#go-settings").addEventListener("click", toSettings);
  $("#back-home").addEventListener("click", toHome);
  gestures($("#settings"), { axis: "x", onSwipe: (d) => (d === "right" ? (show("home"), true) : false) });
  gestures($("#done"), { onTap: () => show("home"), onSwipe: (d) => (d === "down" ? (show("home"), true) : false) });
  setupCardGestures();
  setupSettings();
  const stage = $("#stage");
  const fire = (type, id, x, y) => stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }));
  stage.addEventListener("kbtap", () => { fire("pointerdown", 99, 0, 0); fire("pointerup", 99, 0, 0); });
  stage.addEventListener("kbswipe", (e) => {
    const [dx, dy] = { right: [600, 0], left: [-600, 0], up: [0, -600], down: [0, 600] }[e.detail];
    fire("pointerdown", 98, 0, 0); fire("pointermove", 98, dx / 2, dy / 2); fire("pointerup", 98, dx, dy);
  });

  // 키보드 (데스크톱): 스페이스=뜻 보기, →/←/↑/↓
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    const map = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };
    if (screen === "home") {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startTap(); }
      else if (e.key === "ArrowRight") show("settings");
    } else if (screen === "study") {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); $("#stage").dispatchEvent(new CustomEvent("kbtap")); }
      else if (map[e.key]) { e.preventDefault(); $("#stage").dispatchEvent(new CustomEvent("kbswipe", { detail: map[e.key] })); }
    } else if ((screen === "settings" && (e.key === "ArrowLeft" || e.key === "Escape")) || (screen === "done" && (e.key === "ArrowDown" || e.key === "Enter"))) show("home");
    else if (screen === "onboard" && (e.key === " " || e.key === "Enter" || e.key === "ArrowRight")) obNext();
  });

  renderOnboard();
  show(state.settings.onboarded ? "home" : "onboard");

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
