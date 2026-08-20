# 건물 아이콘 에셋 목록

기지 화면(`src/ui/cityview.ts`)은 `public/assets/buildings/<건물id>.png` 가 있으면
그 이미지로 건물을 그리고, 없으면 코드로 그린 상자로 폴백한다.

**이 이미지들은 저장소에 없다.** IconScout 유료 구독으로 받은 것이라
`.gitignore` 로 제외했다(기존 `units/` · `city/` 와 같은 정책).
저장소만 clone 하면 아이콘 없이 코드 그림으로 동작한다.

## 주의: 빌드는 에셋이 있는 로컬에서

`npm run build` 는 `public/` 을 `dist/` 로 복사하므로 **로컬 빌드 결과물에는
아이콘이 포함된다**(완성품 안에 포함되는 것이라 라이선스상 문제없다).
반대로 CI 등에서 clone 후 빌드하면 아이콘 없이 배포되니, 배포용 번들은
반드시 에셋이 있는 환경에서 만들 것.

## 재다운로드 방법

IconScout MCP 커넥터로 아래 slug 를 받아 해당 파일명으로 저장한다.
포맷 `png`, 크기는 비고에 없으면 500×500.

    download_asset(slug=<slug>, format="png", width=500, height=500)
      -> 응답의 download_url 을 즉시 curl (만료되는 URL이다)
      -> public/assets/buildings/<건물id>.png 로 저장

## 목록 (25/38)

| 건물id | 표시명 | IconScout slug | 제작자 | 비고 |
|---|---|---|---|---|
| sawmill | 채굴장 | `coal-mining-industry-8762109` | Novia Manda Sari | 500×333 |
| quarry | 제련소 | `steel-factory-13249303` | Haca Studio | |
| barracks | 병영 | `military-base-9797727` | Anggi Yansyah | |
| academy | 연구소 | `laboratory-14041435` | Charcoal 3D | |
| market | 거래소 | `marketplace-17353695` | Scarlet Dsgn | |
| turret | 포탑 | `turret-defence-10937974` | Naufal Imaanullah | |
| radar | 레이더 | `radar-11536406` | Orenji Studio | |
| ore-refinery | 광물 정제소 | `cement-factory-15732934` | Ifodiseno | |
| alloy-foundry | 합금 주조소 | `steel-factory-15732818` | Ifodiseno | |
| power-plant | 발전소 | `power-plant-13487349` | Haca Studio | |
| warehouse | 물류 창고 | `warehouse-13487347` | Haca Studio | |
| advanced-barracks | 고급 병영 | `military-base-18138314` | Dzulfikar Laode | |
| factory | 기갑 공장 | `factory-14664641` | Haraki Studio | |
| starport | 우주항 | `rocket-launch-pad-7184502` | Aurora Studio | |
| armory | 병기고 | `military-supply-storage-11094482` | Fariha F Maghfiro | |
| medbay | 의무동 | `hospital-11617592` | Aurora Studio | |
| bunker | 지하 병영 | `bunker-6299936` | IconScout Store | |
| command-post | 전술 지휘소 | `control-room-7846972` | Flat- Icons | |
| garage | 탈것 정비고 | `garage-10055593` | Didik Prasetio | |
| shield-generator | 실드 제너레이터 | `shield-10168569` | Illustraly Design | |
| observatory | 관제탑 | `control-tower-17139463` | Haca Studio | |
| arena | 투기장 | `stadium-12138905` | Creavie Studio | |
| workshop | 장비 공방 | `anvil-with-hot-metal-18308543` | Sajjat Hoshan | 500×400 |
| guild-hall | 연맹 지부 | `city-hall-11734490` | Mintemid | |
| warp-gate | 차원문 | `futuristic-sci-fi-portal-gate-18657136` | Aga Arsari | |

## 아직 없는 13종

farm(보급창) · crystal-mine(가스 추출기) · tavern(용병 사무소) · ration-plant(보급품 가공소) ·
gas-processor(가스 정제탑) · black-market(암시장) · beast-pen(생체 사육장) ·
missile-turret(미사일 포탑) · shield-battery(방어막 충전소) · training-ground(지휘관 훈련장) ·
relic-vault(유물 보관고)

rampart(성벽) · gate(성문) 은 IconScout 대상이 아니다. 성벽 *구간* 은 유료에도 없고
전부 "성 한 채" 단위라서, 코드 드로잉이나 CC0 3D(Poly Pizza 의 Quaternius Stone Wall)를 쓴다.

## 알려진 문제

- 아이콘 크기가 `CH*1.02 + 레벨*1.6`(최대 85px)인데 칸 높이는 `CH≈67px` 이라
  위로 삐져나가고 0번 행이 잘린다. 수정안: `size = CH*0.88 + min(level,10)*0.7`,
  앵커 `baseY - size + CH*0.12`
- 제작자가 달라 색·조명·받침대 유무가 제각각이다. 근본 해결은 소스(.glb/.blend)를
  받아 동일 카메라·조명으로 일괄 재렌더하는 것
