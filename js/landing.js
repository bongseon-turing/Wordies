// 소개 페이지: 학습 곡선 차트 + 이어서 학습 안내
const NAMES = ["고정 10개", "고정 20개", "기준서 자동조절", "시간예산 20분"];
const LABELS = { "기준서 자동조절": "규칙 기반 자동조절", "시간예산 20분": "시간예산 20분 (채택)" };
const COLS = ["--s1", "--s2", "--s3", "--s4"];
let data, mode = "daily";

function legend() {
  document.querySelectorAll("[data-legend]").forEach((el) => {
    el.innerHTML = NAMES.map((n, i) => `<span class="${i === 3 ? "pick" : ""}"><i style="background:var(${COLS[i]})"></i>${LABELS[n] || n}</span>`).join("");
  });
}

function chart(el, key, yMax, yTicks, opts) {
  const W = Math.max(300, el.clientWidth || 720), H = W < 500 ? 240 : 300, L = 42, R = 10, T = 12, B = 28;
  const s = data.series[mode], weeks = s[NAMES[0]].length;
  const x = (w) => L + ((w - 1) / (weeks - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label}">`;
  if (opts.band) g += `<rect x="${L}" y="${y(opts.band[1])}" width="${W - L - R}" height="${y(opts.band[0]) - y(opts.band[1])}" fill="var(--accent-soft)" opacity=".7"/>`;
  for (const t of yTicks) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t.toLocaleString()}</text>`;
  for (const w of W < 500 ? [1, 26, 52] : [1, 13, 26, 39, 52]) g += `<text x="${x(w)}" y="${H - 8}" text-anchor="middle">${w}주</text>`;
  if (opts.goal) g += `<line x1="${L}" x2="${W - R}" y1="${y(opts.goal)}" y2="${y(opts.goal)}" stroke="var(--ink-2)" stroke-dasharray="4 4"/>`;
  NAMES.forEach((n, i) => {
    const d = s[n].map((p, j) => `${j ? "L" : "M"}${x(p.w).toFixed(1)},${y(Math.min(p[key], yMax)).toFixed(1)}`).join("");
    g += `<path d="${d}" fill="none" stroke="var(${COLS[i]})" stroke-width="${i === 3 ? 3 : 2}" stroke-linejoin="round"/>`;
  });
  g += `<line class="xh" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" opacity="0"/>`;
  g += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = g;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh");
  const move = (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const w = Math.max(1, Math.min(weeks, Math.round(((px - L) / (W - L - R)) * (weeks - 1)) + 1));
    xh.setAttribute("x1", x(w)); xh.setAttribute("x2", x(w)); xh.setAttribute("opacity", ".5");
    tip.hidden = false;
    const left = (x(w) / W) * r.width;
    tip.style.left = Math.max(90, Math.min(r.width - 90, left)) + "px";
    tip.style.top = "8px";
    tip.innerHTML = `<div>${w}주차</div>` + NAMES.map((n, i) => `<div><i style="background:var(${COLS[i]})"></i>${LABELS[n] || n} <b>${opts.fmt(s[n][w - 1])}</b></div>`).join("");
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; xh.setAttribute("opacity", "0"); });
}

function render() {
  chart(document.getElementById("c-known"), "known", 3200, [0, 1000, 2000, 3000], { label: "주차별 기억하는 단어 수", goal: 3000, fmt: (p) => p.known.toLocaleString() + "개" });
  chart(document.getElementById("c-min"), "avg", 40, [0, 10, 20, 30, 40], { label: "주차별 하루 평균 학습 시간", band: [10, 20], fmt: (p) => `${p.avg}분 (최대 ${p.max})` });
}

document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  document.querySelectorAll(".seg button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
  render();
}));

// 이미 학습 중이면 버튼 문구를 바꾼다
try {
  const st = JSON.parse(localStorage.getItem("wordies.v1") || "null");
  const n = st ? Object.keys(st.cards || {}).length : 0;
  if (n) {
    document.getElementById("cta-main").textContent = "이어서 학습하기";
    document.getElementById("cta-note").textContent = `지금까지 ${n}단어를 시작했어요.`;
  }
} catch {}

fetch("data/curve.json").then((r) => r.json()).then((d) => { data = d; legend(); render(); });
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => data && render(), 150); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
