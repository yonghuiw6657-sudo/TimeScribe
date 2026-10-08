/**
 * 全量测试总入口。
 *
 * 运行顺序：
 *   1. 编码规范修正与检查（tests/fix-bom.mjs）
 *   2. Node 纯逻辑测试（tests/run-node-tests.mjs）
 *   3. 启动链路测试（tests/p0-launch.mjs）
 *   4. Edge 无头浏览器测试（tests/run-browser-tests.mjs）
 *
 * 任何一步失败，整体失败（不掩盖、不跳过）。
 *
 * 用法：
 *   node tests/run-all.mjs            # 全部阶段
 *   node tests/run-all.mjs P3 P4      # 只跑指定阶段（Node 侧与浏览器侧同时过滤）
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const phases = process.argv.slice(2).filter((a) => /^P\d+$/i.test(a)).map((a) => a.toUpperCase());

const steps = [
  { name: '编码规范检查', cmd: ['tests/fix-bom.mjs'], always: true },
  { name: 'Node 逻辑测试', cmd: ['tests/run-node-tests.mjs', ...phases], always: true },
  { name: '启动链路测试', cmd: ['tests/p0-launch.mjs'], always: phases.length === 0 || phases.includes('P0') },
  { name: '浏览器测试', cmd: ['tests/run-browser-tests.mjs', ...(phases.length ? phases : ['ALL'])], always: true }
];

const summary = [];

for (const step of steps) {
  if (!step.always) {
    summary.push({ name: step.name, status: 'SKIPPED', code: 0 });
    continue;
  }
  console.log('');
  console.log('================ ' + step.name + ' ================');
  const res = spawnSync(process.execPath, step.cmd, {
    cwd: ROOT, stdio: 'inherit', windowsHide: true
  });
  const code = res.status === null ? 1 : res.status;
  summary.push({ name: step.name, status: code === 0 ? 'PASS' : 'FAIL', code });
}

console.log('');
console.log('================ 总览 ================');
let failed = 0;
for (const s of summary) {
  console.log(`${s.status.padEnd(7)} ${s.name}${s.status === 'FAIL' ? '（退出码 ' + s.code + '）' : ''}`);
  if (s.status === 'FAIL') failed += 1;
}
console.log('');
console.log(failed === 0 ? '全部测试通过' : `有 ${failed} 个测试步骤失败`);
process.exit(failed === 0 ? 0 : 1);
