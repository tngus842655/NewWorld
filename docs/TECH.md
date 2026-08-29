# NewWorld — 기술 설계서 (TECH)

> 상태: 초안 (M0 리뷰 대상) · 마지막 수정: 2026-08-22
> 전제: [GDD.md](./GDD.md)의 디자인 필러, 특히 필러 5 "모든 판정은 결정론"

---

## 1. 스택 결정

| 영역 | 선택 | 이유 |
|---|---|---|
| 언어/빌드 | TypeScript strict + Vite | 기존 프로젝트(MoneyGame, 구 NewWorld)와 동일 — 검증된 익숙한 스택 |
| UI | 프레임워크 없음, 자체 경량 반응형 레이어(§5) | MoneyGame과 동일 계열. React 미도입: TDS 미사용 게임 UI에 이점 대비 전환 비용이 큼 |
| 상태 | 자체 signal 스토어 (~100줄, 테스트 포함) | 의존성 최소화, 게임 상태는 단일 트리라 요구가 단순 |
| 콘텐츠 검증 | zod | 콘텐츠 JSON이 게임의 절반 — 로드 시점 스키마 검증은 필수 |
| 테스트 | vitest | core 레이어 전수 테스트 |
| 백엔드 | Supabase (Postgres + Edge Functions + pg_cron) | 이미 프로젝트 존재(sbprvqtpshzrferjauxs), 푸시 스케줄링에 서버 필요 |
| 플랫폼 | Capacitor Android (Google Play) → (2차) @apps-in-toss/web-framework | 2026-08-22 우선순위 전환(앱인토스 보류). MoneyGame 배포 파이프라인 재사용 |

**명시적으로 안 쓰는 것**: React/Vue(사유 위), 캔버스 게임엔진(Phaser 등 — DOM UI 게임이라 불필요),
서버 권위 실시간 판정(v1은 클라 판정 + 결정론 시드로 서버 재검증 *가능성*만 확보).

---

## 2. 레이어 아키텍처

```
┌─────────────────────────────────────────────┐
│ ui/        화면·컴포넌트·라우터 (DOM)         │  ← state 구독, core 직접 호출 금지
├─────────────────────────────────────────────┤
│ state/     스토어·세이브·마이그레이션          │  ← core 호출, 영속화 담당
├─────────────────────────────────────────────┤
│ core/      순수 게임 로직 (부수효과 0)        │  ← content 타입만 의존
├─────────────────────────────────────────────┤
│ content/   정적 콘텐츠 JSON + zod 스키마      │  ← 의존 없음 (최하층)
├─────────────────────────────────────────────┤
│ platform/  토스·웹·안드로이드 어댑터           │  ← ui/state에서 인터페이스로만 사용
└─────────────────────────────────────────────┘
```

**의존 규칙 (위반은 리뷰 리젝 사유)**
- `core/`는 import 가능한 것이 `content/`의 타입·데이터뿐. DOM, Date.now, Math.random, localStorage 접근 금지
- `core/` 함수는 전부 `(state, input, ctx) → newState | result` 순수 함수. 시간과 난수는 `ctx`(§6)로 주입
- `ui/`는 `state/`의 스토어와 액션만 사용. 게임 규칙을 UI에 중복 구현하지 않는다
- `platform/`은 인터페이스(`PlatformBridge`) 뒤에 숨는다. 웹 단독 실행 = mock 브리지

이 구조의 목적: **확장성의 실체는 "core를 어디서든 재실행할 수 있다"이다.**
같은 core 코드가 ① 클라이언트 판정 ② vitest 시뮬레이션 ③ (v2) Edge Function 서버 검증
④ (M3) 밸런스 시뮬레이터 CLI에서 그대로 돈다.

## 3. 폴더 구조

```
src/
  content/
    schema.ts          # zod 스키마 (monsters/regions/encounters/synergies/...)
    index.ts           # 로드 + 검증 + 파생 인덱스(id맵, 지역별 출현테이블)
    data/
      monsters.json    #  219종 (스탯·속성·종족·등급·서식지·에셋id)
      regions.json     #   지역·출현 가중치·재료·해금 조건
      synergies.json   #   종족 시너지 수치
      events.json      #   갈림길·함정·보물·채집 이벤트 풀
      recipes.json     #   미끼·모래시계 세공 레시피
      items.json       #   유물 100점 + 세트 8계열 (효과는 공용 Effect 문법 — DATA §1.5)
      milestones.json  #   도감 마일스톤·보상
      balance.json     #   전역 계수(상성 배수, 포획 기본률, 성장 곡선 계수...)
  core/
    rng.ts             # mulberry32 + 시드 파생(hashSeed), 스트림 분리
    formulas.ts        # CP·성장 곡선·포획률 등 순수 계산식
    expedition.ts      # 파견 생성(시드 확정) → 조우 시퀀스 → 일지(Journal) 생성
    combat.ts          # 조우 판정 (P vs E, 피해, 패주/전멸)
    capture.ts         # 포획 판정·정수 전환
    effects.ts         # Effect 훅 엔진 — 시너지·유물·세트·마일스톤 버프를 훅 9종에 일괄 적용
                       #   (Action에 exhaustive switch, DATA §1.5 문법의 유일한 구현부)
    economy.ts         # 재화 증감·제작·레벨업 검증
    progression.ts     # 도감 상태 전이·마일스톤 평가·해금 판정
    types.ts           # 상태·결과 타입 (SaveState, Journal, ...)
  state/
    signal.ts          # 자체 반응형 프리미티브 (~100줄)
    store.ts           # 루트 스토어 + 액션 (파견하기, 정산하기, 레벨업...)
    save.ts            # 직렬화·localStorage·debounce·클라우드 동기화 훅
    migrations.ts      # 세이브 버전 마이그레이션 체인
    clock.ts           # 서버 오프셋 시계 (§7)
  platform/
    bridge.ts          # PlatformBridge 인터페이스 (푸시·광고·로그인·공유·시간)
    toss.ts            # @apps-in-toss/web-framework 구현
    web.ts             # 브라우저 mock (개발·플레이테스트)
  ui/
    router.ts          # 하단 탭 + 스택 네비게이션
    screens/           # home / expedition / codex / camp / journal / detail
    components/        # MonsterCard, SynergyGauge, TimelineCard, ...
    fx.ts              # 트윈·흔들림·데미지 숫자 (CSS 기반, rAF 최소)
    sfx.ts             # 효과음 — Web Audio 지연 로드, settings.sound 게이트 (GDD §11.1)
  main.ts
tests/
  core/                # 유닛 + 시드 고정 시뮬레이션 스냅샷
  content/             # 전 콘텐츠 zod 통과 + 참조 무결성(존재하지 않는 id 참조 금지)
scripts/
  simulate.mjs         # M3 밸런스 시뮬레이터 (7일 진행 리포트)
  fetch-assets.mjs     # IconScout 다운로드 정리 (ASSETS.md)
public/assets/monsters/  # 3D PNG (git 미포함 — ASSETS.md 참조)
public/assets/sfx/       # 효과음 ogg (Kenney CC0 — 재배포 자유라 git 포함, ASSETS §4-1)
supabase/
  migrations/          # DDL (DATA.md §4) — MCP apply 전 파일로 먼저 작성
  functions/           # expedition-push (M4)
```

## 4. 핵심 도메인 흐름

### 파견 → 귀환 (가장 중요한 시퀀스)

```
[ui] 파견 버튼
→ [state] action.startExpedition(regionId, tier, partyIds)
→ [core] expedition.create(save, input, {now, newSeed})
    · 검증(파티 유효성·중복 파견) · seed 확정 · endsAt = now + duration
    · ※ 조우 결과는 이 시점에 계산하지 않는다 — 갈림길 입력이 남아있기 때문
→ [state] 저장 + (M4) supabase expeditions upsert (푸시 예약용)

[귀환 시점 — 앱 재진입 or 푸시 탭]
→ [core] expedition.resolve(save, expedition, choices, ctx)
    · 시드에서 조우 시퀀스 재생성 → (effects 훅 적용) 조우별 판정·드랍 → Journal 생성
    · 같은 (시드, 선택) 입력이면 언제 어디서 계산해도 같은 일지 (결정론)
→ [state] action.claimJournal(journal) — 재화·포획·도감 반영, 저장
→ [ui] 일지 타임라인 재생
```

갈림길(§GDD 5.4): `resolve`는 갈림길 슬롯에서 `choices[]`를 소비. 미선택分은 `'safe'`로 채워짐.
v1은 귀환 정산 직전에 일괄 선택 UI 제공(파견 중 접속 시 미리 선택 가능), v1.5에서 푸시 즉답 연결.

## 5. UI 반응형 레이어 (자체 signal)

```ts
const gold = signal(0);                    // 쓰기: gold.set(x) / gold.update(fn)
const label = computed(() => `${gold()}G`);
effect(() => { el.textContent = label(); }); // 의존 자동 추적, 파괴 시 해제
```

- 구현 범위: `signal / computed / effect / batch` 4개만. 배열 diff·가상 DOM 없음
- 화면은 "구독하는 렌더 함수". 리스트 갱신은 키 기반 최소 교체 헬퍼(`renderList`) 하나로 통일
- 이 레이어만 단위 테스트로 고정(순환 의존·중복 실행·해제 누수)
- 판단 근거: 화면 6개·리스트 위주 UI에 React 도입 비용(빌드·학습·TDS 미사용) > 자체 100줄 유지 비용

## 6. 결정론과 난수

- RNG: mulberry32. **스트림 분리** — `rng(seed, 'encounters')`, `rng(seed, 'capture')`처럼
  용도별 파생 시드를 사용해, 한 용도의 roll 횟수 변화가 다른 용도 결과를 흔들지 않게 한다
  (콘텐츠 패치가 기존 파견 재현을 깨는 사고 방지)
- 시드 생성: 파견 시작 시 `crypto.getRandomValues` 1회 → 저장. 이후 모든 것은 시드에서 유도
- 일지 스냅샷 테스트: 고정 시드 × 대표 파티 × 각 지역 → Journal JSON 스냅샷을 커밋.
  core 수정 시 스냅샷 diff가 의도된 밸런스 변경인지 리뷰하는 장치

## 7. 시간 처리 (방치형의 아킬레스건)

- `clock.ts`: `now() = Date.now() + serverOffset`
  - 온라인 시: Supabase RPC(`select now()`) 또는 응답 헤더로 오프셋 보정
    (앱인토스 트랙 보류로 당분간 offset=0 — Google Play 1차의 귀환 로컬 알림은 기기 시계 기준)
  - **되감기 클램프**: `now() < save.lastSavedAt`이면 `lastSavedAt`을 하한으로 사용
- 파견 완료 판정·방치 보상은 전부 `clock.now()` 기준. core에는 `ctx.now`로 주입(직접 호출 금지)
- 시간 가속(모래시계 아이템 `useHourglass` — 2026-08-23 구현)은 시계가 아니라 원정 시간축
  (`startedAt`·`endsAt`)을 미는 `accelerateExpedition`으로 — 시계를 감으면 출석·일일 리셋 등
  달력 시스템이 같이 밀리기 때문. DEV 빌드는 가속 시트의 지급 버튼으로 테스트
- 한계 인정: v1 오프라인 단독 플레이는 시계 조작에 완전 방어 불가. 랭킹 없는 v1에서는 수용,
  랭킹(v2) 도입 시 서버 재검증(같은 core를 Edge Function에서 실행)으로 승격 — 이 경로가 있음이 중요

## 8. 세이브

- 단일 JSON 문서 `SaveState` — `{ version, profile, roster, codex, wallet, expeditions, settings, lastSavedAt }`
- 로컬: localStorage, 상태 변경 debounce 1s + 파견/정산 등 중요 액션은 즉시 flush
- 마이그레이션: `migrations.ts`에 `v(n)→v(n+1)` 순수 함수 체인, 로드 시 순차 적용 + 각 단계 테스트
- 클라우드(M5, cloudSync.ts): `saves` 테이블 upsert(jsonb). 충돌 정책 v1 = last-write-wins + 시각 비교 시 경고 후 선택
- 내보내기/가져오기: **2026-08-29 제거** — 클라우드 세이브(구글 로그인)가 기기 이동을 대체.
  가져오기는 랭킹 신원(playerId/secret)을 통째로 교체하는 사고 벡터이기도 했다 (탈퇴 후 랭킹 잔존 사고)

## 9. 플랫폼 어댑터

```ts
interface PlatformBridge {
  env: 'toss' | 'web' | 'android';
  login(): Promise<{ userKey: string } | null>;
  registerPushConsent(): Promise<boolean>;
  showRewardedAd(slot: AdSlot): Promise<'rewarded' | 'dismissed' | 'unavailable'>;
  vibrate(pattern: 'light' | 'success'): void;
  now(): number;              // 플랫폼 신뢰 시간(가능 시), 아니면 Date.now
}
```

- 부팅 시 환경 감지로 구현 선택. `web.ts`는 전 기능 mock(광고는 3초 타이머, 푸시는 콘솔 로그)
- **개발·테스트의 기본은 web** — 토스 샌드박스 없이 전체 루프가 돌아야 한다 (검증 속도)
- 광고·푸시 슬롯 id 등 플랫폼 상수는 `platform/`에 격리, core/콘텐츠는 모름

## 10. 테스트 전략

| 대상 | 방식 | 게이트 |
|---|---|---|
| core/* | vitest 유닛 + 프로퍼티성 케이스(경계 CP, HP 0, 빈 파티) | 커밋 전 통과 필수 |
| 일지 결정론 | 시드 고정 스냅샷 (§6) | 스냅샷 변경은 커밋 메시지에 사유 명시 |
| content/ | zod 전수 + 참조 무결성 + 밸런스 불변식(예: 해금 곡선 단조 증가) | 콘텐츠 수정 시 |
| state/signal | 유닛 (구독·해제·batch) | |
| UI | M2까지는 수동 + 브라우저 패널 검증 스크립트, E2E는 도입 보류 | |
| 밸런스 | scripts/simulate.mjs — 봇 전략 3종(최적/보통/방치)으로 7일 시뮬 → 도달 지역·재화 곡선 리포트 | M3 완료 조건 |

## 11. 성능·품질 예산

- 초기 로드(토스 웹뷰): JS ≤ 200KB gzip, 첫 화면 TTI < 2s (중저가 안드로이드 기준)
- 이미지: 3D PNG 원본 512px → 표시 크기별 128/256 WebP 변환(빌드 스크립트), 지역 단위 지연 로드
- 애니메이션: CSS transform/opacity만, 상시 rAF 루프 금지(진행 게이지는 1초 인터벌)
- 접근성 최소선: 탭 타깃 44px, 색 외 정보 채널(등급은 테두리+라벨), 시스템 폰트 스택

## 12. 코드 컨벤션

- TypeScript strict, `any` 금지(불가피 시 사유 주석), 공개 함수에 JSDoc 한 줄
- 사용자 노출 문자열은 `ui/strings.ts`에 집약(v1 한글 전용이지만 흩뿌리지 않는다)
- 커밋: 한글 명령형 제목("포획 판정 구현"), 논리 단위로 분리. main 직커밋(1인 개발), 마일스톤 태그 `m1`, `m2`...
- 콘텐츠 수치 변경은 코드 변경과 커밋 분리 (밸런스 이력 추적)
