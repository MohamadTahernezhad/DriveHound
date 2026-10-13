<div align="center">

<img src="docs/banner.png" alt="DriveHound">

# DriveHound

**Smart disk space analyzer for Windows**

Finds what fills your drives, explains what every file and folder is,
and tells you whether deleting it is safe — without breaking Windows, your programs or your projects.

[فارسی](README.md) · [Download](#-download--install) · [Usage](#-usage) · [Build from source](#-build-from-source) · [Security](#-security--privacy)

[![CI](https://github.com/MohamadTahernezhad/DriveHound/actions/workflows/ci.yml/badge.svg)](https://github.com/MohamadTahernezhad/DriveHound/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/MohamadTahernezhad/DriveHound?color=7046f0)](https://github.com/MohamadTahernezhad/DriveHound/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/MohamadTahernezhad/DriveHound/total?color=0ea5c6)](https://github.com/MohamadTahernezhad/DriveHound/releases)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows)
![license](https://img.shields.io/badge/license-MIT-green)
![UI](https://img.shields.io/badge/UI-English%20%7C%20Persian-0ea5c6)

<a href="https://github.com/MohamadTahernezhad/DriveHound/releases/latest"><img src="https://img.shields.io/badge/%E2%AC%87%20Download%20for%20Windows-7046f0?style=for-the-badge" alt="Download"></a>

</div>

![DriveHound dashboard](docs/screenshots/dashboard-en-light.png)

## ✨ Why DriveHound?

Typical tools tell you "this folder is 27 GB". DriveHound tells you:

> **Docker Desktop virtual disk — do not delete.** All your containers and databases live inside it, and it grew 27 GB in the last 7 days.
> The right way: `docker system prune -a`, then compact the virtual disk — one click each.

## 🧩 Features

| Area | What it does |
|---|---|
| **Fast scan** | Multi-threaded walk (~25k files/s) or **Turbo** mode reading the NTFS MFT directly (drive C: in seconds; needs admin) |
| **Knowledge base** | 100 rules with hundreds of path patterns: caches, Temp, Docker, WSL, Android emulators, Gradle, npm, browsers, IDEs, system files… rated *safe / caution / personal / do not delete* |
| **Dependency check** | Before deleting: running processes, Windows services, startup entries, PATH, owning installed program, parent dev project, file locks |
| **What changed?** | Folders that grew in the last 7/30 days, new large files, exact comparison with previous scans |
| **Smart cleanup** | Safe items, items that need a proper tool, caution and personal items + Windows tools (DISM, Disk Cleanup, hibernation, Recycle Bin) |
| **Duplicates** | SHA-256 verified; remove extra copies or replace them with hard links |
| **Docker & WSL** | Images, containers, volumes and build cache with exact sizes; virtual disk compaction |
| **System tools** | Old driver packages, restore points, CompactOS, hibernation file |
| **Free without deleting** | Move big folders to another drive behind a junction (apps notice nothing) and transparent NTFS compression — all reversible |
| **AI assistant** | Explains unknown items with **any model**: Claude, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, or local Ollama / LM Studio |
| **Quarantine & history** | Delete into a quarantine on another drive (restorable for N days); every operation is logged |
| **Monitoring** | Free-space chart, notifications when a drive suddenly fills up (with the cause), weekly report |
| **Advanced filters** | On every list: multi-select, size/age ranges, column sort, saved presets, query syntax |
| **More** | Explorer right-click menu, HTML/PDF reports, CSV export, custom rules, protected paths, dark/light themes, Persian/English |

## 🖼 Screenshots

![DriveHound showcase](docs/showcase.png)

| | |
|---|---|
| ![Safety map of a folder](docs/screenshots/explorer-safety-en-light.png) | ![Duplicate finder](docs/screenshots/dupes-en.png) |
| ![Free space over time](docs/screenshots/welcome-monitor-en.png) | ![Safe to delete, with dependency check](docs/screenshots/drawer-safe-en-light.png) |
| ![Advanced filters](docs/screenshots/files-filters-en.png) | ![AI providers](docs/screenshots/settings-ai-en.png) |
| ![Folder explorer](docs/screenshots/explorer-fa.png) | ![Smart cleanup](docs/screenshots/cleanup-fa.png) |
| ![What changed](docs/screenshots/changes-fa.png) | ![Details & dependency check](docs/screenshots/drawer-fa.png) |

---

## 📥 Download & install

**Requirements:** Windows 10 or 11 (64-bit), ~300 MB free space.

**Installer (recommended)** — open **[Releases](../../releases/latest)**, download `DriveHound-Setup-x.y.z.exe`, run it, choose a folder, click **Install**.

**Portable** — download `DriveHound-Portable-x.y.z.exe` and run it directly; nothing is installed.

**SmartScreen warning** — the builds are not signed with a commercial certificate, so Windows may show *"Windows protected your PC"* the first time: click **More info → Run anyway**. The full source is in this repository.

**Uninstall** — *Settings → Apps → DriveHound → Uninstall*. The uninstaller also removes the right-click menu and the startup entry. Settings and history stay in `%APPDATA%\DriveHound`; delete that folder for a complete removal.

---

## 📖 Usage

### First scan
1. On the **Dashboard**, press **Scan** on a drive card (drive C: takes about a minute).
2. For a faster and more complete scan press **Turbo** and approve the UAC prompt.
3. To include protected system folders, use **Run as admin** at the top.

### Understanding an item
Click anything to open the details panel: *what it is*, *what happens if you delete it*, *the right way to clean it* (often a one-click action), the **dependency check**, and **Ask AI** for unknown items.

| Label | Meaning |
|---|---|
| 🟢 **Safe to delete** | Regenerated automatically (cache, temp, build output) |
| 🟡 **Use caution** | Deletable with a consequence (re-download, lost settings) |
| 🔵 **Personal data** | Only you know whether you need it |
| 🔴 **Do not delete** | Would break Windows or a program; the app offers the proper tool |

### Delete methods
- **Recycle Bin** (default): restorable, but space is freed only when the bin is emptied.
- **Quarantine**: moved to another drive, space freed immediately, restorable for a few days (*Settings → Quarantine drive*).
- **Permanent**: immediate and irreversible — good for caches.

### Filter query syntax
`ext:mp4,mkv` · `>1gb` · `<500mb` · `-node_modules` · `"exact phrase"` · `newer:7d` · `older:1y` · `is:safe` (or `caution`, `user`, `danger`). Save frequent filters as presets; `Ctrl+F` focuses the search box.

### AI providers
*Settings → AI assistant → Add provider*, pick a preset or enter any OpenAI-compatible endpoint:

| Provider | Base URL | Key |
|---|---|---|
| Claude (Anthropic) | automatic | `sk-ant-…` from console.anthropic.com |
| OpenAI | `https://api.openai.com/v1` | platform.openai.com |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | aistudio.google.com |
| OpenRouter | `https://openrouter.ai/api/v1` | openrouter.ai |
| Groq / DeepSeek / Mistral | preset | provider console |
| **Ollama (local, free)** | `http://localhost:11434/v1` | not needed |
| **LM Studio (local, free)** | `http://localhost:1234/v1` | not needed |
| Any OpenAI-compatible service | your https URL | if required |

Enter the model id from the provider's docs and press **Save & test**. You can keep several providers and choose the active one. Before the first request the **exact payload** is shown; file contents are never sent.

### Background monitoring
Closing the window keeps the app in the tray, sampling free space every 30 minutes. If a drive loses more than 5 GB within 24 hours it scans quietly and notifies you what grew. All thresholds are configurable.

---

## 🔒 Security & privacy

- **Nothing is deleted without your confirmation.** Recycle Bin is the default and every operation is logged.
- **Core path guard:** drive roots, Windows (except temp/log/update caches), Program Files, profile roots and system files are never deleted — even if the UI made a mistake. Tricks such as `..`, 8.3 names (`PROGRA~1`), junctions and `\\?\` paths are neutralised.
- **Your own protected paths** are enforced in the core too.
- **Isolated UI:** no Node, no network, strict CSP, private `app://` origin; it sends operation ids, never commands.
- **Offline by default.** Only when you ask the AI is metadata about that one item sent to the provider you chose. With a local model (Ollama) nothing leaves your PC.
- **API keys** are encrypted with Windows DPAPI and never returned to the UI.

Details: [SECURITY.md](SECURITY.md)

---

## 🛠 Build from source

**Prerequisites:** Windows 10/11 x64, [Node.js](https://nodejs.org) **22+**, Git, .NET Framework 4.x (preinstalled on Windows; its built-in `csc.exe` compiles the Turbo module).

```bash
git clone https://github.com/MohamadTahernezhad/DriveHound.git
cd DriveHound
npm install
npm run build:native      # builds native/mftscan.exe (Turbo scan)
npm start
```
> Launching from a VS Code terminal? Clear `ELECTRON_RUN_AS_NODE` first (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).

**Tests**
```bash
npm test             # unit + integration (core, security guard, file ops, AI adapters)
npm run test:e2e     # UI + security checks inside the real app (isolated profile — your data is untouched)
npm run audit        # dependency vulnerability audit
```

**Screenshots** — after one scan of drive C: in the app:
```bash
npm run screenshots  # captures docs/screenshots/*.png inside the app from an anonymized copy of your scan
npm run showcase     # docs/showcase.png
npm run banner       # docs/banner.png + docs/social-preview.png
```

**Build installers** — `npm run dist` → `release/DriveHound-Setup-x.y.z.exe` and `release/DriveHound-Portable-x.y.z.exe`. Run the setup file to install your own build.

**One-command scripts** (PowerShell; run with `powershell -ExecutionPolicy Bypass -File …`):

| Script | Does |
|---|---|
| `scripts\setup-dev.ps1` | checks Node/.NET, installs packages, builds the Turbo module, runs tests (`-Start` to launch) |
| `scripts\build-installer.ps1` | full installer + portable build with SHA-256 checksums (`-Install` to run the setup afterwards) |
| `scripts\publish-github.ps1` | points the docs at your repo, commits, pushes, and with `-Release` tags the version so GitHub Actions publishes the installers |

**Publish a release** — the included GitHub Action runs the tests, builds both executables and attaches them to a GitHub Release for every version tag:
```bash
git tag v2.1.1 && git push origin v2.1.1
```

**Auto-update** — `node scripts/set-repo.js <github-user>` adds `build.publish` (and repository links) to `package.json`; installers built afterwards update themselves from your Releases.
To remove the SmartScreen warning, sign with a code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`).

### Project layout
```
main.js              Electron main: validated IPC, app:// protocol, tray, monitoring
preload.js           the only bridge between UI and core
core/                guard (path safety), delete, quarantine, move, Docker/WSL, system tools,
                     AI providers, monitor, input validation
scanner/             scan worker (walk or MFT) and duplicate finder
native/MftScan.cs    read-only MFT reader (C#)
shared/              knowledge base and snapshot comparison
renderer/            UI (framework-free HTML/CSS/JS)
tests/               unit, integration and e2e tests
scripts/             native build, anonymized demo profile for screenshots
```

---

## ❓ FAQ

<details><summary><b>Why does "scanned" differ from used space?</b></summary>
Without admin rights some system folders cannot be read (e.g. System Volume Information). Use <b>Turbo</b> or <b>Run as admin</b>. Hard links (e.g. WinSxS) are counted once.
</details>

<details><summary><b>I deleted files but no space was freed.</b></summary>
With the Recycle Bin method, empty the bin (Smart cleanup → System tools). For Docker/WSL virtual disks, clean inside them and then press <b>Compact</b>.
</details>

<details><summary><b>Turbo does not work.</b></summary>
Turbo needs an NTFS drive and admin approval. If UAC is declined, a standard scan runs automatically.
</details>

<details><summary><b>The AI provider reports a connection error.</b></summary>
Check the base URL and model id against the provider docs and press <b>Test</b>. For Ollama / LM Studio make sure the local server is running. Non-local endpoints must use https.
</details>

<details><summary><b>Where is the log file?</b></summary>
<code>%APPDATA%\DriveHound\data\logs\main.log</code> — errors only; never file contents or keys.
</details>

---

## 🤝 Contributing
Bugs and ideas: [Issues](../../issues). Code: see [CONTRIBUTING.md](CONTRIBUTING.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## 📄 License
[MIT](LICENSE)
