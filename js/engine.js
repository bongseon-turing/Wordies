// Wordies 학습 엔진: FSRS 스케줄링, 시간 예산형 투입, 문제 사다리, 어려운 단어 처리.
// UI와 저장소를 모르는 순수 로직. now()를 주입받아 테스트할 수 있다.
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from "./vendor/ts-fsrs.mjs";

export { Rating, State };

export const RULES = {
  retention: 0.9,
  maxInterval: 365,
  secPerReview: 10,      // 복습 1장 예상 시간(초), 재학습 포함 여유분
  secPerNew: 50,         // 새 단어 1개 예상 시간(소개 + 학습 단계 + 퀴즈)
  maxNewPerDay: 20,
  reviewCapFactor: 1.5,  // 하루 복습 상한 = 예산 × 1.5
  maxTriesPerSession: 3, // 한 세션에서 같은 카드는 최대 3번(소개 제외). 넘으면 내일로
  slowFactor: 1.5,       // 응답 시간이 중앙값 × 1.5 초과면 Hard
  defaultSlowMs: 4000,   // 기록 50개 전까지의 기준
  masteredDays: 21,      // 안정성 21일 이상 = 숙달
  helpLapses: 4,         // 누적 실패 4회 = 도움 모드
  suspendLapses: 8,      // 누적 실패 8회 = 7일 보류 후 새 단어로
  suspendDays: 7,
};

const scheduler = fsrs(generatorParameters({
  request_retention: RULES.retention,
  maximum_interval: RULES.maxInterval,
  enable_fuzz: true,
}));

// ---------- 날짜 ----------
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 86400000);

// ---------- 상태 ----------
export function emptyState() {
  return {
    v: 1,
    settings: { minutes: 20, weeklyGoal: 50, monthlyGoal: 200, voice: "en-US", onboarded: false },
    cards: {},     // id → { fsrs, ladder, streak, lapses, intro, help, quizzed }
    susp: {},      // id → 다시 새 단어로 풀리는 날짜
    log: {},       // 'YYYY-MM-DD' → { rev, ok, newc, sec, planNew }
    times: [],     // 최근 응답 시간(ms)
  };
}

const toCard = (c) => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });
const fromCard = (c) => ({ ...c, due: c.due.toISOString(), last_review: c.last_review ? c.last_review.toISOString() : null });

export function createEngine(words, state, now = () => new Date()) {
  const byId = Object.fromEntries(words.map((w) => [w.id, w]));
  const today = () => dayKey(now());
  const logOf = (k = today()) => (state.log[k] ||= { rev: 0, ok: 0, newc: 0, sec: 0, planNew: null });

  const retrievability = (id) => {
    const c = state.cards[id];
    return c ? scheduler.get_retrievability(toCard(c.fsrs), now(), false) : 0;
  };

  function slowThreshold() {
    const t = state.times;
    if (t.length < 50) return RULES.defaultSlowMs;
    const s = [...t].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] * RULES.slowFactor;
  }

  // 오늘 기한인 카드 (보류 제외), 기억 확률 낮은 순
  function dueIds(until = now()) {
    const t = today();
    return Object.keys(state.cards)
      .filter((id) => {
        const c = state.cards[id].fsrs;
        if (new Date(c.due) > until) return false;
        return !c.last_review || dayKey(c.last_review) !== t; // 오늘 이미 본 카드는 내일로
      })
      .sort((a, b) => retrievability(a) - retrievability(b));
  }

  function lastStudyDay() {
    const ks = Object.keys(state.log).filter((k) => state.log[k].rev > 0 && k < today()).sort();
    return ks.at(-1) || null;
  }

  // 오늘 계획: 복습(상한 적용) + 새 단어 수. 하루 첫 계산값을 고정해 다시 열어도 늘지 않게 한다.
  function plan() {
    const budgetSec = state.settings.minutes * 60;
    const due = dueIds(endOfDay(now()));
    const cap = Math.floor((budgetSec * RULES.reviewCapFactor) / RULES.secPerReview);
    const reviews = due.slice(0, cap);
    const lg = logOf();
    if (lg.planNew === null) {
      const last = lastStudyDay();
      const cameBack = last && daysBetween(last, today()) > 2; // 이틀 이상 쉬고 복귀한 날
      const left = budgetSec - reviews.length * RULES.secPerReview;
      lg.planNew = cameBack ? 0 : Math.max(0, Math.min(RULES.maxNewPerDay, Math.floor(left / RULES.secPerNew)));
    }
    const remainingNew = Math.max(0, lg.planNew - lg.newc);
    return { reviews, deferred: due.length - reviews.length, newIds: pickNew(remainingNew), planNew: lg.planNew };
  }

  // 투입 순서 = 데이터 순서(레벨 순). 혼동·유의어 그룹은 같은 날 하나만.
  function pickNew(n) {
    const t = today();
    for (const [id, until] of Object.entries(state.susp)) if (until <= t) delete state.susp[id];
    const usedGroups = new Set(
      Object.entries(state.cards).filter(([, c]) => c.intro === t).map(([id]) => byId[id]?.group).filter(Boolean)
    );
    const out = [];
    for (const w of words) {
      if (out.length >= n) break;
      if (state.cards[w.id] || state.susp[w.id]) continue;
      if (w.group && usedGroups.has(w.group)) continue;
      out.push(w.id);
      if (w.group) usedGroups.add(w.group);
    }
    return out;
  }

  function introduce(id) {
    state.cards[id] = { fsrs: fromCard(createEmptyCard(now())), ladder: 1, streak: 0, lapses: 0, intro: today(), help: false, quizzed: false };
    logOf().newc += 1;
  }

  // 카드의 현재 문제 형식
  function modeOf(id) {
    const c = state.cards[id];
    if (c.fsrs.state === State.New) return "choice";
    if (c.fsrs.state === State.Learning) return (c.fsrs.learning_steps || 0) >= 1 ? "cloze" : "choice";
    if (c.fsrs.state === State.Relearning) return "recall";
    return c.ladder >= 4 ? "spell" : c.ladder === 3 ? "reverse" : "recall";
  }

  // 사용자 입력 → FSRS 등급
  function toRating(mode, { result, ms, typos }) {
    if (result === "easy") return Rating.Easy;
    if (result === "again") return Rating.Again;
    if (mode === "spell") return typos === 0 ? Rating.Good : typos === 1 ? Rating.Hard : Rating.Again;
    return ms > slowThreshold() ? Rating.Hard : Rating.Good;
  }

  function grade(id, mode, input) {
    const c = state.cards[id];
    const rating = toRating(mode, input);
    const wasReview = c.fsrs.state === State.Review;
    const wasLearning = c.fsrs.state === State.New || c.fsrs.state === State.Learning;
    const { card } = scheduler.next(toCard(c.fsrs), now(), rating);
    c.fsrs = fromCard(card);

    if (rating === Rating.Again) {
      c.streak = 0;
      if (wasReview) {
        c.lapses += 1;
        c.ladder = Math.max(2, c.ladder - 1);
      }
    } else if (wasLearning && card.state === State.Review) {
      c.ladder = Math.max(c.ladder, 2); // 학습 단계 졸업
    } else if (card.state === State.Review) {
      c.streak += 1;
      if (c.ladder === 2 && c.streak >= 2) { c.ladder = 3; c.streak = 0; }
      else if (c.ladder === 3 && c.streak >= 2 && card.stability >= RULES.masteredDays) { c.ladder = 4; c.streak = 0; }
    }

    if (c.lapses >= RULES.suspendLapses) {
      const until = new Date(now()); until.setDate(until.getDate() + RULES.suspendDays);
      state.susp[id] = dayKey(until);
      delete state.cards[id];
    } else if (c.lapses >= RULES.helpLapses) {
      c.help = true;
    }

    const lg = logOf();
    lg.rev += 1;
    if (rating !== Rating.Again) lg.ok += 1;
    if (input.ms && mode !== "spell") {
      state.times.push(Math.min(input.ms, 30000));
      if (state.times.length > 200) state.times.shift();
    }
    return rating;
  }

  // ---------- 통계 ----------
  function stats() {
    const t = today(), s = state.settings;
    const lv = {};
    for (const w of words) {
      const L = (lv[w.level] ||= { total: 0, learned: 0, mastered: 0 });
      L.total += 1;
      const c = state.cards[w.id];
      if (c) { L.learned += 1; if (c.fsrs.stability >= RULES.masteredDays) L.mastered += 1; }
    }
    const d0 = new Date(now());
    const monday = new Date(d0); monday.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
    const week = [...Array(7)].map((_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const k = dayKey(d), g = state.log[k];
      return { key: k, sec: g?.sec || 0, rev: g?.rev || 0, future: k > t };
    });
    const sumNew = (pred) => Object.entries(state.log).filter(([k]) => pred(k)).reduce((a, [, g]) => a + g.newc, 0);
    const weekNew = sumNew((k) => k >= week[0].key && k <= week[6].key);
    const monthPrefix = t.slice(0, 7);
    const monthNew = sumNew((k) => k.startsWith(monthPrefix));
    let streak = 0;
    for (let d = new Date(d0); ; d.setDate(d.getDate() - 1)) {
      const g = state.log[dayKey(d)];
      if (g && g.rev > 0) streak += 1;
      else if (dayKey(d) === t) continue; // 오늘 아직 안 했으면 어제부터 센다
      else break;
    }
    const year = d0.getFullYear(), month = d0.getMonth();
    const monthDays = new Date(year, month + 1, 0).getDate();
    const calendar = [...Array(monthDays)].map((_, i) => {
      const k = dayKey(new Date(year, month, i + 1));
      return { day: i + 1, key: k, sec: state.log[k]?.sec || 0, future: k > t };
    });
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const lg = state.log[t] || { rev: 0, ok: 0, newc: 0, sec: 0 };
    return {
      today: { ...lg, budgetSec: s.minutes * 60 },
      week, weekNew, weekGoal: s.weeklyGoal, monthNew, monthGoal: s.monthlyGoal,
      levels: lv, streak, calendar, firstWeekday,
      totalLearned: Object.keys(state.cards).length,
      totalMastered: Object.values(state.cards).filter((c) => c.fsrs.stability >= RULES.masteredDays).length,
      totalWords: words.length,
    };
  }

  function addTime(sec) { logOf().sec += sec; }

  return { state, byId, plan, introduce, modeOf, grade, stats, retrievability, addTime, today, logOf, slowThreshold };
}

// ---------- 세션 ----------
// 복습 먼저 → 새 단어 5개씩(소개 → 뜻 고르기 → 예문 빈칸) → 남은 학습 카드는 세션 안에서 마무리
export function createSession(engine, now = () => new Date()) {
  const p = engine.plan();
  const q = {
    main: [...p.reviews.map((id) => ({ id, kind: "card" }))],
    newIds: [...p.newIds],
    learning: new Set(), // 이번 세션에서 학습 단계에 있는 카드
    quiz: [],
    done: 0,
    newBatch: 0,
    tries: {},
  };
  const history = [];

  function refillNew() {
    if (q.newBatch > 0 || !q.newIds.length) return false;
    const batch = q.newIds.splice(0, 5);
    batch.forEach((id) => q.main.push({ id, kind: "intro" }));
    q.newBatch = batch.length;
    return true;
  }

  function dueLearning(withinMin) {
    const lim = new Date(+now() + withinMin * 60000);
    let best = null;
    for (const id of q.learning) {
      const c = engine.state.cards[id];
      if (!c) { q.learning.delete(id); continue; }
      const due = new Date(c.fsrs.due);
      if (due <= lim && (!best || due < best.due)) best = { id, due };
    }
    return best?.id || null;
  }

  function next() {
    let id = dueLearning(0);
    if (id) return { id, kind: "card", mode: engine.modeOf(id) };
    if (!q.main.length) refillNew();
    const m = q.main.shift();
    if (m) return m.kind === "intro" ? { ...m, mode: "intro" } : { ...m, mode: engine.modeOf(m.id) };
    id = dueLearning(24 * 60); // 남은 학습 카드는 세션 안에서 마무리
    if (id) return { id, kind: "card", mode: engine.modeOf(id) };
    return null;
  }

  function snapshot() {
    return {
      q: { main: [...q.main], newIds: [...q.newIds], learning: [...q.learning], quiz: [...q.quiz], done: q.done, newBatch: q.newBatch, tries: { ...q.tries } },
      cards: structuredClone(engine.state.cards),
      susp: structuredClone(engine.state.susp),
      log: structuredClone(engine.state.log),
      times: [...engine.state.times],
    };
  }

  // item: next()가 준 것. input: { result: 'know'|'again'|'easy', ms, typos }
  function answer(item, input) {
    history.push({ item, snap: snapshot() });
    if (history.length > 30) history.shift();
    q.done += 1;
    if (item.mode === "intro") {
      engine.introduce(item.id);
      q.learning.add(item.id);
      q.newBatch -= 1;
      return null;
    }
    if (item.mode === "quiz") {
      const c = engine.state.cards[item.id];
      if (c) c.quizzed = true;
      return null;
    }
    const rating = engine.grade(item.id, item.mode, input);
    const c = engine.state.cards[item.id];
    q.tries[item.id] = (q.tries[item.id] || 0) + 1;
    if (c && c.fsrs.state !== State.Review && q.tries[item.id] < RULES.maxTriesPerSession) q.learning.add(item.id);
    else q.learning.delete(item.id);
    return rating;
  }

  function undo() {
    const h = history.pop();
    if (!h) return null;
    const s = h.snap;
    Object.assign(q, { main: s.q.main, newIds: s.q.newIds, learning: new Set(s.q.learning), quiz: s.q.quiz, done: s.q.done, newBatch: s.q.newBatch, tries: s.q.tries });
    engine.state.cards = s.cards; engine.state.susp = s.susp; engine.state.log = s.log; engine.state.times = s.times;
    return h.item;
  }

  function remaining() {
    return q.main.length + q.newIds.length * 3 + q.newBatch * 2 + q.learning.size * 1.5;
  }

  return { next, answer, undo, remaining, get done() { return q.done; }, plan: p, canUndo: () => history.length > 0 };
}

// 철자 비교: 편집 거리
export function typoCount(a, b) {
  a = a.trim().toLowerCase(); b = b.trim().toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
