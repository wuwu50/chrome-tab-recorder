$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'extension/manifest.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "dist/ChromeTabRecorder-$version-Setup.exe"
$testDir = Join-Path $env:RUNNER_TEMP 'RecorderInstallSmoke'
$process = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=',('/DIR="' + $testDir + '"')) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer exit: $($process.ExitCode)" }
$installed = Get-Content -LiteralPath (Join-Path $testDir 'extension/manifest.json') -Raw | ConvertFrom-Json
if ($installed.version -ne $version) { throw 'Installed version mismatch.' }
$launcher = Start-Process -FilePath (Join-Path $testDir 'ChromeTabRecorder.exe') -ArgumentList '--self-test' -WindowStyle Hidden -Wait -PassThru
if ($launcher.ExitCode -ne 0) { throw 'Installed launcher self-test failed.' }
$uninstaller = Join-Path $testDir 'unins000.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing.' }
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed.' }
Write-Output 'PASS: installer, installed version, launcher self-test, uninstaller.'
