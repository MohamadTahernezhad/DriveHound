'use strict';
// AI assistant with pluggable providers. Explains unknown files/folders from metadata only.
//
// Two adapters cover practically every service:
//   • "anthropic" — Claude through the official Anthropic SDK (structured JSON output)
//   • "openai"    — any OpenAI-compatible /chat/completions endpoint: OpenAI, Google Gemini,
//                   OpenRouter, Groq, DeepSeek, Mistral, local Ollama / LM Studio, or a custom server
//
// Privacy: only metadata is sent (path, size, child names, file type) — never file contents.
// The user's home path can be masked; the exact payload is shown to the user before sending.

const fsp = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;

const TYPES = ['anthropic', 'openai'];
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const ANSWER_KEYS = ['title', 'owner', 'what', 'safety', 'impact', 'howto', 'confidence'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ANSWER_KEYS,
  properties: {
    title: { type: 'string', description: 'Short name of what this is' },
    owner: { type: 'string', description: 'Program, tool or OS component that owns it; empty if unknown' },
    what: { type: 'string', description: 'What it is and why it is this large (1-3 sentences)' },
    safety: { type: 'string', enum: ['safe', 'caution', 'user', 'danger'] },
    impact: { type: 'string', description: 'What breaks or is lost if it is deleted' },
    howto: { type: 'string', description: 'The correct way to reclaim the space (tool, setting or command)' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};

const SYSTEM = `You are a Windows storage expert inside a disk-space analyzer. You receive metadata about one file or folder
(never its contents) and explain what it is and whether deleting it is safe.
Safety levels: "safe" = regenerated automatically (caches, temp, build outputs); "caution" = deletable with a consequence
(re-download, lost settings, slower first run); "user" = personal data only the user can judge; "danger" = deleting breaks
Windows, an installed program, a VM/container, or loses data that cannot be recovered.
Be conservative: when unsure between two levels, choose the riskier one and set confidence to "low".
Prefer official cleanup mechanisms (the owning app's settings, its CLI, Disk Cleanup, DISM) over manual deletion.
Answer in the language given by "lang" ("fa" = Persian, "en" = English). Keep each field short and concrete.`;

// Generic providers get the schema in the prompt (structured-output support differs per service)
const SYSTEM_JSON = SYSTEM + `
Respond with ONLY a JSON object (no markdown, no code fences) with exactly these keys:
{"title": string, "owner": string, "what": string, "safety": "safe"|"caution"|"user"|"danger", "impact": string, "howto": string, "confidence": "low"|"medium"|"high"}`;

// ───────── provider validation ─────────
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function validateBaseUrl(u, required) {
  if (u == null || u === '') { if (required) throw new Error('base-url-required'); return ''; }
  if (typeof u !== 'string' || u.length > 300) throw new Error('invalid-base-url');
  let url;
  try { url = new URL(u.trim()); } catch { throw new Error('invalid-base-url'); }
  if (url.username || url.password) throw new Error('credentials-in-url');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) throw new Error('https-required');   // keys never travel in clear text
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid-base-url');
  if (url.search || url.hash) throw new Error('invalid-base-url');
  return url.toString().replace(/\/+$/, '');
}
function validateProvider(p) {
  if (!p || typeof p !== 'object') throw new Error('invalid-provider');
  const id = String(p.id || '');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error('invalid-id');
  const name = String(p.name || '').trim().slice(0, 60);
  if (!name) throw new Error('name-required');
  if (!TYPES.includes(p.type)) throw new Error('invalid-type');
  const model = String(p.model || '').trim();
  if (!/^[\w.:/@+-]{1,120}$/.test(model)) throw new Error('invalid-model');
  const baseUrl = validateBaseUrl(p.baseUrl, p.type === 'openai');
  return { id, name, type: p.type, baseUrl, model };
}
function validateKey(type, key) {
  if (typeof key !== 'string') throw new Error('invalid-key-format');
  const k = key.trim();
  if (type === 'anthropic' && !/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(k)) throw new Error('invalid-key-format');
  if (!/^[\x21-\x7e]{8,400}$/.test(k)) throw new Error('invalid-key-format');
  return k;
}
const isLocal = (p) => { try { return LOCAL_HOSTS.has(new URL(p.baseUrl).hostname); } catch { return false; } };
const needsKey = (p) => p.type === 'anthropic' || !isLocal(p);

// ───────── payload ─────────
function maskUser(p, mask) {
  if (!mask || !p) return p;
  const home = process.env.USERPROFILE || '';
  if (home && p.toLowerCase().startsWith(home.toLowerCase())) return '%USERPROFILE%' + p.slice(home.length);
  return p;
}
async function buildPayload({ target, isDir, size, files, kbTitle, version }, { lang = 'en', mask = true, children = true } = {}) {
  const payload = { lang, path: maskUser(target, mask), type: isDir ? 'folder' : 'file', sizeBytes: Math.round(size || 0) };
  if (files != null) payload.fileCount = files;
  if (!isDir) payload.extension = path.extname(target).toLowerCase() || null;
  if (version && (version.description || version.company)) payload.fileVersionInfo = { description: version.description || '', company: version.company || '' };
  if (kbTitle) payload.localKnowledgeBaseGuess = kbTitle;
  if (isDir && children) {
    try {
      const ents = await fsp.readdir(target, { withFileTypes: true });
      payload.children = ents.slice(0, 40).map((e) => (e.isDirectory() ? e.name + '\\' : e.name));
      if (ents.length > 40) payload.childrenTruncated = ents.length;
    } catch { /* unreadable */ }
  }
  return payload;
}

// ───────── answer parsing ─────────
function extractJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* look for the object inside */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fallthrough */ } }
  throw Object.assign(new Error('bad-response'), { code: 'PARSE' });
}
function normalize(ans) {
  if (!ans || typeof ans !== 'object') throw Object.assign(new Error('bad-response'), { code: 'PARSE' });
  const out = {};
  for (const k of ['title', 'owner', 'what', 'impact', 'howto']) out[k] = String(ans[k] ?? '').slice(0, 1200);
  out.safety = ['safe', 'caution', 'user', 'danger'].includes(ans.safety) ? ans.safety : 'caution';   // unknown → conservative
  out.confidence = ['low', 'medium', 'high'].includes(ans.confidence) ? ans.confidence : 'low';
  if (!out.what && !out.title) throw Object.assign(new Error('bad-response'), { code: 'PARSE' });
  return out;
}
const fail = (msg, code) => Object.assign(new Error(msg), { code });

// ───────── adapters ─────────
async function callAnthropic(p, key, payload) {
  const client = new AnthropicClient({ apiKey: key, maxRetries: 2, timeout: 90000, ...(p.baseUrl ? { baseURL: p.baseUrl } : {}) });
  let res;
  try {
    res = await client.beta.messages.create({
      model: p.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
  } catch (e) {
    if (e instanceof AnthropicClient.AuthenticationError) throw fail('invalid-api-key', 'AUTH');
    if (e instanceof AnthropicClient.NotFoundError) throw fail('model-or-url-not-found', 'NOTFOUND');
    if (e instanceof AnthropicClient.RateLimitError) throw fail('rate-limited', 'RATE');
    if (e instanceof AnthropicClient.APIConnectionError) throw fail('network', 'NET');
    if (e instanceof AnthropicClient.APIError) throw fail('api-error ' + e.status, 'API');
    throw e;
  }
  if (res.stop_reason === 'refusal') throw fail('refused', 'REFUSAL');
  if (res.stop_reason === 'max_tokens') throw fail('truncated', 'TRUNC');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { answer: normalize(extractJson(text)), model: res.model };
}

async function callOpenAI(p, key, payload, fetchImpl = fetch) {
  const url = p.baseUrl + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  const base = { model: p.model, temperature: 0.2, max_tokens: 1500, messages: [{ role: 'system', content: SYSTEM_JSON }, { role: 'user', content: JSON.stringify(payload) }] };
  async function post(body) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120000);
    try {
      return await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal, redirect: 'error' });
    } catch (e) {
      throw fail(e.name === 'AbortError' ? 'timeout' : 'network', 'NET');
    } finally { clearTimeout(timer); }
  }
  // JSON mode first; some servers reject response_format → retry without it
  let r = await post({ ...base, response_format: { type: 'json_object' } });
  if (r.status === 400 || r.status === 422) r = await post(base);
  if (r.status === 401 || r.status === 403) throw fail('invalid-api-key', 'AUTH');
  if (r.status === 404) throw fail('model-or-url-not-found', 'NOTFOUND');
  if (r.status === 429) throw fail('rate-limited', 'RATE');
  if (!r.ok) throw fail('api-error ' + r.status, 'API');
  let data;
  try { data = await r.json(); } catch { throw fail('bad-response', 'PARSE'); }
  const choice = data && data.choices && data.choices[0];
  const text = choice && choice.message && (typeof choice.message.content === 'string' ? choice.message.content : Array.isArray(choice.message.content) ? choice.message.content.map((c) => c.text || '').join('') : '');
  if (!text) throw fail(choice && choice.finish_reason === 'content_filter' ? 'refused' : 'bad-response', choice && choice.finish_reason === 'content_filter' ? 'REFUSAL' : 'PARSE');
  return { answer: normalize(extractJson(text)), model: data.model || p.model };
}

// ───────── service ─────────
function createAI(dataDir, keyStore, deps = {}) {
  const cacheFile = path.join(dataDir, 'ai-cache.json');
  const fetchImpl = deps.fetch || fetch;
  let cache = null;
  async function loadCache() {
    if (cache) return cache;
    try { cache = JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch { cache = {}; }
    return cache;
  }
  async function saveCache() {
    const keys = Object.keys(cache);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete cache[k];
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(cache));
  }

  async function run(provider, payload) {
    const p = validateProvider(provider);
    const key = keyStore.get(p.id);
    if (needsKey(p) && !key) throw fail('no-api-key', 'NOKEY');
    const r = p.type === 'anthropic' ? await callAnthropic(p, key, payload) : await callOpenAI(p, key, payload, fetchImpl);
    return { ...r.answer, model: r.model, provider: p.name };
  }

  async function explain(provider, payload) {
    if (!provider) throw fail('no-provider', 'NOPROVIDER');
    const ck = provider.id + '|' + provider.model + '|' + payload.lang + '|' + payload.type + '|' + String(payload.path).toLowerCase();
    const c = await loadCache();
    if (c[ck] && Date.now() - c[ck].ts < 30 * 86400000) return { ...c[ck].answer, cached: true };
    const answer = await run(provider, payload);
    c[ck] = { ts: Date.now(), answer };
    await saveCache();
    return answer;
  }

  async function test(provider) {
    const t0 = Date.now();
    const a = await run(provider, { lang: 'en', path: 'C:\\Windows\\Temp', type: 'folder', sizeBytes: 1073741824 });
    return { ok: true, ms: Date.now() - t0, model: a.model, sample: a.title };
  }

  return { explain, test, buildPayload };
}

module.exports = { createAI, buildPayload, validateProvider, validateKey, validateBaseUrl, extractJson, normalize, needsKey, callOpenAI, SCHEMA, TYPES, DEFAULT_CLAUDE_MODEL };
