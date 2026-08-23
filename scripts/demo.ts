/**
 * 일지 데모 CLI (M1 DoD) — 파견→정산 풀 사이클을 돌리고 일지를 한글로 출력한다.
 *
 *   npm run demo
 *   npm run demo -- --region sunken-marsh --tier deep --seed abc --level 30 --choice safe
 */
import { content } from '../src/content';
import { chooseCrossroad, claimExpedition, createExpedition } from '../src/core/expedition';
import { createInitialSave } from '../src/core/newgame';
import type { CoreCtx, GrantedReward, Journal } from '../src/core/types';

// ── 인자 파싱 ────────────────────────────────────────────────────────────────
function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}
const regionId = arg('region', 'misty-coast');
const tier = arg('tier', 'standard') as 'scout' | 'standard' | 'deep';
const seed = arg('seed', `demo-${Date.now() % 1_000_000}`);
const level = Number(arg('level', '6'));
const choice = arg('choice', 'risky') as 'safe' | 'risky';

// ── 실행 ─────────────────────────────────────────────────────────────────────
let virtualNow = Date.now();
let uidNo = 0;
const ctx: CoreCtx = {
  now: () => virtualNow,
  newSeed: () => seed,
  newUid: () => `demo-uid-${++uidNo}`,
};

let save = createInitialSave(content, ctx);
for (const monster of save.roster) monster.level = level; // 데모 편의: 파티 레벨 지정
for (const region of content.regionList) save.profile.flags[`region:${region.id}`] = true;
save.wallet.lures = 3;

const partyIds = save.teams[0]!.partyIds;
const created = createExpedition(content, save, { regionId, tier, partyIds, artifactIds: [] }, ctx);
save = created.save;
const expedition = created.expedition;
for (let i = 0; i < expedition.choices.length; i++) {
  save = chooseCrossroad(save, expedition.id, i, choice);
}

virtualNow = expedition.endsAt + 1; // 시간 도약 (데모)
const { save: after, journal, newMilestones } = claimExpedition(content, save, expedition.id, ctx);

// ── 출력 ─────────────────────────────────────────────────────────────────────
const region = content.regions.get(regionId)!;
const tierLabel = { scout: '정찰 (15분)', standard: '원정 (2시간)', deep: '심층 탐사 (8시간)' }[tier];
const artifactRarityLabel = { common: '일반', uncommon: '고급', rare: '희귀', heroic: '영웅', legendary: '전설' } as const;
const pct = (hp: number) => `${Math.round(hp * 100)}%`;
const monsterName = (id: string) => content.monsters.get(id)?.name ?? id;
const artifactLine = (itemId: string) => {
  const def = content.artifacts.get(itemId)!;
  return `[${artifactRarityLabel[def.rarity]}] ${def.name}`;
};
const rewardText = (r: GrantedReward): string => {
  switch (r.kind) {
    case 'gold': return `골드 +${r.amount}`;
    case 'material': return `${content.materials.get(r.materialId)?.name ?? r.materialId} ×${r.count}`;
    case 'card': return `${monsterName(r.monsterId)} 카드 +${r.count}`;
    case 'artifact': return `💎 ${artifactLine(r.drop.itemId)}`;
    case 'lure': return `미끼 +${r.count}`;
  }
};
const eventName = (kind: 'treasures' | 'traps' | 'gathers' | 'crossroads', id: string) =>
  (content.events[kind] as { id: string; name: string }[]).find((e) => e.id === id)?.name ?? id;

const party = expedition.partyIds
  .map((id) => save.roster.find((m) => m.monsterId === id) ?? after.roster.find((m) => m.monsterId === id))
  .filter(Boolean)
  .map((m) => `${monsterName(m!.monsterId)} Lv.${m!.level}`);

console.log('');
console.log(`🌍 ${region.name} · ${tierLabel}   (시드: ${journal.seed})`);
console.log(`👥 원정대: ${party.join(', ')}`);
console.log('─'.repeat(60));

const lines: string[] = [];
for (const entry of journal.entries) {
  switch (entry.type) {
    case 'encounter': {
      const name = monsterName(entry.monsterId);
      if (entry.result === 'flee') {
        lines.push(`⚔️ ${name} 조우 — 패주… (전투력 ${entry.partyPower} vs ${entry.enemyPower}, HP ${pct(entry.hpAfter)}) [목격 기록]`);
        break;
      }
      const head = entry.result === 'autowin' ? `⚔️ ${name} 조우 — 기선 제압, 자동 승리!` : `⚔️ ${name} 조우 — 승리!`;
      lines.push(`${head} (골드 +${entry.gold}, HP ${pct(entry.hpAfter)})`);
      if (entry.capture) {
        const retry = entry.capture.retried ? ' (올가미 재시도)' : '';
        if (entry.capture.success && entry.capture.dupe) {
          lines.push(`   🎯 포획 성공${retry} — 이미 아는 종, 카드 +1`);
        } else if (entry.capture.success) {
          lines.push(`   🎯 포획 성공${retry} — 도감 신규 등록!`);
        } else {
          lines.push(`   🎯 포획 시도${retry}… 놓쳤다!`);
        }
      }
      if (entry.artifact) lines.push(`   💎 전설의 전리품! ${artifactLine(entry.artifact.itemId)}`);
      break;
    }
    case 'treasure':
      lines.push(`💰 ${eventName('treasures', entry.eventId)} — 골드 +${entry.gold}`);
      if (entry.artifact) lines.push(`   💎 유물 발굴! ${artifactLine(entry.artifact.itemId)}`);
      break;
    case 'trap':
      lines.push(
        entry.avoided
          ? `🕳️ ${eventName('traps', entry.eventId)} — 날렵하게 회피!`
          : `🕳️ ${eventName('traps', entry.eventId)} — 당했다! (HP ${pct(entry.hpAfter)})`,
      );
      break;
    case 'gather':
      lines.push(`🌿 ${eventName('gathers', entry.eventId)} — ${content.materials.get(entry.materialId)?.name} ×${entry.count}`);
      break;
    case 'crossroad': {
      const name = eventName('crossroads', entry.eventId);
      const picked = entry.choice === 'risky' ? '위험을 감수한다' : '안전하게 간다';
      const outcome = entry.success ? '성공!' : entry.salvaged ? '실패… 하지만 여명의 나침반이 빛난다' : `실패… (HP ${pct(entry.hpAfter)})`;
      const rewards = entry.rewards.length > 0 ? ` → ${entry.rewards.map(rewardText).join(', ')}` : '';
      lines.push(`🔀 갈림길: ${name} → ${picked} — ${outcome}${rewards}`);
      break;
    }
    case 'wipe':
      lines.push(entry.revived ? `✨ 전멸 위기 — 쓰러진 원정대가 다시 일어선다! (HP ${pct(entry.hpAfter)})` : '💀 전멸… 원정대가 서둘러 철수한다 (전리품 일부 소실)');
      break;
    case 'clearBox':
      lines.push(`🎁 심층 완주 상자 — ${artifactLine(entry.artifact.itemId)}`);
      break;
  }
}
for (const line of lines) console.log(line);

console.log('─'.repeat(60));
const t = journal.totals;
const materialText = Object.entries(t.materials).map(([id, n]) => `${content.materials.get(id)?.name} ×${n}`).join(', ');
const cardTotal = Object.values(t.cards).reduce((a, b) => a + b, 0);
console.log(`🏕️ 귀환 — 골드 ${t.gold}${materialText ? ` · ${materialText}` : ''}${cardTotal ? ` · 카드 +${cardTotal}` : ''}${t.capturedMonsterIds.length ? ` · 신규 ${t.capturedMonsterIds.length}종` : ''}${t.artifacts.length ? ` · 유물 ${t.artifacts.length}점` : ''}`);
if (t.capturedMonsterIds.length > 0) console.log(`📖 도감 등록: ${t.capturedMonsterIds.map(monsterName).join(', ')}`);
for (const id of newMilestones) {
  const milestone = content.milestones.find((m) => m.id === id)!;
  console.log(`🏅 마일스톤 달성: ${milestone.name} (+골드 ${milestone.reward.gold ?? 0})`);
}
console.log(`💼 지갑: 골드 ${after.wallet.gold} · 미끼 ${after.wallet.lures} · 도감 ${Object.values(after.codex).filter((c) => c.captured).length}/52`);
console.log('');
