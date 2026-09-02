/**
 * 원정 — 지역 선택 → 군(원정대) 카드 → 파견 길이 → 출발. (2026-08-23 군 시스템 개편)
 * 편성은 군 카드를 눌러 여는 편성 시트에서, 파견은 군 단위로.
 */
import { content } from '../../content';
import { DIFFICULTIES, TIERS, type Difficulty, type Region, type Tier } from '../../content/schema';
import { adUsesLeft } from '../../core/ads';
import { computePartyPower, enemyPower } from '../../core/combat';
import { collectTeamEffects, query } from '../../core/effects';
import { isExpeditionOut, legendTraceBonus, validLegendTraces } from '../../core/expedition';
import { adsAvailable, showRewardedAd } from '../../platform/ads';
import * as clock from '../../state/clock';
import { canUnlockRegion, capturedCounts, deepestUnlockedRegion, isRegionUnlocked, teamCount } from '../../core/progression';
import { GameError, type SaveState, type TeamLoadout } from '../../core/types';
import { batch, signal } from '../../state/signal';
import { dispatchTeam, grantAdScent, save, unlock } from '../../state/store';
import { artifactIcon, monsterIconBadged, ownedCp } from '../components';
import { DIFFICULTY_LABEL, ELEMENT_EMOJI, ELEMENT_LABEL, TIER_LABEL, TIER_NAME, TRIBE_EMOJI, TRIBE_LABEL, el, fmtClock, fmtGold, fmtPct, fmtRemainShort, josaRo, toast } from '../kit';
import { regionTiers, tierShortName } from '../regionTiers';
import { resetTeamSheet } from '../teamSheet';
import { tabBar } from '../panels';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

// 12지역에서 첫 지역 고정 시작은 진행 유저에게 매번 스크롤 — 접속하면 가장 깊은 해금 지역에서 시작 (2026-08-27)
const selRegion = signal<string>(deepestUnlockedRegion(content, save()).id);
const selTierView = signal<number>(content.regions.get(selRegion())!.tier);
const selTier = signal<Tier>('scout');
const selDifficulty = signal<Difficulty>('normal'); // 난이도 (GDD §5.1) — 탐사·원정에서만 의미, 다른 티어에서는 보통으로 읽는다
/**
 * 잠긴 지역 행을 누르고 있는 동안만 뜨는 해금 조건 안내 (2026-09-02 사용자 — "🌋 0/16 🔥 0/24"가 무슨 뜻인지 모를 수 있다).
 * 시그널로 두는 이유: 화면은 save()·시계 변화마다 통째로 다시 그려지므로 DOM에 직접 붙인 말풍선은 다음 렌더에서 사라진다.
 * 손을 어디서 떼든(행 밖·스크롤 취소 포함) 닫히도록 window에서 pointerup/pointercancel을 받는다.
 */
const heldRegion = signal<string | null>(null);
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', () => heldRegion.set(null));
  window.addEventListener('pointercancel', () => heldRegion.set(null));
}

/** 해금 조건 말풍선 — 조건별로 "무엇을 세는 값인지"와 "어디서 채우는지" 한 줄씩 */
function unlockTip(region: Region, state: SaveState): HTMLElement {
  const counts = capturedCounts(content, state);
  const lines: HTMLElement[] = [];
  for (const [requiredRegion, need] of Object.entries(region.unlock.codexCaptured ?? {})) {
    const r = content.regions.get(requiredRegion);
    const have = counts.byRegion.get(requiredRegion) ?? 0;
    // 지역 이름은 한 번만 — 두 줄에 다 넣으면 '얼어붙은 심연'처럼 긴 이름에서 375px을 넘는다
    lines.push(el('div.small', {}, `${r?.icon ?? ''} ${have}/${need} · ${r?.name ?? requiredRegion} 도감`));
    lines.push(el('div.small.muted.region-tip-sub', {}, '그 지역 원정에서 포획한 종 수 — 새 종을 잡으면 채워집니다'));
  }
  for (const [materialId, need] of Object.entries(region.unlock.materials ?? {})) {
    const m = content.materials.get(materialId);
    const src = m ? content.regions.get(m.region) : undefined;
    const tierName = src ? tierShortName(regionTiers.find((t) => t.tier === src.tier)?.regions ?? [src]) : '';
    const have = state.wallet.materials[materialId] ?? 0;
    lines.push(el('div.small', {}, `${m?.icon ?? ''} ${have}/${need} · ${m?.name ?? materialId} — 보유 수 (해금 시 소모)`));
    lines.push(el('div.small.muted.region-tip-sub', {}, `${tierName} 권역 원정의 채집·갈림길 · 상점 지역 재료 꾸러미`)); // 375px 한 줄
  }
  return el('div.wallet-tip.region-tip', {},
    el('div.wallet-tip-title', {}, `🔒 ${region.icon} ${region.name} 해금 조건`),
    ...lines,
    el('div.small.wallet-tip-use', {}, '조건을 모두 채우면 [해금] 버튼이 나타납니다'),
  );
}

/** 잠긴 행에 길게 누르기 핸들러 — 누르는 동안 unlockTip, 떼면 닫힘. 스크롤(pointercancel)·컨텍스트 메뉴에 걸리지 않게 */
function holdToExplain(row: HTMLElement, regionId: string): HTMLElement {
  row.onpointerdown = (e) => {
    // 행 안 [해금] 버튼에서 시작한 누름은 무시 — 시그널 set이 동기 재렌더로 버튼 노드를 교체해 click이 유실된다 (마우스·iOS)
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    heldRegion.set(regionId);
  };
  row.onpointerup = () => heldRegion.set(null);
  row.onpointercancel = () => heldRegion.set(null);
  row.oncontextmenu = (e) => e.preventDefault(); // 길게 누르기가 브라우저 메뉴·텍스트 선택으로 새지 않게
  return row;
}

/** 권역 탭 선택 — 해금 소지역이 있으면 그중 가장 깊은 곳을 출발 대상으로. 전부 잠긴 권역은 구경만 */
function pickTier(tier: number): void {
  const state = save();
  const bucket = regionTiers.find((t) => t.tier === tier);
  if (!bucket) return;
  const deepest = [...bucket.regions].reverse().find((r) => isRegionUnlocked(content, state, r.id));
  batch(() => {
    selTierView.set(tier);
    if (deepest) selRegion.set(deepest.id);
  });
}
const selTeamId = signal<string>('team-1');
const adBusy = signal(false); // 광고 로드 중 — 파견 패널 버튼 잠금
// 하단 파견 패널 접힘 상태 — 접은 채로 종료해도 다음 접속에 유지 (세이브와 무관한 기기 UI 취향이라 localStorage 별도 키)
const PANEL_OPEN_KEY = 'newworld-ui-dispatch-open';
const panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) !== '0');

function setPanelOpen(next: boolean): void {
  if (panelOpen() !== next) playSfx('tap');
  panelOpen.set(next);
  try { localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0'); } catch { /* 저장 불가 환경이면 세션 한정 동작 */ }
}

/** 파견 중인 군 id 집합 — 회군 복귀 중도 밖에 있는 것 (비추적 시계, 렌더 시점 기준) */
function busyTeamIds(state: SaveState): Set<string> {
  return new Set(state.expeditions.filter((e) => isExpeditionOut(e, clock.now()) && e.teamId).map((e) => e.teamId!));
}

/** 유효한(존재하는) 편성만 남긴 군 파티 */
function teamParty(state: SaveState, team: TeamLoadout): string[] {
  return team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
}
function teamArtifacts(state: SaveState, team: TeamLoadout): string[] {
  return team.artifactIds.filter((itemId) => state.artifacts.some((a) => a.itemId === itemId));
}

interface Preview {
  power: number;
  tribes: { tribe: string; count: number }[];
  synergyAmp: number;
  encounterAdd: number; // 계정 보너스·유물 고유의 원정당 조우 추가 — 정보줄 표기용
  durationMs: number; // 유물 시간 단축(timeMult) 반영 실소요 — 출발 버튼 표기용 (core createExpedition과 같은 식)
}

/** 군 프리셋 기준 유효 전투력 미리보기 (artifactUids를 []로 주면 유물 제외) */
function teamPreview(team: TeamLoadout, regionId: string, tier: Tier, withArtifacts = true): Preview | null {
  const state = save();
  const region = content.regions.get(regionId);
  const partyIds = teamParty(state, team);
  if (!region || partyIds.length === 0) return null;
  try {
    const fx = collectTeamEffects(content, state, partyIds, withArtifacts ? teamArtifacts(state, team) : []);
    const party = partyIds.map((monsterId) => state.roster.find((m) => m.monsterId === monsterId)!).filter(Boolean);
    const power = computePartyPower(content, fx.effects, party, region, tier).total;
    const tribes = [...fx.tribeCounts.entries()]
      .map(([tribe, count]) => ({ tribe, count }))
      .sort((a, b) => b.count - a.count);
    const setupActions = query(fx.effects, 'expeditionSetup', { regionId: region.id, tier });
    let encounterAdd = 0;
    let timeMult = 1;
    for (const action of setupActions) {
      if (action.kind === 'encounterAdd') encounterAdd += action.count;
      if (action.kind === 'timeMult') timeMult *= action.value;
    }
    timeMult = Math.max(timeMult, content.balance.artifacts.effectCaps.timeMultMin);
    const durationMs = Math.round(content.balance.tiers[tier].minutes * 60_000 * timeMult);
    return { power: Math.round(power), tribes, synergyAmp: fx.synergyAmp, encounterAdd, durationMs };
  } catch (error) {
    if (error instanceof GameError) return null;
    throw error;
  }
}

/**
 * 파견 패널 상단 핸들 — 짧게 누르면 토글, 아래로 끌면 접기, 위로 끌면 펼치기.
 */
function panelHandle(open: boolean): HTMLElement {
  const handle = el('div.panel-handle', { title: open ? '내리거나 눌러서 접기' : '올리거나 눌러서 펼치기' },
    open ? el('span.handle-bar', {}) : el('span.handle-open', {}, '∧'),
  );
  let startY: number | null = null;
  handle.onpointerdown = (e) => {
    startY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  handle.onpointerup = (e) => {
    if (startY === null) return;
    const delta = e.clientY - startY;
    startY = null;
    setPanelOpen(delta > 16 ? false : delta < -16 ? true : !panelOpen());
  };
  handle.onpointercancel = () => { startY = null; };
  return handle;
}

function regionRow(regionId: string, opts: { selected: boolean; compact: boolean }): HTMLElement {
  const state = save();
  const region = content.regions.get(regionId)!;
  const unlocked = isRegionUnlocked(content, state, regionId);
  const { selected, compact } = opts;
  if (unlocked) {
    return el(`button.region-row${selected ? '.selected' : ''}`, { onclick: () => selRegion.set(regionId) },
      el('div.region-name', {},
        `${region.icon} ${region.name}`,
        el('span.region-elem', { title: `우세 속성 ${ELEMENT_LABEL[region.element]} — 같거나 이기는 속성이 유리` }, ` ${ELEMENT_EMOJI[region.element]}`),
      ),
      // 티어별 권장 CP 범위 (검토 ① — 전멸 0 기준). 정확한 값은 파견 패널이 선택 티어로 보여준다
      el('div.muted.small', {}, `권장 CP ${fmtGold(region.recommendedCpTier.scout)}~${fmtGold(region.recommendedCpTier.deep)}`),
    );
  }
  // 다음 관문이 아닌 먼 잠김 지역은 이름만 — 12지역에서 잠김 조건 11줄이 목록을 덮는 것을 막는다 (2026-08-26)
  if (compact) {
    // 먼 잠김 지역도 누르고 있으면 조건을 보여준다 — 목록은 짧게, 정보는 손 안에
    const row = holdToExplain(el('div.region-row.locked', { title: '앞 지역을 해금하면 열립니다 (누르고 있으면 조건 안내)' },
      el('div.region-name.muted', {}, `🔒 ${region.icon} ${region.name}`),
    ), regionId);
    return el('div.region-row-wrap', {}, row, heldRegion() === regionId ? unlockTip(region, state) : null);
  }
  const check = canUnlockRegion(content, state, regionId);
  // 해금 조건은 아이콘 + 수치만 간략히 — "필요합니다" 문구 없이 한 줄 유지 (2026-08-23 사용자)
  const counts = capturedCounts(content, state);
  const requirements: string[] = [];
  for (const [requiredRegion, need] of Object.entries(region.unlock.codexCaptured ?? {})) {
    const have = Math.min(counts.byRegion.get(requiredRegion) ?? 0, need);
    requirements.push(`${content.regions.get(requiredRegion)?.icon ?? ''}${have}/${need}`); // 지역 아이콘 = 그 지역 도감
  }
  for (const [materialId, need] of Object.entries(region.unlock.materials ?? {})) {
    const have = Math.min(state.wallet.materials[materialId] ?? 0, need);
    requirements.push(`${content.materials.get(materialId)?.icon ?? ''}${have}/${need}`);
  }
  // 조건을 다 채운 행은 [해금] 버튼이 답이라 말풍선을 붙이지 않는다 ("조건을 채우면 버튼이 나타납니다"가 화면과 모순)
  const rowEl = el('div.region-row.locked', { title: check.ok ? '해금 조건 달성' : `${check.reason ?? ''} — 누르고 있으면 조건 안내` },
    el('div.region-name', {}, `🔒 ${region.icon} ${region.name}`),
    el('div.muted.small.region-req', {}, check.ok ? '해금 조건 달성!' : requirements.join(' ')),
    // 해금하면 바로 출발 대상으로 — 방금 연 지역이 다음 목적지다
    check.ok ? el('button.btn.btn-primary.small-btn', { onclick: () => { unlock(regionId); selRegion.set(regionId); } }, '해금') : null,
  );
  const row = check.ok ? rowEl : holdToExplain(rowEl, regionId);
  // 말풍선은 행 아래에 겹쳐 뜬다 (.region-row-wrap이 기준) — 흐름에 끼우면 누를 때마다 목록이 출렁인다
  return el('div.region-row-wrap', {}, row, !check.ok && heldRegion() === regionId ? unlockTip(region, state) : null);
}

/** 군 카드 — 파티 슬롯 수만큼 미리보기 + 유물 줄 + 이름·CP. 클릭하면 편성 시트 */
function teamCard(team: TeamLoadout): HTMLElement {
  const state = save();
  const busy = busyTeamIds(state).has(team.id);
  const party = teamParty(state, team);
  const artifacts = teamArtifacts(state, team);

  // 해금한 슬롯 수만큼 칸을 그린다 — 4칸 고정은 5칸 편성의 다섯째 몬스터를 숨겼다 (2026-08-27 사용자)
  const slots = state.profile.partySlots;
  const iconCells: HTMLElement[] = [];
  for (let i = 0; i < slots; i++) {
    const monsterId = party[i];
    if (monsterId) {
      const owned = state.roster.find((m) => m.monsterId === monsterId)!;
      iconCells.push(el('div.team-cell', {}, monsterIconBadged(owned, { count: false }))); // 편성 미리보기 — 편성 슬롯과 같은 이유로 카드 수 숨김
    } else {
      iconCells.push(el('div.team-cell.team-cell-empty', {}, '+'));
    }
  }

  // 장착 유물 줄 — 이름·수치는 툴팁과 편성 시트로, 여기서는 등급 테두리만
  const arteRow = artifacts.length > 0
    ? el('div.team-arte-row', {}, ...artifacts.map((itemId) => {
        const def = content.artifacts.get(itemId);
        const owned = state.artifacts.find((a) => a.itemId === itemId);
        const icon = artifactIcon(itemId);
        if (def) icon.title = `${def.name}${owned && owned.enhance > 0 ? ` +${owned.enhance}` : ''}`;
        return icon;
      }))
    : null;

  const totalCp = party.reduce((sum, id) => {
    const owned = state.roster.find((m) => m.monsterId === id);
    return sum + (owned ? ownedCp(owned) : 0);
  }, 0);

  return el(`button.card.team-card${busy ? '.team-busy' : ''}`, {
    title: `${team.name} 편성 열기${artifacts.length > 0 ? ` · 유물 ${artifacts.length}/4` : ''}`,
    onclick: () => {
      playSfx('tap');
      resetTeamSheet();
      overlay.set({ kind: 'teamEdit', teamId: team.id });
    },
  },
    el('div.team-row', {}, ...iconCells),
    arteRow,
    el('div.team-foot', {},
      el('span.team-name-sm', {}, busy ? `🧭 ${team.name}` : team.name), // 파견 중은 칩과 같은 🧭 접두
      party.length > 0
        ? el('span.team-cp', {}, `CP ${fmtGold(totalCp)}`)
        : el('span.muted.small', {}, '비어 있음'),
    ),
  );
}

/** 아직 잠긴 군 — 카드 대신 한 줄 (12지역 개편으로 화면이 길어져 세로 압축, 2026-08-27) */
function lockedTeamLines(state: SaveState): HTMLElement[] {
  // 군 게이트가 뒤로 이동해도(2026-08-26 심부 이동) 이미 만들어진 프리셋은 회수하지 않는다 —
  // 프리셋 카드가 있는 군에 잠금 줄을 겹쳐 보여주지 않는다
  const current = Math.max(teamCount(content, state), state.teams.length);
  return content.balance.teams
    .filter((u) => u.count > current && u.regionUnlocked)
    .map((u) => {
      const region = content.regions.get(u.regionUnlocked!);
      return el('div.team-locked-line', { title: `${region?.name ?? ''} 해금 시 편성 가능` },
        `🔒 원정대 ${u.count} — ${region?.icon ?? ''} ${region?.name ?? ''} 해금 시`);
    });
}

export function renderExpedition(): HTMLElement {
  const state = save();
  // 리셋·세이브 붙여넣기로 선택 지역이 잠겼을 수 있다 — 시그널은 두고 이번 렌더의 출발 대상만 보정
  const regionId = isRegionUnlocked(content, state, selRegion())
    ? selRegion()
    : deepestUnlockedRegion(content, state).id;
  const region = content.regions.get(regionId)!;
  const tier = selTier();
  const busy = busyTeamIds(state);

  // 선택 군 — 없거나 파견 중이면 첫 가용 군으로
  const chosen = state.teams.find((t) => t.id === selTeamId() && !busy.has(t.id))
    ?? state.teams.find((t) => !busy.has(t.id))
    ?? state.teams[0]!;
  const team = chosen;
  const party = teamParty(state, team);
  const info = teamPreview(team, regionId, tier);

  // 난이도 (GDD §5.1, 2026-09-02 사용자) — 탐사·원정에서만 선택, 그 외 티어는 보통 고정. 잠금 없음
  const diffAllowed = content.balance.difficultyTiers.includes(tier);
  const difficulty: Difficulty = diffAllowed ? selDifficulty() : 'normal';
  const diff = content.balance.difficulties[difficulty];
  // 선택 티어·난이도의 권장 CP (전멸률 0.1% 이하 기준 × 적 배수 — 선형, 원정은 전설 조우 제외)
  const recommendedCp = Math.round(region.recommendedCpTier[tier] * diff.enemyMult);
  const cpClass = info && info.power >= recommendedCp ? 'cp-ok' : 'cp-low';
  const synergyChips = (info?.tribes ?? [])
    .filter((t) => t.count >= 2)
    .map((t) =>
      el(`span.tag.synergy${t.count >= 3 ? '.synergy-max' : ''}`, {},
        `${TRIBE_EMOJI[t.tribe as keyof typeof TRIBE_EMOJI]} ${TRIBE_LABEL[t.tribe as keyof typeof TRIBE_LABEL]} ×${Math.min(t.count, 3)}`),
    );

  const lureLoad = Math.min(content.balance.lures.maxLoad, state.wallet.lures);
  const runningCount = state.expeditions.filter((e) => isExpeditionOut(e, clock.now())).length;
  const maxTeams = teamCount(content, state);
  const teamsFull = runningCount >= maxTeams;
  const teamBusy = busy.has(team.id);

  const tierDef = content.balance.tiers[tier];
  const traceChance = content.balance.legendTraces.dropChance[tier];
  const fmtMult = (v: number) => String(Math.round(v * 100) / 100);
  const yieldMult = tierDef.yieldMult * diff.goldMult; // 티어 × 난이도 합성 골드 배수 (둘 다 골드 한정)
  const rareMult = tierDef.rareWeightMult + diff.rareWeightAdd;
  const tierInfo = [
    diff.enemyMult > 1 ? `적 ×${fmtMult(diff.enemyMult)}` : null,
    `조우 ${tierDef.encounters + (info?.encounterAdd ?? 0)}회`,
    tierDef.crossroads > 0 ? `갈림길 ${tierDef.crossroads}회` : null,
    yieldMult > 1 ? `보상 ×${fmtMult(yieldMult)}` : null,
    rareMult > 1 ? `희귀 출현 ×${fmtMult(rareMult)}` : null,
  ].filter(Boolean).join(' · ');
  // 전설 승리선 — 권장은 "전멸 하한"이라 강한 편성에게는 목표가 안 보였다 (2026-09-02 사용자 결정 ③: 여유선 표기).
  // 지역 전설 적 전투력의 최대 × 난이도 적 배수. 확률은 기본 + 난이도 가산 (흔적 가산은 아래 traceLine이 따로 말한다)
  const legendWinCp = Math.round(Math.max(...region.legendary.map((id) => enemyPower(content, content.monsters.get(id)!))) * diff.enemyMult);
  const pctShort = (v: number) => `${Math.round(v * 10000) / 100}%`; // 2.25%처럼 난이도 가산이 소수 둘째 자리까지 온다
  // 흔적·전설 안내는 정보줄에 섞지 않고 한 칸 아래 별도 줄로 (2026-08-29 사용자).
  // 티어당 하나만 존재한다 — 흔적은 전설 없는 티어 전용(dropChance), 전설은 deep 전용
  const tierHighlight = traceChance > 0
    ? el('div.muted.small', {}, `✨ 전설의 흔적 ${fmtPct(traceChance)} [${TIER_NAME.deep} 전설 확률↑]`)
    : tierDef.legendaryChance > 0
      ? el('div.muted.small', {}, `⭐ 전설 조우 ${pctShort(tierDef.legendaryChance + diff.legendaryAdd)} [이기려면 CP ${fmtGold(legendWinCp)}]`)
      : null;

  // 전설의 흔적 — 완주로 모아 deep 출발 시 소모 (core/expedition.ts). 있을 때만 한 줄.
  // 표기는 줄바꿈 안 되게 최소한으로 — 소모 시점·유효 기간 등 상세는 확률 정보 시트가 담당 (2026-08-29 사용자)
  const traceHeld = Math.min(content.balance.legendTraces.maxStacks, validLegendTraces(content, state, clock.now()));
  const traceBonus = legendTraceBonus(content, state, clock.now());
  const deepLegendBase = content.balance.tiers.deep.legendaryChance;
  const traceLine = traceHeld > 0
    ? el('div.muted.small', {},
        `✨ 전설의 흔적 ${traceHeld}개 — ${TIER_NAME.deep} 전설 확률 ${fmtPct(deepLegendBase)}→${fmtPct(deepLegendBase + traceBonus)}`)
    : null;

  // 광고 버프 — 야생의 향기 (GDD §9.2). 버프 중 출발한 원정의 포획률 ×2.
  // 광고 불가 환경(프로드 웹)이거나 오늘 소진이면 행을 숨긴다 (전부 보상형·강제 없음)
  const scentActive = state.buffs.scentUntil > clock.now();
  const scentLeft = adUsesLeft(content, state, 'scentBuff', clock.now());
  const scentRow = scentActive
    ? el('div.muted.small', {},
        `🌿 야생의 향기 [포획률 ×${content.balance.capture.adBuffMult} · ${fmtClock(state.buffs.scentUntil)}까지 출발분]`)
    : adsAvailable() && scentLeft > 0
      ? el('div.list-row', {},
          // 두 줄 표기 — 한 줄이면 버튼에 밀려 어중간하게 접힌다 (2026-08-29 사용자).
          // "30분간"은 효과 지속으로 오독되니 "내 출발" 유지 (30분은 출발 창, 효과는 원정 전체)
          el('div', {},
            el('div.small', {}, '🌿 야생의 향기'),
            el('div.muted.small', {},
              `${content.balance.ads.scentMinutes}분 내 출발 원정 포획 ×${content.balance.capture.adBuffMult}`),
          ),
          el('button.btn.btn-ghost.btn-sm', {
            disabled: adBusy(),
            onclick: () => {
              adBusy.set(true);
              void showRewardedAd().then((result) => {
                adBusy.set(false);
                if (result === 'rewarded') grantAdScent();
                else if (result === 'dismissed') toast('광고를 끝까지 봐야 보상을 받아요', 'error');
                else toast('지금은 광고를 불러올 수 없습니다 — 잠시 후 다시', 'error');
              });
            },
          }, adBusy() ? '준비 중…' : `📺 보기 [오늘 ${scentLeft}회]`),
        )
      : null;

  // 권역 탭 — 12행을 탭 4개 + 소지역 3행으로 접는다. 완료 ✓ · 진행 n/3 · 미개방 🔒,
  // 지금 해금을 실행할 수 있는 관문이 있으면 알림 점(탭 점 관용: '보유'가 아니라 '실행 가능')
  const viewTier = selTierView();
  const tierTabs = tabBar(
    regionTiers.map(({ tier: t, regions }) => {
      const unlockedCount = regions.filter((r) => isRegionUnlocked(content, state, r.id)).length;
      const mark = unlockedCount === regions.length ? '✓' : unlockedCount === 0 ? '🔒' : `${unlockedCount}/${regions.length}`;
      return {
        key: String(t),
        label: `${regions[0]!.icon} ${tierShortName(regions)} ${mark}`,
        title: `${regions[0]!.name} 권역 — 소지역 ${unlockedCount}/${regions.length} 해금`,
        dot: regions.some((r) => !isRegionUnlocked(content, state, r.id) && canUnlockRegion(content, state, r.id).ok),
      };
    }),
    { active: String(viewTier), onPick: (key) => pickTier(Number(key)) },
  );
  const viewRegions = (regionTiers.find((t) => t.tier === viewTier) ?? regionTiers[0]!).regions;
  // 잠김 지역 중 첫 번째(다음 관문)만 조건을 펼친다 — 나머지는 이름만 보여 목표는 보이되 목록은 짧게
  const nextGate = content.regionList.find((r) => !isRegionUnlocked(content, state, r.id))?.id;

  return el('div.screen', {},
    tierTabs,
    el('div.card.stack-sm', {}, ...viewRegions.map((r) => regionRow(r.id, {
      selected: r.id === regionId,
      compact: r.id !== nextGate && !isRegionUnlocked(content, state, r.id),
    }))),

    el('h2.section-title', {}, '원정대'),
    el('div.team-grid', {}, ...state.teams.map((t) => teamCard(t))),
    ...lockedTeamLines(state),

    el(`div.card.dispatch-panel${panelOpen() ? '' : '.collapsed'}`, {},
      panelHandle(panelOpen()),
      // 원정대 선택은 접힘 상태에서도 항상 (2026-08-23 사용자)
      el('div.chips-wrap', {}, ...state.teams.map((t) =>
        el(`button.chip${team.id === t.id ? '.active' : ''}`, {
          disabled: busy.has(t.id),
          onclick: () => selTeamId.set(t.id),
        }, busy.has(t.id) ? `🧭 ${t.name}` : t.name))),
      ...(panelOpen() ? [
        el('div.cp-row', {},
          el('span', {}, `${team.name} 유효 전투력`),
          el(`strong.${cpClass}`, {}, info ? fmtGold(info.power) : '—'),
          el('span.muted.small', { title: `${TIER_NAME[tier]}${difficulty !== 'normal' ? ` · ${DIFFICULTY_LABEL[difficulty]}` : ''} 기준 — 이 전투력이면 전멸 위험 0.1% 이하` },
            `/ 권장 ${fmtGold(recommendedCp)}`),
        ),
        synergyChips.length > 0 ? el('div.chips-wrap', {}, ...synergyChips) : el('div.muted.small', {}, '시너지 없음 [같은 종족 2마리부터 발동]'),
        info && info.synergyAmp > 0 ? el('div.muted.small', {}, `시너지 증폭 +${Math.round(info.synergyAmp * 100)}%`) : null,
        el('div.tier-row', {}, ...TIERS.map((t) =>
          el(`button.btn.tier-btn${tier === t ? '.selected' : ''}`, { onclick: () => selTier.set(t) }, TIER_LABEL[t]),
        )),
        // 난이도 칩 — 탐사·원정만 (GDD §5.1). 잠금 없음: 권장 CP를 보고 유저가 판단한다 (2026-09-02 사용자 결정 ④)
        diffAllowed
          ? el('div.chips-wrap', {}, ...DIFFICULTIES.map((d) =>
              el(`button.chip${difficulty === d ? '.active' : ''}`, { onclick: () => selDifficulty.set(d) }, DIFFICULTY_LABEL[d])))
          : null,
        el('div.muted.small', {}, tierInfo),
        tierHighlight,
        traceLine,
        el('div.muted.small', {}, `미끼 자동 적재: ${lureLoad}개 (보유 ${state.wallet.lures})`),
        scentRow,
        maxTeams > 1 || teamsFull
          ? el('div.muted.small', {}, `원정대 ${runningCount}/${maxTeams} 파견 중`)
          : null,
      ] : []),
      el('button.btn.btn-primary.btn-big', {
        tour: 'dispatch', // 온보딩 투어 — 첫 파견 유도 (GDD §11.2)
        disabled: party.length === 0 || teamsFull || teamBusy,
        onclick: () => {
          if (dispatchTeam(team.id, regionId, tier, difficulty)) {
            playSfx('confirm');
            tab.set('home');
          }
        },
      }, teamsFull
        ? `⛺ 원정대가 모두 파견 중입니다 (${runningCount}/${maxTeams})`
        : party.length === 0
          ? '편성이 비어 있습니다 [카드를 눌러 편성]' // 군 이름은 바로 위 전투력 행에 있다 — 16px 버튼 한 줄에 맞춘다 (2026-09-02)
          : el('span.dispatch-label', {},
              `🧭 ${josaRo(region.name)} 출발`, // 갯벌로·우듬지로·심연으로 — '으로' 고정 금지
              // 선택한 파견 길이의 실소요 — 유물 시간 단축 반영, 튜토리얼 첫 원정은 30초 압축 (2026-08-29 사용자)
              el('span.dispatch-time', {},
                `⏱ ${state.profile.tutorialDone ? fmtRemainShort(info?.durationMs ?? content.balance.tiers[tier].minutes * 60_000) : '30초'}`),
            )),
    ),
  );
}
