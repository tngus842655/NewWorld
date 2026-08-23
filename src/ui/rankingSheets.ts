/**
 * 랭킹·반복 과업 시트 (GDD §9.3) — 홈에서 진입.
 * 랭킹: 내 점수(로컬 파생) + 서버 리더보드 (카테고리 전환, 실패 시 조용한 안내).
 */
import { content } from '../content';
import { scoreBreakdown } from '../core/score';
import { taskCounterValue } from '../core/tasks';
import { fetchBoard, submitScore, type BoardRow, type RankCategory } from '../state/ranking';
import { signal } from '../state/signal';
import { save, setNickname } from '../state/store';
import { askText } from './dialog';
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

  const myRows: [string, number][] = [
    ['🏆 종합', scores.total], ['🧭 원정', scores.expedition], ['📖 몬스터', scores.monster],
    ['💎 유물', scores.artifact], ['📋 과업', scores.task], ['⚔️ 전투력', scores.power],
  ];

  const boardBody =
    current.phase === 'loading'
      ? el('div.center.muted.small', {}, '순위를 불러오는 중…')
      : current.phase === 'error'
        ? el('div.center.stack-sm', {},
            el('span.muted.small', {}, '지금은 순위를 불러올 수 없습니다 (오프라인이어도 게임은 계속됩니다)'),
            el('button.btn.btn-ghost', { onclick: () => void loadBoard() }, '다시 시도'),
          )
        : current.rows.length === 0
          ? el('div.center.muted.small', {}, '아직 등록된 개척자가 없습니다 — 첫 주인공이 되어보세요!')
          : el('div.stack-sm', {},
              ...current.rows.map((row, index) =>
                el(`div.rank-row${row.player_id === state.profile.playerId ? '.rank-me' : ''}`, {},
                  el('span.rank-no', {}, `${index + 1}`),
                  el('span.rank-name', {}, row.nickname),
                  el('strong.rank-score', {}, fmtGold(row[category])),
                ),
              ),
              current.myRank !== null && current.myRank > current.rows.length
                ? el('div.center.muted.small', {}, `내 순위: ${current.myRank}위`)
                : null,
            );

  return sheetShell('랭킹',
    el('div.card.list-row', {},
      el('span', {}, `👤 ${state.profile.nickname}`),
      el('button.btn.btn-ghost', {
        onclick: () => {
          void askText({
            title: '닉네임 변경',
            message: '랭킹에 표시될 이름 (2~12자)',
            placeholder: state.profile.nickname,
            confirmLabel: '변경',
          }).then((text) => {
            if (text && setNickname(text)) void loadBoard();
          });
        },
      }, '변경'),
    ),
    el('div.card.stack-sm', {},
      el('div.odds-title', {}, '내 점수'),
      ...myRows.map(([label, value]) =>
        el('div.list-row', {}, el('span.small', {}, label), el('strong', {}, fmtGold(value)))),
      el('div.small.muted', {}, '점수는 도감·육성·원정·과업에서 자동 계산됩니다 · 종합 = 원정+몬스터+유물+과업×2+전투력÷10'),
    ),
    el('div.odds-title', {}, '리더보드'),
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
        el('span.small', {}, `${rewards} · 점수 +${task.score}`),
      ),
    );
  });

  return sheetShell('반복 과업',
    el('div.muted.small', {}, '과업은 몇 번이고 반복 달성할 수 있습니다. 조건을 채우면 보상이 자동 지급되고, 달성 횟수가 랭킹 과업 점수가 됩니다.'),
    ...rows,
  );
}
