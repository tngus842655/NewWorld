/**
 * 등급 체계 무결성 — 정본은 schema.ts의 RARITIES 하나다 (2026-08-25).
 *
 * 존재 이유: 등급 배열을 손으로 적은 리터럴은 컴파일러도 zod도 잡지 못한다.
 * 2026-08-23에 유물 드랍 추첨 목록에서 uncommon이 빠져 표기 확률과 실제가 어긋난 사고가 있었고,
 * 같은 구멍이 UI 6곳·정렬 3곳에 남아 있었다. 등급을 추가할 때 여기가 먼저 빨개져야 한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RARITIES, RARITY_LABEL } from '../src/content/schema';
import { RARITY_ORDER } from '../src/core/effects';
import { RARITY_NEXT } from '../src/core/economy';
import { RARITY_SCORE } from '../src/core/score';
import { content } from './helpers';

describe('등급 체계 (RARITIES 파생)', () => {
  it('정본 배열은 중복 없이 최소 5단계 — 순서가 곧 서열이다', () => {
    expect(new Set(RARITIES).size).toBe(RARITIES.length);
    expect(RARITIES.length).toBeGreaterThanOrEqual(5);
    expect(RARITIES[0]).toBe('common'); // 최하위 고정 — 뒤집힘 회귀 방지
  });

  it('서열표는 RARITIES 순서와 완전히 일치한다', () => {
    expect(Object.keys(RARITY_ORDER)).toEqual([...RARITIES]);
    RARITIES.forEach((rarity, index) => expect(RARITY_ORDER[rarity]).toBe(index));
  });

  it('합성 사다리는 한 칸씩 이어지고 최상위 등급에서만 끊긴다', () => {
    RARITIES.forEach((rarity, index) => {
      expect(RARITY_NEXT[rarity]).toBe(RARITIES[index + 1] ?? null);
    });
    const terminals = RARITIES.filter((rarity) => RARITY_NEXT[rarity] === null);
    expect(terminals).toEqual([RARITIES.at(-1)]);
  });

  it('등급별 수치 테이블 12종에 빠진 등급이 없다', () => {
    const { balance } = content;
    const tables: [string, Record<string, unknown>][] = [
      ['level.rarityCostMult', balance.level.rarityCostMult],
      ['capture.base', balance.capture.base],
      ['rewards.rarityGoldMult', balance.rewards.rarityGoldMult],
      ['artifacts.dropRarity', balance.artifacts.dropRarity],
      ['artifacts.enhance.rarityCostMult', balance.artifacts.enhance.rarityCostMult],
      ['artifacts.dustPerSalvage', balance.artifacts.dustPerSalvage],
      ['fusion.chance', balance.fusion.chance],
      ['shop.monsterGacha.normal', balance.shop.monsterGacha.normal!],
      ['shop.monsterGacha.premium', balance.shop.monsterGacha.premium!],
      ['shop.monsterGacha.goldNormal', balance.shop.monsterGacha.goldNormal!],
      ['shop.artifactGacha.standard', balance.shop.artifactGacha.standard!],
      ['shop.artifactGacha.premium', balance.shop.artifactGacha.premium!],
      ['core/score.ts RARITY_SCORE', RARITY_SCORE],
    ];
    for (const [name, table] of tables) {
      expect(Object.keys(table).sort(), `${name}에 빠지거나 남는 등급`).toEqual([...RARITIES].sort());
    }
  });

  it('확률형 테이블은 합계가 1이다 — 확률 고지와 실제가 어긋나지 않도록', () => {
    // pickWeighted가 가중치를 정규화하기 때문에, 합이 1을 벗어나도 게임은 정상 동작하고
    // 확률 정보 시트만 틀린 값을 보여준다. 조용한 실패라 여기서 잡는다.
    const { shop, artifacts } = content.balance;
    const distributions: [string, Record<string, number>][] = [
      ['artifacts.dropRarity', artifacts.dropRarity],
      ['shop.monsterGacha.normal', shop.monsterGacha.normal!],
      ['shop.monsterGacha.premium', shop.monsterGacha.premium!],
      ['shop.monsterGacha.goldNormal', shop.monsterGacha.goldNormal!],
      ['shop.artifactGacha.standard', shop.artifactGacha.standard!],
      ['shop.artifactGacha.premium', shop.artifactGacha.premium!],
    ];
    for (const [name, table] of distributions) {
      const sum = Object.values(table).reduce((total, value) => total + value, 0);
      expect(sum, `${name}의 확률 합계`).toBeCloseTo(1, 6);
    }
  });

  it('모든 등급에 한글 라벨이 있다', () => {
    for (const rarity of RARITIES) {
      expect(RARITY_LABEL[rarity], `${rarity}의 한글 라벨 누락`).toBeTruthy();
    }
    expect(new Set(Object.values(RARITY_LABEL)).size, '라벨이 중복된 등급이 있다').toBe(RARITIES.length);
  });

  it('모든 등급에 --rar-* 색과 태그 규칙이 있다 (UI에서 회색으로 뜨는 것 방지)', () => {
    // CSS는 자동화할 수 없어 등급 추가 시 가장 조용히 빠지는 자리다. 파일 텍스트로 직접 검사한다.
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const rarity of RARITIES) {
      expect(css, `styles.css에 --rar-${rarity} 누락`).toContain(`--rar-${rarity}:`);
      // .tag가 가장 중요 — 없으면 등급 태그가 앱 전역에서 회색으로 뜬다
      expect(css, `styles.css에 .tag.rar-${rarity} 누락`).toContain(`.tag.rar-${rarity}`);
      expect(css, `styles.css에 .chip.rar-${rarity} 누락 (등급 필터 칩)`).toContain(`.chip.rar-${rarity}`);
      expect(css, `styles.css에 .micon.rar-${rarity} 누락 (몬스터 아이콘 테두리)`).toContain(`.micon.rar-${rarity}`);
    }
  });

  it('콘텐츠의 모든 몬스터·유물 등급이 RARITIES 안에 있다', () => {
    const allowed = new Set<string>(RARITIES);
    for (const monster of content.monsterList) {
      expect(allowed.has(monster.rarity), `${monster.id}의 등급 ${monster.rarity}`).toBe(true);
    }
    for (const artifact of content.artifacts.values()) {
      expect(allowed.has(artifact.rarity), `${artifact.id}의 등급 ${artifact.rarity}`).toBe(true);
    }
  });
});
