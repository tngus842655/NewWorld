/**
 * 티어별 권장 CP 계측 (검토 ①, 2026-08-30 · 2026-09-02 기준 개정) — "전멸률 0.1% 이하" 기준.
 * 실행: npx tsx scripts/recommend-cp.ts [--seeds 20000] [--write]
 *   --write : regions.json의 recommendedCpTier를 산출값으로 갱신한다 (그 외에는 표만 출력)
 *
 * 정의 (사용자 확정 "전멸 0"의 실현 형태 — 2026-09-02 개정):
 * - 정찰/조사/탐사: 표본 시드에서 전멸률이 0.1% 이하(2만 시드 중 20건 이하)가 되는 최소 파티 전투력(유효 CP)을 이분 탐색.
 * - 원정(deep): **전설 조우 제외** 같은 기준. 전설 포함 무전멸은 어떤 CP로도 불가능하다 —
 *   전설 패배는 고정 0.5 피해(min(ratio,2)×0.25)이고 함정(0.1 고정)이 CP와 무관하게 쌓이므로,
 *   전설 1회 + 함정 5회 조합의 잔존 확률이 CP로 지워지지 않는다. 전설 조우(기본 2%)는
 *   디자인상 의도된 리스크(회생 유물·잔여 HP 관리 영역)로 두고 권장 CP 범위에서 뺀다.
 *
 * 왜 "표본 전멸 0"에서 "0.1% 이하"로 바꿨나 (2026-09-02, docs/NEXT-REGION-DIFFICULTY.md §2·§8-4):
 *   "2만 시드 전멸 0"은 극값 추정기라 시드 꼬리 1~2건(함정 연쇄)이 값을 결정했다 — 가라앉은 늪 원정 5,100이 이웃
 *   이탄늪 3,900(스폰은 더 강함)보다 높고, 분화구 13,000이 협곡 6,300의 2배로 뛰는 역전이 그 흔적.
 *   0.1% 분위는 같은 표본에서 20건이 결정하므로 안정적이고, 값은 구 기준의 0.6~0.75배로 내려온다.
 *   "권장이면 전멸 걱정 없음"이라는 취지는 0.1%로 유지된다. 난이도(GDD §5.1)는 이 값에 적 배수를 곱해 표기한다.
 *
 * 모델: buildPlan(core/expedition.ts)의 피해 관련 분포를 미러링한다 — 조우 구성(encounterMix),
 * 스폰 가중(rareWeightMult 포함), 함정 고정 피해, resolveClash/enemyPower는 실코어 함수 사용.
 * 유물·효과 없음(중립 파티) 가정, 갈림길은 안전 선택(피해 0), 난이도 보통. 캡처·보상은 HP와 무관해 생략.
 * ⚠️ combat/buildPlan 밸런스가 바뀌면 이 미러도 함께 재검토할 것.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent, type Content } from '../src/content';
import type { Region, Tier } from '../src/content/schema';
import { enemyPower, resolveClash } from '../src/core/combat';
import { pickWeighted, streamRng } from '../src/core/rng';

const content: Content = loadContent();
const args = process.argv.slice(2);
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 20_000) || 20_000;
const WRITE = args.includes('--write');
/** 허용 전멸률 — 20k 시드 기준 20건 */
const MAX_WIPE_RATE = 0.001;
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

function wipeRate(region: Region, tier: Tier, partyPower: number, seeds: number): number {
  let wipes = 0;
  for (let i = 0; i < seeds; i++) {
    if (runOnce(region, tier, partyPower, `s${i}`)) wipes++;
  }
  return wipes / seeds;
}

/** 전멸률이 MAX_WIPE_RATE 이하가 되는 최소 CP — 전멸률은 CP에 단조 감소라 이분 탐색 가능 */
function thresholdCp(region: Region, tier: Tier): number {
  let lo = 10;
  let hi = 40_000;
  if (wipeRate(region, tier, hi, 4_000) > MAX_WIPE_RATE) throw new Error(`상한 초과: ${region.id} ${tier}`);
  while (hi - lo > Math.max(1, lo * 0.01)) {
    const mid = Math.round((lo + hi) / 2);
    if (wipeRate(region, tier, mid, 4_000) > MAX_WIPE_RATE) lo = mid;
    else hi = mid;
  }
  // 최종 검증은 큰 표본으로 — 통과할 때까지 2%씩 상향
  let candidate = hi;
  while (wipeRate(region, tier, candidate, SEEDS) > MAX_WIPE_RATE) candidate = Math.round(candidate * 1.02);
  return candidate;
}

/** 표기용 반올림 — 두 자리 유효숫자 위로 */
function roundUp(value: number): number {
  const unit = Math.pow(10, Math.max(1, Math.floor(Math.log10(value)) - 1));
  return Math.ceil(value / unit) * unit;
}

const TIERS_ORDER: Tier[] = ['scout', 'standard', 'extended', 'deep'];
console.log(`seeds=${SEEDS} · 기준: 전멸률 ≤ ${MAX_WIPE_RATE * 100}% (전설 제외, 중립 파티, 갈림길 안전)`);
console.log('region            base   scout standard extended  deep   (구 값)');
const result: Record<string, Record<Tier, number>> = {};
for (const region of content.regionList) {
  const row: number[] = [];
  let floor = 0;
  for (const tier of TIERS_ORDER) {
    // 티어 단조 증가 보정 — 표본 노이즈로 역전되면 앞 티어 값으로 올린다
    const raw = roundUp(thresholdCp(region, tier));
    floor = Math.max(floor, raw);
    row.push(floor);
  }
  result[region.id] = { scout: row[0]!, standard: row[1]!, extended: row[2]!, deep: row[3]! };
  const old = TIERS_ORDER.map((t) => region.recommendedCpTier[t]).join('/');
  console.log(
    `${region.id.padEnd(16)} ${String(region.recommendedCp).padStart(5)} ${row.map((v) => String(v).padStart(8)).join('')}   (${old})`,
  );
}

if (WRITE) {
  // regions.json은 손으로 관리하는 파일이라 전체를 다시 직렬화하지 않고 recommendedCpTier 객체만 치환한다
  const file = path.resolve(process.cwd(), 'src/content/data/regions.json'); // 저장소 루트에서 실행하는 관례 (tsx ESM에는 __dirname이 없다)
  let text = fs.readFileSync(file, 'utf8');
  for (const region of content.regionList) {
    const r = result[region.id]!;
    const pattern = new RegExp(`("id":\\s*"${region.id}"[\\s\\S]*?"recommendedCpTier":\\s*)\\{[^}]*\\}`);
    if (!pattern.test(text)) throw new Error(`recommendedCpTier 블록을 찾지 못함: ${region.id}`);
    // 파일의 기존 서식(6칸 들여쓰기, 한 줄에 한 키)을 그대로 따른다
    text = text.replace(pattern, `$1{\n      "scout": ${r.scout},\n      "standard": ${r.standard},\n      "extended": ${r.extended},\n      "deep": ${r.deep}\n    }`);
  }
  fs.writeFileSync(file, text);
  console.log(`regions.json recommendedCpTier ${content.regionList.length}개 지역 갱신`);
}
