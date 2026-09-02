/**
 * 공용 컴포넌트 — 몬스터 아이콘(에셋 없으면 실루엣 폴백), 카드류.
 */
import { content } from '../content';
import type { ArtifactDef, HourglassDef } from '../content/schema';
import { monsterBaseCp, statAt } from '../core/formulas';
import type { OwnedArtifact, OwnedMonster } from '../core/types';
import { ARTIFACT_RARITY_LABEL, ELEMENT_EMOJI, ELEMENT_LABEL, MONSTER_RARITY_LABEL, SLOT_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, stars } from './kit';

// 구글 공식 'G' 로고 (4색, 브랜딩 가이드 SVG) — 로그인 게이트·설정 계정 섹션 공용
const GOOGLE_G_SVG =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">'
  + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
  + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
  + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
  + '</svg>';

export function googleG(cls: 'google-g' | 'google-g-sm'): HTMLElement {
  return el(`span.${cls}`, { html: GOOGLE_G_SVG });
}

/** 인라인 UI 아이콘 — 앱바와 같은 /assets/ui/{name}.webp를 이모지 자리에. 실패 시 이모지 폴백 */
export function uiIcon(name: string, fallback: string, alt: string): HTMLElement {
  const wrap = el('span.ui-icon', {});
  const img = el<'img'>('img');
  img.src = `/assets/ui/${name}.webp`;
  img.alt = alt;
  img.onerror = () => { img.remove(); wrap.append(fallback); };
  wrap.append(img);
  return wrap;
}

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
export function monsterIconBadged(owned: OwnedMonster, opts: { onExpedition?: boolean; count?: boolean } = {}): HTMLElement {
  const monster = content.monsters.get(owned.monsterId)!;
  const icon = monsterIcon(owned.monsterId);
  // 출신 지역 — 기본 CP가 지역 축으로 뛰기 때문에 등급만 보고 헷갈리지 않게 (2026-08-23)
  const habitat = content.regions.get(monster.habitat);
  if (habitat) icon.append(el('span.micon-region', { title: `서식지 ${habitat.name}` }, habitat.icon));
  // 캠프 등에서 파견 중임을 알리는 코너 뱃지 (클릭은 막지 않는다 — busy와 별개)
  if (opts.onExpedition) icon.append(el('span.micon-badge', { title: '원정 중' }, '🧭'));
  // 보유 카드 수 (중복 포획 누적 — 합성 재료). 편성된 자리에서는 count:false로 감춘다 (2026-08-25 사용자) —
  // 슬롯 한 칸 = 1마리인데 ×6이 붙으면 6마리가 편성된 것으로 읽힌다.
  if (owned.count > 1 && opts.count !== false) icon.append(el('span.micon-count', { title: `보유 카드 ${owned.count}장` }, `×${owned.count}`));
  return icon;
}

export function monsterChip(
  owned: OwnedMonster,
  opts: { selected?: boolean; busy?: boolean; onclick?: () => void; onExpedition?: boolean; wide?: boolean } = {},
): HTMLElement {
  const monster = content.monsters.get(owned.monsterId)!;
  const icon = monsterIconBadged(owned, { onExpedition: opts.onExpedition });
  // 이름은 등급색으로 (2026-08-30 사용자) — 아이콘 테두리와 같은 축이라 목록에서 등급이 먼저 읽힌다
  const name = el(`div.mchip-name.rar-name.rar-${monster.rarity}`, {},
    monster.name,
    el('span.mchip-elems', {
      title: `${ELEMENT_LABEL[monster.element]} · ${TRIBE_LABEL[monster.tribe]}`,
    }, ` ${ELEMENT_EMOJI[monster.element]}${TRIBE_EMOJI[monster.tribe]}`),
  );
  const cls = `${opts.selected ? '.selected' : ''}${opts.busy ? '.busy' : ''}`;
  const attrs = { onclick: opts.onclick, disabled: opts.busy };
  /**
   * wide — 한 줄에 카드 하나인 배치(캠프)용. 남아돌던 오른쪽을 Lv·CP가 채우고 이름도 커진다.
   * 편성 시트는 2열 격자라 오른쪽 여유가 없어 기존 2줄 배치를 그대로 쓴다 (2026-08-30 사용자).
   */
  if (opts.wide) {
    return el(`button.mchip.mchip-wide${cls}`, attrs,
      icon,
      el('div.mchip-body', {}, name),
      el('div.mchip-stats', {},
        el('div.mchip-lv', {}, `Lv.${owned.level} ${stars(owned.star)}`),
        el('div.mchip-cp', {}, `CP ${ownedCp(owned)}`),
      ),
    );
  }
  return el(`button.mchip${cls}`, attrs,
    icon,
    el('div.mchip-body', {},
      name,
      // 2열 격자의 100px 몸통에서 "CP" 뒤 숫자만 다음 줄로 떨어지지 않게 — 접히더라도 "CP 20077" 단위로 (2026-09-02)
      el('div.mchip-sub', {}, `Lv.${owned.level} ${stars(owned.star)} · `, el('span.nowrap', {}, `CP ${ownedCp(owned)}`)),
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
