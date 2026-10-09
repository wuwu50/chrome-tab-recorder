#ifndef AppVersion
  #define AppVersion "1.3.0"
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
[Run]
Filename: "{app}\ChromeTabRecorder.exe"; Description: "開啟分頁影音錄影機安裝與啟動介面"; Flags: nowait postinstall skipifsilent
