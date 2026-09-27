import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const AGENTS = [
  ['game designer', 'Make the core loop compelling and define clear win/lose states.'],
  ['mechanics engineer', 'Design responsive controls, collision rules, and fair difficulty.'],
  ['art director', 'Set a distinct visual direction that can be drawn with CSS or Canvas.'],
  ['level designer', 'Propose a short, replayable progression that fits one self-contained game.'],
  ['UI designer', 'Plan a legible title screen, HUD, pause state, and restart flow.'],
  ['accessibility reviewer', 'Recommend keyboard support, readable contrast, and reduced-motion behavior.'],
  ['sound designer', 'Describe optional lightweight sound cues and how they can be muted.'],
  ['gameplay programmer', 'Identify the simplest robust implementation approach in plain browser code.'],
  ['QA tester', 'List likely edge cases and specific behaviors the finished game must handle.'],
  ['creative producer', 'Find one memorable twist that keeps scope small and the result cohesive.']
];

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 180_000) throw new Error('요청이 너무 큽니다.'); }
  return data ? JSON.parse(data) : {};
}
function contentText(text) {
  const match = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let result = (match ? match[1] : text).trim();
  const start = result.toLowerCase().indexOf('<!doctype html');
  const alternate = result.toLowerCase().indexOf('<html');
  const index = start >= 0 ? start : alternate;
  if (index > 0) result = result.slice(index);
  if (!/<html[\s>]/i.test(result) || !/<body[\s>]/i.test(result)) throw new Error('모델 응답에서 완성된 HTML 게임을 찾지 못했습니다. 다시 생성해 주세요.');
  return result;
}
function providerConfig(provider, model) {
  const defaults = {
    openai: { url: 'https://api.openai.com/v1/responses', model: 'gpt-5.4-mini' },
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-3-flash-preview')}:generateContent`, model: 'gemini-3-flash-preview' },
    claude: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-5' },
    grok: { url: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.7' }
  };
  if (!defaults[provider]) throw new Error('지원하지 않는 AI 제공자입니다.');
  return { ...defaults[provider], model: model || defaults[provider].model };
}
async function providerCall(provider, model, key, prompt) {
  const c = providerConfig(provider, model);
  const headers = { 'content-type': 'application/json' };
  let url = c.url, payload;
  if (provider === 'openai') {
    headers.authorization = `Bearer ${key}`;
    payload = { model: c.model, input: prompt, max_output_tokens: 6500 };
  } else if (provider === 'gemini') {
    url += `?key=${encodeURIComponent(key)}`;
    payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 6500 } };
  } else if (provider === 'claude') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    payload = { model: c.model, max_tokens: 6500, messages: [{ role: 'user', content: prompt }] };
  } else {
    headers.authorization = `Bearer ${key}`;
    payload = { model: c.model, max_tokens: 6500, messages: [{ role: 'user', content: prompt }] };
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(240_000) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json?.message || `제공자 요청이 실패했습니다 (${response.status}).`);
  if (provider === 'openai') return (json.output || []).flatMap(item => item.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
  if (provider === 'gemini') return json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
  if (provider === 'claude') return (json.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  return json.choices?.[0]?.message?.content || '';
}
function codexExec(prompt, model) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json'];
    if (model) args.push('--model', model);
    args.push(prompt);
    const child = spawn(process.env.CODEX_BIN || 'codex', args, { windowsHide: true, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Codex 실행 시간이 초과되었습니다.')); }, 240_000);
    child.stdout.on('data', b => { out += b.toString(); if (out.length > 1_000_000) child.kill(); });
    child.stderr.on('data', b => { err += b.toString(); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Codex CLI를 찾지 못했습니다. Codex CLI를 설치하고 `codex login`을 실행해 주세요.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().slice(-900) || 'Codex CLI 요청에 실패했습니다. `codex login status`를 확인해 주세요.'));
      const messages = out.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
      const final = messages.reverse().find(x => x.type === 'item.completed' && x.item?.type === 'agent_message')?.item?.text;
      resolve(final || out.trim());
    });
  });
}
async function generate(input, notify = () => {}) {
  const { provider, model, key, description, title } = input;
  if (!description?.trim()) throw new Error('게임 아이디어를 입력해 주세요.');
  if (description.length > 3000) throw new Error('아이디어는 3,000자 이내로 입력해 주세요.');
  if (provider !== 'codex' && (!key || key.length < 8)) throw new Error('선택한 제공자의 API 키를 입력해 주세요. 키는 요청 처리 중에만 사용됩니다.');
  const call = p => provider === 'codex' ? codexExec(p, model) : providerCall(provider, model, key, p);
  const name = title?.trim() || '새 게임';
  const reports = await Promise.all(AGENTS.map(async ([role, assignment], i) => {
    const prompt = `You are specialist agent ${i + 1} of 10 for one browser game.\nRole: ${role}.\nTask: ${assignment}\nGame idea: ${description}\nReturn a concise implementation brief of at most 120 words. Do not write code.`;
    const result = await call(prompt);
    notify({ type: 'agentComplete', index: i, role });
    return { role, result: result.trim().slice(0, 1600) };
  }));
  notify({ type: 'synthesis' });
  const briefs = reports.map((r, i) => `${i + 1}. ${r.role}: ${r.result}`).join('\n');
  const prompt = `Create a polished, playable browser game as ONE complete standalone HTML document.\n\nTitle: ${name}\nGame request: ${description}\n\nTen specialist-agent briefs (incorporate them into one coherent game):\n${briefs}\n\nRequirements:\n- Return only complete HTML, starting with <!doctype html>. No markdown fences or explanation.\n- Include all CSS and JavaScript inline. Use Canvas or DOM. No external libraries, assets, network requests, or build steps.\n- Make controls obvious, responsive on phone and desktop, and immediately playable. Include start, pause if appropriate, score/progression, game over/win, and restart.\n- Use an original visual style with polished typography, color, animation and interface. Keyboard and touch controls where suitable. Add a mute control if sound is used.\n- Avoid remote resources and unsafe eval. Respect prefers-reduced-motion.\n- Ensure the game works when embedded inside a sandboxed iframe. Keep the implementation self-contained.`;
  const html = contentText(await call(prompt));
  return { id: crypto.randomUUID(), title: name, description: description.trim(), html, agents: reports, createdAt: new Date().toISOString(), provider, model: model || '' };
}
async function codexStatus() {
  return new Promise(resolve => {
    const child = spawn(process.env.CODEX_BIN || 'codex', ['login', 'status'], { windowsHide: true, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ installed: true, authenticated: false, detail: 'Codex 상태 확인 시간이 초과되었습니다.' }); }, 7000);
    child.stdout.on('data', b => out += b.toString()); child.stderr.on('data', b => err += b.toString());
    child.on('error', () => { clearTimeout(timer); resolve({ installed: false, authenticated: false }); });
    child.on('close', code => { clearTimeout(timer); resolve({ installed: true, authenticated: code === 0, detail: (out || err).trim().slice(0, 200) }); });
  });
}
async function deploy(input) {
  const project = String(input.project || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) throw new Error('Cloudflare 프로젝트 이름은 영문 소문자, 숫자, 하이픈으로 입력해 주세요.');
  const gamesDir = path.join(ROOT, 'games', project);
  await mkdir(gamesDir, { recursive: true });
  const entries = await readdir(gamesDir, { withFileTypes: true });
  if (!entries.some(e => e.isFile() && e.name === 'index.html')) throw new Error('먼저 게임 모음의 index.html을 이 프로젝트 폴더로 내보내 주세요.');
  const bin = process.platform === 'win32' ? path.join(ROOT, 'node_modules', '.bin', 'wrangler.cmd') : path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  const args = ['pages', 'deploy', gamesDir, '--project-name', project];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: ROOT, windowsHide: true, env: process.env, shell: process.platform === 'win32' });
    let out = '', err = '';
    child.stdout.on('data', b => out += b.toString()); child.stderr.on('data', b => err += b.toString());
    child.on('error', () => reject(new Error('Wrangler를 찾지 못했습니다. `npm install` 후 다시 실행해 주세요.')));
    child.on('close', code => code === 0 ? resolve({ output: (out + err).slice(-2500), url: `https://${project}.pages.dev` }) : reject(new Error((err || out).slice(-1200) || 'Cloudflare Pages 배포에 실패했습니다.')));
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { return send(res, 403, { error: '로컬 앱 요청만 허용됩니다.' }); }
        if (!['127.0.0.1', 'localhost', '::1'].includes(origin.hostname) || Number(origin.port) !== PORT) return send(res, 403, { error: '로컬 앱 요청만 허용됩니다.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, version: '0.1.0' });
      if (req.method === 'GET' && url.pathname === '/api/codex/status') return send(res, 200, await codexStatus());
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        const input = await body(req);
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'connection': 'keep-alive', 'x-content-type-options': 'nosniff' });
        const emit = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
        try { const result = await generate(input, emit); emit({ type: 'complete', game: result }); }
        catch (error) { emit({ type: 'error', error: error.message || '게임 생성에 실패했습니다.' }); }
        return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/api/export') {
        const { project, html } = await body(req);
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project) || typeof html !== 'string' || html.length > 4_000_000) throw new Error('내보내기 정보가 올바르지 않습니다.');
        const dir = path.join(ROOT, 'games', project); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'index.html'), html, 'utf8');
        return send(res, 200, { ok: true, path: `games/${project}/index.html` });
      }
      if (req.method === 'POST' && url.pathname === '/api/deploy') return send(res, 200, await deploy(await body(req)));
      return send(res, 404, { error: 'API 경로를 찾을 수 없습니다.' });
    }
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(ROOT, 'public', `.${requested}`);
    if (!file.startsWith(path.resolve(ROOT, 'public') + path.sep)) return send(res, 403, { error: '금지된 경로입니다.' });
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    const data = await readFile(file); send(res, 200, data, types[ext] || 'application/octet-stream');
  } catch (error) {
    if (res.headersSent) return res.destroy();
    send(res, 400, { error: error.message || '요청을 처리하지 못했습니다.' });
  }
});
server.listen(PORT, HOST, () => console.log(`Button Game Studio running at http://${HOST}:${PORT}`));
