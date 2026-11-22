; Meetline for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Meetline> /DOutputDir=<dist> /DIconFile=<build\meetline.ico> meetline.iss
; Installs to %LOCALAPPDATA%\Programs\Meetline, adds Meetline to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Meetline, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Meetline"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\meetline.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Meetline
AppVersion={#AppVersion}
AppVerName=Meetline {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/meetline/
AppSupportURL=https://github.com/juw12/meetline
DefaultDirName={autopf}\Meetline
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Meetline-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Meetline.exe
UninstallDisplayName=Meetline
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Meetline"; Filename: "{app}\Meetline.exe"; Comment: "Find the fairest place for two to eight people to meet"
Name: "{userdesktop}\Meetline"; Filename: "{app}\Meetline.exe"; Comment: "Find the fairest place for two to eight people to meet"; Tasks: desktopicon

[Run]
Filename: "{app}\Meetline.exe"; Description: "{cm:LaunchProgram,Meetline}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Meetline.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopMeetline"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Meetline window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Meetline.exe')) then
    Exec(ExpandConstant('{app}\Meetline.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
