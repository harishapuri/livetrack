; LiveTrack portable uninstaller (standalone).
; Removes portable leftovers + known user data. Does NOT run the NSIS Setup uninstaller.
;
; Built by scripts/build-portable-uninstaller.js → LiveTrack-Uninstall-Portable-*.exe

Unicode true
Name "LiveTrack Portable Uninstall"
Caption "LiveTrack Portable Uninstall"
BrandingText "LiveTrack"
OutFile "${OUT_FILE}"
RequestExecutionLevel user
ShowInstDetails show
InstallDir "$EXEDIR"
SetCompressor /SOLID lzma

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var /GLOBAL ConfirmChoice

Function .onInit
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Uninstall LiveTrack portable and remove local data?$\r$\n$\r$\nThis will:$\r$\n\
• Quit LiveTrack if it is running$\r$\n\
• Delete LiveTrack-Portable-*.exe next to this uninstaller$\r$\n\
• Remove user data under Projects\coact, Documents\Coact, .coact$\r$\n\
• Remove AppData\LiveTrack (Roaming + Local)$\r$\n$\r$\n\
The NSIS Setup install (if present) is left alone — use Apps & Features for that." \
      IDYES continue
    Quit
    continue:
  ${EndIf}
FunctionEnd

Section "Uninstall"
  DetailPrint "Stopping LiveTrack processes..."
  nsExec::ExecToLog 'taskkill /F /IM "LiveTrack.exe" /T'
  Pop $0
  nsExec::ExecToLog 'cmd /C for %F in ("$EXEDIR\LiveTrack-Portable-*.exe") do taskkill /F /IM "%~nxF" /T 2>nul'
  Pop $0
  Sleep 800

  DetailPrint "Removing portable executables beside this uninstaller..."
  FindFirst $0 $1 "$EXEDIR\LiveTrack-Portable-*.exe"
  ${Unless} ${Errors}
    loop_portable:
      ${If} $1 != ""
        DetailPrint "Deleting $EXEDIR\$1"
        Delete /REBOOTOK "$EXEDIR\$1"
      ${EndIf}
      FindNext $0 $1
      ${Unless} ${Errors}
        Goto loop_portable
      ${EndUnless}
    FindClose $0
  ${EndUnless}

  ; Optional local data folder some portable apps keep next to the exe
  RMDir /r "$EXEDIR\data"
  RMDir /r "$EXEDIR\LiveTrack"

  DetailPrint "Removing LiveTrack / Coact user data..."
  RMDir /r "$PROFILE\Projects\coact"
  RMDir /r "$PROFILE\Documents\Coact"
  RMDir /r "$PROFILE\.coact"
  RMDir /r "$APPDATA\LiveTrack"
  RMDir /r "$LOCALAPPDATA\LiveTrack"

  ; Harmless if missing — portable builds rarely create these
  Delete "$DESKTOP\LiveTrack.lnk"
  Delete "$SMPROGRAMS\LiveTrack.lnk"
  RMDir /r "$SMPROGRAMS\LiveTrack"

  DetailPrint "Done."
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
    MessageBox MB_ICONINFORMATION "LiveTrack portable cleanup finished."
  ${EndIf}
SectionEnd
