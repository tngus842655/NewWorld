/**
 * 원정 일지 뷰 — 엔트리를 카드 타임라인으로, 순차 공개 연출 (GDD §5.5).
 */
import { content } from '../content';
import type { Journal, JournalEntry } from '../core/types';
import { monsterIcon } from './components';
import { ARTIFACT_RARITY_LABEL, TIER_LABEL, el, fmtGold, fmtPct } from './kit';
import { playSfx, type SfxId } from './sfx';

const REVEAL_INTERVAL_MS = 420;

function monsterName(id: string): string {
  return content.monsters.get(id)?.name ?? id;
}
function artifactLabel(itemId: string): string {
  const def = content.artifacts.get(itemId);
  return def ? `[${ARTIFACT_RARITY_LABEL[def.rarity]}] ${def.name}` : itemId;
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
            el('div.jline', {}, `⚔️ ${name} 조우 — 패주…`),
            el('div.jsub', {}, `전투력 ${fmtGold(entry.partyPower)} vs ${fmtGold(entry.enemyPower)} · HP ${fmtPct(entry.hpAfter)} · 목격 기록`),
          ),
        );
      }
      const lines: HTMLElement[] = [
        el('div.jline', {}, entry.result === 'autowin' ? `⚔️ ${name} 조우 — 기선 제압, 자동 승리!` : `⚔️ ${name} 조우 — 승리!`),
        el('div.jsub', {}, `골드 +${fmtGold(entry.gold)} · HP ${fmtPct(entry.hpAfter)}`),
      ];
      if (entry.capture) {
        const retry = entry.capture.retried ? ' (올가미 재시도)' : '';
        if (entry.capture.success && entry.capture.dupe) {
          lines.push(el('div.jline.jcapture', {}, `🎯 포획 성공${retry} — 카드 +1`));
        } else if (entry.capture.success) {
          lines.push(el('div.jline.jcapture.jnew', {}, `🎯 포획 성공${retry} — 도감 신규 등록!`));
        } else {
          lines.push(el('div.jline.jmiss', {}, `🎯 포획 시도${retry}… 놓쳤다`));
        }
      }
      if (entry.artifact) lines.push(el('div.jline.jdrop', {}, `💎 전설의 전리품! ${artifactLabel(entry.artifact.itemId)}`));
      return el('div.jcard.jcard-mon', {},
        monsterIcon(entry.monsterId),
        el('div.jbody', {}, ...lines),
      );
    }
    case 'treasure': {
      const lines = [el('div.jline', {}, `💰 ${eventName('treasures', entry.eventId)} — 골드 +${fmtGold(entry.gold)}`)];
      if (entry.artifact) lines.push(el('div.jline.jdrop', {}, `💎 유물 발굴! ${artifactLabel(entry.artifact.itemId)}`));
      return el('div.jcard', {}, ...lines);
    }
    case 'trap':
      return el(`div.jcard${entry.avoided ? '' : '.jcard-bad'}`, {},
        el('div.jline', {}, entry.avoided
          ? `🕳️ ${eventName('traps', entry.eventId)} — 날렵하게 회피!`
          : `🕳️ ${eventName('traps', entry.eventId)} — 당했다! HP ${fmtPct(entry.hpAfter)}`),
      );
    case 'gather':
      return el('div.jcard', {},
        el('div.jline', {}, `🌿 ${eventName('gathers', entry.eventId)} — ${content.materials.get(entry.materialId)?.name} ×${entry.count}`),
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
        el('div.jline', {}, `🔀 ${name} → ${picked} — ${outcome}`),
        rewardText ? el('div.jsub', {}, rewardText) : null,
      );
    }
    case 'wipe':
      return entry.revived
        ? el('div.jcard.jrevive', {}, el('div.jline', {}, `✨ 전멸 위기 — 원정대가 다시 일어선다! HP ${fmtPct(entry.hpAfter)}`))
        : el('div.jcard.jcard-bad', {}, el('div.jline', {}, '💀 전멸… 원정대가 서둘러 철수한다 (전리품 일부 소실)'));
    case 'clearBox':
      return el('div.jcard.jdrop-card', {}, el('div.jline.jdrop', {}, `🎁 심층 완주 상자 — ${artifactLabel(entry.artifact.itemId)}`));
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

  const footer = el(`div.jfooter${opts.instant ? '' : '.jhidden'}`, {},
    el('div.jline', {}, `🏕️ 귀환 — ${summaryBits}`),
    totals.capturedMonsterIds.length > 0
      ? el('div.jsub', {}, `📖 도감 등록: ${totals.capturedMonsterIds.map(monsterName).join(', ')}`)
      : null,
    ...newMilestones.map((id) => {
      const milestone = content.milestones.find((m) => m.id === id);
      return milestone
        ? el('div.jline.jmilestone', {}, `🏅 마일스톤 달성: ${milestone.name}${milestone.reward.gold ? ` (+골드 ${fmtGold(milestone.reward.gold)})` : ''}`)
        : null;
    }),
  );

  const timeline = el('div.jtimeline', {}, ...cards, footer);
  const title = el('div', {},
    el('div.jtitle', {}, `📜 ${region?.name ?? journal.regionId} · ${TIER_LABEL[journal.tier]}`),
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
      skip.remove();
    },
  }, '한번에 보기');

  return el('div.journal', {},
    el('div.jheader', {}, title, skip),
    timeline,
  );
}
