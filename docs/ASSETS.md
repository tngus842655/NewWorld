# NewWorld — 에셋 파이프라인 (ASSETS)

> 상태: 초안 · 마지막 수정: 2026-08-22
> 원천: IconScout 개인 유료 플랜 (3D 포함, 전 프리미엄 다운로드 가능)

---

## 1. 원칙

1. **작가(스타일) 우선, 낱개 금지.** 몬스터 52종의 톤 통일이 게임의 얼굴이다.
   **[확정 2026-08-22] 주력: Saw Ind** — Monsters & Magic Halloween Collection(25, 팩ID
   `monsters-magic-halloween-collection-3d-icon-pack_369694`) + Reptiles And Amphibians(15,
   `reptiles-and-amphibians-3d-icon-pack_275659`). 클레이 질감 정면 얼굴 스타일, 3000px, png/blend 제공.
   **보조: IconScout Store — Mascot & Monster**(20, `mascot-monster-3d-icon-pack_159248`) 슬라임·눈알 계열.
   유물 후보: Saw Ind 오브젝트(마법서·수정구·솥 등) + Naufal Hudallah Adventure Game(35, `adventure-game-3d-icon-pack_273009`).
2. **선(先)파일럿. [완료]** 후보 6작가 콜라주 비교로 결정 — 사용자 이견 시 대량 다운로드 전 교체.
3. **저장소 미포함.** IconScout 라이선스상 원본 재배포 금지 — `public/assets/`는 .gitignore 유지
   (구 NewWorld와 동일 원칙). 대신 이 문서의 매핑 대장이 "무엇을 어디서 받았나"의 진실.
4. **즉시 다운로드.** MCP `download_asset`이 주는 URL은 만료됨 — 발급 즉시 curl로 저장.

## 2. 수급 목록 (v1)

| 용도 | 수량 | 검색 방향 (asset=3d) |
|---|---|---|
| 몬스터 (도감 52종) | 52 | monster / cute monster / halloween monster / dragon / slime / ghost / robot |
| 유물 (28종) | 28 | medieval weapon / armor / shield / flag / amulet / artifact / relic |
| 지역 배너 | 5 | forest / swamp / volcano / island / ruins (또는 illustration으로 대체 검토) |
| 재료 아이콘 | 8 | herb / shell / crystal / moss / branch ... |
| 재화·아이템 | 6± | gold coin / potion / trap / treasure chest |
| UI 엠블럼 (속성 5·종족 6) | 11 | flame / leaf / snowflake / sun / moon / paw / wing ... (2D icon 팩도 후보) |
| 연출 Lottie | 3± | confetti / sparkle / level up |

- 몬스터 52종의 종별 배정(어느 아이콘이 "가시덩쿨 늑대"인가)은 M1에서 monsters.json과 함께 확정
- 등급 차별화는 에셋이 아니라 프레임(테두리·배경 광택)으로 — 에셋 요구를 늘리지 않는 장치

## 3. 파이프라인

```
search_assets (작가·팩 단위 탐색, 그리드로 사용자와 함께 선별)
→ download_asset(png 500) → 만료 전 즉시 curl → C:/Workspace/BAK/NewWorld-assets-raw/monsters/{id}.png
→ 매핑 대장: scripts/assets-manifest.json { 몬스터id: { slug, contributor } } — 저장소에 커밋
→ node scripts/build-assets.mjs : sharp로 256px WebP → public/assets/monsters/{id}.webp (git 미포함)
→ 코드는 asset id로만 참조 (DATA.md §6), 파일 누락 시 종족 이모지 폴백
```

- **[완료 2026-08-22] 몬스터 52종 전량 수급·변환** (총 ~600KB). 새 기기/클론에서는 BAK 원본으로
  build-assets.mjs만 재실행하면 복원된다
- 원본은 `BAK`에 보관 (재다운로드 비용 절약 — 구 NewWorld 25종 원본도 BAK에 있음)
- 구 NewWorld 건물 아이콘 25종: 이번 컨셉에서 미사용. 폐기하지 말고 BAK 유지 (추후 캠프 시설 등장 시 후보)

## 4-1. 사운드 (SFX) 매핑 대장 — 2026-08-23

원천: `C:\Workspace\util\Audio`의 **Kenney 3팩 (CC0)**. IconScout와 달리 재배포 자유이므로
선별본을 `public/assets/sfx/{id}.ogg`로 리네임해 **저장소에 커밋**한다 (총 23개 ≈ 160KB).
설계 원칙은 GDD §11.1. 참고: ogg는 iOS 웹뷰 미지원 — 앱인토스 트랙 재개 시 m4a 일괄 변환.

| id | 용도 | 원본 (팩 / 파일) |
|---|---|---|
| tap | 탭·일반 버튼 | interface / click_001 |
| open | 시트 열림 | interface / open_001 |
| close | 시트 닫힘 | interface / close_001 |
| confirm | 파견 출발·슬롯 확장 | interface / confirmation_001 |
| error | 오류 토스트 | interface / error_004 |
| question | 갈림길 시트 등장 | interface / question_001 |
| select | 갈림길 선택 | interface / select_001 |
| treasure | 보물·갈림길 성공 | interface / glass_002 |
| defeat | 패주·갈림길 실패 | impact / impactSoft_medium_000 |
| trap | 함정 피격 | impact / impactSoft_heavy_000 |
| artifact | 유물 발굴·완주 상자 | impact / impactBell_heavy_000 |
| gather | 채집 | impact / impactMining_000 |
| enhance | 유물 강화 | impact / impactMetal_medium_000 |
| salvage | 유물 분해 | impact / impactGlass_medium_000 |
| craft | 미끼 제작 | impact / impactPlank_medium_000 |
| capture-new | 포획 성공 (신규 등록) | digital-audio / powerUp1 |
| capture-dupe | 포획 성공 (정수 전환) | digital-audio / powerUp5 |
| capture-miss | 포획 실패 | digital-audio / lowDown |
| levelup | 레벨업 | digital-audio / powerUp3 |
| awaken | 각성 | digital-audio / powerUp6 |
| revive | 전멸 부활 (언데드 시너지) | digital-audio / powerUp7 |
| wipe | 전멸 | digital-audio / lowThreeTone |
| milestone | 도감 마일스톤 달성 | digital-audio / threeTone1 |

- 교체 시 이 표만 고치고 같은 id로 파일을 갈아끼우면 코드 수정 불필요 (코드는 id만 안다)

## 4. 라이선스 메모

- IconScout 개인 유료 플랜: 디지털 제품(앱·게임) 내 사용 허용, 원본 파일 재배포·재판매 금지
- 앱 스토어 등록 스크린샷·홍보물 사용 가능
- 출시 전 확인: 구독 해지 후 기존 다운로드 자산의 계속 사용 조건 (플랜 약관 재확인 — M5 체크리스트)
