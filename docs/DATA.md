# NewWorld — 데이터 설계서 (DATA)

> 상태: 초안 (M0 리뷰 대상) · 마지막 수정: 2026-08-22
> 모든 게임 수치는 코드가 아니라 여기 정의된 콘텐츠 JSON에 산다. 코드는 구조만 안다.

---

## 1. 콘텐츠 JSON (src/content/data/)

로드 시 zod로 전수 검증. id는 전부 kebab-case 문자열, 참조 무결성 테스트로 보증.

### 1.1 monsters.json — 52종

```jsonc
{
  "id": "thorn-wolf",
  "name": "가시덩쿨 늑대",
  "element": "nature",            // fire | nature | frost | light | dark
  "tribe": "beast",               // beast | spirit | undead | aquatic | flying | construct
  "rarity": "common",             // common | rare | epic | legendary
  "baseHp": 46,
  "baseAtk": 12,
  "habitat": "whispering-woods",  // 대표 서식지 (도감 힌트 표기용)
  "asset": "thorn-wolf",          // public/assets/monsters/{asset}.webp
  "flavor": "덤불 속에서 꼬리만 보인다면 이미 늦었다.",
  "tags": []                      // 확장 슬롯: 추후 스킬·특성 도입 시 사용 (v1 빈 배열)
}
```

- 등급별 기본 CP 밴드(생성 규칙): 커먼 60~90 / 레어 110~160 / 에픽 200~280 / 전설 400~520
  (지역이 깊을수록 밴드 상단. 개체값은 시트에서 수동 배정 — M1에서 52종 확정)
- `tags`가 v1의 확장 여지: 스킬/장비 시스템이 와도 스키마 파괴 없이 증축

### 1.2 regions.json — 지역 4+1

```jsonc
{
  "id": "whispering-woods",
  "name": "속삭이는 숲",
  "order": 2,
  "element": "nature",                    // 지역 우세 속성 (파티 상성 보정)
  "recommendedCp": 400,
  "unlock": { "codexCaptured": { "misty-coast": 6 }, "materials": {} },
  "materials": ["dew-branch", "spirit-moss"],
  "spawns": [                              // 조우 출현 테이블 (가중치)
    { "monster": "thorn-wolf", "weight": 18 },
    { "monster": "gale-owl",   "weight": 14 }
    // ... 커먼7 레어3 에픽2
  ],
  "legendary": "elder-treant",             // 심층 한정 전설 (별도 출현 규칙: balance.json)
  "encounterMix": { "monster": 72, "treasure": 12, "trap": 10, "gather": 6 },  // %
  "tierMods": { "deep": { "rareWeightMult": 2.0 } }
}
```

### 1.3 synergies.json / events.json / recipes.json / milestones.json

- `synergies.json`: 종족별 `{ at2: {...효과}, at3: {...} }` — 효과는 `{ kind, value }` 태그드 유니언
  (예: `{"kind":"atkMult","value":0.10}`, `{"kind":"reviveOnce","hpRatio":0.3}`)
- `events.json`: 갈림길/함정/보물/채집 풀. 갈림길은 `{ id, text, safe: Reward, risky: { check: cpRatio, success: Reward, fail: Damage } }`
- `recipes.json`: 미끼 등 제작법 `{ id, cost: { materials, gold }, effect }`
- `milestones.json`: `{ id, condition: {...태그드 유니언}, reward: { buff?, gold } }`
- 보상(Reward)·조건(Condition)·효과(Effect)는 **공용 태그드 유니언 타입**으로 통일 —
  새 종류 추가 = 스키마에 variant 추가 + core에 해당 케이스 구현 (컴파일러가 누락 잡음)

### 1.4 balance.json — 전역 계수 (전부 여기, 코드에 매직넘버 금지)

```jsonc
{
  "elementAdvantage": 1.3,
  "elementDisadvantage": 0.77,
  "cpFormula": { "atkWeight": 2, "hpWeight": 0.5 },
  "levelCurve": { "statGrowth": 0.08, "goldBase": 40, "goldExp": 1.6, "maxLevel": 30 },
  "starMult": 1.25,
  "essencePerDupe": { "common": 3, "rare": 8, "epic": 20, "legendary": 50 },
  "starCost": [10, 25, 60, 150],
  "captureBase": { "common": 0.40, "rare": 0.15, "epic": 0.05, "legendary": 0.015 },
  "lureMult": 2.0, "adBuffMult": 2.0, "captureMultCap": 4.0,
  "tiers": {
    "scout": { "minutes": 15, "encounters": 3, "crossroads": 0 },
    "standard": { "minutes": 120, "encounters": 8, "crossroads": 1, "yieldMult": 1.2 },
    "deep": { "minutes": 480, "encounters": 20, "crossroads": 2, "legendaryChance": 0.05 }
  },
  "defeatDamageK": 0.35, "victoryDamageK": 0.12,
  "fleeRewardRatio": 0.5,
  "crossroadTimeoutHours": 4,
  "adDailyLimits": { "instantReturn": 3, "scentBuff": 3 }
}
```

### 1.5 items.json — 유물 28종 + 세트 (GDD §8)

```jsonc
{
  "id": "predators-fang",
  "name": "포식자의 송곳니",
  "slot": "weapon",             // weapon | armor | banner | charm
  "rarity": "legendary",        // common | rare | heroic | legendary
  "set": null,                  // 세트 id 또는 null
  "main": { "stat": "atkMult", "base": 0.18, "perEnhance": 0.03 },
  "substatCount": 3,            // 획득 시 substatPool에서 중복 없이 롤 (등급별 0~3)
  "unique": [                   // 고유 능력 (영웅=조건부 옵션 1, 전설=본격 능력)
    { "hook": "beforeEncounter",
      "when": { "encounterIndex": 0, "encounterKind": "monster" },
      "do": { "kind": "autoWin" } }
  ],
  "asset": "predators-fang",
  "flavor": "첫 사냥감은 도망치지 못한다."
}
```

**효과 문법 (확장성의 핵심):**

```
Effect   = { hook: Hook, when?: Condition, do: Action }
Hook     = expeditionSetup | computeParty | beforeEncounter | afterVictory
         | afterDefeat | captureRoll | crossroad | lootRoll | journalEnd   (9종)
Condition= { region?, element?, tribe?, tier?, encounterKind?, encounterRarity?,
             encounterIndex?, hpBelow? }                                    (AND 결합)
Action   = { kind: "statMult", stat, value } | { kind: "captureAdd", value }
         | { kind: "captureRetry", perExpedition } | { kind: "autoWin" }
         | { kind: "damageReduce", value } | { kind: "reviveOnce", hpRatio }
         | { kind: "rewardMult", target, value } | { kind: "timeMult", value }
         | { kind: "encounterAdd", count } | { kind: "synergyAmp", value }
         | { kind: "salvageOnFail", ratio } | { kind: "spawnWeightMult", rarity, value }
         | ...                                          (태그드 유니언 — 필요 시 variant 추가)
```

- zod discriminated union으로 검증 — 오타·미지원 kind는 **빌드 실패**
- core `effects.ts`는 Action에 exhaustive switch — variant 추가 시 컴파일러가 미구현을 잡음
- 같은 Action + 다른 Condition = 다른 유물. **다양성은 조합에서 나온다** (코드 0줄 확장)
- 스택 규칙: 같은 stat 배수는 곱연산, `balance.json`의 `effectCaps`로 상한
- 시너지(1.3의 synergies.json) 효과도 동일 Effect 문법으로 통일 — 엔진 하나로 시너지·유물·세트·마일스톤 버프 전부 처리

세트는 같은 파일의 `sets` 배열: `{ id, name, bonuses: { "2": Effect[], "4": Effect[] } }`

**balance.json 추가 키:**

```jsonc
"artifacts": {
  "dropRarity": { "common": 0.55, "rare": 0.30, "heroic": 0.12, "legendary": 0.03 },
  "sources": { "treasureChance": 0.35, "deepClearBox": true,
               "legendaryEncounter": 0.35, "crossroadCrit": 0.15 },
  "firstTreasurePity": true,          // 계정 첫 보물 조우는 유물 확정
  "enhance": { "max": 5, "dustCost": [10, 25, 50, 90, 150] },
  "dustPerSalvage": { "common": 5, "rare": 12, "heroic": 30, "legendary": 80 },
  "substatPool": [ { "stat": "atkMult", "min": 0.03, "max": 0.08, "weight": 20 } /* ... */ ],
  "effectCaps": { "rewardMult": 3.0, "timeMultMin": 0.5, "captureMultCap": 4.0 }
}
```

## 2. 세이브 스키마 (SaveState v1)

```ts
interface SaveState {
  version: 1;
  profile: { createdAt: number; tutorialDone: boolean; cloudUserKey?: string };
  wallet: { gold: number; materials: Record<MaterialId, number>; essence: Record<MonsterId, number>; lures: number; dust: number };
  roster: OwnedMonster[];          // { uid, monsterId, level, star, currentHpRatio, expeditionId? }
  artifacts: OwnedArtifact[];      // { uid, itemId, enhance, substats: {stat,value}[], teamId? }
  teams: TeamLoadout[];            // { id, name, partyUids, artifactUids } — 파견 프리셋 (해금 팀 수만큼)
  codex: Record<MonsterId, { seen: boolean; captured: boolean; awakened: boolean; firstCapturedAt?: number }>;
  milestones: MilestoneId[];       // 달성 목록 (버프는 로드 시 재계산 — 저장 안 함)
  expeditions: ActiveExpedition[]; // { id, regionId, tier, partyUids, artifactUids, seed, startedAt,
                                   //   endsAt, choices: ('safe'|'risky')[], claimed: boolean }
                                   //   ※ 파티·유물은 파견 시점 스냅샷 (원정 중 교체 방지)
  journalArchive: JournalSummary[]; // 최근 20건 요약 (풀 일지는 시드에서 재생성 가능하므로 미저장)
  counters: { adUsedToday: Record<AdSlot, number>; day: string };  // 일일 제한
  settings: { sound: boolean; push: boolean };
  lastSavedAt: number;
}
```

원칙:
- **파생값은 저장하지 않는다** (마일스톤 버프, 도감 점수, 유효 CP → 로드 시 재계산)
- 풀 일지도 저장하지 않는다 — `(seed, choices)`가 있으면 core가 언제든 재생성 (결정론의 배당)
- 버전 필드는 정수 증가만. 마이그레이션은 TECH.md §8

## 3. 파생 데이터 흐름

```
콘텐츠 JSON (git) ──빌드시──▶ zod 검증 + 인덱스 생성 (id맵, 지역 출현 누적가중치)
                              └─ 실패 시 빌드 중단 (잘못된 콘텐츠는 배포 불가)
세이브 (localStorage) ──로드──▶ 마이그레이션 체인 ▶ 파생값 재계산 ▶ 스토어
```

## 4. Supabase 스키마 (프로젝트: sbprvqtpshzrferjauxs · M4에 적용)

> 적용 방식: `supabase/migrations/*.sql`로 파일 작성 → 리뷰 → MCP `apply_migration`.
> 콘텐츠는 DB에 넣지 않는다(클라 JSON이 원본). DB는 **유저 상태와 푸시 스케줄만**.

```sql
-- 0001_core.sql
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  toss_user_key text unique not null,          -- 앱인토스 로그인 식별자
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.saves (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null,                         -- SaveState 통째 (LWW)
  version int not null,
  updated_at timestamptz not null default now()
);

create table public.expeditions (              -- 푸시 스케줄링용 미러 (진실은 세이브 쪽)
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  region_id text not null,
  tier text not null check (tier in ('scout','standard','deep')),
  ends_at timestamptz not null,
  status text not null default 'running' check (status in ('running','done','claimed')),
  return_push_sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index expeditions_due on public.expeditions (ends_at) where status = 'running';

alter table public.profiles   enable row level security;
alter table public.saves      enable row level security;
alter table public.expeditions enable row level security;
-- RLS 정책은 인증 방식 확정과 함께 0002에서:
--   앱인토스 로그인 → Edge Function(login)에서 toss userKey 검증 후 Supabase JWT 발급(커스텀 클레임 profile_id)
--   → 정책: profile_id = (auth.jwt()->>'profile_id')::uuid
--   클라이언트 anon 직쓰기는 saves/expeditions 본인 행만.
```

미결(M4 착수 시 확정): 앱인토스 로그인 검증 API 스펙 확인 → JWT 발급 함수 설계.
그 전까지 클라우드 저장 없이도 게임 전체가 로컬로 동작해야 한다(TECH §9 web mock).

## 5. 푸시 파이프라인 (M4)

```
파견 시작 ─▶ expeditions upsert (ends_at)
pg_cron (매분) ─▶ due & not sent 조회 ─▶ Edge Function expedition-push
  ─▶ 앱인토스 푸시 API 호출 ("원정대가 돌아왔습니다!") ─▶ return_push_sent = true
클라 귀환 정산 ─▶ status = 'claimed' (다음 파견 시 지난 행 정리)
```

- 푸시 본문에 성과 요약을 넣기 위한 사전 계산은 하지 않는다(서버는 시드를 모름) —
  v1 푸시는 고정 문구 + 지역명. 성과는 열어서 확인 (열어볼 이유가 되기도 함)
- 수신 동의: 앱인토스 푸시 동의 플로우(§GDD 10) 통과 유저만 expeditions 미러 업로드
- 갈림길 푸시(M6): crossroad_at 컬럼 추가 예정 — 스키마 변경은 그때 마이그레이션으로

## 6. 에셋 참조 규칙

- 코드·콘텐츠는 에셋을 `asset` id로만 참조. 실제 파일: `public/assets/{monsters|artifacts}/{id}@{128|256}.webp`
- 매핑 대장: `docs/ASSETS.md`의 표 (IconScout 원본 URL·작가·라이선스 메모 포함)
- 에셋 누락 시 폴백: 등급색 실루엣 + 이니셜 (개발 중 에셋 없이도 전 화면 동작)
