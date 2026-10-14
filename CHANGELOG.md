# Changelog

## 2.2.0 — 2026-10-14

### Added
- **Refresh button and F5 / Ctrl+R**: reloads the current page — drives' free space, Docker/WSL, system tools, moves, history and installed programs are fetched again.
- **Automatic refresh after every operation** (delete, system tools, Docker, move, quarantine, drivers…): the current page updates right away and other pages reload their data the next time they are opened.
- Scan-based pages (dashboard, explorer, largest files, what changed, cleanup) and duplicate results drop files and folders that no longer exist on disk — whether removed by a tool, an action or another program.

### Fixed
- Pages kept showing old data after something was deleted or cleaned until the app was restarted or the drive was rescanned.

## 2.1.1 — 2026-10-13

### Fixed
- **"Run as admin" closed the app instead of reopening it.** The elevated copy found the running one through the single-instance lock and exited, then the running one quit too. The lock is now released before the elevated copy starts (and taken back if the UAC prompt is cancelled).

## 2.1.0 — 2026-10-11

### Added
- **AI with any provider**: Claude (Anthropic SDK) and any OpenAI-compatible API — OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, local Ollama / LM Studio, or a custom endpoint. Several providers, one active; per-provider encrypted keys, connection test, per-provider consent.
- Uninstaller removes the Explorer right-click menu and the startup entry.
- End-to-end tests for a real scan, the duplicate finder, monitoring samples and the AI provider flow.
- Error log at `%APPDATA%\DriveHound\data\logs\main.log`.
- GitHub documentation, CI and release workflows (checksums, release notes, tag/version check), Dependabot, and one-command PowerShell scripts: `setup-dev`, `build-installer`, `publish-github`.

### Changed
- Installer file name is now `DriveHound-Setup-x.y.z.exe` (no spaces, so GitHub release links and auto-update work).
- The UI is served from a private `app://` origin (allows disabling `file://` privileges).
- Requests from the Explorer menu / command line are queued until the app has finished starting.

### Removed
- The "Dev projects" page (artifact detection inside other views is unchanged).

### Fixed
- **Scan results not reaching the UI** in 2.0 (the "done" message was gated on a job that had just been cleared) — now covered by an end-to-end test that runs a real scan.
- Filter bar icons overflowing their controls.
- Packaged build showing a blank window.
- Opening the app from the Explorer menu before startup could overwrite settings.

## 2.0.0 — 2026-10-07

### Added
- Turbo scan (direct NTFS MFT reader), duplicate finder, Docker & WSL manager, old drivers, restore points, CompactOS / NTFS compression.
- Move folders to another drive behind a junction (reversible), quarantine with auto-purge, operation history.
- Background monitoring with tray icon, free-space chart and growth / low-space notifications.
- Advanced filters with query syntax and saved presets on every list.
- Custom rules, protected paths, HTML/PDF reports, Explorer right-click menu.
- Unit, integration and in-app end-to-end tests; Electron fuses; validated IPC.

### Fixed
- `C:` (drive-relative) being treated as the current directory instead of the drive root.
- Quarantining a single file.

## 1.0.0 — 2026-10-07

- First release: fast scan, knowledge base with safety levels, dependency check, "what changed", smart cleanup, installed apps, Persian/English UI with dark/light themes.
