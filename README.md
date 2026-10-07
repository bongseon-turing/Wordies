# Wordies

영어 핵심 3,000단어(Oxford 3000 기준)를 간격 반복(FSRS)과 단어 가족으로, 버튼 없이 손끝으로 외우는 웹앱.

- `index.html` — 소개: 지향점, 학습 원리, 학습 곡선(1년 시뮬레이션), 하루 흐름, 규칙
- `app.html` — 학습 앱: 탭 = 뜻 보기, → 알아요, ← 몰라요, ↑ 너무 쉬움, ↓ 되돌리기

## 구조

| 경로 | 내용 |
| --- | --- |
| `js/engine.js` | 학습 규칙 전부: FSRS 스케줄, 시간 예산형 투입, 문제 사다리(L1~L4), 도움 모드·보류, 세션 큐, 되돌리기 |
| `js/app.js` | 화면과 제스처 |
| `js/landing.js` | 소개 페이지 차트 |
| `js/vendor/ts-fsrs.mjs` | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT) |
| `data/words.json` | 단어 데이터 (v0.1: A1 51단어) |
| `data/curve.json` | 학습 곡선 시뮬레이션 결과 |
| `tools/simulate_curve.py` | 시뮬레이션 스크립트 (`pip install fsrs`) |

빌드 단계 없음. `main`에 푸시하면 GitHub Actions가 Pages로 배포합니다.

## 로컬 실행

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## 단어 데이터 형식

```json
{"id":"visit","word":"visit","pos":"동사","ipa":"/ˈvɪzɪt/","level":"A1",
 "meaning":["방문하다"],"ex":"We visit my grandparents every summer.","exForm":"visit",
 "exKo":"우리는 매년 여름 조부모님을 방문한다.","root":"vis = 보다. 가서 보는 것이 visit.",
 "family":[["visitor","방문객"],["vision","시력, 비전"]],"group":null}
```

`exForm`은 예문 속 실제 형태(빈칸 문제에 사용), `group`이 같은 단어는 같은 날 처음 배우지 않습니다.

## 출처

단어 선정과 레벨은 Oxford 3000(Oxford University Press)을 참고했고, 한국어 뜻·예문·기억 단서는 직접 작성했습니다. 학습 기록은 브라우저(localStorage)에만 저장됩니다.
