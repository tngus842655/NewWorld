/**
 * 공용 컴포넌트 — 몬스터 아이콘(에셋 없으면 실루엣 폴백), 카드류.
 */
import { content } from '../content';
import type { ArtifactDef } from '../content/schema';
import { monsterBaseCp, statAt } from '../core/formulas';
import type { OwnedArtifact, OwnedMonster } from '../core/types';
import { ARTIFACT_RARITY_LABEL, MONSTER_RARITY_LABEL, SLOT_LABEL, TRIBE_EMOJI, el, stars } from './kit';

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

export function monsterChip(owned: OwnedMonster, opts: { selected?: boolean; busy?: boolean; onclick?: () => void } = {}): HTMLElement {
  const monster = content.monsters.get(owned.monsterId)!;
  return el(
    `button.mchip${opts.selected ? '.selected' : ''}${opts.busy ? '.busy' : ''}`,
    { onclick: opts.onclick, disabled: opts.busy },
    monsterIcon(owned.monsterId),
    el('div.mchip-body', {},
      el('div.mchip-name', {}, monster.name),
      el('div.mchip-sub', {}, `Lv.${owned.level} ${stars(owned.star)} · CP ${ownedCp(owned)}`),
    ),
  );
}

export function artifactCard(owned: OwnedArtifact, def: ArtifactDef, opts: { selected?: boolean; busy?: boolean; onclick?: () => void } = {}): HTMLElement {
  const mainValue = def.main.base + def.main.perEnhance * owned.enhance;
  const setName = def.set ? content.sets.get(def.set)?.name : null;
  return el(
    `button.acard.rar-${def.rarity}${opts.selected ? '.selected' : ''}${opts.busy ? '.busy' : ''}`,
    { onclick: opts.onclick, disabled: opts.busy },
    artifactIcon(def.id),
    el('div.acard-body', {},
      el('div.acard-name', {}, `${def.name}${owned.enhance > 0 ? ` +${owned.enhance}` : ''}`),
      el('div.acard-sub', {},
        `[${ARTIFACT_RARITY_LABEL[def.rarity]} ${SLOT_LABEL[def.slot]}] ${mainLabel(def.main.stat)} ${fmtEffect(def.main.stat, mainValue)}${setName ? ` · ${setName} 세트` : ''}`,
      ),
      owned.substats.length > 0
        ? el('div.acard-subs', {}, owned.substats.map((s) => `${mainLabel(s.stat)} ${fmtEffect(s.stat, s.value)}`).join(' · '))
        : null,
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
