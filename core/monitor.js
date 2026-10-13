'use strict';
// Background monitor: samples free space, detects sudden growth and low space,
// triggers a quiet background scan to find the cause, and raises notifications.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function createMonitor({ dataDir, listDrives, getSettings, notify, investigate }) {
  const file = path.join(dataDir, 'freespace.jsonl');
  const stateFile = path.join(dataDir, 'monitor-state.json');
  let timer = null;
  let busy = false;

  async function readState() { try { return JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { return { lastAlert: {}, lastLow: {}, lastWeekly: 0 }; } }
  async function writeState(s) { await fsp.writeFile(stateFile, JSON.stringify(s)); }

  async function samples(days = 30) {
    let txt = '';
    try { txt = await fsp.readFile(file, 'utf8'); } catch { return []; }
    const since = Date.now() - days * 86400000;
    return txt.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.ts >= since);
  }

  async function record(drives) {
    const rec = { ts: Date.now(), d: {}, s: {} };
    for (const d of drives) { rec.d[d.letter] = d.free; rec.s[d.letter] = d.size; }
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.appendFile(file, JSON.stringify(rec) + '\n');
    // keep ~120 days
    const st = await fsp.stat(file);
    if (st.size > 4 * 1024 * 1024) {
      const keep = await samples(120);
      await fsp.writeFile(file, keep.map((x) => JSON.stringify(x)).join('\n') + '\n');
    }
    return rec;
  }

  async function tick(force) {
    const cfg = getSettings().monitor || {};
    if (!cfg.enabled && !force) return;
    if (busy) return;
    busy = true;
    try {
      const drives = (await listDrives()).filter((d) => d.type === 3);
      await record(drives);
      const hist = await samples(2);
      const st = await readState();
      const now = Date.now();
      const thresholdBytes = (cfg.thresholdGB || 5) * 1024 ** 3;
      for (const d of drives) {
        // growth over the last 24 h = highest free space seen in the window minus now
        const window = hist.filter((h) => h.ts >= now - 86400000 && h.d[d.letter] != null);
        const maxFree = Math.max(...window.map((h) => h.d[d.letter]), d.free);
        const drop = maxFree - d.free;
        if (drop >= thresholdBytes && now - (st.lastAlert[d.letter] || 0) > 6 * 3600000) {
          st.lastAlert[d.letter] = now;
          await writeState(st);
          const cause = await investigate(d.letter).catch(() => null);
          notify({ kind: 'growth', drive: d.letter, drop, cause });
        }
        const pctFree = d.free / d.size;
        if (pctFree < (cfg.lowFreePct || 10) / 100 && now - (st.lastLow[d.letter] || 0) > 86400000) {
          st.lastLow[d.letter] = now;
          await writeState(st);
          notify({ kind: 'low', drive: d.letter, free: d.free, size: d.size });
        }
      }
      if (cfg.weekly !== false && now - (st.lastWeekly || 0) > 7 * 86400000) {
        const week = await samples(7);
        if (week.length > 4) {
          const first = week[0];
          const changes = drives.map((d) => ({ drive: d.letter, change: (first.d[d.letter] ?? d.free) - d.free, free: d.free }));
          notify({ kind: 'weekly', changes });
        }
        st.lastWeekly = now;
        await writeState(st);
      }
    } finally { busy = false; }
  }

  function start() {
    stop();
    const cfg = getSettings().monitor || {};
    const minutes = Math.max(10, Math.min(24 * 60, cfg.intervalMin || 30));
    timer = setInterval(() => tick().catch(() => {}), minutes * 60000);
    setTimeout(() => tick().catch(() => {}), 20000);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { start, stop, tick, samples, record };
}

module.exports = { createMonitor };
