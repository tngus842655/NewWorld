/**
 * 월간 출석 시트 (v8, GDD §9) — 이번 달 달력에 도장을 찍고 n일차 보상을 받는다.
 * 보상은 출석 순서대로라 며칠 빠져도 사다리를 계속 탄다. 다이아의 v1 유일 획득처.
 */
import { content } from '../content';
import type { AttendanceReward } from '../content/schema';
import { attendanceNow, canCheckIn, monthParts, nextReward } from '../core/attendance';
import { checkInToday, nowTick, save } from '../state/store';
import { el, fmtGold, toast } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function rewardText(reward: AttendanceReward): string {
  const bits = [
    reward.diamonds ? `💎 ${reward.diamonds}` : null,
    reward.gold ? `💰 ${fmtGold(reward.gold)}` : null,
    reward.dust ? `✨ ${reward.dust}` : null,
    reward.lures ? `🪤 ${reward.lures}` : null,
  ].filter((bit): bit is string => bit !== null);
  return bits.join(' · ');
}

export function attendanceSheet(): HTMLElement {
  const state = save();
  const now = nowTick(); // 자정 넘김·시간 도약에도 반응
  const { month, day: today } = monthParts(now);
  const { days } = attendanceNow(state, now);
  const [yearStr, monthStr] = month.split('-') as [string, string];
  const year = Number(yearStr);
  const monthNo = Number(monthStr);
  const daysInMonth = new Date(year, monthNo, 0).getDate();
  const firstDow = new Date(year, monthNo - 1, 1).getDay();
  const { rewards } = content.balance.attendance;

  // 달력 셀 — 도장(출석) / 오늘 / 미래 구분
  const cells: HTMLElement[] = Array.from({ length: firstDow }, () => el('div.attend-cell.blank', {}));
  for (let d = 1; d <= daysInMonth; d++) {
    const stamped = days.includes(d);
    const cell = el('div.attend-cell', {}, el('span.attend-day', {}, `${d}`), stamped ? el('span.attend-stamp', {}, '✔') : null);
    if (stamped) cell.classList.add('stamped');
    if (d === today) cell.classList.add('today');
    if (d > today) cell.classList.add('future');
    cells.push(cell);
  }

  // 다가올 보상 미리보기 (다음 3개) — 다이아 데이가 보이게
  const upcoming: HTMLElement[] = [];
  for (let i = days.length; i < Math.min(days.length + 3, rewards.length); i++) {
    upcoming.push(el(`div.list-row${i === days.length ? '.attend-next' : ''}`, {},
      el('span.muted.small', {}, `${i + 1}일차${i === days.length ? ' (다음)' : ''}`),
      el('span.small', {}, rewardText(rewards[i]!)),
    ));
  }

  const claimable = canCheckIn(state, now);
  const reward = nextReward(content, state, now);
  const totalDiamonds = rewards.reduce((sum, r) => sum + (r.diamonds ?? 0), 0);

  return sheetShell(`📅 ${monthNo}월 출석`,
    el('div.card.codex-summary', {},
      el('div', {}, el('strong', {}, `${days.length}`), el('span.muted', {}, `일 출석`)),
      el('div.muted.small', {}, `이번 달 다이아 총 💎 ${totalDiamonds} · 매월 1일 초기화`),
    ),
    el('div.card.stack-sm', {},
      el('div.attend-cal', {}, ...DOW.map((d) => el('div.attend-dow', {}, d))),
      el('div.attend-cal', {}, ...cells),
    ),
    el('button.btn.btn-primary.attend-claim', {
      disabled: !claimable,
      onclick: () => {
        const result = checkInToday();
        if (!result) return;
        playSfx(result.reward?.diamonds ? 'treasure' : 'confirm');
        toast(result.reward
          ? `${result.dayIndex}일차 출석! ${rewardText(result.reward)}`
          : `${result.dayIndex}일차 출석! (이번 달 보상은 모두 받았습니다)`, 'ok');
      },
    }, claimable
      ? reward
        ? `출석하고 받기 [${rewardText(reward)}]`
        : '출석 도장 찍기 (보상 완료)'
      : '오늘 출석 완료 ✓'),
    upcoming.length > 0 ? el('div.card.stack-sm', {}, ...upcoming) : null,
    el('div.muted.small.center', {}, '보상은 날짜가 아니라 출석한 순서대로 받습니다'),
  );
}
