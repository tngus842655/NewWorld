# NewWorld — 에셋 파이프라인 (ASSETS)

> 상태: 초안 · 마지막 수정: 2026-08-22
> 원천: IconScout 개인 유료 플랜 (3D 포함, 전 프리미엄 다운로드 가능)

---

## 1. 원칙

1. **작가(스타일) 우선, 낱개 금지.** 몬스터 52종의 톤 통일이 게임의 얼굴이다.
   대형 팩을 내는 작가 1명을 주력으로 정하고(후보: Didik Prasetio, NuFa Studio, Saw Ind,
   Pixoo 3d Team 등 다작 작가), 부족분만 렌더 톤이 비슷한 보조 작가 1~2명으로 채운다.
   낱개 아이콘을 스타일 검토 없이 섞지 않는다.
2. **선(先)파일럿.** M0에서 주력 작가 후보별로 6~8종씩 받아 실제 도감 그리드 목업에 얹어보고
   콜라주 스크린샷으로 사용자 컨펌 후 대량 다운로드.
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
→ download_asset → 즉시 curl → raw/ (원본 PNG 512, git 외부 폴더)
→ scripts/fetch-assets.mjs 대장(assets-manifest.json) 갱신: { assetId, iconscoutId, 작가, 원본파일명 }
→ 빌드 변환: sharp로 128/256 WebP 생성 → public/assets/monsters/{id}@{size}.webp
→ 코드는 asset id로만 참조 (DATA.md §6), 누락 시 실루엣 폴백
```

- `raw/` 원본은 `BAK` 쪽에 두고 주기 백업 (재다운로드 비용 절약 — 구 NewWorld 25종 원본도 BAK에 있음)
- 구 NewWorld 건물 아이콘 25종: 이번 컨셉에서 미사용. 폐기하지 말고 BAK 유지 (추후 캠프 시설 등장 시 후보)

## 4. 라이선스 메모

- IconScout 개인 유료 플랜: 디지털 제품(앱·게임) 내 사용 허용, 원본 파일 재배포·재판매 금지
- 앱 스토어 등록 스크린샷·홍보물 사용 가능
- 출시 전 확인: 구독 해지 후 기존 다운로드 자산의 계속 사용 조건 (플랜 약관 재확인 — M5 체크리스트)
