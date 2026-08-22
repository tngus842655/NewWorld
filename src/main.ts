/**
 * 엔트리 포인트 — UI는 M2에서. 지금은 콘텐츠 로드 검증만 한다.
 */
import { content } from './content';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = `<pre style="padding:16px;font-family:monospace">
NewWorld — M1 (코어 시뮬레이션)

콘텐츠 로드 OK
· 몬스터 ${content.monsterList.length}종 / 지역 ${content.regionList.length}곳
· 유물 ${content.artifacts.size}종 / 세트 ${content.sets.size}계열
· 마일스톤 ${content.milestones.length}개

UI는 M2에서 만들어집니다. 일지 데모: npm run demo
</pre>`;
}
