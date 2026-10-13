# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this repository, and include:

- what you found and its impact,
- steps to reproduce (a minimal path, file name or IPC call is ideal),
- the DriveHound version and Windows version.

You should get a reply within a few days. Fixes are released as a new version and credited in the changelog unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Security model

DriveHound deletes and moves files, so its design assumes the UI could be buggy or compromised and enforces safety in the core.

### Renderer isolation
- `contextIsolation`, `sandbox`, `nodeIntegration: false`, strict Content-Security-Policy.
- The UI is served from a private `app://bundle` origin; the handler only serves the `renderer/` and `shared/` folders and refuses path traversal.
- All renderer network requests are blocked; navigation, new windows, webviews and permission requests are denied; DevTools are disabled in builds.

### IPC
- Every handler validates argument types and shapes (`core/validate.js`) and checks that the sender is the app's own page.
- The renderer never sends command lines. It sends identifiers (action ids, Docker ids, `oemNN.inf`, uninstall registry ids) that the core maps to fixed commands executed with `execFile` argument arrays — no shell string interpolation of user input.

### Path guard (`core/guard.js`)
- Canonicalises paths: resolves `..`, 8.3 short names and junctions; strips trailing dots/spaces; rejects device (`\\?\`, `\\.\`), UNC and alternate-data-stream paths.
- Refuses drive roots, Windows (except Temp, logs and update caches), Program Files roots, WindowsApps, user-profile roots and known folders, system files at drive roots, the app itself, and user-protected paths.
- Recursive deletion never follows junctions or symlinks.
- Moves rename the source first (fails if anything holds a file open), copy, verify size and file count, then create a junction; any failure rolls back.

### Elevation
UAC is requested only for specific fixed operations: MFT read (read-only), DISM, `powercfg`, `pnputil /delete-driver` without `/force`, `vssadmin`, `compact`, diskpart virtual-disk compaction.

### AI providers
- Only metadata about the selected item is sent (path, size, child names, file type, version info) — never file contents. The user name can be masked, and the exact payload is shown and must be approved per provider.
- API keys are encrypted with Windows DPAPI (`safeStorage`) and never returned to the UI.
- Non-local endpoints must use HTTPS; credentials in URLs are rejected; redirects from OpenAI-compatible endpoints are not followed.

### Build hardening
Electron fuses: RunAsNode, `NODE_OPTIONS` and inspector flags disabled; embedded ASAR integrity validation and ASAR-only loading enabled; `file://` extra privileges disabled.

### Testing
`npm test` covers the guard (path tricks, junctions, short names), validators, parsers and AI adapters; `npm run test:e2e` runs isolation, IPC-rejection, protocol-traversal and XSS checks inside the real app.
