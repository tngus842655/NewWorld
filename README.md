# NewWorld

2008년 웹게임 **칠용전설**(중국 원작 七龙纪, Age of Seventh Dragon)을 자료 기반으로 재현하는 프로젝트.

- 조사 자료집: https://claude.ai/code/artifact/570a1b1b-6a0e-4b0f-8ea3-f9a624e22489
- 현재 단계: 모바일 웹 싱글 플레이 프로토타입 (도시 건설 · 유닛 훈련 · 영웅 고용)
- 타깃: **모바일 세로 화면** (하단 탭 네비게이션, 터치 우선)

## 설계 원칙

1. **데이터와 코드 분리** — 게임 수치는 전부 `data/*.json`. 코드는 스키마(`src/core/types.ts`)만 안다.
2. **출처 표기** — 모든 데이터에 `provenance` 필드: `4399`(원작 실측) / `baike`(바이두백과) / `estimate`(임시 추정, 교체 대상).
3. **표현물 교체 가능** — 원본 아트·명칭은 참고용(`reference/`, git 제외)으로만 두고, 공개 시점에 자체 제작물로 교체할 수 있는 구조를 유지한다.
4. **저장소 추상화** — 게임 로직은 `StorageAdapter` 인터페이스만 사용. localStorage(기본) ↔ Supabase(.env.local 설정 시) 교체 가능.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속. 저장은 기본 localStorage — Supabase를 쓰려면 `.env.example`을 `.env.local`로 복사하고 값을 채운다.

## 구조

```
data/        게임 데이터 JSON (units/ buildings/ heroes/)
assets/      교체 가능한 아트 (플레이스홀더)
reference/   원본 참고 자료 — git 제외, 배포 금지
src/core/    게임 로직 (틱, 액션, 타입)
src/db/      저장소 어댑터 (localStorage / Supabase)
src/ui/      렌더링
docs/        사양서·계획
```
