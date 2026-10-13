'use strict';
// API keys (one per AI provider) encrypted with Windows DPAPI via Electron safeStorage.
// Keys never reach the renderer: the UI only learns whether a provider has a key.

const fs = require('fs');
const path = require('path');

function createKeyStore(dataDir, safeStorage) {
  const file = path.join(dataDir, 'ai-keys.json');
  const legacy = path.join(dataDir, 'ai-key.bin');            // v2.0 single Claude key
  const idOk = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

  function readAll() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
  function writeAll(obj) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }

  return {
    available: () => safeStorage.isEncryptionAvailable(),
    has: (id) => idOk(id) && !!readAll()[id],
    get(id) {
      if (!idOk(id)) return null;
      const enc = readAll()[id];
      if (!enc) return null;
      try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
    },
    set(id, key) {
      if (!idOk(id)) throw new Error('invalid-id');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption-unavailable');
      const all = readAll();
      all[id] = safeStorage.encryptString(key).toString('base64');
      writeAll(all);
      return true;
    },
    clear(id) { const all = readAll(); delete all[id]; writeAll(all); return true; },
    // returns the legacy key once (and removes the old file) so main can turn it into a provider
    takeLegacy() {
      if (!fs.existsSync(legacy)) return null;
      let key = null;
      try { key = safeStorage.decryptString(fs.readFileSync(legacy)); } catch { /* unreadable */ }
      try { fs.unlinkSync(legacy); } catch { /* ignore */ }
      return key;
    },
  };
}

module.exports = { createKeyStore };
