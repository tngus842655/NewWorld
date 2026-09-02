/**
 * 영구 보너스 시트 (GDD §4.6, 2026-08-25) — 조련(몬스터 레벨·각성 총합)·공명(유물 강화 총합).
 * 어떤 몬스터·유물이든 육성 총량이 계단을 오르면 계정의 모든 원정대가 세진다 — 육성의 킥.
 */
import { content } from '../content';
import { accountBonusState, type AxisState } from '../core/accountBonus';
import { signal } from '../state/signal';
import { save } from '../state/store';
import { describeEffect } from './effectText';
import { el } from './kit';
import { tabBar } from './panels';
import { sheetShell } from './overlays';

// 축 탭 (2026-08-25 사용자) — 조련·공명을 한 화면에 쌓지 않고 탭으로 가른다
const axisTab = signal<'training' | 'resonance'>('training');

function tierRows(st: AxisState): HTMLElement[] {
  return st.tiers.map((tier, i) => {
    const done = i < st.active;
    return el(`div.list-row.bonus-tier${done ? '.done' : ''}`, {},
      el('span.small', {}, `${done ? '✅' : '🔒'} ${tier.score}점`),
      el('span.small', {}, tier.effects.map(describeEffect).join(' · ')),
    );
  });
}

/** 발동 중 효과 합계 — 같은 종류끼리 합산해 이 축이 지금 주는 것을 숫자로 보여준다 (2026-08-25 사용자) */
function activeSummary(st: AxisState): string {
  const acts = st.tiers.slice(0, st.active).flatMap((t) => t.effects.map((e) => e.do));
  if (acts.length === 0) return '발동 중인 보너스 없음 [첫 계단까지 키워보세요]';
  const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
  let atk = 0; let hp = 0; let reduce = 0; let capture = 0; let gold = 0; let enc = 0; let spawn = 1;
  for (const a of acts) {
    if (a.kind === 'statMult' && (a.stat === 'atk' || a.stat === 'cp')) atk += a.value;
    if (a.kind === 'statMult' && (a.stat === 'hp' || a.stat === 'cp')) hp += a.value;
    if (a.kind === 'damageReduce') reduce += a.value;
    if (a.kind === 'captureAdd') capture += a.value;
    if (a.kind === 'rewardMult' && (a.target === 'gold' || a.target === 'all')) gold += a.value;
    if (a.kind === 'encounterAdd') enc += a.count;
    if (a.kind === 'spawnWeightMult') spawn *= a.value;
  }
  const parts = [
    // 라벨은 짧게 — 네 항목이 붙으면 311px 카드에서 한 줄을 넘긴다 (2026-09-02 문구 점검)
    atk > 0 ? `공격 +${pct(atk)}` : null,
    hp > 0 ? `생명 +${pct(hp)}` : null,
    reduce > 0 ? `받는 피해 -${pct(reduce)}` : null,
    enc > 0 ? `조우 +${enc}` : null,
    capture > 0 ? `포획률 +${pct(capture)}p` : null,
    gold > 0 ? `골드 +${pct(gold)}` : null,
    spawn > 1 ? `희귀+ 출현 ×${Math.round(spawn * 100) / 100}` : null,
  ].filter(Boolean);
  return `발동 · ${parts.join(' · ')}`;
}

function axisCard(title: string, desc: string, st: AxisState): HTMLElement {
  // 진행바 — 직전 계단에서 다음 계단까지의 구간 진행률 (마지막 계단 이후는 가득)
  const prev = st.active > 0 ? st.tiers[st.active - 1]!.score : 0;
  const ratio = st.next ? Math.min(1, (st.score - prev) / (st.next.score - prev)) : 1;
  const fill = el('div.bonus-bar-fill');
  fill.style.width = `${Math.round(ratio * 100)}%`;
  return el('div.card.stack-sm', {},
    el('div.list-row', {},
      el('strong', {}, title),
      el('strong.title-cp', {}, `${st.score}점 · ${st.active}/${st.tiers.length}`),
    ),
    el('div.muted.small', {}, desc),
    el('div.small.bonus-active', {}, activeSummary(st)),
    el('div.bonus-bar', {}, fill),
    el('div.muted.small', {},
      st.next
        ? `다음 계단 ${st.next.score}점 — ${st.next.effects.map(describeEffect).join(' · ')}`
        : '모든 계단 달성!'),
    ...tierRows(st),
  );
}

export function accountBonusSheet(): HTMLElement {
  const state = save();
  const bonus = accountBonusState(content, state);
  let lv = 0;
  let star = 0;
  for (const m of state.roster) { lv += m.level - 1; star += m.star - 1; }
  const w = content.balance.accountBonus.starWeight;
  const axis = axisTab();
  return sheetShell('🎖 영구 보너스',
    el('p.muted.small', {},
      '어떤 몬스터·유물이든 육성 총량이 계단을 오르면 계정의 모든 원정대에 영구 효과가 붙습니다. 발동한 효과는 유효 전투력·포획·정산에 자동 반영됩니다.'),
    tabBar(
      [
        { key: 'training' as const, label: `🐾 조련 ${bonus.training.active}/${bonus.training.tiers.length}` },
        { key: 'resonance' as const, label: `🔮 공명 ${bonus.resonance.active}/${bonus.resonance.tiers.length}` },
      ],
      { active: axis, onPick: (key) => axisTab.set(key) },
    ),
    axis === 'training'
      ? axisCard('🐾 조련', `몬스터 육성 총량 [레벨 ${lv} + 각성 ${star}×${w}]`, bonus.training)
      : axisCard('🔮 공명', '유물 강화 총량 [전 종 강화 단계의 합]', bonus.resonance),
  );
}
