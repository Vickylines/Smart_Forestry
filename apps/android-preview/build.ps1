param(
    [Parameter(Mandatory = $true)][string]$JdkPath,
    [Parameter(Mandatory = $true)][string]$SdkPath,
    [string]$BuildToolsVersion = '36.0.0',
    [int]$CompileSdk = 36,
    [switch]$SkipWebBuild,
    [switch]$Inspection
)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$clientPath = Join-Path $workspacePath 'apps/client'
$privatePath = Join-Path $workspacePath '.android-preview'
# aapt2 on Windows cannot reliably open non-ASCII paths. Keep its staging paths ASCII.
$buildCachePath = Join-Path $env:LOCALAPPDATA 'CodexAndroidBuilds/forest-preview'
$buildPath = Join-Path $buildCachePath ('build-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$outputPath = Join-Path $workspacePath 'dist/android'
$toolsPath = Join-Path $SdkPath ('build-tools/' + $BuildToolsVersion)
$platformJar = Join-Path $SdkPath ('platforms/android-' + $CompileSdk + '/android.jar')
$javaPath = Join-Path $JdkPath 'bin/java.exe'
$javacPath = Join-Path $JdkPath 'bin/javac.exe'
$jarPath = Join-Path $JdkPath 'bin/jar.exe'
$keytoolPath = Join-Path $JdkPath 'bin/keytool.exe'
$aaptPath = Join-Path $toolsPath 'aapt2.exe'

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
foreach ($requiredPath in @($javaPath, $javacPath, $jarPath, $aaptPath, $platformJar)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Missing build tool: $requiredPath" }
}
if (-not $SkipWebBuild) {
    Push-Location $clientPath
    try { Invoke-Checked 'npm.cmd' @('run', 'build:h5') } finally { Pop-Location }
}

$classesPath = Join-Path $buildPath 'classes'
$dexPath = Join-Path $buildPath 'dex'
$assetsPath = Join-Path $buildPath 'assets'
$wwwPath = Join-Path $assetsPath 'www'
$nativePath = Join-Path $buildPath 'native'
foreach ($directory in @($classesPath, $dexPath, $wwwPath, $outputPath, $privatePath, $nativePath)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
foreach ($sourceItem in @('res', 'src', 'AndroidManifest.xml')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $sourceItem) -Destination $nativePath -Recurse -Force }
if ($Inspection) {
    # An isolated package for device QA. Never enable debugging in the distributed APK.
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tests/BaiduRegression.java') -Destination (Join-Path $nativePath 'src/BaiduRegression.java')
    $inspectionSources = @(Get-ChildItem -LiteralPath (Join-Path $nativePath 'src') -Filter '*.java' -Recurse)
    $inspectionSources += Get-Item -LiteralPath (Join-Path $nativePath 'AndroidManifest.xml')
    foreach ($source in $inspectionSources) {
        $body = [IO.File]::ReadAllText($source.FullName).Replace('cn.zhihuilinye.preview', 'cn.zhihuilinye.preview.qa').Replace('android:debuggable="false"', 'android:debuggable="true"').Replace('android:label="智慧林业"', 'android:label="智慧林业 QA"').Replace('setContentView(frame);', 'setContentView(frame); getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);')
        [IO.File]::WriteAllText($source.FullName, $body, [Text.UTF8Encoding]::new($false))
    }
    $inspectionManifest = Join-Path $nativePath 'AndroidManifest.xml'
    $inspectionBody = [IO.File]::ReadAllText($inspectionManifest).Replace('</manifest>', '<instrumentation android:name="cn.zhihuilinye.preview.qa.BaiduRegression" android:targetPackage="cn.zhihuilinye.preview.qa" /></manifest>')
    [IO.File]::WriteAllText($inspectionManifest, $inspectionBody, [Text.UTF8Encoding]::new($false))
}
$h5Path = Join-Path $clientPath 'dist/build/h5'
Get-ChildItem -LiteralPath $h5Path | Copy-Item -Destination $wwwPath -Recurse -Force
$resourceZip = Join-Path $buildPath 'resources.zip'
$baseApk = Join-Path $buildPath 'base.apk'
$classesJar = Join-Path $buildPath 'classes.jar'
$alignedApk = Join-Path $buildPath 'aligned.apk'
$signedApk = Join-Path $buildPath 'signed.apk'
$version = '0.3.0'
$suffix = if ($Inspection) { '-inspection' } else { '' }
$finalApk = Join-Path $outputPath ('zhihuilinye-' + $version + $suffix + '.apk')

Invoke-Checked $aaptPath @('compile', '--dir', (Join-Path $nativePath 'res'), '-o', $resourceZip)
Invoke-Checked $aaptPath @('link', '-o', $baseApk, '-I', $platformJar, '--manifest', (Join-Path $nativePath 'AndroidManifest.xml'), '-R', $resourceZip, '--auto-add-overlay')
$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $nativePath 'src') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
Invoke-Checked $javacPath (@('--release', '8', '-encoding', 'UTF-8', '-classpath', $platformJar, '-d', $classesPath) + $sourceFiles)
Invoke-Checked $jarPath @('--create', '--file', $classesJar, '-C', $classesPath, '.')
Invoke-Checked $javaPath @('-cp', (Join-Path $toolsPath 'lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', $platformJar, '--min-api', '29', '--output', $dexPath, $classesJar)
# JAR normalizes ZIP separators; this Windows aapt2 build writes backslashes for -A.
Invoke-Checked $jarPath @('--update', '--file', $baseApk, '-C', $buildPath, 'assets', '-C', $dexPath, 'classes.dex')
$archiveEntries = @(& $jarPath tf $baseApk)
if ($archiveEntries -notcontains 'assets/www/index.html' -or ($archiveEntries | Where-Object { $_.Contains('\') })) { throw 'APK asset paths are not portable' }
Invoke-Checked (Join-Path $toolsPath 'zipalign.exe') @('-f', '4', $baseApk, $alignedApk)
$keystorePath = Join-Path $privatePath 'debug.keystore'
$nativeKeystorePath = Join-Path $buildPath 'debug.keystore'
if (Test-Path -LiteralPath $keystorePath) {
    Copy-Item -LiteralPath $keystorePath -Destination $nativeKeystorePath
} else {
    Invoke-Checked $keytoolPath @('-genkeypair', '-keystore', $nativeKeystorePath, '-storepass', 'android', '-alias', 'androiddebugkey', '-keypass', 'android', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US')
    Copy-Item -LiteralPath $nativeKeystorePath -Destination $keystorePath
}
$signerJar = Join-Path $toolsPath 'lib/apksigner.jar'
Invoke-Checked $javaPath @('-jar', $signerJar, 'sign', '--ks', $nativeKeystorePath, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $signedApk, $alignedApk)
Invoke-Checked $javaPath @('-jar', $signerJar, 'verify', '--verbose', $signedApk)
Copy-Item -LiteralPath $signedApk -Destination $finalApk -Force
$builtApk = Get-Item -LiteralPath $finalApk
$sha256 = (Get-FileHash -LiteralPath $finalApk -Algorithm SHA256).Hash
$packageName = if ($Inspection) { 'cn.zhihuilinye.preview.qa' } else { 'cn.zhihuilinye.preview' }
$info = [ordered]@{ apk = $builtApk.FullName; installApk = $signedApk; bytes = $builtApk.Length; sha256 = $sha256; package = $packageName; version = $version; debuggable = [bool]$Inspection; builtAt = (Get-Date -Format o) }
$info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath ('build-info' + $suffix + '.json')) -Encoding utf8
$info | ConvertTo-Json
