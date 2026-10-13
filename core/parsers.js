'use strict';
// Pure text parsers for external tool output. Locale-independent where possible.

// "1.23GB", "512kB", "12MB (virtual 1.2GB)", "0B" → bytes
function parseHumanSize(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const m = String(s).trim().match(/^([\d.,]+)\s*([kKMGTP]?i?B)?/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || 'B').toUpperCase().replace('I', '');
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15 }[unit] || 1;
  return Math.round(n * mult);
}

// pnputil /enum-drivers output. Labels are localized, so fields are identified by value shape.
function parsePnputil(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const vals = b.split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? l.slice(i + 1).trim() : null; }).filter((v) => v != null);
    const published = vals.find((v) => /^oem\d+\.inf$/i.test(v));
    if (!published) continue;
    const pi = vals.indexOf(published);
    const original = vals.slice(pi + 1).find((v) => /\.inf$/i.test(v)) || '';
    const oi = vals.indexOf(original);
    const guidIdx = vals.findIndex((v) => /^\{[0-9a-f-]{36}\}$/i.test(v));
    const verVal = vals.find((v) => /^\d{1,2}\/\d{1,2}\/\d{4}\s+[\d.]+$/.test(v)) || '';
    const vm = verVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([\d.]+)$/);
    const provider = oi >= 0 ? vals[oi + 1] || '' : '';
    const cls = guidIdx > 0 ? vals[guidIdx - 1] : (oi >= 0 ? vals[oi + 2] || '' : '');
    const signerIdx = vals.indexOf(verVal);
    out.push({
      published: published.toLowerCase(), original: original.toLowerCase(), provider, cls,
      guid: guidIdx >= 0 ? vals[guidIdx] : '',
      version: vm ? vm[4] : '', date: vm ? Date.UTC(+vm[3], +vm[1] - 1, +vm[2]) : 0,
      signer: signerIdx >= 0 ? vals[signerIdx + 1] || '' : '',
    });
  }
  return out;
}

// [Version] section of an .inf file
function parseInfVersion(text) {
  const sec = String(text).match(/\[Version\]([\s\S]*?)(\n\s*\[|$)/i);
  const body = sec ? sec[1] : '';
  const get = (k) => { const m = body.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+)$', 'im')); return m ? m[1].replace(/;.*$/, '').trim() : ''; };
  const dv = get('DriverVer').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*,\s*([\d.]+)/);
  return { version: dv ? dv[4] : '', date: dv ? Date.UTC(+dv[3], +dv[1] - 1, +dv[2]) : 0, cls: get('Class'), provider: get('Provider').replace(/^%|%$/g, '') };
}

// `wsl -l -v` (already decoded from UTF-16LE)
function parseWslList(text) {
  const lines = String(text).replace(/\u0000/g, '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  const out = [];
  for (const line of lines.slice(1)) {
    const def = /^\s*\*/.test(line);
    const parts = line.replace(/^\s*\*?\s*/, '').split(/\s{2,}|\t/).filter(Boolean);
    if (parts.length < 3) continue;
    const version = Number(parts[parts.length - 1]);
    if (!version) continue;
    out.push({ name: parts.slice(0, parts.length - 2).join(' '), state: parts[parts.length - 2], version, default: def });
  }
  return out;
}

// Validate identifiers before passing them to external CLIs
const isDockerId = (s) => typeof s === 'string' && /^(sha256:)?[a-f0-9]{12,64}$/i.test(s);
const isDockerName = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.\-/:@]{0,250}$/.test(s) && !s.includes('..');
const isWslName = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}$/.test(s);
const isOemInf = (s) => typeof s === 'string' && /^oem\d{1,5}\.inf$/i.test(s);

module.exports = { parseHumanSize, parsePnputil, parseInfVersion, parseWslList, isDockerId, isDockerName, isWslName, isOemInf };
