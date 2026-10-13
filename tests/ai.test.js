'use strict';
// AI provider layer: validation, parsing, and the OpenAI-compatible adapter against a local mock server.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AI = require('../core/ai');

const ANSWER = { title: 'Temp files', owner: 'Windows', what: 'Temporary files.', safety: 'safe', impact: 'None.', howto: 'Disk Cleanup', confidence: 'high' };

function mockServer(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const call = { url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
        calls.push(call);
        handler(call, res, calls.length);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, calls, url: 'http://127.0.0.1:' + srv.address().port + '/v1' }));
  });
}
const reply = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const chat = (content, model = 'mock-model') => ({ model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
const keyStore = (keys = {}) => ({ get: (id) => keys[id] || null, has: (id) => !!keys[id] });

test('provider validation', () => {
  const ok = AI.validateProvider({ id: 'my-groq', name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1/', model: 'some/model-1.5:latest' });
  assert.equal(ok.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(AI.validateProvider({ id: 'local', name: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'm' }).baseUrl, 'http://localhost:11434/v1');
  assert.equal(AI.validateProvider({ id: 'claude', name: 'Claude', type: 'anthropic', model: 'claude-opus-5-5' }).baseUrl, '');
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'openai', baseUrl: 'http://evil.example.com/v1', model: 'm' }), /https-required/);
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'openai', baseUrl: 'https://user:pass@host/v1', model: 'm' }), /credentials-in-url/);
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'openai', baseUrl: 'file:///C:/x', model: 'm' }), /invalid-base-url/);
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'openai', model: 'm' }), /base-url-required/);
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'shell', baseUrl: 'https://a', model: 'm' }), /invalid-type/);
  assert.throws(() => AI.validateProvider({ id: 'x', name: 'x', type: 'openai', baseUrl: 'https://a', model: 'm; rm -rf' }), /invalid-model/);
  assert.throws(() => AI.validateProvider({ id: '../x', name: 'x', type: 'openai', baseUrl: 'https://a', model: 'm' }), /invalid-id/);
});

test('key validation', () => {
  assert.throws(() => AI.validateKey('anthropic', 'sk-wrong'), /invalid-key-format/);
  assert.ok(AI.validateKey('anthropic', 'sk-ant-' + 'a'.repeat(40)));
  assert.ok(AI.validateKey('openai', 'gsk_abcdefgh12345'));
  assert.throws(() => AI.validateKey('openai', 'has space inside'), /invalid-key-format/);
  assert.throws(() => AI.validateKey('openai', 'short'), /invalid-key-format/);
});

test('needsKey: local endpoints do not, remote ones do', () => {
  assert.equal(AI.needsKey({ type: 'openai', baseUrl: 'http://127.0.0.1:1234/v1' }), false);
  assert.equal(AI.needsKey({ type: 'openai', baseUrl: 'https://api.openai.com/v1' }), true);
  assert.equal(AI.needsKey({ type: 'anthropic', baseUrl: '' }), true);
});

test('answer parsing tolerates fences and prose, and is conservative', () => {
  assert.equal(AI.extractJson('```json\n' + JSON.stringify(ANSWER) + '\n```').title, 'Temp files');
  assert.equal(AI.extractJson('Sure! Here it is: ' + JSON.stringify(ANSWER) + ' Hope it helps').safety, 'safe');
  assert.throws(() => AI.extractJson('no json here'), /bad-response/);
  const n = AI.normalize({ title: 'x', what: 'y', safety: 'totally-fine', confidence: 'sure' });
  assert.equal(n.safety, 'caution');
  assert.equal(n.confidence, 'low');
  assert.throws(() => AI.normalize({}), /bad-response/);
});

test('OpenAI-compatible adapter: JSON mode, auth header, retry without response_format', async () => {
  const m = await mockServer((call, res, n) => {
    if (n === 1) return reply(res, 400, { error: 'response_format not supported' });
    reply(res, 200, chat(JSON.stringify(ANSWER)));
  });
  try {
    const r = await AI.callOpenAI({ baseUrl: m.url, model: 'mock-model' }, 'secret-key-123', { lang: 'en', path: 'C:\\x' });
    assert.equal(r.answer.title, 'Temp files');
    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].url, '/v1/chat/completions');
    assert.equal(m.calls[0].headers.authorization, 'Bearer secret-key-123');
    assert.deepEqual(m.calls[0].body.response_format, { type: 'json_object' });
    assert.equal(m.calls[1].body.response_format, undefined);
    assert.equal(m.calls[1].body.messages[0].role, 'system');
    assert.ok(!JSON.stringify(m.calls[1].body).includes('secret-key-123'), 'key never in the body');
  } finally { m.srv.close(); }
});

test('OpenAI-compatible adapter: error mapping', async () => {
  for (const [status, re] of [[401, /invalid-api-key/], [404, /model-or-url-not-found/], [429, /rate-limited/], [500, /api-error 500/]]) {
    const m = await mockServer((call, res) => reply(res, status, { error: 'x' }));
    try { await assert.rejects(AI.callOpenAI({ baseUrl: m.url, model: 'm' }, 'k', {}), re); } finally { m.srv.close(); }
  }
  await assert.rejects(AI.callOpenAI({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, 'k', {}), /network/);
});

test('service: local provider without key, cache, remote provider requires key', async () => {
  const m = await mockServer((call, res) => reply(res, 200, chat('```json\n' + JSON.stringify(ANSWER) + '\n```')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ai-'));
  try {
    const svc = AI.createAI(dir, keyStore());
    const local = { id: 'ollama', name: 'Ollama', type: 'openai', baseUrl: m.url, model: 'llama' };
    const payload = { lang: 'fa', path: 'C:\\x', type: 'folder' };
    const a = await svc.explain(local, payload);
    assert.equal(a.title, 'Temp files');
    assert.equal(a.provider, 'Ollama');
    assert.equal(m.calls[0].headers.authorization, undefined, 'no key sent to a local server');
    const b = await svc.explain(local, payload);
    assert.equal(b.cached, true);
    assert.equal(m.calls.length, 1);
    const t = await svc.test(local);
    assert.ok(t.ok && t.ms >= 0);
    const remote = { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'x' };
    await assert.rejects(svc.explain(remote, payload), /no-api-key/);
    await assert.rejects(svc.explain(null, payload), /no-provider/);
  } finally { m.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('payload contains metadata only and masks the user profile', async () => {
  const home = process.env.USERPROFILE;
  const p = await AI.buildPayload({ target: path.join(home, 'AppData', 'Local', 'Temp'), isDir: true, size: 123 }, { lang: 'en', mask: true, children: false });
  assert.ok(p.path.startsWith('%USERPROFILE%'));
  assert.ok(!JSON.stringify(p).includes(home));
  assert.equal(p.children, undefined);
});
