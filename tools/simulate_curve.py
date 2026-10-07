"""Wordies 학습 곡선 시뮬레이션: Oxford 3000 x FSRS, 투입 전략 비교."""
import json, random, sys
from datetime import datetime, timedelta, timezone
from fsrs import Scheduler, Card, Rating, State

DAYS = 365
LEVELS = [("A1", 900, 0.75), ("A2", 850, 0.95), ("B1", 750, 1.15), ("B2", 500, 1.35)]  # (레벨, 단어 수, 난이도 지수)
SEC_NEW, SEC_REVIEW, SEC_STEP = 25, 8, 6  # 새 단어 소개, 복습 1회, 같은 날 학습 단계 1회


def make_deck():
    deck = []
    for lv, n, d in LEVELS:
        for _ in range(n):
            deck.append({"lv": lv, "d": d * random.uniform(0.8, 1.25)})
    return deck  # 레벨 순서 = 투입 순서


def recall(sched, card, now, d):
    r = sched.get_card_retrievability(card, now)
    return random.random() < r ** d


def grade(ok):
    if not ok:
        return Rating.Again
    x = random.random()
    return Rating.Hard if x < 0.15 else Rating.Easy if x > 0.95 else Rating.Good


def run(strategy, study_prob=1.0, seed=1):
    random.seed(seed)
    sched = Scheduler(desired_retention=0.9, maximum_interval=365, enable_fuzzing=True)
    deck, cards = make_deck(), []
    t0 = datetime(2026, 1, 1, 9, tzinfo=timezone.utc)
    nxt, hist, acc_hist, missed = 0, [], [], 0
    for day in range(DAYS):
        now = t0 + timedelta(days=day)
        if random.random() > study_prob:  # 쉬는 날
            missed += 1
            hist.append(snapshot(sched, cards, now, day, 0, 0, 0))
            continue
        # 1) 예정 복습 (기억 확률 낮은 것부터)
        due = [c for c in cards if c["card"].due <= now + timedelta(hours=12)]
        n_new = strategy(day, cards, now, acc_hist, missed_streak=missed, due_today=len(due))
        reviews = ok_n = 0
        for c in due:
            ok = recall(sched, c["card"], now, c["d"])
            c["card"], _ = sched.review_card(c["card"], grade(ok), now)
            reviews += 1; ok_n += ok
            steps = 0
            while c["card"].state != State.Review and steps < 6:  # 재학습 단계
                t = now + timedelta(minutes=10 * (steps + 1))
                c["card"], _ = sched.review_card(c["card"], Rating.Good if random.random() < 0.85 else Rating.Again, t)
                steps += 1; reviews += 1
            if not ok:
                c["fails"] += 1
        acc_hist.append(ok_n / reviews if reviews else None)
        # 2) 새 단어 수 결정
        missed = 0
        new_steps = 0
        for _ in range(n_new):
            if nxt >= len(deck):
                break
            w = deck[nxt]; nxt += 1
            card, s = Card(), 0
            while card.state != State.Review and s < 8:  # 1분 → 10분 학습 단계
                t = now + timedelta(minutes=1 + 10 * s)
                p = 0.7 if s == 0 else 0.85
                card, _ = sched.review_card(card, Rating.Good if random.random() < p ** w["d"] else Rating.Again, t)
                s += 1
            new_steps += s
            cards.append({"card": card, "lv": w["lv"], "d": w["d"], "fails": 0})
        minutes = (n_new * SEC_NEW + reviews * SEC_REVIEW + new_steps * SEC_STEP) / 60
        hist.append(snapshot(sched, cards, now, day, n_new, reviews, minutes))
    return hist


def snapshot(sched, cards, now, day, n_new, reviews, minutes):
    known = mastered = 0
    lv_m = {lv: 0 for lv, *_ in LEVELS}
    for c in cards:
        r = sched.get_card_retrievability(c["card"], now) ** c["d"]
        known += r  # 오늘 시험 보면 기대 정답 수
        if c["card"].stability and c["card"].stability >= 21:
            mastered += 1; lv_m[c["lv"]] += 1
    return {"day": day + 1, "introduced": len(cards), "known": round(known), "mastered": mastered,
            "new": n_new, "reviews": reviews, "minutes": round(minutes, 1), "lv": lv_m}


# ---- 전략 ----
def fixed(n):
    return lambda day, cards, now, acc, missed_streak, due_today: n


def due_tomorrow(cards, now):
    lim = now + timedelta(days=1, hours=12)
    return sum(1 for c in cards if c["card"].due <= lim)


def adaptive(day, cards, now, acc, missed_streak, due_today):
    """기준서 규칙 그대로."""
    if missed_streak >= 2:
        return 0
    dt = due_today
    if dt > 150:
        return 0
    n = 5 if dt > 100 else 10
    recent = [a for a in acc[-7:] if a is not None]
    if recent:
        a = sum(recent) / len(recent)
        if a < 0.80: n = round(n * 0.7)
        elif a > 0.92: n = min(20, round(n * 1.2))
    return n


def budget(minutes=15):
    """시간 예산형: 예정 복습 시간을 빼고 남는 시간만큼 새 단어."""
    def f(day, cards, now, acc, missed_streak, due_today):
        rev_min = due_today * SEC_REVIEW * 1.3 / 60
        left = minutes - rev_min
        return max(0, min(25, int(left * 60 / (SEC_NEW + 2.5 * SEC_STEP))))
    return f


if __name__ == "__main__":
    out = {}
    for name, strat in [("고정 10개", fixed(10)), ("고정 20개", fixed(20)),
                        ("기준서 자동조절", adaptive), ("시간예산 15분", budget(15)), ("시간예산 20분", budget(20))]:
        out[name] = run(strat)
        out[name + " · 주5일"] = run(strat, study_prob=5 / 7, seed=2)
    json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False)
    for k, h in out.items():
        fin = next((x["day"] for x in h if x["introduced"] >= 3000), None)
        last = h[-1]
        mins = [x["minutes"] for x in h if x["minutes"] > 0]
        print(f"{k:16} 투입={last['introduced']} 완주일={fin} 1년후 기억={last['known']} 숙달={last['mastered']} "
              f"평균분={sum(mins)/len(mins):.1f} 최대분={max(mins):.0f}")
