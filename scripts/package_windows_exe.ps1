param(
  [Parameter(Mandatory = $true)][string]$AppSlug,
  [Parameter(Mandatory = $true)][string]$AppDisplayName,
  [Parameter(Mandatory = $true)][string]$AppVersion,
  [Parameter(Mandatory = $false)][string]$Publisher = "Open Neom",
  [Parameter(Mandatory = $false)][string]$ProjectDir = ".",
  [Parameter(Mandatory = $false)][string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$ResolvedProject = (Resolve-Path $ProjectDir).Path
$ReleaseDir = Join-Path $ResolvedProject "build\windows\x64\runner\Release"

if (-not (Test-Path $ReleaseDir)) {
  throw "Windows Release directory not found at $ReleaseDir"
}

# Detect main executable inside Release folder (exclude flutter_tester / crashpad)
$MainExe = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" |
  Where-Object { $_.Name -notmatch "crashpad|updater|unins" } |
  Select-Object -First 1

if (-not $MainExe) {
  throw "Could not find built .exe inside $ReleaseDir"
}

$OutFullDir = Join-Path $ResolvedProject $OutputDir
New-Item -ItemType Directory -Force -Path $OutFullDir | Out-Null

$IconPath = Join-Path $ResolvedProject "windows\runner\resources\app_icon.ico"
$SetupIconLine = ""
if (Test-Path $IconPath) {
  $SetupIconLine = "SetupIconFile=$IconPath"
}

# Deterministic AppId GUID namespace from AppSlug so upgrades overwrite cleanly
$Md5 = [System.Security.Cryptography.MD5]::Create()
$Bytes = $Md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("open-neom-installer-$AppSlug"))
$AppGuid = ([Guid]::new($Bytes)).ToString().ToUpper()

$InstallerBaseName = "$AppDisplayName-Setup-x64"
$IssPath = Join-Path $env:TEMP "$AppSlug-installer.iss"

$IssContent = @"
[Setup]
AppId={{$AppGuid}
AppName=$AppDisplayName
AppVersion=$AppVersion
AppPublisher=$Publisher
DefaultDirName={autopf}\$AppDisplayName
DefaultGroupName=$AppDisplayName
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=$OutFullDir
OutputBaseFilename=$InstallerBaseName
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
$SetupIconLine

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "$ReleaseDir\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\$AppDisplayName"; Filename: "{app}\$($MainExe.Name)"
Name: "{autodesktop}\$AppDisplayName"; Filename: "{app}\$($MainExe.Name)"; Tasks: desktopicon

[Run]
Filename: "{app}\$($MainExe.Name)"; Description: "{cm:LaunchProgram,$AppDisplayName}"; Flags: nowait postinstall skipifsilent
"@

Set-Content -Path $IssPath -Value $IssContent -Encoding UTF8

# Locate Inno Setup compiler (preinstalled on GitHub windows-latest)
$IsccCandidates = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe"
)
$IsccExe = $IsccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $IsccExe) {
  Write-Host "Installing Inno Setup via Chocolatey..."
  choco install innosetup --yes --no-progress
  $IsccExe = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
}

& $IsccExe $IssPath
if ($LASTEXITCODE -ne 0) {
  throw "ISCC failed with exit code $LASTEXITCODE"
}

$FinalExe = Join-Path $OutFullDir "$InstallerBaseName.exe"
Write-Host "Created Windows installer: $FinalExe"
