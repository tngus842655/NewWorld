/**
 * 뽑기·발굴 리빌 연출 (2026-08-29 사용자 — "토스트 알림은 성의없다, 가운데서 ~3초 긴장 후 짠!").
 * 카드 뒷면이 중앙에서 점점 크게 떨리다(2.6초, 후반에 등급색 오라가 미리 새어나온다)
 * 섬광과 함께 터지며 결과가 튀어나온다. 긴장 중 탭 = 스킵 즉시 공개, 공개 후 탭 = 닫기.
 * 10연은 결과가 5×2 그리드로 차례로 쏟아지고, 오라는 최고 등급 색을 미리 태운다.
 * 다이얼로그(dialog.ts)와 같은 최상위 독립 레이어 — 상점 시트 위에 뜬다.
 */
import { content } from '../content';
import { RARITY_LABEL, type MonsterRarity } from '../content/schema';
import { artifactIcon, monsterIcon } from './components';
import { RARITY_ORDER, el } from './kit';
import { playSfx, type SfxId } from './sfx';

export type GachaRevealPayload =
  | { kind: 'monster'; results: { monsterId: string; isNew: boolean }[] }
  | { kind: 'artifact'; itemIds: string[] };

const SUSPENSE_MS = 2600; // 긴장 구간 — 사용자 주문 "한 3초 정도 뒤에 짠!" (섬광 포함 총 ~3초)
const BURST_MS = 380; // 섬광 → 결과 등장까지

/** 등급별 오라 — 희귀 미만은 무채색 (토스트·아이콘과 같은 '희귀 이상만 연출' 원칙, 색은 --rar-*와 동일) */
function auraOf(rarity: MonsterRarity): { glow: string; spark: string } {
  if (RARITY_ORDER[rarity] < RARITY_ORDER.rare) return { glow: 'rgba(220, 226, 240, 0.20)', spark: '#dce2f0' };
  return {
    rare: { glow: 'rgba(74, 163, 255, 0.5)', spark: '#4aa3ff' },
    heroic: { glow: 'rgba(182, 120, 255, 0.5)', spark: '#b678ff' },
    legendary: { glow: 'rgba(255, 165, 61, 0.5)', spark: '#ffa53d' },
    transcendent: { glow: 'rgba(255, 45, 79, 0.55)', spark: '#ff2d4f' },
  }[rarity as Exclude<MonsterRarity, 'common' | 'uncommon'>];
}

interface RevealInfo {
  topRarity: MonsterRarity; // 오라·스파크 색 — 여러 장이면 최고 등급
  sfx: SfxId;
  count: number;
  body: (HTMLElement | null)[];
}

function monsterSingleInfo(result: { monsterId: string; isNew: boolean }): RevealInfo {
  const monster = content.monsters.get(result.monsterId)!;
  return {
    topRarity: monster.rarity,
    sfx: result.isNew ? 'capture-new' : 'treasure',
    count: 1,
    body: [
      monsterIcon(result.monsterId),
      el(`div.gacha-result-name.rar-name.rar-${monster.rarity}`, {}, monster.name),
      el('div.gacha-result-sub', {}, `[${RARITY_LABEL[monster.rarity]} 몬스터 카드]`),
      el('div.gacha-result-badge', {}, result.isNew ? '✨ 도감 신규 등록!' : '보유 카드 +1 [합성 재료]'),
    ],
  };
}

function monsterMultiInfo(results: { monsterId: string; isNew: boolean }[]): RevealInfo {
  const monsters = results.map((r) => ({ ...r, def: content.monsters.get(r.monsterId)! }));
  const topRarity = monsters.reduce<MonsterRarity>(
    (top, m) => (RARITY_ORDER[m.def.rarity] > RARITY_ORDER[top] ? m.def.rarity : top), 'common');
  const newCount = monsters.filter((m) => m.isNew).length;
  return {
    topRarity,
    sfx: newCount > 0 ? 'capture-new' : 'treasure',
    count: results.length,
    body: [
      el('div.gacha-grid', {}, ...monsters.map((m, i) => {
        const cell = el('div.gacha-cell', {},
          monsterIcon(m.monsterId),
          m.isNew ? el('span.gacha-cell-new', {}, 'NEW') : null);
        cell.style.setProperty('--i', String(i)); // 셀별 등장 지연 — 차례로 쏟아지는 연출
        return cell;
      })),
      el('div.gacha-result-sub', {},
        `[카드 ${monsters.length}장${newCount > 0 ? ` · ✨ 도감 신규 ${newCount}종` : ''}]`),
    ],
  };
}

function artifactSingleInfo(itemId: string): RevealInfo {
  const def = content.artifacts.get(itemId)!;
  return {
    topRarity: def.rarity,
    sfx: 'artifact',
    count: 1,
    body: [
      artifactIcon(itemId),
      el(`div.gacha-result-name.rar-name.rar-${def.rarity}`, {}, def.name),
      el('div.gacha-result-sub', {}, `[${RARITY_LABEL[def.rarity]} 유물]`),
    ],
  };
}

function artifactMultiInfo(itemIds: string[]): RevealInfo {
  const defs = itemIds.map((id) => content.artifacts.get(id)!);
  const topRarity = defs.reduce<MonsterRarity>(
    (top, d) => (RARITY_ORDER[d.rarity] > RARITY_ORDER[top] ? d.rarity : top), 'common');
  return {
    topRarity,
    sfx: 'artifact',
    count: itemIds.length,
    body: [
      el('div.gacha-grid', {}, ...itemIds.map((id, i) => {
        const cell = el('div.gacha-cell', {}, artifactIcon(id));
        cell.style.setProperty('--i', String(i));
        return cell;
      })),
      el('div.gacha-result-sub', {}, `[유물 ${itemIds.length}점]`),
    ],
  };
}

/** 결과가 닫힐 때 resolve — 호출부는 후속 토스트(마일스톤 등)를 이 뒤에 띄운다 */
export function showGachaReveal(payload: GachaRevealPayload): Promise<void> {
  return new Promise((resolve) => {
    const info =
      payload.kind === 'artifact'
        ? payload.itemIds.length === 1
          ? artifactSingleInfo(payload.itemIds[0]!)
          : artifactMultiInfo(payload.itemIds)
        : payload.results.length === 1
          ? monsterSingleInfo(payload.results[0]!)
          : monsterMultiInfo(payload.results);

    const aura = auraOf(info.topRarity);
    const sparks = Array.from({ length: 10 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 10 + 0.3;
      const dist = 90 + (i % 3) * 34;
      const spark = el('span.gacha-spark', {});
      spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
      spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
      return spark;
    });

    const stage = el('div.gacha-stage', {},
      el('div.gacha-card', {},
        el('span.gacha-card-mark', {}, '?'),
        info.count > 1 ? el('span.gacha-card-count', {}, `×${info.count}`) : null,
      ),
      el('div.gacha-flash', {}),
      ...sparks,
      el('div.gacha-result', {},
        ...info.body,
        el('div.gacha-hint.small.muted', {}, '탭하여 닫기'),
      ),
    );
    stage.style.setProperty('--gacha-aura', aura.glow);
    stage.style.setProperty('--gacha-spark', aura.spark);

    // 결과 아이콘은 긴장 구간 동안 미리 로드 — micon 기본은 lazy인데, display:none 안이라
    // 공개 순간까지 페치가 시작되지 않아 빈 칸이 떴다가 늦게 채워진다
    stage.querySelectorAll('.gacha-result img').forEach((img) => { (img as HTMLImageElement).loading = 'eager'; });

    let phase: 'suspense' | 'burst' | 'result' = 'suspense';
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    const toResult = () => {
      phase = 'result';
      backdrop.classList.remove('phase-burst');
      backdrop.classList.add('phase-result');
    };
    const toBurst = () => {
      if (phase !== 'suspense') return;
      phase = 'burst';
      backdrop.classList.remove('phase-suspense');
      backdrop.classList.add('phase-burst');
      playSfx(info.sfx); // "짠!" — 소리는 섬광 시점에
      later(toResult, BURST_MS);
    };
    const close = () => {
      timers.forEach(clearTimeout);
      backdrop.remove();
      resolve();
    };

    const backdrop = el('div.gacha-backdrop.phase-suspense', {
      onclick: () => {
        if (phase === 'suspense') toBurst(); // 긴장 스킵
        else if (phase === 'result') close();
      },
    }, stage);
    document.body.append(backdrop);

    // 모션 최소화 설정이면 긴장·섬광 없이 바로 결과
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      phase = 'result';
      backdrop.classList.remove('phase-suspense');
      backdrop.classList.add('phase-result');
      playSfx(info.sfx);
      return;
    }
    playSfx('open');
    later(toBurst, SUSPENSE_MS);
  });
}
