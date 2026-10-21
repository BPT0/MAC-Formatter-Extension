# 크롬 웹스토어 제출용 zip을 만든다.
# 실행: powershell -ExecutionPolicy Bypass -File tools/package.ps1
# 결과: dist/mac-formatter-<manifest 버전>.zip (개발용 파일 tools/, tests/, samples/, .claude/, .git/ 은 포함하지 않는다)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path.TrimEnd("\")

# 패키지에 넣을 파일과 폴더(허용 목록). 새 런타임 파일을 추가하면 여기에도 추가한다.
$runtimeFiles = @(
  "manifest.json", "background.js", "content.js",
  "popup.html", "popup.css", "popup.js",
  "mac-utils.js", "preprocess.js", "detect.js", "ocr.js", "recognizer.js"
)
$runtimeDirs = @("icons", "vendor")

function Fail($message) {
  Write-Host "[실패] $message" -ForegroundColor Red
  exit 1
}

# --- manifest 점검 ---------------------------------------------------------
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') { Fail "version 형식이 올바르지 않습니다: $($manifest.version)" }
if ($manifest.name.Length -gt 45) { Fail "name이 45자를 넘습니다 ($($manifest.name.Length)자)" }
if ($manifest.description.Length -gt 132) { Fail "description이 132자를 넘습니다 ($($manifest.description.Length)자)" }

$referenced = @($manifest.background.service_worker, $manifest.action.default_popup)
$referenced += $manifest.icons.PSObject.Properties.Value
foreach ($script in $manifest.content_scripts) { $referenced += $script.js }
foreach ($path in $referenced) {
  if (-not (Test-Path (Join-Path $root $path))) { Fail "manifest가 참조하는 파일이 없습니다: $path" }
  $top = $path.Split("/")[0]
  if (($runtimeFiles -notcontains $path) -and ($runtimeDirs -notcontains $top)) { Fail "manifest가 참조하는 파일이 패키지 목록에 없습니다: $path" }
}

# popup.html이 불러오는 스크립트/스타일이 모두 패키지 안에 있고 외부 주소가 아닌지 확인
$popup = Get-Content (Join-Path $root "popup.html") -Raw -Encoding UTF8
if ($popup -match '<script[^>]+src="https?:') { Fail "popup.html이 외부 스크립트를 불러옵니다 (원격 코드는 허용되지 않습니다)" }
foreach ($match in [regex]::Matches($popup, '(?:src|href)="([^"]+)"')) {
  $ref = $match.Groups[1].Value
  if ($ref -match '^(https?:|data:|#)') { continue }
  if (-not (Test-Path (Join-Path $root $ref))) { Fail "popup.html이 참조하는 파일이 없습니다: $ref" }
  $top = $ref.Split("/")[0]
  if (($runtimeFiles -notcontains $ref) -and ($runtimeDirs -notcontains $top)) { Fail "popup.html이 참조하는 파일이 패키지 목록에 없습니다: $ref" }
}

# --- 파일 모으기 -----------------------------------------------------------
$files = @()
foreach ($name in $runtimeFiles) {
  $full = Join-Path $root $name
  if (-not (Test-Path $full)) { Fail "패키지 목록의 파일이 없습니다: $name" }
  $files += Get-Item $full
}
foreach ($dir in $runtimeDirs) {
  $full = Join-Path $root $dir
  if (-not (Test-Path $full)) { Fail "패키지 목록의 폴더가 없습니다: $dir" }
  $files += Get-ChildItem $full -Recurse -File
}

# --- zip 만들기 (항목 경로는 / 로 저장) ------------------------------------
$distDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force $distDir | Out-Null
$zipPath = Join-Path $distDir "mac-formatter-$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $entryName = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

# --- 결과 검증 -------------------------------------------------------------
$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $names = $check.Entries | ForEach-Object { $_.FullName }
  if ($names -notcontains "manifest.json") { Fail "zip 최상위에 manifest.json이 없습니다" }
  $forbidden = $names | Where-Object { $_ -match '^(tools|tests|samples|\.claude|\.git|dist)/' }
  if ($forbidden) { Fail "개발용 파일이 포함되었습니다: $($forbidden -join ', ')" }
  if ($names | Where-Object { $_ -match '\\' }) { Fail "zip 항목 경로에 역슬래시가 있습니다" }
  $count = $check.Entries.Count
} finally {
  $check.Dispose()
}

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[완료] $zipPath"
Write-Host "       버전 $($manifest.version), 파일 $count 개, $sizeMb MB"
