'use strict';
// Append-only operation log (JSON lines). Every destructive or system-changing operation is recorded.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

function createHistory(dataDir) {
  const file = path.join(dataDir, 'history.jsonl');
  const MAX = 5 * 1024 * 1024;

  async function add(entry) {
    const rec = { id: crypto.randomUUID(), ts: Date.now(), ...entry };
    await fsp.mkdir(dataDir, { recursive: true });
    try {
      const st = await fsp.stat(file);
      if (st.size > MAX) await fsp.rename(file, file + '.1').catch(() => {});
    } catch { /* new file */ }
    await fsp.appendFile(file, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  }

  async function list(limit = 2000) {
    const out = [];
    for (const f of [file + '.1', file]) {
      let txt = '';
      try { txt = await fsp.readFile(f, 'utf8'); } catch { continue; }
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
      }
    }
    out.sort((a, b) => b.ts - a.ts);
    return out.slice(0, limit);
  }

  return { add, list, file };
}

module.exports = { createHistory };
