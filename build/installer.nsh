; Extra NSIS script for the MSP++ installer (package.json build.nsis.include).
;
; The one-click per-user installer would otherwise name its folder after the
; npm package ("msp-pp"). On a first install, point it at
; %LOCALAPPDATA%\Programs\MSP++ instead. The installer reads this registry value
; as "where MSP++ is already installed", so every update after that overwrites
; the same folder and MSP++.exe keeps the same path.
;
; The app's data (logins, settings, note backups) lives in %APPDATA% and is not
; touched by installing, updating or uninstalling.

!macro preInit
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
    ${If} $0 == ""
      WriteRegExpandStr HKCU "Software\${APP_GUID}" InstallLocation "$LOCALAPPDATA\Programs\MSP++"
    ${EndIf}
  !endif
!macroend
