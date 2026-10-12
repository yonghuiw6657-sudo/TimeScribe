/**
 * Node 测试运行器（纯逻辑测试 + 静态资源检查）
 *
 * 用法：
 *   node tests/run-node-tests.mjs              # 跑全部阶段
 *   node tests/run-node-tests.mjs P1           # 只跑 P1
 *   node tests/run-node-tests.mjs P1 P2        # 跑多个阶段
 *
 * 测试文件清单来自 tests/manifest.json，不在代码里硬编码文件名。
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const manifest = JSON.parse(readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'tmp') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

// ------------------------------------------------------------------ sandbox
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Promise,
  URL,
  URLSearchParams,
  performance,
  TT: {
    ROOT,
    path,
    fs: { readFileSync, existsSync, readdirSync, statSync, writeFileSync },
    walk
  }
};
sandbox.globalThis = sandbox;
sandbox.window = undefined;
vm.createContext(sandbox);

function runInSandbox(relPath) {
  const full = path.join(ROOT, relPath);
  if (!existsSync(full)) throw new Error('找不到文件：' + relPath);
  const src = readFileSync(full, 'utf8');
  vm.runInContext(src, sandbox, { filename: relPath });
}

// harness 的 defineSuite 是 async，必须等它完成注册
await vm.runInContext('(async function(){\n' + readFileSync(path.join(HERE, 'harness.js'), 'utf8') + '\n})()', sandbox, { filename: 'harness.js' });

// defineSuite 返回 Promise（因为支持 async 套件），收集起来统一等待，
// 否则 async 套件里的用例还没注册，runner 就会以为"没有测试"。
await vm.runInContext('globalThis.__TT_SUITE_PROMISES__ = [];', sandbox);
await vm.runInContext([
  'var __origDefineSuite = TTTest.defineSuite;',
  'TTTest.defineSuite = function (phase, name, fn) {',
  '  var p = __origDefineSuite(phase, name, fn);',
  '  globalThis.__TT_SUITE_PROMISES__.push(p);',
  '  return p;',
  '};'
].join('\n'), sandbox);

// 生产代码的全局模块（交付给浏览器，测试里直接复用同一份）。
// 新增全局模块时，必须同时在 manifest.json 与 tests/selftest.html、index.html 里登记，
// 并由 p1-data.test.js 的"三处清单一致"测试把关。
const GLOBAL_NAMES = {
  'js/util.js': 'TTUtil',
  'js/calc.js': 'TTCalc',
  'js/storage.js': 'TTStorage',
  'js/projects.js': 'TTProjects',
  'js/store.js': 'TTStore',
  'js/timer.js': 'TTTimer',
  'js/ui/toast.js': null,
  'js/ui/modal.js': null,
  'js/ui/form.js': null,
  'js/ui/home.js': null,
  'js/ui/checkin.js': null,
  'js/ui/projectActions.js': null,
  'js/ui/records.js': null,
  'js/ui/settings.js': null,
  'js/ui/data.js': null
};
for (const rel of manifest.browserGlobals || []) {
  const name = Object.prototype.hasOwnProperty.call(GLOBAL_NAMES, rel) ? GLOBAL_NAMES[rel] : undefined;
  if (name === undefined) throw new Error('新增了全局模块但没有在 GLOBAL_NAMES 里登记：' + rel);
  if (name === null) continue;          // 纯浏览器模块（依赖 document），Node 侧不加载
  runInSandbox(rel);
  if (!sandbox[name]) throw new Error(rel + ' 没有导出 ' + name);
  sandbox.TT[name] = sandbox[name];     // 测试里用 TT.TTCalc 这样访问
}

const wanted = process.argv.slice(2).filter((a) => /^P\d+$/i.test(a)).map((a) => a.toUpperCase());
const phases = Object.keys(manifest.phases).filter((p) => wanted.length === 0 || wanted.includes(p));

const files = [];
for (const phase of phases) {
  for (const f of manifest.phases[phase].node || []) files.push(f);
}

if (files.length === 0) {
  console.log('Node 侧没有匹配的测试文件（这在某些阶段是正常的）。');
  process.exit(0);
}

for (const file of files) {
  const full = path.join(HERE, file);
  const src = readFileSync(full, 'utf8');
  await vm.runInContext('(async function(){\n' + src + '\n})()', sandbox, { filename: file });
}
// 等所有套件注册完成（async 套件可能还在等着加载前的准备动作）
await vm.runInContext('Promise.all(globalThis.__TT_SUITE_PROMISES__)', sandbox);

const registered = await vm.runInContext('TTTest.suites.reduce(function(n, s){ return n + s.tests.length; }, 0)', sandbox);
if (registered === 0) {
  console.error('没有任何用例被注册，测试配置有问题（不能让这种情况算通过）。');
  process.exit(1);
}

const results = await sandbox.TTTest.run(null);
const summary = sandbox.TTTest.summarize(results);

for (const r of results) {
  const tag = r.passed ? 'PASS' : 'FAIL';
  console.log(`${tag}  [${r.phase}] ${r.suite} :: ${r.test}${r.passed ? '' : '  →  ' + r.message}`);
}
console.log('');
console.log(`Node 测试：总计 ${summary.total} 项，通过 ${summary.passed}，失败 ${summary.failed}`);

// 反向检查：清单里列的文件必须真的存在，避免"文件改名后测试静默消失"
let missing = 0;
for (const phase of Object.keys(manifest.phases)) {
  const entry = manifest.phases[phase];
  for (const f of (entry.node || [])) {
    if (!existsSync(path.join(HERE, f))) { console.error('清单中的测试文件不存在：' + f); missing += 1; }
  }
  for (const f of (entry.browser || [])) {
    if (!existsSync(path.join(HERE, f))) { console.error('清单中的测试文件不存在：' + f); missing += 1; }
  }
}
if (missing > 0) process.exit(1);

process.exit(summary.failed === 0 ? 0 : 1);
