$ErrorActionPreference = 'Stop'

$clientRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $clientRoot 'android'

$javaCandidates = @(
  $env:JAVA_HOME,
  'C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot',
  'C:\Program Files\Microsoft\jdk-21.0.11-hotspot'
) | Where-Object { $_ }

$sdkCandidates = @(
  $env:ANDROID_SDK_ROOT,
  $env:ANDROID_HOME,
  'C:\Android\Sdk'
) | Where-Object { $_ }

$javaHome = $javaCandidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
$sdkRoot = $sdkCandidates | Where-Object { Test-Path (Join-Path $_ 'platforms') } | Select-Object -First 1

if (-not $javaHome) {
  throw 'JAVA_HOME not found. Please install JDK 21 or update client/scripts/android-assemble-release.ps1.'
}

if (-not $sdkRoot) {
  throw 'ANDROID_SDK_ROOT not found. Please install Android SDK or update client/scripts/android-assemble-release.ps1.'
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:Path = "$javaHome\bin;$sdkRoot\platform-tools;$sdkRoot\cmdline-tools\latest\bin;$env:Path"

Push-Location $clientRoot
try {
  npm run build
  npx cap sync android

  Push-Location $androidRoot
  try {
    .\gradlew.bat --no-daemon assembleRelease --console=plain
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}
