'use strict';
// Points the project at your GitHub repository:
//   - replaces the <your-username> placeholder in the docs
//   - adds repository / homepage / bugs to package.json
//   - adds build.publish so installers get auto-updates from your Releases
// Usage: node scripts/set-repo.js <github-user> [repo-name]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const [user, repo = 'drivehound'] = process.argv.slice(2);
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
if (!user || !NAME.test(user)) { console.error('Invalid GitHub user name: ' + (user || '(empty)')); process.exit(1); }
if (!REPO.test(repo) || repo === '.' || repo === '..') { console.error('Invalid repository name: ' + repo); process.exit(1); }

const docs = ['README.md', 'README.en.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md'];
for (const d of ['docs', 'docs/release-notes', '.github', '.github/ISSUE_TEMPLATE']) {
  const dir = path.join(root, d);
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(md|ya?ml)$/i.test(f)) docs.push(d + '/' + f);
}

let changed = 0;
for (const rel of docs) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.split('<your-username>').join(user).split('/drivehound').join('/' + repo).split('cd drivehound\n').join('cd ' + repo + '\n');
  if (after !== before) { fs.writeFileSync(file, after); changed++; console.log('  updated', rel); }
}

const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const url = `https://github.com/${user}/${repo}`;
pkg.repository = { type: 'git', url: url + '.git' };
pkg.homepage = url + '#readme';
pkg.bugs = { url: url + '/issues' };
pkg.build.publish = { provider: 'github', owner: user, repo };
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log('  updated package.json (repository, homepage, bugs, build.publish)');
console.log(`Done: ${changed + 1} files now point to ${url}`);
