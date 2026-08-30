/**
 * 미끼 수급·소비 감사 (검토 ②, 2026-08-30)
 *
 *   npx tsx scripts/lure-audit.ts [--days 14] [--shop]
 *
 * 질문: 미끼가 "제작·상점이 불필요할 정도로" 공짜 수급(갈림길·출석)만으로 남아도는가.
 * 소비는 미포획 희귀+ 조우에만 발동(2026-08-25 낭비 수정)하므로 도감이 찰수록 0에 수렴한다 —
 * 수급원별 분해와 일별 재고 곡선으로 어느 수급원이 과잉의 주범인지 찾는다.
 * 봇 뼈대는 material-audit.ts와 동일 (파견·귀환·해금·성장·갈림길), 기본은 상점·제작 없이
 * 공짜 수급만 켠다 (--shop 이면 골드상점 미끼 일3 구매 추가).
 */
import { content } from '../src/content';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import { buyPartySlot, levelUpMonster, unlockRegion } from '../src/core/economy';
import { monsterLevelUpCost } from '../src/core/formulas';
import { canCheckIn, checkIn } from '../src/core/attendance';
import { chooseCrossroad, claimExpedition, createExpedition } from '../src/core/expedition';
import { createInitialSave } from '../src/core/newgame';
import { isRegionUnlocked, nextPartySlotUnlock, teamCount } from '../src/core/progression';
import { buyShopProduct } from '../src/core/shop';
import { GameError, type CoreCtx, type SaveState } from '../src/core/types';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 14) || 14;
const USE_SHOP = args.includes('--shop');
const DAY_MS = 86_400_000;

interface Strategy {
  name: string;
  label: string;
  checkHours: number[];
  riskyAt: number;
  safety: number;
  spendRatio: number;
}
const STRATEGIES: Strategy[] = [
  { name: 'hardcore', label: '하드코어(2시간마다)', checkHours: [8, 10, 12, 14, 16, 18, 20, 22], riskyAt: 1.0, safety: 0.7, spendRatio: 1.0 },
  { name: 'normal', label: '보통(하루 4회)', checkHours: [8, 12, 19, 23], riskyAt: 1.5, safety: 0.85, spendRatio: 0.6 },
  { name: 'idle', label: '방치(하루 2회)', checkHours: [8, 22], riskyAt: Infinity, safety: 1.0, spendRatio: 0.3 },
];

function makeCtx(name: string): { ctx: CoreCtx; set: (t: number) => void } {
  let now = 0;
  let seedNo = 0;
  let uidNo = 0;
  return {
    ctx: { now: () => now, newSeed: () => `lure-${name}-${++seedNo}`, newUid: () => `u${++uidNo}` },
    set: (t) => { now = t; },
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

function pickParty(save: SaveState, slots: number): string[] {
  const busy = new Set(save.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyIds));
  return save.roster
    .filter((m) => !busy.has(m.monsterId))
    .map((m) => {
      const def = content.monsters.get(m.monsterId)!;
      const cp = (def.baseAtk * 2 + def.baseHp * 0.5) * (1 + 0.08 * (m.level - 1)) * Math.pow(content.balance.star.mult, m.star - 1);
      return { uid: m.monsterId, cp };
    })
    .sort((a, b) => b.cp - a.cp)
    .slice(0, slots)
    .map((p) => p.uid);
}

function powerOf(save: SaveState, party: string[], regionId: string, tier: 'scout' | 'standard' | 'deep'): number {
  const region = content.regions.get(regionId)!;
  const fx = collectTeamEffects(content, save, party, []);
  const members = party.map((id) => save.roster.find((m) => m.monsterId === id)!);
  return computePartyPower(content, fx.effects, members, region, tier).total;
}

interface DayRow { day: number; stock: number; gained: number; used: number; captured: number }
interface Audit {
  label: string;
  bySource: Record<string, number>;
  used: number;
  runs: number;
  days: DayRow[];
}

function audit(strategy: Strategy): Audit {
  const { ctx, set } = makeCtx(strategy.name);
  set(0);
  let save = createInitialSave(content, ctx);
  save.profile.tutorialDone = true;

  const bySource: Record<string, number> = { 시작: save.wallet.lures };
  let used = 0;
  let gainedToday = 0;
  let usedToday = 0;
  let runs = 0;
  const days: DayRow[] = [];

  const claimDue = (t: number): void => {
    for (const expedition of [...save.expeditions]) {
      if (expedition.claimed || expedition.endsAt > t) continue;
      const result = claimExpedition(content, save, expedition.id, ctx);
      save = result.save;
      runs++;
      bySource['갈림길'] = (bySource['갈림길'] ?? 0) + result.journal.totals.luresGained;
      gainedToday += result.journal.totals.luresGained;
      used += result.journal.totals.luresUsed;
      usedToday += result.journal.totals.luresUsed;
    }
  };

  for (let d = 0; d < DAYS; d++) {
    for (const h of strategy.checkHours) {
      const t = d * DAY_MS + h * 3600_000;
      set(t);
      claimDue(t);

      // 출석 — 하루 1회 (미끼 보상일이면 수급원에 기록)
      if (canCheckIn(save, t)) {
        const before = save.wallet.lures;
        const result = checkIn(content, save, t);
        save = result.save;
        const delta = save.wallet.lures - before;
        if (delta > 0) {
          bySource['출석'] = (bySource['출석'] ?? 0) + delta;
          gainedToday += delta;
        }
      }

      // 상점 (옵션) — 골드상점 미끼 일3
      if (USE_SHOP) {
        for (let i = 0; i < 3; i++) {
          try {
            const result = buyShopProduct(content, save, { productId: 'gold-lure' }, ctx);
            save = result.save;
            bySource['골드상점'] = (bySource['골드상점'] ?? 0) + 1;
            gainedToday += 1;
          } catch (error) {
            if (error instanceof GameError) break;
            throw error;
          }
        }
      }

      // 해금·성장 (material-audit과 동일 정책)
      for (const region of content.regionList) {
        if (isRegionUnlocked(content, save, region.id)) continue;
        const next = safely(() => unlockRegion(content, save, region.id));
        if (next) save = next;
      }
      if (nextPartySlotUnlock(content, save)) {
        const next = safely(() => buyPartySlot(content, save));
        if (next) save = next;
      }
      {
        const budget = Math.floor(save.wallet.gold * strategy.spendRatio);
        let spentGold = 0;
        for (let guard = 0; guard < 500; guard++) {
          const ranked = [...save.roster]
            .map((m) => {
              const def = content.monsters.get(m.monsterId)!;
              const cp = (def.baseAtk * 2 + def.baseHp * 0.5) * (1 + 0.08 * (m.level - 1)) * Math.pow(content.balance.star.mult, m.star - 1);
              return { uid: m.monsterId, cp };
            })
            .sort((a, b) => b.cp - a.cp);
          const mains = new Set(ranked.slice(0, save.profile.partySlots).map((r) => r.uid));
          const best = save.roster
            .filter((m) => m.level < content.balance.level.max && mains.has(m.monsterId))
            .map((m) => {
              const def = content.monsters.get(m.monsterId)!;
              return { uid: m.monsterId, level: m.level, gain: (def.baseAtk * 2 + def.baseHp * 0.5) / monsterLevelUpCost(content, m.monsterId, m.level) };
            })
            .sort((a, b) => b.gain - a.gain)[0];
          if (!best) break;
          const cost = monsterLevelUpCost(content, best.uid, best.level);
          if (spentGold + cost > budget) break;
          const next = safely(() => levelUpMonster(content, save, best.uid));
          if (!next) break;
          save = next;
          spentGold += cost;
        }
      }

      // 파견 — 시간대별 티어 (밤 deep), 갈림길은 전략별 안전/위험
      const tier: 'scout' | 'standard' | 'deep' = h >= 22 || h < 6 ? 'deep' : 'standard';
      while (save.expeditions.filter((e) => !e.claimed).length < teamCount(content, save)) {
        const party = pickParty(save, save.profile.partySlots);
        if (party.length === 0) break;
        const unlocked = content.regionList.filter((r) => isRegionUnlocked(content, save, r.id));
        let region = unlocked[0]!;
        for (const r of unlocked) if (powerOf(save, party, r.id, tier) >= r.recommendedCp * strategy.safety) region = r;
        let result;
        try {
          result = createExpedition(content, save, { regionId: region.id, tier, partyIds: party, artifactIds: [] }, ctx);
        } catch (error) {
          if (error instanceof GameError) break;
          throw error;
        }
        save = result.save;
        const power = powerOf(save, party, region.id, tier);
        const choice = power >= region.recommendedCp * strategy.riskyAt ? 'risky' : 'safe';
        for (let i = 0; i < result.expedition.choices.length; i++) save = chooseCrossroad(save, result.expedition.id, i, choice);
      }
    }
    const captured = Object.values(save.codex).filter((c) => c.captured).length;
    // 재고는 파견에 실린 미끼 포함 (귀환 시 반환되므로 사실상 보유분)
    const loaded = save.expeditions.filter((e) => !e.claimed).reduce((sum, e) => sum + e.luresLoaded, 0);
    days.push({ day: d + 1, stock: save.wallet.lures + loaded, gained: gainedToday, used: usedToday, captured });
    gainedToday = 0;
    usedToday = 0;
  }

  return { label: strategy.label, bySource, used, runs, days };
}

console.log(`\n=== 미끼 수급·소비 감사 — ${DAYS}일${USE_SHOP ? ' (+골드상점)' : ' (공짜 수급만)'} ===`);
for (const strategy of STRATEGIES) {
  const result = audit(strategy);
  const income = Object.values(result.bySource).reduce((a, b) => a + b, 0);
  console.log(`\n▶ ${result.label} — 런 ${result.runs}회`);
  console.log(`  수급 ${income} [${Object.entries(result.bySource).map(([k, v]) => `${k} ${v}`).join(' · ')}] · 소비 ${result.used} (소비율 ${income > 0 ? Math.round((result.used / income) * 100) : 0}%)`);
  console.log('  일차 | 재고 | +수급 | -소비 | 도감');
  for (const row of result.days) {
    const bar = '#'.repeat(Math.min(50, row.stock));
    console.log(`   D${String(row.day).padStart(2)} | ${String(row.stock).padStart(4)} | ${String(row.gained).padStart(5)} | ${String(row.used).padStart(5)} | ${String(row.captured).padStart(3)}  ${bar}`);
  }
}
console.log('');
