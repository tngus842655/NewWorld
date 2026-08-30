/**
 * 티어별 권장 CP 계측 (검토 ①, 2026-08-30) — "전멸 0" 기준.
 * 실행: npx tsx scripts/recommend-cp.ts [seeds]
 *
 * 정의 (사용자 확정 "전멸 0"의 실현 형태):
 * - 정찰/조사/탐사: 표본 시드 전수에서 전멸 0이 되는 최소 파티 전투력(유효 CP)을 이분 탐색.
 * - 원정(deep): **전설 조우 제외** 전멸 0. 전설 포함 무전멸은 어떤 CP로도 불가능하다 —
 *   전설 패배는 고정 0.5 피해(min(ratio,2)×0.25)이고 함정(0.1 고정)이 CP와 무관하게 쌓이므로,
 *   전설 1회 + 함정 5회 조합의 잔존 확률이 CP로 지워지지 않는다. 전설 조우(기본 2%)는
 *   디자인상 의도된 리스크(회생 유물·잔여 HP 관리 영역)로 두고 권장 CP 범위에서 뺀다.
 *
 * 모델: buildPlan(core/expedition.ts)의 피해 관련 분포를 미러링한다 — 조우 구성(encounterMix),
 * 스폰 가중(rareWeightMult 포함), 함정 고정 피해, resolveClash/enemyPower는 실코어 함수 사용.
 * 유물·효과 없음(중립 파티) 가정, 갈림길은 안전 선택(피해 0). 캡처·보상은 HP와 무관해 생략.
 * ⚠️ combat/buildPlan 밸런스가 바뀌면 이 미러도 함께 재검토할 것.
 */
import { loadContent, type Content } from '../src/content';
import type { Region, Tier } from '../src/content/schema';
import { enemyPower, resolveClash } from '../src/core/combat';
import { pickWeighted, streamRng } from '../src/core/rng';

const content: Content = loadContent();
const SEEDS = Number(process.argv[2] ?? 20_000);
const KINDS = ['monster', 'treasure', 'trap', 'gather'] as const;

/** 한 시드의 원정에서 전멸 여부 — 피해 경로만 재현 (전설 제외) */
function runOnce(region: Region, tier: Tier, partyPower: number, seed: string): boolean {
  const tierDef = content.balance.tiers[tier];
  const rng = streamRng(seed, `reccp:${region.id}:${tier}`);
  const rareMult = tierDef.rareWeightMult;
  let hp = 1;
  for (let i = 0; i < tierDef.encounters; i++) {
    const kind = pickWeighted(rng, KINDS, (k) => region.encounterMix[k]);
    if (kind === 'monster') {
      const spawn = pickWeighted(rng, region.spawns, (s) => {
        const monster = content.monsters.get(s.monster)!;
        return monster.rarity === 'rare' || monster.rarity === 'heroic' ? s.weight * rareMult : s.weight;
      });
      const monster = content.monsters.get(spawn.monster)!;
      const outcome = resolveClash(content, partyPower, enemyPower(content, monster), 0, 0);
      hp -= outcome.damage;
    } else if (kind === 'trap') {
      hp -= content.balance.combat.trapDamage;
    }
    if (hp <= 0) return true;
  }
  return false;
}

function wipeCount(region: Region, tier: Tier, partyPower: number, seeds: number): number {
  let wipes = 0;
  for (let i = 0; i < seeds; i++) {
    if (runOnce(region, tier, partyPower, `s${i}`)) wipes++;
  }
  return wipes;
}

/** 표본 전멸 0이 되는 최소 CP — 전멸률은 CP에 단조 감소라 이분 탐색 가능 */
function zeroWipeCp(region: Region, tier: Tier): number {
  let lo = 10;
  let hi = 40_000;
  if (wipeCount(region, tier, hi, 4_000) > 0) throw new Error(`상한 초과: ${region.id} ${tier}`);
  while (hi - lo > Math.max(1, lo * 0.01)) {
    const mid = Math.round((lo + hi) / 2);
    if (wipeCount(region, tier, mid, 4_000) > 0) lo = mid;
    else hi = mid;
  }
  // 최종 검증은 큰 표본으로 — 통과할 때까지 2%씩 상향
  let candidate = hi;
  while (wipeCount(region, tier, candidate, SEEDS) > 0) candidate = Math.round(candidate * 1.02);
  return candidate;
}

/** 표기용 반올림 — 두 자리 유효숫자 위로 */
function roundUp(value: number): number {
  const unit = Math.pow(10, Math.max(1, Math.floor(Math.log10(value)) - 1));
  return Math.ceil(value / unit) * unit;
}

const TIERS_ORDER: Tier[] = ['scout', 'standard', 'extended', 'deep'];
console.log(`seeds=${SEEDS}`);
console.log('region            base   scout standard extended  deep');
for (const region of content.regionList) {
  const row: number[] = [];
  let floor = 0;
  for (const tier of TIERS_ORDER) {
    // 티어 단조 증가 보정 — 표본 노이즈로 역전되면 앞 티어 값으로 올린다
    const raw = roundUp(zeroWipeCp(region, tier));
    floor = Math.max(floor, raw);
    row.push(floor);
  }
  console.log(
    `${region.id.padEnd(16)} ${String(region.recommendedCp).padStart(5)} ${row.map((v) => String(v).padStart(8)).join('')}`,
  );
}
