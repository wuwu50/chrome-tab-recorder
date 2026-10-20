#ifndef AppVersion
  #define AppVersion "1.15.0"
#endif
[Setup]
AppId={{589A672F-832B-4DCF-8457-B0F2877E1B8F}
AppName=分頁影音錄影機
AppVersion={#AppVersion}
AppPublisher=wuwu50
AppPublisherURL=https://github.com/wuwu50/chrome-tab-recorder
DefaultDirName={localappdata}\Programs\ChromeTabRecorder
DefaultGroupName=分頁影音錄影機
PrivilegesRequired=lowest
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=ChromeTabRecorder-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\ChromeTabRecorder.exe
CloseApplications=no
InfoBeforeFile=install-info.txt
[Tasks]
Name: desktopicon; Description: "建立桌面捷徑"; GroupDescription: "捷徑："
[Files]
Source: "..\build\ChromeTabRecorder.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\分頁影音錄影機"; Filename: "{app}\ChromeTabRecorder.exe"
Name: "{userdesktop}\分頁影音錄影機"; Filename: "{app}\ChromeTabRecorder.exe"; Tasks: desktopicon
[Registry]
Root: HKCU; Subkey: "Software\Classes\chrometabrecorder"; ValueType: string; ValueData: "URL:ChromeTabRecorder Update"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\chrometabrecorder"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\chrometabrecorder\shell\open\command"; ValueType: string; ValueData: """{app}\ChromeTabRecorder.exe"" --update"
[Run]
Filename: "{app}\ChromeTabRecorder.exe"; Description: "開啟分頁影音錄影機安裝與啟動介面"; Flags: nowait postinstall skipifsilent

[InstallDelete]
Type: files; Name: "{app}\extension\install-complete.json"
Type: files; Name: "{app}\extension\install-complete.json.tmp"

[UninstallDelete]
Type: files; Name: "{app}\extension\install-complete.json"
Type: files; Name: "{app}\extension\install-complete.json.tmp"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Marker, Temporary: String;
begin
  if CurStep = ssPostInstall then
  begin
    Marker := ExpandConstant('{app}\extension\install-complete.json');
    Temporary := Marker + '.tmp';
    if not SaveStringToFile(Temporary, '{"version":"{#AppVersion}","complete":true}', False) then
      RaiseException('Cannot write installation completion marker.');
    if not RenameFile(Temporary, Marker) then
      RaiseException('Cannot finalize installation completion marker.');
  end;
end;
