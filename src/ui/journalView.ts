/**
 * 원정 일지 뷰 — 엔트리를 카드 타임라인으로, 순차 공개 연출 (GDD §5.5).
 */
import { content } from '../content';
import type { Journal, JournalEntry } from '../core/types';
import { adsAvailable, showRewardedAd } from '../platform/ads';
import { grantJournalDouble, save } from '../state/store';
import { monsterIcon } from './components';
import { ARTIFACT_RARITY_LABEL, DIFFICULTY_LABEL, RARITY_ORDER, TIER_LABEL, el, fmtGold, fmtPct, toast } from './kit';
import { playSfx, type SfxId } from './sfx';

const REVEAL_INTERVAL_MS = 420;

function monsterName(id: string): string {
  return content.monsters.get(id)?.name ?? id;
}
function artifactLabel(itemId: string): string {
  const def = content.artifacts.get(itemId);
  return def ? `[${ARTIFACT_RARITY_LABEL[def.rarity]}] ${def.name}` : itemId;
}
/** 유물 드랍 줄 — 등급색으로 표시 (전설 고정색이던 것을 실제 등급 연동으로, 2026-08-24) */
function artifactDropLine(text: string, itemId: string): HTMLElement {
  const line = el('div.jline.jdrop', {}, text);
  const def = content.artifacts.get(itemId);
  if (def) line.style.color = `var(--rar-${def.rarity})`;
  return line;
}
/** 영웅 이상 조우 카드를 카드째 빛나게 하는 등급 클래스 — 등급이 늘어도 서열로 따라온다 (2026-08-25) */
function rarityCardClass(rarity: string): string {
  const rank = RARITY_ORDER[rarity as keyof typeof RARITY_ORDER];
  return rank !== undefined && rank >= RARITY_ORDER.heroic ? `.jcard-rar-${rarity}` : '';
}
function eventName(kind: 'treasures' | 'traps' | 'gathers' | 'crossroads', id: string): string {
  return (content.events[kind] as { id: string; name: string }[]).find((e) => e.id === id)?.name ?? id;
}

/** 카드당 1음 — 포획 결과음이 승리·드랍음보다 우선 (GDD §11.1) */
function entrySfx(entry: JournalEntry): SfxId | null {
  switch (entry.type) {
    case 'encounter':
      if (entry.result === 'flee') return 'defeat';
      if (entry.capture) {
        if (!entry.capture.success) return 'capture-miss';
        return entry.capture.dupe ? 'capture-dupe' : 'capture-new';
      }
      return entry.artifact ? 'artifact' : null;
    case 'treasure': return entry.artifact ? 'artifact' : 'treasure';
    case 'trap': return entry.avoided ? null : 'trap';
    case 'gather': return 'gather';
    case 'crossroad': return entry.success ? 'treasure' : 'defeat';
    case 'wipe': return entry.revived ? 'revive' : 'wipe';
    case 'clearBox': return 'artifact';
  }
}

function entryCard(entry: JournalEntry): HTMLElement {
  switch (entry.type) {
    case 'encounter': {
      const name = monsterName(entry.monsterId);
      // 조우 카드엔 몬스터 얼굴을 — 패주(목격만)는 실루엣으로 (GDD §5.5)
      if (entry.result === 'flee') {
        return el('div.jcard.jcard-bad.jcard-mon', {},
          monsterIcon(entry.monsterId, { silhouette: true }),
          el('div.jbody', {},
            el('div.jline', {}, `⚔️ ${name} 조우 [패주…]`),
            el('div.jsub', {}, `전투력 ${fmtGold(entry.partyPower)} vs ${fmtGold(entry.enemyPower)} · HP ${fmtPct(entry.hpAfter)} · 목격 기록`),
          ),
        );
      }
      const lines: HTMLElement[] = [
        el('div.jline', {}, entry.result === 'autowin' ? `⚔️ ${name} 조우 [기선 제압, 자동 승리!]` : `⚔️ ${name} 조우 [승리!]`),
        el('div.jsub', {}, `골드 +${fmtGold(entry.gold)} · HP ${fmtPct(entry.hpAfter)}`),
      ];
      if (entry.capture) {
        const retry = entry.capture.retried ? ' (올가미 재시도)' : '';
        if (entry.capture.success && entry.capture.dupe) {
          lines.push(el('div.jline.jcapture', {}, `🎯 포획 성공${retry} [카드 +1]`));
        } else if (entry.capture.success) {
          lines.push(el('div.jline.jcapture.jnew', {}, `🎯 포획 성공${retry} [도감 신규 등록!]`));
        } else {
          lines.push(el('div.jline.jmiss', {}, `🎯 포획 시도${retry}… 놓쳤다`));
        }
      }
      if (entry.artifact) lines.push(artifactDropLine(`💎 전설의 전리품! ${artifactLabel(entry.artifact.itemId)}`, entry.artifact.itemId));
      const rarity = content.monsters.get(entry.monsterId)?.rarity ?? 'common';
      return el(`div.jcard.jcard-mon${rarityCardClass(rarity)}`, {},
        monsterIcon(entry.monsterId),
        el('div.jbody', {}, ...lines),
      );
    }
    case 'treasure': {
      const lines = [el('div.jline', {}, `💰 ${eventName('treasures', entry.eventId)} [골드 +${fmtGold(entry.gold)}]`)];
      if (entry.artifact) lines.push(artifactDropLine(`💎 유물 발굴! ${artifactLabel(entry.artifact.itemId)}`, entry.artifact.itemId));
      const dropRarity = entry.artifact ? content.artifacts.get(entry.artifact.itemId)?.rarity ?? 'common' : 'common';
      return el(`div.jcard${rarityCardClass(dropRarity)}`, {}, ...lines);
    }
    case 'trap':
      return el(`div.jcard${entry.avoided ? '' : '.jcard-bad'}`, {},
        el('div.jline', {}, entry.avoided
          ? `🕳️ ${eventName('traps', entry.eventId)} [날렵하게 회피!]`
          : `🕳️ ${eventName('traps', entry.eventId)} [당했다! HP ${fmtPct(entry.hpAfter)}]`),
      );
    case 'gather':
      return el('div.jcard', {},
        el('div.jline', {}, `🌿 ${eventName('gathers', entry.eventId)} [${content.materials.get(entry.materialId)?.name} ×${entry.count}]`),
      );
    case 'crossroad': {
      const name = eventName('crossroads', entry.eventId);
      const picked = entry.choice === 'risky' ? '위험을 감수' : '안전한 길';
      const rewardText = entry.rewards.map((r) => {
        switch (r.kind) {
          case 'gold': return `골드 +${fmtGold(r.amount)}`;
          case 'material': return `${content.materials.get(r.materialId)?.name} ×${r.count}`;
          case 'card': return `${monsterName(r.monsterId)} 카드 +${r.count}`;
          case 'artifact': return `💎 ${artifactLabel(r.drop.itemId)}`;
          case 'lure': return `미끼 +${r.count}`;
        }
      }).join(' · ');
      const outcome = entry.success ? '성공!' : entry.salvaged ? '실패… 그러나 절반의 보상' : `실패… HP ${fmtPct(entry.hpAfter)}`;
      return el(`div.jcard${entry.success ? '' : '.jcard-bad'}`, {},
        el('div.jline', {}, `🔀 ${name} → ${picked} [${outcome}]`),
        rewardText ? el('div.jsub', {}, rewardText) : null,
      );
    }
    case 'wipe':
      return entry.revived
        ? el('div.jcard.jrevive', {}, el('div.jline', {}, `✨ 전멸 위기 [원정대가 다시 일어선다! HP ${fmtPct(entry.hpAfter)}]`))
        : el('div.jcard.jcard-bad', {}, el('div.jline', {}, '💀 전멸… 서둘러 철수한다 (전리품 일부 소실)'));
    case 'clearBox': {
      const boxRarity = content.artifacts.get(entry.artifact.itemId)?.rarity ?? 'common';
      return el(`div.jcard.jdrop-card${rarityCardClass(boxRarity)}`, {},
        artifactDropLine(`🎁 완주 상자 ${artifactLabel(entry.artifact.itemId)}`, entry.artifact.itemId));
    }
  }
}

export interface JournalViewOpts {
  /** 재열람 모드 — 순차 연출·효과음 없이 전체를 바로 보여준다 */
  instant?: boolean;
  /** 제목 아래 보조 줄 (예: '3시간 전 귀환') */
  subtitle?: string;
}

export function journalView(journal: Journal, newMilestones: string[], opts: JournalViewOpts = {}): HTMLElement {
  const region = content.regions.get(journal.regionId);
  const totals = journal.totals;

  const cards = journal.entries.map((entry) => {
    const card = entryCard(entry);
    if (!opts.instant) card.classList.add('jhidden');
    return card;
  });

  const materialText = Object.entries(totals.materials).map(([id, n]) => `${content.materials.get(id)?.name} ×${n}`).join(' · ');
  const cardTotal = Object.values(totals.cards).reduce((a, b) => a + b, 0);
  const summaryBits = [
    `골드 ${fmtGold(totals.gold)}`,
    materialText || null,
    cardTotal > 0 ? `카드 +${cardTotal}` : null,
    totals.capturedMonsterIds.length > 0 ? `신규 ${totals.capturedMonsterIds.length}종` : null,
    totals.artifacts.length > 0 ? `유물 ${totals.artifacts.length}점` : null,
  ].filter(Boolean).join(' · ');

  // 광고 2배 (GDD §9.2 — 원정당 1회, 골드·재료만: 카드·포획·유물은 도감 자산).
  // 정산 직후·아카이브 재열람 양쪽에서 노출 — 이미 받았거나 받을 재화가 없으면 숨긴다
  const doubleRow = ((): HTMLElement | null => {
    if (!adsAvailable()) return null;
    const entry = save().journalArchive.find((j) => j.expeditionId === journal.expeditionId);
    if (!entry?.journal || entry.doubled) return null;
    if (totals.gold <= 0 && Object.keys(totals.materials).length === 0) return null;
    const label = '📺 광고 보고 골드·재료 2배 받기 [원정당 1회]';
    const btn = el('button.btn.btn-ghost.btn-sm', {
      onclick: () => {
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = '📺 광고 준비 중…';
        void showRewardedAd().then((result) => {
          if (result === 'rewarded' && grantJournalDouble(journal.expeditionId)) {
            playSfx('treasure');
            btn.replaceWith(el('div.jline', {}, '✅ 보상을 2배로 받았습니다'));
            return;
          }
          (btn as HTMLButtonElement).disabled = false;
          btn.textContent = label;
          if (result === 'dismissed') toast('광고를 끝까지 봐야 보상을 받아요', 'error');
          else if (result === 'unavailable') toast('지금은 광고를 불러올 수 없습니다 — 잠시 후 다시', 'error');
        });
      },
    }, label);
    return el('div.jline', {}, btn);
  })();

  const footer = el(`div.jfooter${opts.instant ? '' : '.jhidden'}`, {},
    el('div.jline', {}, `🏕️ 귀환 [${summaryBits}]`),
    totals.capturedMonsterIds.length > 0
      ? el('div.jsub', {}, `📖 도감 등록: ${totals.capturedMonsterIds.map(monsterName).join(', ')}`)
      : null,
    journal.legendTrace
      ? el('div.jline', {}, `✨ 전설의 흔적 발견 [다음 ${TIER_LABEL.deep} 전설 확률↑]`)
      : null,
    doubleRow,
    ...newMilestones.map((id) => {
      const milestone = content.milestones.find((m) => m.id === id);
      return milestone
        ? el('div.jline.jmilestone', {}, `🏅 마일스톤 달성: ${milestone.name}${milestone.reward.gold ? ` (+골드 ${fmtGold(milestone.reward.gold)})` : ''}`)
        : null;
    }),
  );

  const timeline = el('div.jtimeline', {}, ...cards, footer);
  const title = el('div', {},
    // 난이도는 보통이 아닐 때만 덧붙인다 (GDD §5.1 난이도, 2026-09-02)
    el('div.jtitle', {},
      `📜 ${region?.name ?? journal.regionId} · ${TIER_LABEL[journal.tier]}${journal.difficulty && journal.difficulty !== 'normal' ? ` · ${DIFFICULTY_LABEL[journal.difficulty]}` : ''}`),
    opts.subtitle ? el('div.muted.small', {}, opts.subtitle) : null,
  );

  if (opts.instant) {
    return el('div.journal', {}, el('div.jheader', {}, title), timeline);
  }

  const all = [...cards, footer];
  const sfxIds: (SfxId | null)[] = [
    ...journal.entries.map(entrySfx),
    newMilestones.length > 0 ? 'milestone' : null,
  ];

  let revealed = 0;
  const revealNext = (withSound = true): boolean => {
    const node = all[revealed];
    if (!node) return false;
    node.classList.remove('jhidden');
    node.classList.add('jreveal');
    const sfx = sfxIds[revealed];
    if (withSound && sfx) playSfx(sfx);
    revealed++;
    timeline.scrollTop = timeline.scrollHeight;
    return true;
  };
  revealNext();
  const interval = setInterval(() => {
    if (!timeline.isConnected || !revealNext()) clearInterval(interval);
  }, REVEAL_INTERVAL_MS);

  const skip = el('button.btn.btn-ghost', {
    onclick: () => {
      while (revealNext(false)); // 일괄 공개는 무음 — 전 카드 동시 재생 방지
      clearInterval(interval);
      skip.style.visibility = 'hidden'; // remove()는 헤더 높이가 줄어 시트가 출렁인다
    },
  }, '한번에 보기');

  return el('div.journal', {},
    el('div.jheader', {}, title, skip),
    timeline,
  );
}
