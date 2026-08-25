/**
 * 시뮬레이터 봇 — simulate.ts와 unlock-sweep.ts가 공유하는 플레이어 모델.
 *
 * simulate.ts에 있던 봇 로직을 그대로 옮기고 `content`만 인자로 뺐다.
 * 해금 조건을 바꿔가며 재려면 loadContent()로 새 콘텐츠를 만들어 넘겨야 하기 때문이다.
 * 동작은 이전과 동일하다 — 추가된 것은 게이트 관측(codexReadyDay/materialReadyDay)뿐이고,
 * 이건 읽기만 할 뿐 봇의 선택을 바꾸지 않는다.
 */
import type { Content } from '../src/content';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import { canCheckIn, checkIn } from '../src/core/attendance';
import { awakenMonster, buyPartySlot, craftRecipe, enhanceArtifact, levelUpMonster, unlockRegion } from '../src/core/economy';
import { monsterLevelUpCost, monsterStarUpCost } from '../src/core/formulas';
import { chooseCrossroad, claimExpedition, createExpedition, useHourglass } from '../src/core/expedition';
import { createInitialSave } from '../src/core/newgame';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock, teamCount } from '../src/core/progression';
import { buyShopProduct } from '../src/core/shop';
import { GameError, type CoreCtx, type SaveState } from '../src/core/types';

export interface Strategy {
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

export const STRATEGIES: Strategy[] = [
  { name: 'hardcore', label: '하드코어(2시간마다)', checkHours: [8, 10, 12, 14, 16, 18, 20, 22], riskyAt: 1.0, safety: 0.7, spendRatio: 1.0, craftLures: true, enhance: true },
  { name: 'normal', label: '보통(하루 4회)', checkHours: [8, 12, 19, 23], riskyAt: 1.5, safety: 0.85, spendRatio: 0.6, craftLures: true, enhance: true },
  { name: 'idle', label: '방치(하루 2회)', checkHours: [8, 22], riskyAt: Infinity, safety: 1.0, spendRatio: 0.3, craftLures: false, enhance: false },
];

export const DAY_MS = 86_400_000;

export interface DayRow {
  day: number;
  gold: number;
  captured: number;
  topCp: number;
  wipes: number;
  runs: number;
  unlocked: string;
  byRegion: Record<string, number>; // 지역별 도감 수 (업적 계단 도달 측정)
  partySlots: number; // 그날 말 파티 슬롯 (2026-08-25 슬롯 게이트 계측)
}

/**
 * 슬롯 게이트 관측 (2026-08-25) — 지역 해금의 codexReadyDay/materialReadyDay와 같은 방식.
 * 도감·골드 조건의 충족 일차를 따로 남겨, 둘 중 무엇이 실제 제동인지 판별한다.
 */
export interface SlotGateObs {
  codexDay?: number; // totalCaptured 조건을 처음 만족한 일차
  goldDay?: number; // gold 조건을 처음 만족한 일차 (그 시점 보유 골드 기준)
  buyDay?: number; // 실제로 구매한 일차
  capturedAtBuy?: number; // 구매 시점 도감 종 수
}

export interface SimResult {
  strategy: string;
  label: string;
  days: DayRow[];
  unlockDay: Record<string, number>;
  /** 슬롯 칸수 → 게이트 관측 (scripts/slot-sweep.ts) */
  slotGate: Record<number, SlotGateObs>;
  /** 도감 조건만 따로 충족된 일차 — 게이트 중 무엇이 병목인지 보려고 */
  codexReadyDay: Record<string, number>;
  /** 재료 조건만 따로 충족된 일차 */
  materialReadyDay: Record<string, number>;
  totals: { runs: number; wipes: number; artifacts: number; legendarySeen: boolean };
  /** 과금 구간 추정용 — 기본 경로에서는 전부 0 */
  spend: {
    diamondsGranted: number;
    diamondsSpent: number;
    hourglassMinutes: number;
    /** 상품 id → 구매 횟수 */
    purchases: Record<string, number>;
    /** 뽑기로 도감에 새로 등록된 종 수 */
    gachaNewSpecies: number;
  };
}

export interface SimOptions {
  days: number;
  /** 도감 우선 파견 — 감당 가능한 지역 중 24종 미달인 가장 앞 지역을 돈다 */
  codexMode?: boolean;
  /**
   * 아래는 전부 기본 off — 켜지 않으면 기존 simulate.ts 출력과 완전히 동일하다.
   * 과금 구간 추정(scripts/spend-sim.ts)에서만 켠다.
   */
  /** 골드 상점을 일일 한도까지 이용 (미끼·재료 꾸러미·모래시계) */
  useGoldShop?: boolean;
  /** 미끼를 팀 수 × maxLoad 만큼 확보 — 기본(false)은 3개 고정이라 2군부터 맨몸으로 나간다 */
  lurePerTeam?: boolean;
  /** 보유 모래시계를 진행 중 원정에 사용 */
  useHourglasses?: boolean;
  /** 월간 출석 — 골드 19,000·가루 520·미끼 10·다이아 160/월. 다이아의 v1 유일 획득처다 */
  checkInDaily?: boolean;
  /** 남는 재료를 모래시계로 세공 — 일일 한도가 없는 유일한 재료→시간 전환로 */
  craftHourglasses?: boolean;
  /** 유료 충전 다이아 (출석분은 checkInDaily가 따로 준다) */
  diamonds?: { initial: number; perDay: number };
  /** 다이아 사용처: time=모래시계 우선 · codex=고급 뽑기 우선(도감을 직접 찍는다) */
  spendPolicy?: 'time' | 'codex';
  /** 시드 소금 — 같은 설정을 여러 시드로 돌려 노이즈를 평균낼 때 쓴다 (기본 빈 문자열 = 기존 시드) */
  seedSalt?: string;
}

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

/** 슬롯별 최고 유물 선택 (등급 → 강화 순) — v6 종 단위: 진행 원정 사용분은 개수에서 차감 */
function pickArtifacts(content: Content, save: SaveState): string[] {
  const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, heroic: 3, legendary: 4 };
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

/** CP 상위 + 같은 종족 뭉치기 휴리스틱으로 파티 선택 */
function pickParty(content: Content, save: SaveState, slots: number): string[] {
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

function partyPowerOf(
  content: Content,
  save: SaveState,
  partyIds: string[],
  artifactUids: string[],
  regionId: string,
  tier: 'scout' | 'standard' | 'deep',
): number {
  const region = content.regions.get(regionId)!;
  const fx = collectTeamEffects(content, save, partyIds, artifactUids);
  const party = partyIds.map((id) => save.roster.find((m) => m.monsterId === id)!);
  return computePartyPower(content, fx.effects, party, region, tier).total;
}

export function simulate(content: Content, strategy: Strategy, opts: SimOptions): SimResult {
  const { days: DAYS, codexMode = false } = opts;
  const spend = { diamondsGranted: 0, diamondsSpent: 0, hourglassMinutes: 0, purchases: {} as Record<string, number>, gachaNewSpecies: 0 };
  const { ctx, set } = makeCtx(strategy.name + (opts.seedSalt ?? ''));
  set(0);
  let save = createInitialSave(content, ctx);
  save.profile.tutorialDone = true; // 시뮬은 튜토리얼 압축 없이

  const unlockDay: Record<string, number> = { 'misty-coast': 0 };
  const codexReadyDay: Record<string, number> = {};
  const materialReadyDay: Record<string, number> = {};
  const slotGate: Record<number, SlotGateObs> = {};
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

    // 0) 월간 출석 — 다이아만이 아니라 골드 19,000/월이 목적이다
    if (opts.checkInDaily && canCheckIn(save, t)) save = checkIn(content, save, t).save;

    // 1) 귀환 정산
    for (const expedition of [...save.expeditions]) {
      if (expedition.claimed || expedition.endsAt > t) continue;
      const result = claimExpedition(content, save, expedition.id, ctx);
      save = result.save;
      goldEarned += result.journal.totals.gold;
      runs++;
      if (result.journal.wiped) wipes++;
    }

    // 1-b) 게이트 관측 — 도감 조건과 재료 조건이 각각 언제 채워지는지 (봇 행동은 바꾸지 않는다)
    {
      const day = Math.floor(t / DAY_MS) + 1;
      const counts = capturedCounts(content, save);
      for (const region of content.regionList) {
        if (isRegionUnlocked(content, save, region.id)) continue;
        const codexOk = Object.entries(region.unlock.codexCaptured ?? {}).every(
          ([id, n]) => (counts.byRegion.get(id) ?? 0) >= n,
        );
        const matOk = Object.entries(region.unlock.materials ?? {}).every(
          ([id, n]) => (save.wallet.materials[id] ?? 0) >= n,
        );
        if (codexOk && codexReadyDay[region.id] === undefined) codexReadyDay[region.id] = day;
        if (matOk && materialReadyDay[region.id] === undefined) materialReadyDay[region.id] = day;
      }
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

    // 3) 슬롯 구매 — 두 조건의 충족 일차를 따로 기록한다 (무엇이 제동인지 판별)
    {
      const pending = nextPartySlotUnlock(content, save);
      if (pending) {
        const day = Math.floor(t / DAY_MS) + 1;
        const obs = (slotGate[pending.slots] ??= {});
        const captured = capturedCounts(content, save).total;
        if (obs.codexDay === undefined && captured >= pending.totalCaptured) obs.codexDay = day;
        if (obs.goldDay === undefined && save.wallet.gold >= pending.gold) obs.goldDay = day;
        const next = safely(() => buyPartySlot(content, save));
        if (next) {
          save = next;
          obs.buyDay = day;
          obs.capturedAtBuy = captured;
        }
      }
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

    // 4-b) 재화 지급·소비 (옵션) — 기본 경로에서는 통째로 건너뛴다
    if (opts.diamonds) {
      const isDayStart = strategy.checkHours[0] === Math.floor((t % DAY_MS) / 3600_000);
      const grant = t === checkpoints[0] ? opts.diamonds.initial + opts.diamonds.perDay : isDayStart ? opts.diamonds.perDay : 0;
      if (grant > 0) {
        save = { ...save, wallet: { ...save.wallet, diamonds: save.wallet.diamonds + grant } };
        spend.diamondsGranted += grant;
      }
    }
    if (opts.useGoldShop || opts.diamonds) {
      const buy = (productId: string): boolean => {
        const product = content.shopProducts.find((p) => p.id === productId);
        if (!product) return false;
        try {
          const result = buyShopProduct(content, save, { productId }, ctx);
          if (product.shop === 'diamond') spend.diamondsSpent += product.price;
          if (result.granted.isNewMonster) spend.gachaNewSpecies++;
          save = result.save;
          spend.purchases[productId] = (spend.purchases[productId] ?? 0) + 1;
          return true;
        } catch (error) {
          if (error instanceof GameError) return false;
          throw error;
        }
      };
      const drain = (productId: string, max: number): void => {
        for (let i = 0; i < max; i++) if (!buy(productId)) break;
      };
      const lureGoal = opts.lurePerTeam ? teamCount(content, save) * content.balance.lures.maxLoad : 3;

      if (opts.useGoldShop) {
        // 골드는 남아도는 재화라(시뮬 하드코어 D5에 33만) 일일 한도까지 쓰는 것이 정상 플레이다
        if (save.wallet.lures < lureGoal) drain('gold-lure', 3);
        drain('gold-materials', 2);
        drain('gold-hourglass-480', 1);
        drain('gold-hourglass-240', 1);
        drain('gold-hourglass-120', 2);
        drain('gold-hourglass-60', 2);
        drain('gold-hourglass-15', 3);
        // 도감을 직접 찍는 골드 뽑기 — 해금 게이트가 도감이라 이게 시간 단축보다 직접적이다
        drain('gold-monster-gacha', 1);
        drain('gold-artifact-gacha', 1);
        drain('gold-dust', 2);
      }
      if (opts.diamonds || opts.checkInDaily) {
        const policy = opts.spendPolicy ?? 'time';
        // 골드로 살 수 있는 것(미끼·골드)에 다이아를 쓰는 건 낭비다. 골드 상점을 쓰는 봇은 건너뛴다
        if (!opts.useGoldShop) {
          buy('dia-starter');
          for (let i = 0; i < 8 && save.wallet.lures < lureGoal; i++) if (!buy('dia-lures')) break;
        }
        // codex 정책: 다이아를 모아 고급 뽑기(희귀 이상 확정)에 먼저 쓴다 — 게이트가 도감이므로
        if (policy === 'codex') {
          for (let i = 0; i < 60; i++) if (!buy('dia-monster-gacha-premium')) break;
        }

        // 모래시계는 분/다이아가 480분(19.2) > 240(15) > 120(12) > 60(10) > 15(7.5) 순으로 큰 것이 싸지만,
        // 남은 시간보다 큰 모래시계는 잘려서 낭비된다(accelerateExpedition의 clamp).
        // 그래서 "지금 내보내는 티어 길이 이하"의 가장 큰 것을 산다.
        const nowHour = Math.floor((t % DAY_MS) / 3600_000);
        const tierMinutes = nowHour >= 22 || nowHour < 6 ? content.balance.tiers.deep.minutes : content.balance.tiers.standard.minutes;
        const best = [...content.hourglasses.values()].filter((h) => h.minutes <= tierMinutes).sort((a, b) => b.minutes - a.minutes)[0];
        const hourglassProduct = best
          ? content.shopProducts.find((p) => p.shop === 'diamond' && p.goods.kind === 'hourglass' && p.goods.hourglassId === best.id)
          : undefined;
        // 이번 체크포인트에 실제로 소화 가능한 만큼만 (팀 수 × 라운드 여유). 남으면 다음 체크포인트로 이월된다
        if (hourglassProduct) {
          const absorb = teamCount(content, save) * 8;
          for (let i = 0; i < absorb; i++) if (!buy(hourglassProduct.id)) break;
        }
        // 남는 다이아는 도감을 직접 찍는 고급 뽑기로 (희귀 이상 확정 — 도감 tail이 곧 게이트다)
        for (let i = 0; i < 60; i++) if (!buy('dia-monster-gacha-premium')) break;
      }
    }

    // 5) 미끼 제작 (기본 미끼만, 보유 3개 미만일 때)
    if (strategy.craftLures) {
      const lureGoal = opts.lurePerTeam ? teamCount(content, save) * content.balance.lures.maxLoad : 3;
      while (save.wallet.lures < lureGoal) {
        // 기본 경로는 기본 미끼만 (기존 동작 보존). 팀별 확보 모드에서만 꾸러미도 쓴다
        const next =
          safely(() => craftRecipe(content, save, 'basic-lure')) ??
          (opts.lurePerTeam ? safely(() => craftRecipe(content, save, 'lure-bundle')) : null);
        if (!next) break;
        save = next;
      }
    }

    // 5-b) 모래시계 세공 — 재료 레시피에는 일일 한도가 없다. 상점 캡을 넘는 유일한 골드→시간 전환로.
    //
    // ⚠️ 함정: 세공은 **다음 지역 해금에 쓸 재료와 같은 풀**을 먹는다. 아무 생각 없이 다 만들면
    // 해금 재료가 계속 0으로 깎여 화산이 D7 → D19로 밀린다(실측). 그래서 잠긴 지역이 요구하는
    // 만큼은 남겨두고 그 위로만 세공한다.
    if (opts.craftHourglasses) {
      const reserved: Record<string, number> = {};
      for (const region of content.regionList) {
        if (isRegionUnlocked(content, save, region.id)) continue;
        for (const [materialId, count] of Object.entries(region.unlock.materials ?? {})) {
          reserved[materialId] = Math.max(reserved[materialId] ?? 0, count);
        }
      }
      for (let guard = 0; guard < 200; guard++) {
        let made = false;
        for (const recipe of content.recipes.values()) {
          if (recipe.output.kind !== 'hourglass') continue;
          const wouldStarve = Object.entries(recipe.cost.materials).some(
            ([materialId, count]) => (save.wallet.materials[materialId] ?? 0) - count < (reserved[materialId] ?? 0),
          );
          if (wouldStarve) continue;
          const next = safely(() => craftRecipe(content, save, recipe.id));
          if (!next) continue;
          save = next;
          made = true;
        }
        if (!made) break;
      }
    }

    // 6) 유물 강화 (최고 등급 착용분 위주)
    if (strategy.enhance) {
      for (const uid of pickArtifacts(content, save)) {
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
    const dispatchAll = (): boolean => {
    let sent = false;
    while (save.expeditions.filter((e) => !e.claimed).length < teamCount(content, save)) {
      const party = pickParty(content, save, save.profile.partySlots);
      if (party.length === 0) break;
      const artifacts = pickArtifacts(content, save);

      const unlocked = content.regionList.filter((r) => isRegionUnlocked(content, save, r.id));
      let region = unlocked[0]!;
      for (const r of unlocked) {
        const power = partyPowerOf(content, save, party, artifacts, r.id, tier);
        if (power >= r.recommendedCp * strategy.safety) region = r;
      }
      // 도감 우선 모드(--codex): 감당 가능한 지역 중 24종 미달인 가장 앞 지역을 돈다 (실유저의 도감 채우기 행동)
      if (codexMode) {
        const counts = capturedCounts(content, save);
        const target = unlocked.find(
          (r) =>
            (counts.byRegion.get(r.id) ?? 0) < 24 &&
            partyPowerOf(content, save, party, artifacts, r.id, tier) >= r.recommendedCp * strategy.safety,
        );
        if (target) region = target;
      }

      const result = (() => {
        try {
          return createExpedition(content, save, { regionId: region.id, tier, partyIds: party, artifactIds: artifacts }, ctx);
        } catch (error) {
          if (error instanceof GameError) return null;
          throw error;
        }
      })();
      if (!result) break;
      save = result.save;
      sent = true;

      // 갈림길 선택
      const power = partyPowerOf(content, save, party, artifacts, region.id, tier);
      const choice = power >= region.recommendedCp * strategy.riskyAt ? 'risky' : 'safe';
      for (let i = 0; i < result.expedition.choices.length; i++) {
        save = chooseCrossroad(save, result.expedition.id, i, choice);
      }
    }
    return sent;
    };
    dispatchAll();

    // 7-b) 모래시계 사용 (옵션) — 파견 뒤에 써야 대상이 있다. 큰 것부터, 남은 시간의 절반 미만이면 낭비라 안 쓴다.
    // 가속 → 정산 → 재파견이 한 체크포인트 안에서 맞물리므로 라운드를 돌린다.
    if (opts.useHourglasses) {
      for (let round = 0; round < 60; round++) {
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
            spend.hourglassMinutes += hourglass.minutes;
            used = true;
          }
        }
        for (const expedition of [...save.expeditions]) {
          if (expedition.claimed || expedition.endsAt > t) continue;
          const result = claimExpedition(content, save, expedition.id, ctx);
          save = result.save;
          goldEarned += result.journal.totals.gold;
          runs++;
          if (result.journal.wiped) wipes++;
        }
        const sent = dispatchAll();
        if (!used && !sent) break;
      }
    }

    // 일말 기록
    const dayIdx = Math.floor(t / DAY_MS);
    const isLastCheckOfDay = strategy.checkHours[strategy.checkHours.length - 1] === hour;
    if (isLastCheckOfDay) {
      const counts = capturedCounts(content, save);
      const party = pickParty(content, save, 3);
      const topCp =
        party.length > 0 ? Math.round(partyPowerOf(content, save, party, pickArtifacts(content, save), 'misty-coast', 'standard')) : 0;
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
        partySlots: save.profile.partySlots,
      });
    }
  }

  return {
    strategy: strategy.name,
    label: strategy.label,
    days,
    unlockDay,
    slotGate,
    codexReadyDay,
    materialReadyDay,
    spend,
    totals: {
      runs,
      wipes,
      artifacts: save.artifacts.length,
      legendarySeen: Object.entries(save.codex).some(([id, c]) => c.seen && content.monsters.get(id)?.rarity === 'legendary'),
    },
  };
}
