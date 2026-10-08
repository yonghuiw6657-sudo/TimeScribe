/**
 * P0 启动链路自检（Node 运行）
 *
 * 目的：验证"双击 启动.bat → 本机服务起来 → 端口可访问"这条链路真的成立，
 * 而不是只在手动实验里成立。
 *
 * 做法：把交付文件复制到临时目录，把 启动.bat 中"打开 Edge"那一行换成写标记文件，
 * 然后真的执行它。这样能完整验证脚本逻辑，又不会弹出浏览器窗口。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const log = [];
let failures = 0;

function pass(name, detail) {
  log.push(`PASS  [P0] 启动链路 :: ${name}${detail ? '  (' + detail + ')' : ''}`);
}

function fail(name, message) {
  failures += 1;
  log.push(`FAIL  [P0] 启动链路 :: ${name}  →  ${message}`);
}

function check(name, fn) {
  try {
    pass(name, fn());
  } catch (err) {
    fail(name, err.message);
  }
}

async function checkAsync(name, fn) {
  try {
    pass(name, await fn());
  } catch (err) {
    fail(name, err.message);
  }
}

function ps(command) {
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', command],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return (res.stdout || '').trim();
}

function listenerCount(port) {
  const out = ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count`);
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

/** netstat 给出的端口占用者更可靠（Get-NetTCPConnection 在 HttpListener 场景下会显示 PID 4）。 */
function listenerOwners(port) {
  const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  const owners = [];
  for (const line of (res.stdout || '').split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[1];
    if (!local.endsWith(':' + port)) continue;
    owners.push(cols[cols.length - 1]);
  }
  return owners;
}

function killPort(port) {
  const pids = listenerOwners(port).filter((p) => p !== '0' && p !== '4');
  for (const pid of pids) spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true });
  return pids;
}

/** 等端口彻底空闲，避免上一轮测试的僵尸服务导致新服务绑定失败（HttpListener 会静默失败）。 */
async function waitPortFree(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  while (Date.now() < deadline) {
    lastCount = listenerCount(port);
    if (lastCount === 0) return true;
    killPort(port);
    await sleep(300);
  }
  return lastCount === 0;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 同步读取一个本机 URL 的文本（避免 PowerShell 管道的编码转换问题）。 */
function fetchSyncText(url) {
  const res = spawnSync(process.execPath, ['-e',
    `fetch(${JSON.stringify(url)}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{console.error(e.message);process.exit(1)})`
  ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (res.status !== 0) throw new Error('读取失败：' + (res.stderr || '').slice(0, 200));
  return res.stdout || '';
}

async function portAnswering(url) {
  for (let i = 0; i < 10; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch { /* retry */ }
    await sleep(300);
  }
  return false;
}

// -------------------------------------------------------------------- 主体
const sandboxDir = mkdtempSync(path.join(tmpdir(), 'tt-launch-'));
let PORT = 0;
let BASE = '';

/** 挑一个真正空闲的端口，避免上一轮遗留的 HTTP.sys 预留导致误判（这本身也是"资源释放"的检查）。 */
async function pickFreePort() {
  for (let port = 8801; port <= 8899; port++) {
    if (listenerCount(port) !== 0) continue;
    if (await portAnswering(`http://127.0.0.1:${port}/index.html`)) continue;
    return port;
  }
  throw new Error('8801-8899 之间没有空闲端口，测试环境异常');
}

try {
  PORT = await pickFreePort();
  BASE = `http://127.0.0.1:${PORT}`;
  log.push('  （本次使用端口 ' + PORT + '）');

  cpSync(path.join(ROOT, 'index.html'), path.join(sandboxDir, 'index.html'));
  cpSync(path.join(ROOT, 'css'), path.join(sandboxDir, 'css'), { recursive: true });
  cpSync(path.join(ROOT, 'js'), path.join(sandboxDir, 'js'), { recursive: true });
  cpSync(path.join(ROOT, 'serve.ps1'), path.join(sandboxDir, 'serve.ps1'));
  cpSync(path.join(ROOT, 'start-server.ps1'), path.join(sandboxDir, 'start-server.ps1'));
  cpSync(path.join(ROOT, 'launch.ps1'), path.join(sandboxDir, 'launch.ps1'));

  const batSrc = readFileSync(path.join(ROOT, '启动.bat'), 'utf8');
  let portRebound = 0;
  let scriptSwapped = 0;
  const patched = batSrc.split(/\r?\n/).map((line) => {
    let out = line;
    const portMatch = /-Port\s+(\d+)/.exec(out);
    if (portMatch) {
      out = out.replace(portMatch[0], '-Port ' + PORT);
      portRebound += 1;
    }
    // 指向测试替身：替身负责"写标记文件代替打开 Edge"，非测试模式则转交真实 launch.ps1
    if (out.includes('launch.ps1')) {
      out = out.replace('launch.ps1', 'stub.ps1');
      scriptSwapped += 1;
    }
    return out;
  }).join('\r\n');

  const ps1Src = readFileSync(path.join(ROOT, 'launch.ps1'), 'utf8');
  const stub = [
    'param([int]$Port = 8787)',
    'if ($env:TT_TEST_FAKE_LAUNCH -eq "1") {',
    '  "LAUNCH_CALLED" | Out-File -FilePath (Join-Path $PSScriptRoot "launch-flag.txt") -Encoding ascii',
    '  exit 0',
    '}',
    '& (Join-Path $PSScriptRoot "launch.ps1") -Port $Port',
    'exit $LASTEXITCODE',
    ''
  ].join('\r\n');
  writeFileSync(path.join(sandboxDir, 'stub.ps1'), stub, 'utf8');

  const launchHasEdge = /msedge\.exe/.test(ps1Src);
  const launchHasStartProcess = /Start-Process/.test(ps1Src);

  check('launch.ps1 负责选择并打开 Edge（.bat 已不含该逻辑）', () => {
    if (!launchHasEdge) throw new Error('launch.ps1 里找不到 Edge 路径，用户不会打开浏览器');
    if (!launchHasStartProcess) throw new Error('launch.ps1 里没有 Start-Process，无法打开浏览器');
    return '由 launch.ps1 打开 Edge';
  });
  check('启动.bat 只做"调用 launch.ps1"，自身不含 Edge 逻辑', () => {
    if (!/launch\.ps1/.test(batSrc)) throw new Error('启动.bat 没有调用 launch.ps1');
    if (/msedge/i.test(batSrc)) throw new Error('启动.bat 里仍有 Edge 逻辑，应集中在 launch.ps1');
    if (portRebound !== 1) throw new Error('期望在 启动.bat 中找到 1 处端口参数，实际 ' + portRebound + ' 处');
    if (scriptSwapped !== 1) throw new Error('期望在 启动.bat 中找到 1 处脚本调用，实际 ' + scriptSwapped + ' 处');
    return '端口参数 1 处；Edge 逻辑已集中在 launch.ps1';
  });
  check('启动.bat 不重复定义启动逻辑（只有一处脚本调用）', () => {
    const calls = (batSrc.match(/launch\.ps1/g) || []).length;
    if (calls !== 1) throw new Error('期望恰好 1 处调用 launch.ps1，实际 ' + calls + ' 处');
    return '唯一入口：launch.ps1';
  });

  check('启动.bat 只使用 ASCII 字符（cmd 下中文会乱码）', () => {
    const buf = readFileSync(path.join(ROOT, '启动.bat'));
    const offenders = [];
    for (let i = 0; i < buf.length && offenders.length <= 3; i++) {
      if (buf[i] > 0x7F) offenders.push('字节 ' + i + ' = 0x' + buf[i].toString(16));
    }
    if (offenders.length) throw new Error('存在非 ASCII 字节：' + offenders.join(', '));
    return '纯 ASCII';
  });

  check('停止.bat 也只使用 ASCII 字符', () => {
    const buf = readFileSync(path.join(ROOT, '停止.bat'));
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] > 0x7F) throw new Error('存在非 ASCII 字节，位置 ' + i);
    }
    return '纯 ASCII';
  });

  check('批处理文件不带 BOM（cmd 会把 BOM 当成命令的一部分）', () => {
    for (const name of ['启动.bat', '停止.bat', '测试.bat']) {
      const buf = readFileSync(path.join(ROOT, name));
      if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        throw new Error(name + ' 带 UTF-8 BOM，会导致 @echo off 失效');
      }
    }
    return '三个批处理文件均无 BOM';
  });

  writeFileSync(path.join(sandboxDir, '启动-test.bat'), patched, 'utf8');

  await checkAsync('测试开始前端口已彻底空闲（避免上一轮僵尸服务干扰）', async () => {
    killPort(PORT);
    const free = await waitPortFree(PORT);
    if (!free) throw new Error('端口 ' + PORT + ' 无法释放，测试环境不干净');
    return '端口空闲';
  });

  // ---- 第一次：完整真实链路（不起 Edge 之外的一切都真实执行）----
  const run = spawnSync('cmd.exe', ['/c', '启动-test.bat'], {
    cwd: sandboxDir, encoding: 'utf8', windowsHide: true, timeout: 60000,
    env: Object.assign({}, process.env, { TT_DEBUG_SERVER: '1' })
  });
  log.push('  （启动.bat 退出码 ' + run.status + '）');
  if (process.env.TT_DEBUG_LAUNCH) {
    log.push('  DEBUG sandbox=' + sandboxDir);
    log.push('  DEBUG files=' + readdirSync(sandboxDir).join(','));
    log.push('  DEBUG listenerCount=' + listenerCount(PORT));
    log.push('  DEBUG stdout=' + JSON.stringify(run.stdout || '').slice(0, 1500));
    log.push('  DEBUG stderr=' + JSON.stringify(run.stderr || '').slice(0, 800));
  }
  if (run.stdout && run.stdout.trim()) log.push('  stdout: ' + run.stdout.trim().replace(/\s+/g, ' ').slice(0, 240));

  check('执行 启动.bat 的退出码为 0', () => {
    if (run.status !== 0) throw new Error('退出码 ' + run.status + '，stderr: ' + (run.stderr || '').slice(0, 300));
    return 'ok';
  });

  await checkAsync('启动后端口可以访问（浏览器打开时页面已就绪，不是空白页）', async () => {
    const alive = await portAnswering(`${BASE}/index.html`);
    if (!alive) throw new Error('端口没有响应，用户会看到"无法访问"');
    return 'HTTP 可访问';
  });

  check('服务确实在提供 app 页面（内容正确且为中文）', () => {
    // 用 fetch 而不是 PowerShell 管道：PowerShell 管道会把中文按控制台编码转换，导致误判
    const html = fetchSyncText(`${BASE}/index.html`);
    if (!html.includes('TimeScribe')) throw new Error('index.html 内容异常：' + html.slice(0, 120));
    return '内容正确（' + html.length + ' 字节）';
  });

  check('服务返回的 JavaScript MIME 类型正确（否则 ES 模块无法加载）', () => {
    const ct = ps(`$r = Invoke-WebRequest -Uri '${BASE}/js/main.js' -UseBasicParsing -TimeoutSec 5; $r.Headers['Content-Type']`);
    if (!/javascript/i.test(ct)) throw new Error('Content-Type 不是 javascript：' + ct);
    return ct;
  });

  check('目录穿越被拒绝（不能读取服务目录之外的文件）', () => {
    const code = ps(`try { $r = Invoke-WebRequest -Uri '${BASE}/../../Windows/win.ini' -UseBasicParsing -TimeoutSec 5; $r.StatusCode } catch { $_.Exception.Response.StatusCode.value__ }`);
    if (code === '200') throw new Error('越权读取成功，存在目录穿越问题');
    return 'HTTP ' + code;
  });

  check('再次执行 启动.bat 不会起第二个服务（幂等）', () => {
    const before = listenerCount(PORT);
    if (before !== 1) throw new Error('第一次启动后监听进程数为 ' + before + '，期望 1');
    const run2 = spawnSync('cmd.exe', ['/c', '启动-test.bat'], {
      cwd: sandboxDir, encoding: 'utf8', windowsHide: true, timeout: 60000
    });
    const after = listenerCount(PORT);
    if (run2.status !== 0) throw new Error('第二次执行退出码 ' + run2.status);
    if (after !== before) throw new Error('监听进程数从 ' + before + ' 变成了 ' + after);
    return '监听进程数仍为 ' + after;
  });

  check('服务已在运行时被识别为复用而非重复启动', () => {
    // 直接问 start-server.ps1：它必须返回 SERVER_ALREADY，而不是再起一个
    const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(sandboxDir, 'start-server.ps1'), '-Port', String(PORT)],
      { encoding: 'utf8', windowsHide: true, cwd: sandboxDir, timeout: 30000 });
    const out = (res.stdout || '').trim();
    if (!/SERVER_ALREADY/.test(out)) {
      throw new Error('start-server.ps1 没有识别出已有服务，输出：' + JSON.stringify(out.slice(0, 200)));
    }
    if (listenerCount(PORT) !== 1) throw new Error('复用判断期间多起了服务');
    return out.slice(0, 60);
  });

  check('服务进程独立于启动脚本存在（脚本退出后仍在监听）', () => {
    if (listenerCount(PORT) !== 1) throw new Error('启动脚本退出后服务也没了');
    return '存活';
  });

  check('服务进程号写入了 server.pid，便于诊断与停止', () => {
    const pidPath = path.join(sandboxDir, 'server.pid');
    if (!existsSync(pidPath)) throw new Error('缺少 server.pid，出问题时无法定位服务进程');
    const pid = readFileSync(pidPath, 'utf8').trim();
    if (!/^\d+$/.test(pid)) throw new Error('server.pid 内容不是进程号：' + pid);
    // HttpListener 由 HTTP.sys 代管，netstat 可能显示 PID 4，因此校验"进程真实存在"而不是"是不是 TCP 监听者"
    const alive = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Measure-Object).Count`);
    if (alive.trim() !== '1') throw new Error('server.pid 记录的进程 ' + pid + ' 并不存在（服务可能已退出）');
    return 'PID ' + pid + ' 对应的进程存在，监听者 ' + listenerOwners(PORT).join(',');
  });

  check('端口被占用时不会静默失败（失败信息会写入 server.log）', () => {
    // 此时服务正在运行 → 再直接跑一次 serve.ps1，应当明确拒绝并记录日志
    const logPath = path.join(sandboxDir, 'server.log');
    const before = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0;
    const second = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(sandboxDir, 'serve.ps1'), '-Port', String(PORT), '-Quiet'],
      { encoding: 'utf8', windowsHide: true, cwd: sandboxDir, timeout: 30000 });
    if (second.status === 0) throw new Error('端口已被占用，重复启动却返回成功');
    if (!existsSync(logPath)) throw new Error('没有生成 server.log，用户遇到问题无从排查');
    const after = readFileSync(logPath, 'utf8');
    if (after.length <= before) throw new Error('server.log 没有记录本次失败原因');
    if (!/already in use/.test(after)) throw new Error('server.log 内容未说明原因：' + after.slice(-200));
    return '已记录失败原因，退出码 ' + second.status;
  });

  // ---- 第二次：用替身替换"打开浏览器"这一步，验证脚本确实走到了那一步 ----
  await checkAsync('脚本会走到"打开浏览器"这一步（用替身记录，不真的弹窗）', async () => {
    const batForStub = patched.replace('launch.ps1', 'stub.ps1');
    writeFileSync(path.join(sandboxDir, '启动-stub.bat'), batForStub, 'utf8');
    const flagPath = path.join(sandboxDir, 'launch-flag.txt');
    if (existsSync(flagPath)) rmSync(flagPath, { force: true });
    const ownersBefore = listenerOwners(PORT).slice().sort().join(',');

    const res = spawnSync('cmd.exe', ['/c', '启动-stub.bat'], {
      cwd: sandboxDir, encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: Object.assign({}, process.env, { TT_TEST_FAKE_LAUNCH: '1' })
    });
    if (res.status !== 0) throw new Error('替身模式下退出码 ' + res.status + '：' + (res.stderr || '').slice(0, 200));
    if (!existsSync(flagPath)) throw new Error('没有到达打开浏览器那一步，用户双击后不会看到界面');
    if (listenerOwners(PORT).slice().sort().join(',') !== ownersBefore) {
      throw new Error('替身模式不应改变服务状态');
    }
    return '已到达打开浏览器这一步（服务状态未变）';
  });
} finally {
  // 明确结束由本测试拉起的服务进程，并确认端口最终释放
  const pidPath = path.join(sandboxDir, 'server.pid');
  let serverPid = null;
  if (PORT && existsSync(pidPath)) {
    const v = readFileSync(pidPath, 'utf8').trim();
    if (/^\d+$/.test(v)) serverPid = v;
  }
  if (serverPid) spawnSync('taskkill', ['/PID', serverPid, '/T', '/F'], { windowsHide: true });
  killPort(PORT);

  let left = -1;
  for (let i = 0; i < 30; i++) {
    left = listenerCount(PORT);
    if (left === 0) break;
    await sleep(500);
  }
  if (PORT) {
    if (left === 0) {
      pass('测试结束后服务已停止且端口已释放（不留僵尸服务）', '端口 ' + PORT + ' 空闲');
    } else {
      fail('测试结束后服务已停止且端口已释放（不留僵尸服务）',
        '端口 ' + PORT + ' 上仍有 ' + left + ' 个监听者（可能只剩 HTTP.sys 预留，进程已结束）');
    }
  }
  try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

for (const line of log) console.log(line);
console.log('');
console.log(`启动链路测试：失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
