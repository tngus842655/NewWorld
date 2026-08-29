# 안드로이드 릴리스 빌드 (원정 몬스터즈)

**평소에는 이것만 하면 된다.** `android/app/build.gradle`에서 `versionCode`를 올리고,
cmd 창에서 `C:\Workspace\NewWorld\android`로 들어가 두 줄을 친다.

```
gradlew.bat clean
gradlew.bat bundleRelease
```

`android\app\build\outputs\bundle\release\app-release.aab`가 나온다. 이걸 Play Console에 올린다.

> `npm run build`를 따로 칠 필요가 없다. gradle이 빌드 전에 알아서 vite로 `dist/`를 다시 만들고
> 앱 안으로 복사한다(`makeWebDist` → `capCopy` → `preBuild`). 이 두 태스크가 빠지면
> **앱 안에 예전 게임이 그대로 들어간 채 스토어에 올라간다** — 그래서 빌드에 묶어 두었다.
> (gradle의 vite 실행은 타입체크를 생략한다 — `npm run typecheck`는 개발 게이트에서 돈다)

| 항목 | 값 |
| --- | --- |
| 패키지 이름 | `com.expeditionmonsters.app` — **첫 Play 업로드 전까지만 변경 가능** |
| 앱 표시명 | 원정 몬스터즈 |
| SDK | `C:\Android\Sdk` (`android/local.properties`, 커밋 안 됨) |
| 서명 키 | `android/newworld-upload.keystore` (커밋 안 됨) |
| 산출물 | `android/app/build/outputs/bundle/release/app-release.aab` |

Android Studio는 필요 없다. JDK(17+)와 위 SDK만 있으면 된다.

---

## 구글 로그인 (네이티브 특이사항)

회원 전용 게임이라 로그인이 안 되면 앱이 게이트에서 멈춘다. 웹뷰 안의 구글 OAuth는
구글이 차단하므로(disallowed_useragent) 네이티브는 **시스템 브라우저(커스텀 탭)로 나갔다
딥링크로 복귀**한다 (`state/cloud.ts`).

- 딥링크: `com.expeditionmonsters.app://auth-callback`
  — `cloud.ts NATIVE_REDIRECT`와 `AndroidManifest.xml`의 intent-filter가 같은 값이어야 한다
- **Supabase 대시보드 설정 필요 (1회)**: Authentication → URL Configuration → Redirect URLs에
  `com.expeditionmonsters.app://auth-callback`을 추가해야 실기기 로그인이 동작한다.
  구글 콘솔 쪽은 손댈 것 없음 (커스텀 탭이 웹과 같은 리디렉션 경로를 탄다)

---

## 처음 한 번만 — 업로드 키 만들기

키가 없으면 `bundleRelease`가 **시작하자마자 멈추고** 안내를 띄운다.

```
powershell -ExecutionPolicy Bypass -File C:\Workspace\NewWorld\scripts\make-upload-key.ps1
```

비밀번호를 한 번 물어보고 두 파일을 같이 만든다.

- `android\newworld-upload.keystore` — 서명 키
- `android\keystore.properties` — gradle이 읽는 설정 (같은 비밀번호가 자동으로 들어감)

둘 다 `android/.gitignore`에 있어 커밋되지 않는다.

> ⚠️ **키를 잃어버리면 `com.expeditionmonsters.app`은 영영 업데이트할 수 없다.**
> 만든 즉시 클라우드와 외장 드라이브 등 **두 군데 이상**에 백업할 것.
> (2026-08-29 초기 키는 자동 생성 — 비밀번호는 `android\keystore.properties` 안에 있다.
> 첫 Play 업로드 전이라면 두 파일을 지우고 위 명령으로 원하는 비밀번호로 다시 만들어도 된다.)

서명이 제대로 붙었는지 확인:

```
gradlew.bat signingReport
```

`Variant: release`의 `Config`가 `null`이 아니면 정상이다.

---

## 버전 올리기

`android/app/build.gradle`의 두 값.

```gradle
versionCode <직전 값 + 1>
versionName "<보이는 버전, 예: 0.2.0>"
```

`versionCode`는 한 번 올라간 번호를 재사용할 수 없고 콘솔에서도 못 고친다.

---

## 아이콘을 바꿨을 때

원본은 `public/app-icon/icon-512-v1.png` 하나다. 갈아 끼운 뒤:

```
npm run icons
```

런처 아이콘(밀도 5종 + 적응형), 스플래시, 스토어 512 아이콘(`store/icon-512.png`)이 다시 만들어진다.

---

## 다른 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm run build:aab` | 위 두 줄과 같다 (저장소 루트에서 실행) |
| `npm run build:android` | 웹 자산 빌드 + 전체 sync. **플러그인을 더하거나 뺐을 때만** (평소 빌드는 copy만 돈다) |
| `npm run make-key` | 업로드 키 생성 |
| `npm run icons` | 아이콘·스플래시·스토어 아이콘 재생성 |

---

## 막힐 때

| 증상 | 원인 |
| --- | --- |
| `서명 키가 없습니다` | 위 '처음 한 번만'을 안 했다 |
| `Keystore was tampered with, or password was incorrect` | `keystore.properties`의 비밀번호가 키스토어와 다르다. 스크립트로 다시 만들면 둘이 항상 같아진다 |
| `SDK location not found` | `android/local.properties`에 `sdk.dir=C:/Android/Sdk`가 없다 |
| 앱에 예전 게임이 들어 있다 | `makeWebDist`/`capCopy`가 안 돈 것이다. `gradlew.bat clean` 후 다시 |
| 앱에서 구글 로그인이 안 된다 | Supabase Redirect URLs에 딥링크 미등록 (위 '구글 로그인' 참고) |
| 빌드가 꼬여 보인다 | `gradlew.bat clean` 한 번 |
