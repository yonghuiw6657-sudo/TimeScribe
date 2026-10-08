/**
 * 浏览器测试运行器（用 Edge 无头模式真实执行）
 *
 * 用法：
 *   node tests/run-browser-tests.mjs P0
 *   node tests/run-browser-tests.mjs ALL
 *
 * 工作方式：
 *   1. 确保 http://127.0.0.1:8787 上的本机服务在运行（不在则用 start-server.ps1 拉起）
 *   2. 让 Edge 打开 tests/selftest.html?report=1，测试页跑完后把结果 POST 回 /__result
 *   3. 运行器轮询 http://127.0.0.1:8787/__result 取回结果
 *
 * 为什么不直接用 --dump-dom：
 *   headless 的 --dump-dom 会在页面脚本还没跑完时就把 DOM 取走（只剩 RUNNING）。
 *   用 --virtual-time-budget 虽然能等到结果，但虚拟时间下 setTimeout 几乎瞬时触发、
 *   而 Date.now() 仍走真实时间，两者脱节会让"计时时长"类断言失去意义。
 *   因此改用"测试页主动回传结果 + 运行器轮询"，计时测试就能跑在真实时间上。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const RESULT_URL = `${BASE}/__result`;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe')
];

const args = process.argv.slice(2);
const phases = args.filter((a) => /^(P\d+|ALL)$/i.test(a)).map((a) => a.toUpperCase());
if (phases.length === 0) phases.push('ALL');

// ------------------------------------------------------------------ helpers
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function serverAlive() {
  try {
    const res = await fetch(`${BASE}/tests/harness.js`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverAlive()) return true;
    await sleep(250);
  }
  return false;
}

async function clearResult() {
  try {
    await fetch(RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '__CLEAR__'
    });
  } catch { /* ignore */ }
}

async function fetchResult() {
  try {
    const res = await fetch(RESULT_URL, { cache: 'no-store' });
    if (res.status !== 200) return null;
    const text = (await res.text()).trim();
    if (!text || text === '__CLEAR__') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

// --------------------------------------------------------------------- main
const startedByUs = [];
let exitCode = 0;
const edgeProcs = [];

try {
  const external = await serverAlive();
  if (!external) {
    const launched = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'start-server.ps1'), '-Port', String(PORT)],
      { encoding: 'utf8', windowsHide: true, cwd: ROOT, timeout: 30000 }
    );
    const out = (launched.stdout || '').trim();
    const pidMatch = /SERVER_(?:PID|ALREADY)=(\d+)/.exec(out);
    if (!pidMatch) {
      console.error('无法启动本机服务（127.0.0.1:' + PORT + '）。');
      console.error(out || (launched.stderr || '').slice(0, 600) || '（无输出）');
      process.exit(2);
    }
    const startedPid = Number(pidMatch[1]);
    if (startedPid > 0) startedByUs.push(startedPid);
    if (!(await waitForServer(10000))) {
      console.error('服务已启动但端口未就绪。');
      process.exit(2);
    }
  }

  const edge = findEdge();
  if (!edge) {
    console.error('找不到 Microsoft Edge，无法执行浏览器测试。');
    process.exit(2);
  }

  const profile = mkdtempSync(path.join(tmpdir(), 'tt-edge-'));
  try {
    for (const phase of phases) {
      await clearResult();

      const url = `${BASE}/tests/selftest.html?p=${encodeURIComponent(phase)}&fmt=json&app=1&report=1&t=${Date.now()}`;
      const child = spawn(edge, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        `--user-data-dir=${profile}`,
        url
      ], { stdio: 'ignore', windowsHide: true });
      edgeProcs.push(child);

      // 轮询等待结果回传（计时类测试本身需要几秒到几十秒）
      const deadline = Date.now() + 240000;
      let payload = null;
      while (Date.now() < deadline) {
        payload = await fetchResult();
        if (payload) break;
        if (child.exitCode !== null && child.exitCode !== 0) break;
        await sleep(500);
      }

      if (!payload) {
        console.error(`[${phase}] 未能在规定时间内取回测试结果（页面可能报错或超时）。`);
        exitCode = 1;
        continue;
      }

      if (!payload.results || payload.summary.total === 0) {
        console.error(`[${phase}] 没有任何测试被执行，测试配置有问题（不能让这种情况算通过）。`);
        exitCode = 1;
        continue;
      }

      for (const r of payload.results) {
        const tag = r.passed ? 'PASS' : 'FAIL';
        console.log(`${tag}  [${r.phase}] ${r.suite} :: ${r.test}${r.passed ? '' : '  →  ' + r.message}`);
      }
      console.log(`浏览器测试 [${phase}]：总计 ${payload.summary.total} 项，通过 ${payload.summary.passed}，失败 ${payload.summary.failed}`);
      if (payload.summary.failed > 0) exitCode = 1;
    }
  } finally {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
} finally {
  for (const child of edgeProcs) {
    try { child.kill(); } catch { /* ignore */ }
  }
  for (const pid of startedByUs) {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch { /* ignore */ }
  }
}

process.exit(exitCode);
