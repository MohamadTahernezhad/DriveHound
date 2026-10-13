; DriveHound — leave nothing behind in the registry on uninstall.
; (User data in %APPDATA%\DriveHound is kept so a reinstall keeps history and settings.)
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DriveHound"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\DriveHound"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DriveHound"
  ; entries from the app's former name (Disk Insight)
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DiskInsight"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\DiskInsight"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DiskInsight"
!macroend
