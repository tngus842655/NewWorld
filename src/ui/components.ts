/**
 * 공용 컴포넌트 — 몬스터 아이콘(에셋 없으면 실루엣 폴백), 카드류.
 */
import { content } from '../content';
import type { ArtifactDef, HourglassDef } from '../content/schema';
import { monsterBaseCp, statAt } from '../core/formulas';
import type { OwnedArtifact, OwnedMonster } from '../core/types';
import { ARTIFACT_RARITY_LABEL, ELEMENT_EMOJI, ELEMENT_LABEL, MONSTER_RARITY_LABEL, SLOT_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, stars } from './kit';

/** 몬스터 아이콘 — /assets/monsters/{id}.webp, 없으면 종족 이모지 실루엣 (DATA.md §6) */
export function monsterIcon(monsterId: string, opts: { silhouette?: boolean } = {}): HTMLElement {
  const monster = content.monsters.get(monsterId);
  const box = el(`div.micon.rar-${monster?.rarity ?? 'common'}${opts.silhouette ? '.silhouette' : ''}`);
  if (!monster) return box;
  const img = el('img');
  img.src = `/assets/monsters/${monster.asset}.webp`;
  img.alt = monster.name;
  img.loading = 'lazy';
  img.onerror = () => {
    img.remove();
    box.append(el('span.micon-fallback', {}, TRIBE_EMOJI[monster.tribe]));
  };
  box.append(img);
  return box;
}

/** 모래시계 아이콘 — /assets/hourglasses/{asset}.webp, 없으면 ⏳ 폴백. 등급은 테두리 색으로만 */
export function hourglassIcon(def: HourglassDef, opts: { small?: boolean } = {}): HTMLElement {
  const box = el(`div.hg-icon.rar-${def.rarity}${opts.small ? '.hg-sm' : ''}`);
  const img = el('img');
  img.src = `/assets/hourglasses/${def.asset}.webp`;
  img.alt = def.name;
  img.loading = 'lazy';
  img.onerror = () => {
    img.remove();
    box.append(el('span', {}, '⏳'));
  };
  box.append(img);
  return box;
}

export function artifactIcon(itemId: string): HTMLElement {
  const def = content.artifacts.get(itemId);
  const box = el(`div.micon.rar-${def?.rarity ?? 'common'}`);
  if (!def) return box;
  const img = el('img');
  img.src = `/assets/artifacts/${def.asset}.webp`;
  img.alt = def.name;
  img.loading = 'lazy';
  img.onerror = () => {
    img.remove();
    box.append(el('span.micon-fallback', {}, { weapon: '🗡️', armor: '🛡️', banner: '🚩', charm: '🧿' }[def.slot] ?? '💎'));
  };
  box.append(img);
  return box;
}

export function ownedCp(owned: OwnedMonster): number {
  const monster = content.monsters.get(owned.monsterId);
  if (!monster) return 0;
  const { balance } = content;
  const atk = statAt(monster.baseAtk, owned.level, owned.star, balance);
  const hp = statAt(monster.baseHp, owned.level, owned.star, balance);
  return Math.round(atk * balance.cp.atkWeight + hp * balance.cp.hpWeight);
}

/** 몬스터 아이콘 + 뱃지(출신 지역·원정 중·카드 수) — 칩과 캠프 접힘 목록이 공유 */
export function monsterIconBadged(owned: OwnedMonster, opts: { onExpedition?: boolean } = {}): HTMLElement {
  const monster = content.monsters.get(owned.monsterId)!;
  const icon = monsterIcon(owned.monsterId);
  // 출신 지역 — 기본 CP가 지역 축으로 뛰기 때문에 등급만 보고 헷갈리지 않게 (2026-08-23)
  const habitat = content.regions.get(monster.habitat);
  if (habitat) icon.append(el('span.micon-region', { title: `서식지 ${habitat.name}` }, habitat.icon));
  // 캠프 등에서 파견 중임을 알리는 코너 뱃지 (클릭은 막지 않는다 — busy와 별개)
  if (opts.onExpedition) icon.append(el('span.micon-badge', { title: '원정 중' }, '🧭'));
  // 보유 카드 수 (중복 포획 누적 — 합성 재료)
  if (owned.count > 1) icon.append(el('span.micon-count', { title: `보유 카드 ${owned.count}장` }, `×${owned.count}`));
  return icon;
}

export function monsterChip(
  owned: OwnedMonster,
  opts: { selected?: boolean; busy?: boolean; onclick?: () => void; onExpedition?: boolean } = {},
): HTMLElement {
  const monster = content.monsters.get(owned.monsterId)!;
  const icon = monsterIconBadged(owned, { onExpedition: opts.onExpedition });
  return el(
    `button.mchip${opts.selected ? '.selected' : ''}${opts.busy ? '.busy' : ''}`,
    { onclick: opts.onclick, disabled: opts.busy },
    icon,
    el('div.mchip-body', {},
      el('div.mchip-name', {},
        monster.name,
        el('span.mchip-elems', {
          title: `${ELEMENT_LABEL[monster.element]} · ${TRIBE_LABEL[monster.tribe]}`,
        }, ` ${ELEMENT_EMOJI[monster.element]}${TRIBE_EMOJI[monster.tribe]}`),
      ),
      el('div.mchip-sub', {}, `Lv.${owned.level} ${stars(owned.star)} · CP ${ownedCp(owned)}`),
    ),
  );
}

/** 유물 아이콘 + 뱃지(개수·강화) — v6 종 단위 */
export function artifactIconBadged(owned: OwnedArtifact): HTMLElement {
  const icon = artifactIcon(owned.itemId);
  if (owned.enhance > 0) icon.append(el('span.micon-badge', { title: `강화 +${owned.enhance}` }, `+${owned.enhance}`));
  if (owned.count > 1) icon.append(el('span.micon-count', { title: `보유 ${owned.count}개` }, `×${owned.count}`));
  return icon;
}

export function artifactCard(owned: OwnedArtifact, def: ArtifactDef, opts: { selected?: boolean; busy?: boolean; onclick?: () => void } = {}): HTMLElement {
  const mainValue = def.main.base + def.main.perEnhance * owned.enhance;
  const setName = def.set ? content.sets.get(def.set)?.name : null;
  return el(
    `button.acard.rar-${def.rarity}${opts.selected ? '.selected' : ''}${opts.busy ? '.busy' : ''}`,
    { onclick: opts.onclick, disabled: opts.busy },
    artifactIconBadged(owned),
    el('div.acard-body', {},
      el('div.acard-name', {}, `${def.name}${owned.enhance > 0 ? ` +${owned.enhance}` : ''}`),
      el('div.acard-sub', {},
        `[${ARTIFACT_RARITY_LABEL[def.rarity]} ${SLOT_LABEL[def.slot]}] ${mainLabel(def.main.stat)} ${fmtEffect(def.main.stat, mainValue)}${setName ? ` · ${setName} 세트` : ''}`,
      ),
    ),
  );
}

export function mainLabel(stat: string): string {
  return (
    {
      atkMult: '공격', hpMult: '생명', captureAdd: '포획률', synergyAmp: '시너지 증폭',
      goldMult: '골드 획득', materialMult: '재료 획득', damageReduce: '피해 경감',
    }[stat] ?? stat
  );
}

export function fmtEffect(stat: string, value: number): string {
  if (stat === 'captureAdd') return `+${(value * 100).toFixed(1)}%p`;
  return `+${Math.round(value * 100)}%`;
}

export function rarityTag(rarity: keyof typeof MONSTER_RARITY_LABEL): HTMLElement {
  return el(`span.tag.rar-${rarity}`, {}, MONSTER_RARITY_LABEL[rarity]);
}

export function baseCpOf(monsterId: string): number {
  const monster = content.monsters.get(monsterId);
  return monster ? Math.round(monsterBaseCp(monster, content.balance)) : 0;
}
