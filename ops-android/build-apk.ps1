$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$CmdToolsZip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
$CmdToolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'

New-Item -ItemType Directory -Force -Path $Sdk | Out-Null
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk

if (-not (Test-Path (Join-Path $Sdk 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
  Write-Host 'Downloading Android cmdline-tools...'
  Invoke-WebRequest -Uri $CmdToolsUrl -OutFile $CmdToolsZip -UseBasicParsing
  $Tmp = Join-Path $env:TEMP 'android-cmdline-tools-extract'
  if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
  Expand-Archive -Path $CmdToolsZip -DestinationPath $Tmp -Force
  $Dest = Join-Path $Sdk 'cmdline-tools\latest'
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  # zip contains 'cmdline-tools' folder
  $Inner = Get-ChildItem $Tmp | Select-Object -First 1
  Move-Item $Inner.FullName $Dest
}

$SdkManager = Join-Path $Sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
Write-Host 'Installing platform-34 + build-tools...'
$packages = @('platform-tools', 'platforms;android-34', 'build-tools;34.0.0')
cmd /c "echo y| `"$SdkManager`" --sdk_root=`"$Sdk`" $($packages -join ' ')"

Set-Location $Root
if (-not (Test-Path 'local.properties')) {
  "sdk.dir=$($Sdk -replace '\\','\\')" | Set-Content -Encoding ASCII local.properties
  # local.properties needs escaped backslashes or forward slashes
  "sdk.dir=$($Sdk -replace '\\','/')" | Set-Content -Encoding ASCII local.properties
}

Write-Host 'Building debug APK...'
& .\gradlew.bat assembleDebug --no-daemon
$Apk = Join-Path $Root 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }
$Out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'LoveRussian-OPS.apk'
Copy-Item $Apk $Out -Force
Write-Host "APK_OK $Out"
