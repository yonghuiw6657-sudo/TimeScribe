/**
 * 按阶段加载浏览器测试（由 selftest.html 动态 import）。
 * 文件清单来自 manifest.json，避免把文件名硬编码在页面里。
 */
const params = new URLSearchParams(location.search);
const rawPhase = params.get('p') || 'ALL';
const phase = rawPhase.toUpperCase();

const manifest = await (await fetch('./manifest.json', { cache: 'no-store' })).json();

const files = [];
if (phase === 'ALL') {
  for (const key of Object.keys(manifest.phases)) {
    for (const f of (manifest.phases[key].browser || [])) files.push('./' + f);
  }
} else {
  const entry = manifest.phases[phase];
  if (!entry) throw new Error('未知阶段：' + phase);
  for (const f of (entry.browser || [])) files.push('./' + f);
}

export const loaded = [];
for (const file of files) {
  // 加时间戳避免浏览器缓存导致测试文件没有被重新执行
  await import(file + '?v=' + (window.__TT_LOAD_TAG__ || Date.now()));
  loaded.push(file);
}

export const phaseName = phase;
export const fileList = files;
