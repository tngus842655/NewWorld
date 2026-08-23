/**
 * M3 밸런스 시뮬레이터 (ROADMAP M3, TECH §10)
 * 봇 전략 3종이 같은 core 로직으로 7일을 플레이한 진행 리포트를 낸다.
 *
 *   npx tsx scripts/simulate.ts [--days 7] [--json <출력경로>]
 *
 * 목표 곡선(GDD §9.1, "보통" 기준): 숲 D1~2 → 늪 D6~8 → 화산 D10~14 (하드코어 약 2배 속도)
 */
import { content } from '../src/content';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import {
  awakenMonster,
  buyPartySlot,
  craftRecipe,
  enhanceArtifact,
  levelUpMonster,
  unlockRegion,
} from '../src/core/economy';
import { monsterLevelUpCost, monsterStarUpCost } from '../src/core/formulas';
import { chooseCrossroad, claimExpedition, createExpedition } from '../src/core/expedition';
import { createInitialSave } from '../src/core/newgame';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock, teamCount } from '../src/core/progression';
import { GameError, type CoreCtx, type SaveState } from '../src/core/types';
import { writeFileSync } from 'node:fs';

// ── 전략 정의 ────────────────────────────────────────────────────────────────
interface Strategy {
  name: string;
  label: string;
  /** 하루 중 접속하는 시각(시) */
  checkHours: number[];
  /** 위험 갈림길 선택 조건: P >= rec × riskyAt (Infinity = 항상 안전) */
  riskyAt: number;
  /** 파견 안전 계수: P >= rec × safety 인 가장 깊은 지역 선택 */
  safety: number;
  /** 레벨업에 쓰는 골드 비율 상한 (남길 예비금 = 1 - spendRatio) */
  spendRatio: number;
  /** 미끼 제작 여부 */
  craftLures: boolean;
  /** 유물 강화 여부 */
  enhance: boolean;
}

const STRATEGIES: Strategy[] = [
  { name: 'hardcore', label: '하드코어(2시간마다)', checkHours: [8, 10, 12, 14, 16, 18, 20, 22], riskyAt: 1.0, safety: 0.7, spendRatio: 1.0, craftLures: true, enhance: true },
  { name: 'normal', label: '보통(하루 4회)', checkHours: [8, 12, 19, 23], riskyAt: 1.5, safety: 0.85, spendRatio: 0.6, craftLures: true, enhance: true },
  { name: 'idle', label: '방치(하루 2회)', checkHours: [8, 22], riskyAt: Infinity, safety: 1.0, spendRatio: 0.3, craftLures: false, enhance: false },
];

const DAY_MS = 86_400_000;
const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 7) || 7;
const jsonIdx = args.indexOf('--json');
const JSON_OUT = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const CODEX_MODE = args.includes('--codex'); // 도감 우선 파견 (지역 24종 채우기 속도 측정용)

// ── 봇 로직 ──────────────────────────────────────────────────────────────────

function makeCtx(name: string): { ctx: CoreCtx; set: (t: number) => void } {
  let now = 0;
  let seedNo = 0;
  let uidNo = 0;
  return {
    ctx: { now: () => now, newSeed: () => `sim-${name}-${++seedNo}`, newUid: () => `u${++uidNo}` },
    set: (t) => {
      now = t;
    },
  };
}

function safely(fn: () => SaveState): SaveState | null {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GameError) return null;
    throw error;
  }
}

/** 슬롯별 최고 유물 선택 (등급 → 강화 순) */
function pickArtifacts(save: SaveState): string[] {
  const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, heroic: 3, legendary: 4 };
  const busy = new Set(save.expeditions.filter((e) => !e.claimed).flatMap((e) => e.artifactUids));
  const bySlot = new Map<string, { uid: string; score: number }>();
  for (const owned of save.artifacts) {
    if (busy.has(owned.uid)) continue;
    const def = content.artifacts.get(owned.itemId)!;
    const score = rank[def.rarity]! * 10 + owned.enhance;
    const cur = bySlot.get(def.slot);
    if (!cur || score > cur.score) bySlot.set(def.slot, { uid: owned.uid, score });
  }
  return [...bySlot.values()].map((v) => v.uid);
}

/** CP 상위 + 같은 종족 뭉치기 휴리스틱으로 파티 선택 */
function pickParty(save: SaveState, slots: number): string[] {
  const busy = new Set(save.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyIds));
  const free = save.roster
    .filter((m) => !busy.has(m.monsterId))
    .map((m) => {
      const def = content.monsters.get(m.monsterId)!;
      const cp =
        (def.baseAtk * content.balance.cp.atkWeight + def.baseHp * content.balance.cp.hpWeight) *
        (1 + content.balance.level.statGrowth * (m.level - 1)) *
        Math.pow(content.balance.star.mult, m.star - 1);
      return { uid: m.monsterId, tribe: def.tribe, cp };
    })
    .sort((a, b) => b.cp - a.cp);
  if (free.length === 0) return [];

  const picked = free.slice(0, slots);
  // 시너지 스왑: 상위권에 2마리 있는 종족의 3번째가 후보군에 있으면, 최저 CP와 교체
  const counts = new Map<string, number>();
  for (const p of picked) counts.set(p.tribe, (counts.get(p.tribe) ?? 0) + 1);
  for (const [tribe, count] of counts) {
    if (count !== 2 || picked.length < 3) continue;
    const third = free.find((f) => f.tribe === tribe && !picked.includes(f));
    if (!third) continue;
    const worst = [...picked].reverse().find((p) => p.tribe !== tribe)!;
    if (third.cp >= worst.cp * 0.6) {
      picked[picked.indexOf(worst)] = third;
      break;
    }
  }
  return picked.map((p) => p.uid);
}

function partyPowerOf(save: SaveState, partyIds: string[], artifactUids: string[], regionId: string, tier: 'scout' | 'standard' | 'deep'): number {
  const region = content.regions.get(regionId)!;
  const fx = collectTeamEffects(content, save, partyIds, artifactUids);
  const party = partyIds.map((id) => save.roster.find((m) => m.monsterId === id)!);
  return computePartyPower(content, fx.effects, party, region, tier).total;
}

interface DayRow {
  day: number;
  gold: number;
  captured: number;
  topCp: number;
  wipes: number;
  runs: number;
  unlocked: string;
  byRegion: Record<string, number>; // 지역별 도감 수 (업적 계단 도달 측정)
}

interface SimResult {
  strategy: string;
  label: string;
  days: DayRow[];
  unlockDay: Record<string, number>;
  totals: { runs: number; wipes: number; artifacts: number; legendarySeen: boolean };
}

function simulate(strategy: Strategy): SimResult {
  const { ctx, set } = makeCtx(strategy.name);
  set(0);
  let save = createInitialSave(content, ctx);
  save.profile.tutorialDone = true; // 시뮬은 튜토리얼 압축 없이

  const unlockDay: Record<string, number> = { 'misty-coast': 0 };
  const days: DayRow[] = [];
  let wipes = 0;
  let runs = 0;
  let goldEarned = 0;

  const checkpoints: number[] = [];
  for (let d = 0; d < DAYS; d++) {
    for (const h of strategy.checkHours) checkpoints.push(d * DAY_MS + h * 3600_000);
  }

  for (const t of checkpoints) {
    set(t);

    // 1) 귀환 정산
    for (const expedition of [...save.expeditions]) {
      if (expedition.claimed || expedition.endsAt > t) continue;
      const result = claimExpedition(content, save, expedition.id, ctx);
      save = result.save;
      goldEarned += result.journal.totals.gold;
      runs++;
      if (result.journal.wiped) wipes++;
    }

    // 2) 지역 해금 (가능해지는 즉시)
    for (const region of content.regionList) {
      if (isRegionUnlocked(content, save, region.id)) continue;
      if (canUnlockRegion(content, save, region.id).ok) {
        const next = safely(() => unlockRegion(content, save, region.id));
        if (next) {
          save = next;
          unlockDay[region.id] = Math.floor(t / DAY_MS) + 1;
        }
      }
    }

    // 3) 슬롯 구매
    if (nextPartySlotUnlock(content, save)) {
      const next = safely(() => buyPartySlot(content, save));
      if (next) save = next;
    }

    // 4) 성장: 각성(골드 — 2026-08-23 정수 폐기) → 레벨업(예산 내 CP 최대화)
    const budget = Math.floor(save.wallet.gold * strategy.spendRatio);
    let spent = 0;
    {
      // 주전(CP 상위 슬롯 수)에 한해 예산 내에서 각성
      const mains = [...save.roster]
        .map((m) => {
          const def = content.monsters.get(m.monsterId)!;
          const cp = (def.baseAtk * 2 + def.baseHp * 0.5) * Math.pow(content.balance.star.mult, m.star - 1);
          return { monsterId: m.monsterId, cp };
        })
        .sort((a, b) => b.cp - a.cp)
        .slice(0, save.profile.partySlots);
      for (const main of mains) {
        for (let guard = 0; guard < 5; guard++) {
          const current = save.roster.find((m) => m.monsterId === main.monsterId)!;
          if (current.star >= content.balance.star.max) break;
          if (current.level < 10) break; // 초반엔 레벨업이 골드 효율이 좋다 — 각성은 주전이 성장한 뒤
          const cost = monsterStarUpCost(content, main.monsterId, current.star);
          if (spent + cost > budget) break;
          const next = safely(() => awakenMonster(content, save, main.monsterId));
          if (!next) break;
          save = next;
          spent += cost;
        }
      }
    }
    // 정석 육성: 로스터 전체에서 CP 상위 "주전"(슬롯 수)에 골드를 집중 — 파견 중이어도 육성
    for (let guard = 0; guard < 500; guard++) {
      const ranked = [...save.roster]
        .map((m) => {
          const def = content.monsters.get(m.monsterId)!;
          const cp =
            (def.baseAtk * 2 + def.baseHp * 0.5) *
            (1 + content.balance.level.statGrowth * (m.level - 1)) *
            Math.pow(content.balance.star.mult, m.star - 1);
          return { uid: m.monsterId, cp };
        })
        .sort((a, b) => b.cp - a.cp);
      const mainParty = new Set(ranked.slice(0, save.profile.partySlots).map((r) => r.uid));
      const candidates = save.roster
        .filter((m) => m.level < content.balance.level.max && mainParty.has(m.monsterId))
        .map((m) => {
          const def = content.monsters.get(m.monsterId)!;
          const baseCp = def.baseAtk * 2 + def.baseHp * 0.5;
          return { uid: m.monsterId, level: m.level, gain: baseCp / monsterLevelUpCost(content, m.monsterId, m.level) };
        })
        .sort((a, b) => b.gain - a.gain);
      const best = candidates[0];
      if (!best) break;
      const cost = monsterLevelUpCost(content, best.uid, best.level);
      if (spent + cost > budget) break;
      const next = safely(() => levelUpMonster(content, save, best.uid));
      if (!next) break;
      save = next;
      spent += cost;
    }

    // 5) 미끼 제작 (기본 미끼만, 보유 3개 미만일 때)
    if (strategy.craftLures) {
      while (save.wallet.lures < 3) {
        const next = safely(() => craftRecipe(content, save, 'basic-lure'));
        if (!next) break;
        save = next;
      }
    }

    // 6) 유물 강화 (최고 등급 착용분 위주)
    if (strategy.enhance) {
      for (const uid of pickArtifacts(save)) {
        for (let i = 0; i < 5; i++) {
          const next = safely(() => enhanceArtifact(content, save, uid));
          if (!next) break;
          save = next;
        }
      }
    }

    // 7) 파견 — 빈 팀 슬롯마다
    const hour = Math.floor((t % DAY_MS) / 3600_000);
    const tier: 'scout' | 'standard' | 'deep' = hour >= 22 || hour < 6 ? 'deep' : 'standard';
    while (save.expeditions.filter((e) => !e.claimed).length < teamCount(content, save)) {
      const party = pickParty(save, save.profile.partySlots);
      if (party.length === 0) break;
      const artifacts = pickArtifacts(save);

      const unlocked = content.regionList.filter((r) => isRegionUnlocked(content, save, r.id));
      let region = unlocked[0]!;
      for (const r of unlocked) {
        const power = partyPowerOf(save, party, artifacts, r.id, tier);
        if (power >= r.recommendedCp * strategy.safety) region = r;
      }
      // 도감 우선 모드(--codex): 감당 가능한 지역 중 24종 미달인 가장 앞 지역을 돈다 (실유저의 도감 채우기 행동)
      if (CODEX_MODE) {
        const counts = capturedCounts(content, save);
        const target = unlocked.find((r) =>
          (counts.byRegion.get(r.id) ?? 0) < 24 &&
          partyPowerOf(save, party, artifacts, r.id, tier) >= r.recommendedCp * strategy.safety);
        if (target) region = target;
      }

      const result = (() => {
        try {
          return createExpedition(content, save, { regionId: region.id, tier, partyIds: party, artifactUids: artifacts }, ctx);
        } catch (error) {
          if (error instanceof GameError) return null;
          throw error;
        }
      })();
      if (!result) break;
      save = result.save;

      // 갈림길 선택
      const power = partyPowerOf(save, party, artifacts, region.id, tier);
      const choice = power >= region.recommendedCp * strategy.riskyAt ? 'risky' : 'safe';
      for (let i = 0; i < result.expedition.choices.length; i++) {
        save = chooseCrossroad(save, result.expedition.id, i, choice);
      }
    }

    // 일말 기록
    const dayIdx = Math.floor(t / DAY_MS);
    const isLastCheckOfDay = strategy.checkHours[strategy.checkHours.length - 1] === hour;
    if (isLastCheckOfDay) {
      const counts = capturedCounts(content, save);
      const party = pickParty(save, 3);
      const topCp = party.length > 0 ? Math.round(partyPowerOf(save, party, pickArtifacts(save), 'misty-coast', 'standard')) : 0;
      days.push({
        day: dayIdx + 1,
        gold: goldEarned,
        captured: counts.total,
        topCp,
        wipes,
        runs,
        unlocked: content.regionList.filter((r) => isRegionUnlocked(content, save, r.id)).map((r) => r.order).join(''),
        // 지역별 도감 수 — 업적 계단 도달 일차 측정용 (2026-08-23)
        byRegion: Object.fromEntries(content.regionList.map((r) => [r.id, counts.byRegion.get(r.id) ?? 0])),
      });
    }
  }

  return {
    strategy: strategy.name,
    label: strategy.label,
    days,
    unlockDay,
    totals: {
      runs,
      wipes,
      artifacts: save.artifacts.length,
      legendarySeen: Object.entries(save.codex).some(([id, c]) => c.seen && content.monsters.get(id)?.rarity === 'legendary'),
    },
  };
}

// ── 실행·리포트 ──────────────────────────────────────────────────────────────
const results = STRATEGIES.map(simulate);

const REGION_LABEL: Record<string, string> = {
  'whispering-woods': '숲', 'sunken-marsh': '늪', 'ashen-volcano': '화산',
};
/** "보통" 유저 기준 목표 (GDD §9.1). 하드코어는 하한의 절반까지 허용으로 본다. */
const GOAL: Record<string, [number, number]> = {
  'whispering-woods': [1, 2], 'sunken-marsh': [6, 8], 'ashen-volcano': [10, 14],
};

console.log(`\n=== NewWorld ${DAYS}일 진행 시뮬레이션 ===`);
for (const result of results) {
  console.log(`\n▶ ${result.label}`);
  console.log('  일차 | 누적골드 | 도감 | 상위3 CP | 런 | 전멸 | 해금');
  for (const row of result.days) {
    console.log(
      `   D${row.day}  | ${String(row.gold).padStart(7)} | ${String(row.captured).padStart(3)} | ${String(row.topCp).padStart(7)} | ${String(row.runs).padStart(3)} | ${String(row.wipes).padStart(3)} | 지역${row.unlocked}`,
    );
  }
  const unlocks = Object.entries(result.unlockDay)
    .filter(([id]) => id !== 'misty-coast')
    .map(([id, day]) => {
      const [lo, hi] = GOAL[id] ?? [0, 99];
      const mark = day >= lo && day <= hi ? '✅' : day < lo ? '⚡빠름' : '🐌느림';
      return `${REGION_LABEL[id] ?? id} D${day}(목표 D${lo}~${hi}) ${mark}`;
    });
  console.log(`  해금: ${unlocks.length > 0 ? unlocks.join(' · ') : '없음'}`);
  // 지역 도감 24종(업적 9단계, 완전 정복 제외) 도달 일차
  const codexGoals = content.regionList.map((region) => {
    const label = region.id === 'misty-coast' ? '해안' : (REGION_LABEL[region.id] ?? region.id);
    const hit = result.days.find((row: any) => (row.byRegion?.[region.id] ?? 0) >= 24);
    const last = result.days[result.days.length - 1] as any;
    return `${label} ${hit ? `D${hit.day}` : `미달(${last?.byRegion?.[region.id] ?? 0}/24)`}`;
  });
  console.log(`  도감 24종 도달: ${codexGoals.join(' · ')}`);
  console.log(`  총계: 런 ${result.totals.runs} · 전멸 ${result.totals.wipes} · 유물 ${result.totals.artifacts} · 전설 목격 ${result.totals.legendarySeen ? 'O' : 'X'}`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  console.log(`\nJSON → ${JSON_OUT}`);
}
