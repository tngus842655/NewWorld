import { describe, expect, it } from 'vitest';
import { josa, josaRo } from '../src/ui/kit';

describe('한글 조사 헬퍼', () => {
  it('josa — 받침 유무로 고른다', () => {
    expect(josa('30분', '은', '는')).toBe('30분은');
    expect(josa('13초', '은', '는')).toBe('13초는');
  });

  it('josaRo — ㄹ 받침은 으로가 아니라 로 (서울로 규칙)', () => {
    expect(josaRo('진주 갯벌')).toBe('진주 갯벌로'); // ㄹ 받침
    expect(josaRo('달빛 덤불')).toBe('달빛 덤불로'); // ㄹ 받침
    expect(josaRo('고목의 우듬지')).toBe('고목의 우듬지로'); // 받침 없음
    expect(josaRo('분화구 심장부')).toBe('분화구 심장부로'); // 받침 없음
    expect(josaRo('얼어붙은 심연')).toBe('얼어붙은 심연으로'); // ㄴ 받침
    expect(josaRo('속삭이는 숲')).toBe('속삭이는 숲으로'); // ㅍ 받침
  });
});
