# Contributing

Thanks for helping improve DriveHound!

## Setup
```bash
npm install
npm run build:native
npm start
```
Requires Windows 10/11 and Node.js 22+.

## Before opening a pull request
```bash
npm test          # must pass
npm run test:e2e  # must pass (runs the app with an isolated profile)
```

## Guidelines
- **Safety first.** Anything that deletes, moves or changes the system must go through `core/guard.js` and be covered by a test in `tests/`.
- **No shell strings from input.** Run external tools with `execFile` and argument arrays; validate every identifier (see `core/parsers.js`).
- **IPC** handlers declare validators (`core/validate.js`); never expose `ipcRenderer` from `preload.js`.
- **Knowledge rules** live in `shared/knowledge.js`. Each rule needs Persian and English text for *what*, *impact* and *how to clean*, and the most conservative safety level that is true.
- **UI text** must exist in both languages (`renderer/i18n.js` or `T(fa, en)`), and all dynamic values must be escaped with `esc()`.
- Keep the code style of the surrounding file; no new runtime dependencies without discussion.

## Reporting bugs
Open an issue with the version, Windows version, steps to reproduce and, if relevant, the last lines of
`%APPDATA%\DriveHound\data\logs\main.log`. Security issues: see [SECURITY.md](SECURITY.md).
