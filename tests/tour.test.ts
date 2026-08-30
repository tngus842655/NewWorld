/**
 * 온보딩 투어 — 단계 판정 순수부 (GDD §11.2). 렌더·차단(DOM)은 브라우저 E2E로.
 */
import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, pickTourStep, tourActive, type TourUi } from '../src/ui/tourSteps';
import { content, makeCtx, saveWithParty } from './helpers';
import { createInitialSave } from '../src/core/newgame';

const UI_HOME: TourUi = { tab: 'home', overlayKind: null };

describe('투어 활성 조건 (tourActive)', () => {
  it('신규 계정은 활성, 완료(tourDone)·기존 유저(tutorialDone·미시작)는 비활성', () => {
    const clock = makeCtx();
    const fresh = createInitialSave(content, clock.ctx);
    expect(tourActive(fresh)).toBe(true);

    const done = structuredClone(fresh);
    done.profile.flags['tourDone'] = true;
    expect(tourActive(done)).toBe(false);

    // 투어 도입 전부터 플레이하던 계정 — tutorialDone인데 시작 흔적 없음 → 투어 안 뜸
    const veteran = structuredClone(fresh);
    veteran.profile.tutorialDone = true;
    expect(tourActive(veteran)).toBe(false);

    // 투어 중 첫 정산으로 tutorialDone이 켜져도 (11단계) 투어는 계속된다
    const midTour = structuredClone(veteran);
    midTour.profile.flags['tourStarted'] = true;
    expect(tourActive(midTour)).toBe(true);
  });
});

describe('단계 진행 (pickTourStep) — 첫 미완료 단계', () => {
  it('신규 계정은 intro부터, 행동이 쌓일수록 순서대로 전진한다', () => {
    const clock = makeCtx();
    const save = createInitialSave(content, clock.ctx);
    const step = (ui: TourUi = UI_HOME) => pickTourStep(save, ui)?.id;

    expect(step()).toBe('intro');
    save.profile.flags['tourIntro'] = true;
    expect(step()).toBe('go-expedition');
    expect(step({ tab: 'expedition', overlayKind: null })).toBe('dispatch');

    // 파견하면 (자동 홈 복귀) 지도 단계
    save.expeditions.push({ id: 'e1' } as never);
    expect(step()).toBe('map');
    expect(step({ tab: 'camp', overlayKind: null })).toBe('home-for-map'); // 딴 데 있으면 홈으로 유도

    save.profile.flags['tourMap'] = true;
    expect(step()).toBe('tab-camp');
    expect(step({ tab: 'camp', overlayKind: null })).toBe('camp-monster');
    expect(step({ tab: 'camp', overlayKind: 'monster' })).toBe('levelup');

    // 시트를 닫아버리면 이전 단계가 다시 안내한다 (자가 복구)
    expect(step({ tab: 'camp', overlayKind: null })).toBe('camp-monster');

    save.roster[0]!.level = 2;
    expect(step({ tab: 'camp', overlayKind: null })).toBe('tab-codex');
    expect(step({ tab: 'codex', overlayKind: null })).toBe('codex-info');
    save.profile.flags['tourCodex'] = true;
    expect(step({ tab: 'codex', overlayKind: null })).toBe('home-for-journal');
    expect(step()).toBe('journal');

    save.journalArchive.push({ expeditionId: 'e1' } as never);
    expect(step()).toBe('attendance');
    save.attendance.days.push(1);
    expect(step()).toBe('finale');
    save.profile.flags['tourDone'] = true;
    expect(pickTourStep(save, UI_HOME)).toBeNull();
  });

  it('레벨업 대신 각성해도 성장 단계로 인정한다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup', star: 2 }]);
    save.profile.flags['tourIntro'] = true;
    save.profile.flags['tourMap'] = true;
    save.expeditions.push({ id: 'e1' } as never);
    expect(pickTourStep(save, { tab: 'camp', overlayKind: null })?.id).toBe('tab-codex');
  });

  it('모든 단계 id는 유일하다', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
