/**
 * Effect → 한글 설명 — 유물 고유 능력·세트 보너스를 사람이 읽는 문장으로.
 */
import { content } from '../content';
import { RARITY_LABEL, type Action, type Condition, type Effect } from '../content/schema';
import { ELEMENT_LABEL, TIER_NAME, TRIBE_LABEL } from './kit';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function describeCondition(when: Condition | undefined): string {
  if (!when) return '';
  const parts: string[] = [];
  if (when.region) parts.push(when.region.map((r) => content.regions.get(r)?.name ?? r).join('·') + '에서');
  if (when.tier) parts.push(`${TIER_NAME[when.tier]} 시`);
  if (when.element) parts.push(`${ELEMENT_LABEL[when.element]} 대상`);
  if (when.tribe) parts.push(`${TRIBE_LABEL[when.tribe]} 유닛`);
  if (when.encounterIndex !== undefined) parts.push(`${when.encounterIndex + 1}번째 조우`);
  if (when.encounterKind === 'monster') parts.push('몬스터 조우');
  if (when.hpBelow !== undefined) parts.push(`HP ${pct(when.hpBelow)} 이하일 때`);
  return parts.length > 0 ? `[${parts.join(' · ')}] ` : '';
}

function describeAction(action: Action): string {
  switch (action.kind) {
    case 'statMult': {
      const stat = { atk: '공격력', hp: '생명력', cp: '전투력' }[action.stat];
      return `${stat} ${action.value >= 0 ? '+' : ''}${pct(action.value)}`;
    }
    case 'damageReduce': return `받는 피해 -${pct(action.value)}`;
    case 'heal': return `승리 후 HP ${pct(action.ratio)} 회복`;
    case 'reviveOnce': return `전멸 시 1회 부활 (HP ${pct(action.hpRatio)})`;
    case 'autoWin': return '자동 승리';
    case 'captureAdd': return `포획률 +${(action.value * 100).toFixed(1)}%p`;
    case 'captureRetry': return `포획 실패 시 재시도 (원정당 ${action.perExpedition}회)`;
    case 'synergyAmp': return `시너지 효과 +${pct(action.value)}`;
    case 'rewardMult': {
      const target = { gold: '골드', materials: '재료', all: '모든' }[action.target];
      return `${target} 보상 +${pct(action.value)}`;
    }
    case 'timeMult': return `파견 시간 ${pct(1 - action.value)} 단축`;
    case 'encounterAdd': return `조우 +${action.count}`;
    case 'encounterMixMult': {
      const target = { monster: '몬스터', treasure: '보물', trap: '함정', gather: '채집' }[action.target];
      return `${target} 빈도 ×${action.value}`;
    }
    case 'spawnWeightMult': {
      const rarity = RARITY_LABEL[action.minRarity];
      return `${rarity} 이상 출현 가중 ×${action.value}`;
    }
    case 'salvageOnFail': return `갈림길 실패 시에도 보상 ${pct(action.ratio)} 획득`;
    case 'crossroadSuccessAdd': return `갈림길 위험 성공률 +${pct(action.value)}p`;
    case 'fleeRewardRatioSet': return `전멸 시 반입 비율 ${pct(action.value)}`;
    case 'trapAvoid': return `함정 회피 +${pct(action.chance)}`;
    case 'healReceivedMult': return `받는 회복 ×${action.value}`;
  }
}

export function describeEffect(effect: Effect): string {
  return `${describeCondition(effect.when)}${describeAction(effect.do)}`;
}
