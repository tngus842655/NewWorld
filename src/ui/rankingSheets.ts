/**
 * 랭킹·반복 과업 시트 (GDD §9.3) — 홈에서 진입.
 * 랭킹: 내 점수(로컬 파생) + 서버 리더보드 (카테고리 전환, 실패 시 조용한 안내).
 */
import { content } from '../content';
import { scoreBreakdown } from '../core/score';
import { taskCounterValue } from '../core/tasks';
import { fetchBoard, submitScore, type BoardRow, type RankCategory } from '../state/ranking';
import { signal } from '../state/signal';
import { save } from '../state/store';
import { el, fmtGold } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

const CATEGORY_LABEL: Record<RankCategory, string> = {
  total: '🏆 종합', expedition: '🧭 원정', monster: '📖 몬스터',
  artifact: '💎 유물', task: '📋 과업', power: '⚔️ 전투력',
};
const CATEGORIES: RankCategory[] = ['total', 'expedition', 'monster', 'artifact', 'task', 'power'];

type BoardState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; rows: BoardRow[]; myRank: number | null };

const boardCategory = signal<RankCategory>('total');
const board = signal<BoardState>({ phase: 'loading' });
let loadToken = 0;

async function loadBoard(): Promise<void> {
  const token = ++loadToken;
  board.set({ phase: 'loading' });
  await submitScore(save()); // 내 최신 점수 먼저 반영
  const result = await fetchBoard(boardCategory(), save().profile.playerId);
  if (token !== loadToken) return; // 그 사이 다시 열었으면 이 응답은 버린다
  board.set(result ? { phase: 'ready', ...result } : { phase: 'error' });
}

/** 랭킹 시트를 열 때 호출 — 종합 탭으로 리셋하고 서버 조회 시작 */
export function openRankingBoard(): void {
  boardCategory.set('total');
  void loadBoard();
}

export function rankingSheet(): HTMLElement {
  const state = save();
  const scores = scoreBreakdown(content, state);
  const current = board();
  const category = boardCategory();
  const myScore: Record<RankCategory, number> = {
    total: scores.total, expedition: scores.expedition, monster: scores.monster,
    artifact: scores.artifact, task: scores.task, power: scores.power,
  };

  const rankRow = (rank: number | null, name: string, score: number, me: boolean) =>
    el(`div.rank-row${me ? '.rank-me' : ''}`, {},
      el('span.rank-no', {}, rank === null ? '—' : `${rank}`),
      el('span.rank-name', {}, name),
      el('strong.rank-score', {}, fmtGold(score)),
    );

  const boardBody =
    current.phase === 'loading'
      ? el('div.center.muted.small', {}, '순위를 불러오는 중…')
      : current.phase === 'error'
        ? el('div.center.stack-sm', {},
            el('span.muted.small', {}, '지금은 순위를 불러올 수 없습니다 (오프라인이어도 게임은 계속됩니다)'),
            rankRow(null, `${state.profile.nickname} (내 점수)`, myScore[category], true),
            el('button.btn.btn-ghost', { onclick: () => void loadBoard() }, '다시 시도'),
          )
        : el('div.stack-sm', {},
            ...(current.rows.length === 0
              ? [el('div.center.muted.small', {}, '아직 등록된 개척자가 없습니다 — 첫 주인공이 되어보세요!')]
              : current.rows.map((row, index) =>
                  rankRow(index + 1, row.nickname, row[category], row.player_id === state.profile.playerId))),
            // 상위 50 밖이면 내 행을 하단에 강조로
            current.rows.every((row) => row.player_id !== state.profile.playerId)
              ? rankRow(current.myRank, state.profile.nickname, myScore[category], true)
              : null,
          );

  // 닉네임 변경은 설정 탭으로 — 여기는 순위 확인 전용 (2026-08-23 사용자)
  const shell = sheetShell('🏆 랭킹',
    el('div.chips-wrap', {}, ...CATEGORIES.map((c) =>
      el(`button.chip${category === c ? '.active' : ''}`, {
        onclick: () => {
          playSfx('tap');
          boardCategory.set(c);
          void loadBoard();
        },
      }, CATEGORY_LABEL[c]))),
    boardBody,
  );
  shell.classList.add('sheet-full'); // 팝업이 아닌 전체 화면 (2026-08-23 사용자)
  return shell;
}

const COUNTER_LABEL = { expedition: '원정 완료', capture: '몬스터 포획', craft: '미끼 제작', fusion: '합성 시도' } as const;

export function tasksSheet(): HTMLElement {
  const state = save();

  const rows = content.tasks.map((task) => {
    const value = taskCounterValue(state, task.counter);
    const into = value % task.every;
    const claimed = state.tasks[task.id] ?? 0;
    const rewards = [
      task.reward.gold > 0 ? `골드 ${task.reward.gold}` : null,
      task.reward.dust > 0 ? `가루 ${task.reward.dust}` : null,
    ].filter(Boolean).join(' + ');
    const fill = el('div.progress-fill');
    fill.style.width = `${Math.round((into / task.every) * 100)}%`;
    return el('div.card.stack-sm', {},
      el('div.list-row', {},
        el('span', {}, `${task.icon} ${task.name}`),
        el('span.muted.small', {}, claimed > 0 ? `달성 ×${claimed}` : '미달성'),
      ),
      el('div.progress', {}, fill),
      el('div.list-row', {},
        el('span.muted.small', {}, `${COUNTER_LABEL[task.counter]} ${into}/${task.every}회`),
        el('span.small', {}, rewards), // 점수는 내부 관리만 — 표시 안 함 (2026-08-23 사용자)
      ),
    );
  });

  return sheetShell('반복 과업',
    el('div.muted.small', {}, '조건을 채우면 보상이 자동 지급됩니다 · 무한 반복'),
    ...rows,
  );
}
