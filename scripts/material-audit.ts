/**
 * 재료 수급·소비 감사 (2026-08-25)
 *
 *   npx tsx scripts/material-audit.ts [--days 14] [--no-shop]
 *
 * "재료 8종에 소모처가 있는가"는 tests/crafting.test.ts가 이미 고정한다.
 * 여기서 재는 건 그 다음 질문 — 양이 맞는가:
 * 수급(채집 조우 · 갈림길 보상 · 상점 꾸러미) 대비 소비(레시피 · 지역 해금)가
 * 재료별로 얼마나 어긋나서, 어느 재료가 쓰이지 않고 쌓이는가.
 *
 * 봇은 재료를 남기지 않으려 애쓰는 유저를 흉내낸다 — 만들 수 있는 모래시계는 다 만들고
 * 만든 건 바로 원정 가속에 쓴다. 그런데도 남는 재료가 곧 구조적 과잉이다.
 */
import { content } from '../src/content';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import { buyPartySlot, craftRecipe, levelUpMonster, unlockRegion } from '../src/core/economy';
import { monsterLevelUpCost } from '../src/core/formulas';
import { chooseCrossroad, claimExpedition, createExpedition, useHourglass } from '../src/core/expedition';
import { createInitialSave } from '../src/core/newgame';
import { isRegionUnlocked, nextPartySlotUnlock, regionFlagKey, teamCount } from '../src/core/progression';
import { buyShopProduct } from '../src/core/shop';
import { GameError, type CoreCtx, type SaveState } from '../src/core/types';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 14) || 14;
const USE_SHOP = !args.includes('--no-shop');
/** 전 지역 해금 + 만렙 파티로 시작 — 화산 재료까지 도는 정상 운영 상태를 잰다 */
const ENDGAME = args.includes('--endgame');
const DAY_MS = 86_400_000;

const MATS = [...content.materials.values()];
const REGION_OF = new Map(MATS.map((m) => [m.id, content.regions.get(m.region)!]));
const slotOf = (id: string): number => REGION_OF.get(id)!.materials.indexOf(id);
const pad = (s: string | number, n: number): string => String(s).padStart(n);
/** 한글은 폭 2로 세는 좌측 정렬 */
const padE = (s: string, n: number): string => {
  const w = [...s].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

// ── A. 정적 소모처 표 ────────────────────────────────────────────────────────
console.log('\n=== A. 재료별 소모처 ===');
for (const mat of MATS) {
  const sinks: string[] = [];
  for (const recipe of content.recipes.values()) {
    const n = recipe.cost.materials[mat.id];
    if (n) sinks.push(`${recipe.name} x${n}`);
  }
  for (const region of content.regionList) {
    const n = region.unlock.materials?.[mat.id];
    if (n) sinks.push(`${region.name} 해금 x${n}(1회)`);
  }
  console.log(`  ${padE(mat.name, 16)} ${padE(`${REGION_OF.get(mat.id)!.name} 슬롯${slotOf(mat.id)}`, 18)} ${sinks.join(' · ') || '(없음)'}`);
}

// ── B. 해석적 수급 모델 ──────────────────────────────────────────────────────
// 채집 조우는 지역 재료 2종 중 균등 랜덤(expedition.ts), 갈림길 보상은 slot 지정.
// 둘 다 rewardScale·yieldMult가 붙지 않아 지역이 깊어져도 개수는 그대로다.
console.log('\n=== B. 원정 1회 기대 수급 (심층 기준) ===');
const deep = content.balance.tiers.deep;
const avgGather = (content.balance.rewards.gatherMaterialMin + content.balance.rewards.gatherMaterialMax) / 2;
const crossMat: { safe: [number, number]; risky: [number, number] } = { safe: [0, 0], risky: [0, 0] };
for (const c of content.events.crossroads) {
  const add = (into: [number, number], slot: 0 | 1, count: number): void => {
    if (slot === 0) into[0] += count / content.events.crossroads.length;
    else into[1] += count / content.events.crossroads.length;
  };
  for (const r of c.safe) if (r.kind === 'material') add(crossMat.safe, r.slot as 0 | 1, r.count);
  for (const r of c.risky.success) if (r.kind === 'material') add(crossMat.risky, r.slot as 0 | 1, r.count);
}
console.log(`  ${padE('지역', 14)} ${pad('채집/슬롯', 10)} ${pad('갈림길안전', 12)} ${pad('갈림길위험', 12)} ${pad('슬롯0계', 9)} ${pad('슬롯1계', 9)}`);
for (const region of content.regionList) {
  const mix = region.encounterMix;
  const share = mix.gather / (mix.monster + mix.treasure + mix.trap + mix.gather);
  const gatherEach = (deep.encounters * share * avgGather) / 2;
  const cr = deep.crossroads;
  const [safe0, safe1] = [crossMat.safe[0] * cr, crossMat.safe[1] * cr];
  const [risky0, risky1] = [crossMat.risky[0] * cr, crossMat.risky[1] * cr];
  console.log(
    `  ${padE(region.name, 14)} ${pad(gatherEach.toFixed(2), 10)} ${pad(`${safe0.toFixed(1)}/${safe1.toFixed(1)}`, 12)} ${pad(`${risky0.toFixed(1)}/${risky1.toFixed(1)}`, 12)} ` +
      `${pad((gatherEach + risky0).toFixed(2), 9)} ${pad((gatherEach + risky1).toFixed(2), 9)}`,
  );
}
console.log('  ※ 갈림길 칸은 "슬롯0/슬롯1" 기대값, 계는 위험 선택 기준. 채집은 2종 균등 분배.');

// ── C. 시뮬 실측 ─────────────────────────────────────────────────────────────
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
    ctx: { now: () => now, newSeed: () => `mat-${name}-${++seedNo}`, newUid: () => `u${++uidNo}` },
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

function pickArtifacts(save: SaveState): string[] {
  const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, heroic: 3, legendary: 4, transcendent: 5 };
  const used = new Map<string, number>();
  for (const itemId of save.expeditions.filter((e) => !e.claimed).flatMap((e) => e.artifactIds)) {
    used.set(itemId, (used.get(itemId) ?? 0) + 1);
  }
  const bySlot = new Map<string, { itemId: string; score: number }>();
  for (const owned of save.artifacts) {
    if (owned.count - (used.get(owned.itemId) ?? 0) <= 0) continue;
    const def = content.artifacts.get(owned.itemId)!;
    const score = rank[def.rarity]! * 10 + owned.enhance;
    const cur = bySlot.get(def.slot);
    if (!cur || score > cur.score) bySlot.set(def.slot, { itemId: owned.itemId, score });
  }
  return [...bySlot.values()].map((v) => v.itemId);
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

function powerOf(save: SaveState, party: string[], arts: string[], regionId: string, tier: 'scout' | 'standard' | 'deep'): number {
  const region = content.regions.get(regionId)!;
  const fx = collectTeamEffects(content, save, party, arts);
  const members = party.map((id) => save.roster.find((m) => m.monsterId === id)!);
  return computePartyPower(content, fx.effects, members, region, tier).total;
}

interface Audit {
  label: string;
  income: Record<string, number>;
  spent: Record<string, number>;
  stock: Record<string, number>;
  crafted: Record<string, number>;
  runs: number;
  hourglassMinutes: number;
}

function audit(strategy: Strategy): Audit {
  const { ctx, set } = makeCtx(strategy.name);
  set(0);
  let save = createInitialSave(content, ctx);
  save.profile.tutorialDone = true;
  if (ENDGAME) {
    // 화산까지 도는 후반부 정상 운영: 전 지역 해금 · 슬롯 최대 · 파티 만렙
    for (const region of content.regionList) save.profile.flags[regionFlagKey(region.id)] = true;
    save.profile.partySlots = 5;
    const strong = [...content.monsters.values()]
      .filter((m) => m.rarity === 'heroic')
      .sort((a, b) => b.baseAtk * 2 + b.baseHp * 0.5 - (a.baseAtk * 2 + a.baseHp * 0.5))
      .slice(0, 20);
    save.roster = strong.map((m) => ({ monsterId: m.id, level: content.balance.level.max, star: 3, count: 1 }));
    for (const m of strong) save.codex[m.id] = { seen: true, captured: true, awakened: true, firstCapturedAt: 0 };
    save.wallet.gold = 200_000;
  }

  const income: Record<string, number> = {};
  const spent: Record<string, number> = {};
  const crafted: Record<string, number> = {};
  let runs = 0;
  let hourglassMinutes = 0;

  const noteSpend = (before: SaveState, after: SaveState): void => {
    for (const m of MATS) {
      const delta = (before.wallet.materials[m.id] ?? 0) - (after.wallet.materials[m.id] ?? 0);
      if (delta > 0) spent[m.id] = (spent[m.id] ?? 0) + delta;
    }
  };
  const claimDue = (t: number): void => {
    for (const expedition of [...save.expeditions]) {
      if (expedition.claimed || expedition.endsAt > t) continue;
      const result = claimExpedition(content, save, expedition.id, ctx);
      save = result.save;
      runs++;
      for (const [id, n] of Object.entries(result.journal.totals.materials)) income[id] = (income[id] ?? 0) + n;
    }
  };

  const checkpoints: number[] = [];
  for (let d = 0; d < DAYS; d++) for (const h of strategy.checkHours) checkpoints.push(d * DAY_MS + h * 3600_000);

  for (const t of checkpoints) {
    set(t);
    claimDue(t);

    // 지역 해금 — 재료 소비
    for (const region of content.regionList) {
      if (isRegionUnlocked(content, save, region.id)) continue;
      const next = safely(() => unlockRegion(content, save, region.id));
      if (next) {
        noteSpend(save, next);
        save = next;
      }
    }

    // 슬롯·레벨 성장 — 재료와 무관하지만 지역 진입 속도를 좌우한다
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

    // 상점 — 골드가 남아도는 게임이라 재료 꾸러미는 매일 한도까지 산다 (수급원)
    if (USE_SHOP) {
      for (const product of content.shopProducts) {
        if (product.shop !== 'gold' || product.goods.kind !== 'materialsAll') continue;
        for (let i = 0; i < 3; i++) {
          try {
            const result = buyShopProduct(content, save, { productId: product.id }, ctx);
            for (const g of result.granted.materials ?? []) income[g.materialId] = (income[g.materialId] ?? 0) + g.count;
            save = result.save;
          } catch (error) {
            if (error instanceof GameError) break;
            throw error;
          }
        }
      }
    }

    // 제작 — 미끼는 3개까지, 모래시계는 만들 수 있는 만큼 전부
    while (save.wallet.lures < 3) {
      const next = ['lure-bundle', 'basic-lure'].reduce<SaveState | null>((acc, id) => acc ?? safely(() => craftRecipe(content, save, id)), null);
      if (!next) break;
      noteSpend(save, next);
      save = next;
    }
    for (let guard = 0; guard < 200; guard++) {
      let made = false;
      for (const recipe of content.recipes.values()) {
        if (recipe.output.kind !== 'hourglass') continue;
        const next = safely(() => craftRecipe(content, save, recipe.id));
        if (!next) continue;
        noteSpend(save, next);
        crafted[recipe.id] = (crafted[recipe.id] ?? 0) + 1;
        save = next;
        made = true;
      }
      if (!made) break;
    }

    // 파견 → 모래시계로 당기기 → 귀환 정산 — 모래시계가 남아 있는 한 반복.
    // 순서가 중요하다: 파견 전에 쓰려 하면 대상이 없어 한 개도 소모되지 않는다.
    const hour = Math.floor((t % DAY_MS) / 3600_000);
    const tier: 'scout' | 'standard' | 'deep' = hour >= 22 || hour < 6 ? 'deep' : 'standard';
    const dispatch = (): boolean => {
      let sent = false;
      while (save.expeditions.filter((e) => !e.claimed).length < teamCount(content, save)) {
        const party = pickParty(save, save.profile.partySlots);
        if (party.length === 0) break;
        const arts = pickArtifacts(save);
        const unlocked = content.regionList.filter((r) => isRegionUnlocked(content, save, r.id));
        let region = unlocked[0]!;
        for (const r of unlocked) if (powerOf(save, party, arts, r.id, tier) >= r.recommendedCp * strategy.safety) region = r;
        let result;
        try {
          result = createExpedition(content, save, { regionId: region.id, tier, partyIds: party, artifactIds: arts }, ctx);
        } catch (error) {
          if (error instanceof GameError) break;
          throw error;
        }
        save = result.save;
        sent = true;
        const power = powerOf(save, party, arts, region.id, tier);
        const choice = power >= region.recommendedCp * strategy.riskyAt ? 'risky' : 'safe';
        for (let i = 0; i < result.expedition.choices.length; i++) save = chooseCrossroad(save, result.expedition.id, i, choice);
      }
      return sent;
    };

    for (let round = 0; round < 60; round++) {
      const sent = dispatch();
      // 큰 모래시계부터, 남은 시간이 긴 원정에 — 남은 시간의 절반 미만짜리는 낭비라 쓰지 않는다
      let used = false;
      for (const hourglass of [...content.hourglasses.values()].sort((a, b) => b.minutes - a.minutes)) {
        for (let guard = 0; guard < 200; guard++) {
          if ((save.wallet.hourglasses[hourglass.id] ?? 0) <= 0) break;
          const target = save.expeditions.filter((e) => !e.claimed && e.endsAt > t).sort((a, b) => b.endsAt - a.endsAt)[0];
          if (!target) break;
          if (target.endsAt - t < hourglass.minutes * 60_000 * 0.5) break;
          const next = safely(() => useHourglass(content, save, target.id, hourglass.id, t).save);
          if (!next) break;
          save = next;
          hourglassMinutes += hourglass.minutes;
          used = true;
        }
      }
      claimDue(t);
      if (!sent && !used) break;
    }
  }

  const stock: Record<string, number> = {};
  for (const m of MATS) stock[m.id] = save.wallet.materials[m.id] ?? 0;
  return { label: strategy.label, income, spent, stock, crafted, runs, hourglassMinutes };
}

console.log(`\n=== C. ${DAYS}일 시뮬 실측${USE_SHOP ? '' : ' (상점 구매 없음)'} ===`);
for (const strategy of STRATEGIES) {
  const result = audit(strategy);
  console.log(`\n▶ ${result.label} — 런 ${result.runs}회 · 모래시계로 당긴 시간 ${(result.hourglassMinutes / 60).toFixed(0)}시간`);
  console.log(`  ${padE('재료', 16)} ${pad('수급', 7)} ${pad('소비', 7)} ${pad('잔고', 7)} ${pad('소비율', 7)}   잔고 증가`);
  for (const mat of MATS) {
    const inc = result.income[mat.id] ?? 0;
    const sp = result.spent[mat.id] ?? 0;
    const st = result.stock[mat.id] ?? 0;
    const rate = inc > 0 ? sp / inc : 0;
    const perDay = st / DAYS;
    const bar = '#'.repeat(Math.min(40, Math.round(perDay / 2)));
    console.log(`  ${padE(`${mat.icon}${mat.name}`, 16)} ${pad(inc, 7)} ${pad(sp, 7)} ${pad(st, 7)} ${pad(`${(rate * 100).toFixed(0)}%`, 7)}   ${bar} ${perDay.toFixed(1)}/일`);
  }
  const madeList = Object.entries(result.crafted)
    .map(([id, n]) => `${content.recipes.get(id)!.name} ${n}`)
    .join(' · ');
  console.log(`  제작: ${madeList || '없음'}`);
}
console.log('');
