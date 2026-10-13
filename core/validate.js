'use strict';
// Minimal schema validation for IPC arguments. Every ipcMain handler validates its input:
// a compromised or buggy renderer must not be able to pass unexpected shapes to the core.

class ValidationError extends Error {}

const V = {
  str: (max = 4096) => (v, k) => { if (typeof v !== 'string' || v.length > max) throw new ValidationError(k + ': string expected'); return v; },
  optStr: (max = 4096) => (v, k) => (v == null ? undefined : V.str(max)(v, k)),
  path: () => (v, k) => {
    if (typeof v !== 'string' || v.length > 32000 || !/^[a-zA-Z]:[\\/]/.test(v) || /[\u0000-\u001f]/.test(v)) throw new ValidationError(k + ': absolute path expected');
    return v;
  },
  optPath: () => (v, k) => (v == null ? undefined : V.path()(v, k)),
  drive: () => (v, k) => { if (typeof v !== 'string' || !/^[a-zA-Z]:\\?$/.test(v)) throw new ValidationError(k + ': drive expected'); return v.slice(0, 2).toUpperCase(); },
  num: (min = -Infinity, max = Infinity) => (v, k) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(k + ': number expected'); return v; },
  optNum: (min, max) => (v, k) => (v == null ? undefined : V.num(min, max)(v, k)),
  bool: () => (v) => !!v,
  oneOf: (...vals) => (v, k) => { if (!vals.includes(v)) throw new ValidationError(k + ': invalid value'); return v; },
  match: (re, max = 256) => (v, k) => { if (typeof v !== 'string' || v.length > max || !re.test(v)) throw new ValidationError(k + ': invalid format'); return v; },
  arr: (item, max = 10000) => (v, k) => { if (!Array.isArray(v) || v.length > max) throw new ValidationError(k + ': array expected'); return v.map((x, i) => item(x, k + '[' + i + ']')); },
  obj: (shape) => (v, k) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(k + ': object expected');
    const out = {};
    for (const [key, fn] of Object.entries(shape)) out[key] = fn(v[key], k + '.' + key);
    return out;
  },
  any: () => (v) => v,
  json: (maxBytes = 1e6) => (v, k) => { const s = JSON.stringify(v ?? null); if (s.length > maxBytes) throw new ValidationError(k + ': too large'); return JSON.parse(s); },
};

// Validate a list of positional args against validators.
function check(args, validators) {
  return validators.map((fn, i) => fn(args[i], 'arg' + i));
}

module.exports = { V, check, ValidationError };
