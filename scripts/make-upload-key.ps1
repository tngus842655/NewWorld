<#
.SYNOPSIS
플레이스토어 업로드 키를 만들고 android/keystore.properties까지 채운다. (MoneyGame 이식)

.DESCRIPTION
비밀번호를 한 번만 물어보고 키스토어와 설정 파일에 같은 값을 넣는다.
둘을 따로 입력하다가 어긋나면 gradle이 "Keystore was tampered with, or password was
incorrect"라는 엉뚱한 메시지를 내는데, 그걸 원천적으로 막기 위함이다.

⚠️ 만들어진 .keystore를 잃어버리면 com.expeditionmonsters.app은 영영 업데이트할 수 없다.
   즉시 클라우드와 외장 드라이브 등 두 군데 이상에 백업할 것.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts/make-upload-key.ps1

.NOTES
반드시 터미널 창에서 직접 실행할 것. 비밀번호를 입력받아야 해서
stdin이 없는 환경(에디터의 실행 버튼 등)에서는 실패한다.
#>
param(
    # 기본값은 android/newworld-upload.keystore. 테스트할 때만 바꾼다.
    [string] $KeystorePath,
    [string] $PropertiesPath,
    [string] $Alias = 'newworld',
    # 자동화·테스트용. 평소에는 쓰지 말 것 — 비밀번호가 명령 기록에 남는다.
    [string] $Password
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $KeystorePath)   { $KeystorePath   = Join-Path $root 'android\newworld-upload.keystore' }
if (-not $PropertiesPath) { $PropertiesPath = Join-Path $root 'android\keystore.properties' }

if (Test-Path $KeystorePath) {
    Write-Host "이미 있습니다: $KeystorePath" -ForegroundColor Yellow
    Write-Host "덮어쓰면 기존 키를 잃습니다. 새로 만들려면 파일을 먼저 옮기세요." -ForegroundColor Yellow
    exit 1
}

# keytool 찾기: PATH → JAVA_HOME → 흔한 JDK 설치 위치 순.
# 이 PC는 JAVA_HOME이 비어 있고 PATH의 java.exe도 Oracle javapath 스텁(keytool 없음)이라
# 마지막 폴더 검색까지 있어야 확실하다.
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool -and $env:JAVA_HOME) {
    $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    if (Test-Path $candidate) { $keytool = $candidate }
}
if (-not $keytool) {
    $roots = @('C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft')
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        $found = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue |
                 ForEach-Object { Join-Path $_.FullName 'bin\keytool.exe' } |
                 Where-Object { Test-Path $_ } |
                 Select-Object -First 1
        if ($found) { $keytool = $found; break }
    }
}
if (-not $keytool -or -not (Test-Path $keytool)) {
    throw 'keytool을 찾지 못했습니다. JDK를 설치하거나 JAVA_HOME을 설정하세요.'
}
Write-Host "keytool: $keytool" -ForegroundColor DarkGray

if (-not $Password) {
    Write-Host ''
    Write-Host '업로드 키를 만듭니다. 비밀번호는 최소 6자입니다.' -ForegroundColor Cyan
    Write-Host '이 비밀번호는 android\keystore.properties에도 자동으로 들어갑니다.' -ForegroundColor Cyan
    Write-Host ''
    $toPlain = {
        param($secure)
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    $first  = & $toPlain (Read-Host '비밀번호' -AsSecureString)
    $second = & $toPlain (Read-Host '비밀번호 확인' -AsSecureString)
    if ($first -ne $second) { throw '두 번 입력한 비밀번호가 다릅니다.' }
    $Password = $first
}
if ($Password.Length -lt 6) { throw '비밀번호는 6자 이상이어야 합니다.' }

# validity 10000일(약 27년) — Play는 2033-10-22 이후까지 유효한 키만 받는다.
# -storepass/-keypass를 인자로 넘기면 잠깐 프로세스 목록에 보이지만, 어차피 같은 값이
# keystore.properties에 평문으로 남는다(gradle이 그렇게 읽는다). 개인 PC 기준 감수한다.
& $keytool -genkeypair -v `
    -keystore  $KeystorePath `
    -alias     $Alias `
    -keyalg    RSA `
    -keysize   2048 `
    -validity  10000 `
    -storepass $Password `
    -keypass   $Password `
    -dname     'CN=Expedition Monsters, OU=Individual, O=Expedition Monsters, L=Seoul, ST=Seoul, C=KR'

if ($LASTEXITCODE -ne 0) { throw "키 생성 실패 (exit $LASTEXITCODE)" }

# gradle이 읽는 형식. storeFile은 android/ 기준 상대 경로.
$props = @(
    '# scripts/make-upload-key.ps1이 만든 파일. 커밋 금지 (android/.gitignore에 있음).'
    ('storeFile=' + (Split-Path -Leaf $KeystorePath))
    ('storePassword=' + $Password)
    ('keyAlias=' + $Alias)
    ('keyPassword=' + $Password)
)
# BOM 없이 쓴다. Windows PowerShell 5.1의 `-Encoding utf8`은 BOM을 붙이는데,
# gradle이 쓰는 java.util.Properties는 BOM을 첫 줄의 일부로 읽어 엉뚱한 항목을 만든다.
[System.IO.File]::WriteAllLines($PropertiesPath, $props, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host "키스토어 : $KeystorePath"   -ForegroundColor Green
Write-Host "설정 파일: $PropertiesPath" -ForegroundColor Green
Write-Host ''
Write-Host '이제 서명된 .aab를 만들 수 있습니다:' -ForegroundColor Cyan
Write-Host '  npm run build:aab'
Write-Host ''
Write-Host '⚠️ 키스토어 파일을 반드시 두 군데 이상에 백업하세요.' -ForegroundColor Yellow
Write-Host '   잃어버리면 이 앱은 영영 업데이트할 수 없습니다.' -ForegroundColor Yellow
