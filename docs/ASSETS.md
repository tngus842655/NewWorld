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
3. **변환본은 저장소 포함, 원본은 미포함.** *(2026-08-24 개정 — 사용자 확인: 256px WebP 변환본은
   저장소에 넣어도 된다)* `public/assets/`의 WebP를 전부 커밋한다 — 클론 즉시 전 에셋 동작.
   IconScout 원본 PNG는 여전히 재배포 금지로 BAK에만 보관, 매핑 대장(assets-manifest.json)이
   "무엇을 어디서 받았나"의 진실.
4. **즉시 다운로드.** MCP `download_asset`이 주는 URL은 만료됨 — 발급 즉시 curl로 저장.

## 2. 수급 목록 (v1)

| 용도 | 수량 | 검색 방향 (asset=3d) |
|---|---|---|
| 몬스터 (도감 219종) | 219 | monster / cute monster / halloween monster / dragon / slime / ghost / robot |
| 유물 (100종) | 100 | medieval weapon / armor / shield / flag / amulet / artifact / relic |
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
- **[완료 2026-08-23] 2배 확장분 전량 수급·변환 (몬스터 104/104 · 유물 56/56)** — 동일 파이프라인.
  기존 톤 유지 위해 기존 매핑 작가 우선 선별, 아이콘 실물 검수로 이름 조정 9건 반영
  (수급 현황은 assets-manifest.json이 진실)
- **[완료 2026-08-24] 재확장분 전량 수급·변환 (몬스터 216/216 · 유물 96/96)** — 동일 파이프라인.
  기존 매핑 작가 우선(Zulfa·Soni Sokell·Creasheeps·Kentung·Fuwa 등) + 신규 팩 활용
  (Taru Epic Medieval 30종 → 유물 무기, Kentung Fantasy Avatar 20종 → 인간형 몬스터).
  콘택트 시트 전수 검사로 교체 7건(큐피드→백조, 픽셀랩터→공룡 등) + 이름 조정 18건
  (온천달팽이, 눌어붙은 마시멜로, 노을홍학, 진혼백조, 태양의 모루, 견습기사 흉갑 등)
- **[완료 2026-08-25] 초월 등급 7점** — 몬스터 3(같은 드래곤의 원소별 리컬러: 빨강·보라·금)
  + 유물 4(용심핵·용린 방벽·군주의 군기·용아검 — 부적/방어구/깃발/무기 4슬롯을 한 점씩). 몬스터는 Flat- Icons `dragon-11304451` 한 점을 `modulate({hue,saturation,brightness})`로
  변주했다 — IconScout이 `can_recolor: true`로 허용한 에셋이고, 실루엣 공유는 '같은 종의 원소 변종'이라는 의도다.
  리컬러 수치는 매핑 대장의 `recolor` 필드에 남겨 언제든 재현·되돌릴 수 있다.
  **탐색 실측 (다음에 드래곤을 다시 찾을 때의 출발점)**: `asset=3d query="dragon"` 1,265건은 대부분 춘절 용(뱀형)·
  용과(dragon fruit)·머리만 크롭. `wyvern`·`phoenix`는 사실상 0건. Ali Rahmat "Dragon Character" 팩 20점은
  **같은 드래곤의 포즈 변형**이라 3종으로 쓸 수 없다. 서로 다른 서양 드래곤 3종은 카탈로그에 없다시피 하다.
- 원본은 `BAK`에 보관 (재다운로드 비용 절약 — 구 NewWorld 25종 원본도 BAK에 있음)
- 구 NewWorld 건물 아이콘 25종: 이번 컨셉에서 미사용. 폐기하지 말고 BAK 유지 (추후 캠프 시설 등장 시 후보)

## 3-1. 에셋 교체·중복 검사 도구 (2026-08-25)

에셋은 나중에 더 나은 것으로 바꾸게 된다. 손으로 하면 순서를 빠뜨리기 쉬워 스크립트로 고정했다.

```bash
# 한 점 교체 — id 검증 → 중복 대조 → BAK 보관 → 256 WebP 변환 → 매핑 대장 갱신
node scripts/swap-asset.mjs monsters emberwing-sovereign ~/Downloads/new-dragon.png --slug dragon-999 --by "Artist"

# 전 에셋 중복 검사 (--all 로 '의심'까지)
node scripts/check-asset-dupes.mjs
```

**중복 판정은 지각 해시(dHash 16×16)로 한다.** sha256이 아닌 이유가 중요하다 —
원본은 PNG(무손실), 저장소 변환본은 WebP q82(손실)라 **같은 그림인데도 픽셀의 43%가 다르다.**
2026-08-25에 정확 해시로 검사했다가 전부 "고유"로 통과했고, 그 상태로 진행하다 에셋 1점을 덮어썼다.
실측 분리도: 같은 그림 PNG↔WebP 7~11% · 진짜 중복 0~4% · 실루엣만 닮은 것(창·작살류) 15~21%
→ 중복선 13%, 의심선 22%.

`swap-asset.mjs`는 **파일을 하나도 쓰기 전에** 검증을 끝낸다 (쓰기를 먼저 했다가 원본까지 날린 전례).
의도적으로 같은 조각을 공유하는 변종(초월 3색 드래곤)은 매핑 대장의 `variantOf`로 묶어 검사에서 제외한다.

**중복 5쌍 해소 완료** (2026-08-25). 쌍마다 '어느 쪽이 잘못됐나'로 교체 대상을 정했다 —
등급이 낮은 쪽이 아니라 **정체와 어긋나는 쪽**을 바꾼다:

| 교체 | 이유 | 새 출처 |
|---|---|---|
| `flame-dancer` | 희귀가 커먼(`spark-wisp`)과 같은 slug를 공유 | `fire-11212183` 갈래 불꽃 |
| `solar-roc` | 전설인데 영웅 갈매기와 판박이 (메모리에도 '등급감 미흡'으로 기록) | `eagle-12730520` 전신 독수리 |
| `ash-dancer` | **속성 불일치** — 암흑인데 주황 불꽃 | `fire-13778238` + 자주 리컬러 |
| `gullwing-pennant` | **슬롯 불일치** — 깃발 슬롯인데 깃털 이미지 | `pennant-9353364` 깃대 페넌트 |
| `bone-orchard-king` | 왕관 해골은 '가라앉은 황제'에 더 맞다 | `skull-6617622` 해골 무더기 |

교체 후 324장 전수 재검사 **중복 0건**. 남은 '의심' 6건은 전부 창·작살·삼지창류로,
서로 다른 물건이 실루엣만 닮은 정상 케이스다(15~21% 구간 — 임계값이 이 구간을 걸러내도록 맞춰져 있다).

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
