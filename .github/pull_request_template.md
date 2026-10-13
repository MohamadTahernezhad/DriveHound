## What does this change?

<!-- A short description, and the issue it fixes (e.g. "Fixes #12"). -->

## How was it tested?

- [ ] `npm test` passes
- [ ] `npm run test:e2e` passes
- [ ] Tried it manually in the app (describe below)

## Checklist

- [ ] Anything that deletes, moves or changes the system goes through `core/guard.js` and has a test
- [ ] No shell command strings built from input (`execFile` + argument arrays only)
- [ ] New UI text exists in both Persian and English
- [ ] `CHANGELOG.md` updated if users will notice the change
