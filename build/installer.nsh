; electron-builder includes this file in the NSIS installer. Its `protocols` setting registers the
; openbot:// scheme only on macOS and Linux, so the installer writes the Windows key itself.
; The application writes the same key at each start (`src/main/index.ts`).

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\openbot" "" "URL:OpenBot invitations"
  WriteRegStr SHCTX "Software\Classes\openbot" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\openbot\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "Software\Classes\openbot\shell\open\command" "" '"$appExe" "%1"'
!macroend

; An update runs the old uninstaller first. Keep the key then, so that links work during the update.
; Delete the key only when it still opens this copy. Another copy can own it now.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    ReadRegStr $0 SHCTX "Software\Classes\openbot\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey SHCTX "Software\Classes\openbot"
    ${endIf}
    Pop $0
  ${endIf}
!macroend
