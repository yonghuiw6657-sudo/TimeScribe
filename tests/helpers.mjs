/**
 * 浏览器测试与被测 app 之间的桥接工具。
 * 测试页与 app 同源，因此可以直接操作 app 窗口里的真实模块。
 */
export const T = window.TTTest;

function frame() {
  return document.getElementById('app-frame');
}

export function appWin() {
  const f = frame();
  T.ok(f, '测试页缺少被测 iframe');
  const win = f.contentWindow;
  T.ok(win && win.document, '被测 app 未加载，本套测试无效');
  T.ok(win.TTStore, '被测 app 的模块还不存在（可能尚未完成启动）');
  return win;
}

export function appDoc() {
  return appWin().document;
}

/** app 里的全局模块：m('TTStore') */
export function m(name) {
  const w = appWin();
  T.ok(w[name], 'app 里缺少模块 ' + name);
  return w[name];
}

export function doc() {
  return appDoc();
}

export function q(selector) {
  // 弹窗会渲染在 app 自己的文档里（那里才有真实的项目数据），
  // 因此查询时优先看 app 文档，找不到再看测试页。
  const inApp = appDoc().querySelector(selector);
  if (inApp) return inApp;
  return document.querySelector(selector);
}

export function qa(selector) {
  const list = Array.prototype.slice.call(appDoc().querySelectorAll(selector));
  if (list.length) return list;
  return Array.prototype.slice.call(document.querySelectorAll(selector));
}

export function textOf(selector) {
  const node = q(selector);
  return node ? node.textContent : null;
}

/**
 * 让被测 app 在一个干净的数据状态下重新启动。
 * app 会读取 ?fresh=1 并在启动时清空自己的数据。
 */
export async function resetAppData() {
  const f = frame();
  T.ok(f, '测试页缺少被测 iframe');

  // 直接清一次，保证即使不重启也已经干净（新旧两种键前缀都要清）
  try {
    const win = f.contentWindow;
    const keys = [];
    for (let i = 0; i < win.localStorage.length; i++) keys.push(win.localStorage.key(i));
    keys.forEach(function (k) {
      if (!k) return;
      if (k.indexOf('timescribe.') === 0 || k.indexOf('timetracker.') === 0) win.localStorage.removeItem(k);
    });
  } catch (err) { /* ignore */ }

  await new Promise(function (resolve) {
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    f.addEventListener('load', finish, { once: true });
    f.src = '../index.html?fresh=1&t=' + Date.now();
    setTimeout(finish, 8000);
  });

  const ok = await waitFor(function () {
    const win = f.contentWindow;
    return (win && win.__TIMESCRIBE_BOOT__ && win.TTStore && win.TTTimer) ? true : null;
  }, 8000);
  if (!ok) throw new Error('重新加载后 app 没有完成启动');

  // 上一次的计时状态也清掉（重载后本来就是空闲，这里只是保险）
  try { f.contentWindow.TTTimer.resetForTest(); } catch (e) { /* ignore */ }
  f.contentWindow.TTUI.toast.clearAll();
  f.contentWindow.TTUI.modal.closeAll();
}

export function commit(fn) {
  return m('TTStore').commit(fn);
}

/**
 * 把"不足多久不计入"的阈值临时改掉。
 * 注意：这不是降低验收标准——短段是否被丢弃由专门的门槛测试（P6）负责，
 * 这里改阈值是为了让其他测试能用几秒的段来做验证，不必真的等 2 分钟。
 */
export function setMinSeconds(sec) {
  return commit(function (s) {
    s.settings.minSeconds = sec;
    return s;
  });
}

export function state() {
  return m('TTStore').getState();
}

/** 直接用业务接口造数据，避免测试里到处写对象字面量。 */
export function addProject(name, parentId, color) {
  let created = null;
  commit(function (s) {
    created = m('TTProjects').createProject(s, { name: name, parentId: parentId || null, color: color });
    return s;
  });
  T.ok(created && created.ok, '创建项目失败：' + (created && created.reason));
  return created.project;
}

export function addRecord(projectId, dateStr, activeSec, extra) {
  const record = Object.assign({
    id: m('TTCalc').makeId('rec'),
    projectId: projectId,
    date: dateStr,
    startAt: dateStr + 'T02:00:00.000Z',
    endAt: dateStr + 'T03:00:00.000Z',
    activeSec: activeSec,
    pausedSec: 0,
    note: '',
    source: 'timer',
    createdAt: dateStr + 'T03:00:00.000Z'
  }, extra || {});
  commit(function (s) {
    s.records.push(record);
    return s;
  });
  return record;
}

export function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/** 等待某个条件成立（用于等异步渲染）。 */
export async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 3000);
  for (;;) {
    let value = null;
    try { value = fn(); } catch (e) { value = null; }
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(30);
  }
}

export function click(node) {
  T.ok(node, '要点击的元素不存在');
  node.dispatchEvent(new (appWin().MouseEvent)('click', { bubbles: true, cancelable: true }));
}

export function setValue(node, value) {
  T.ok(node, '要赋值的元素不存在');
  node.value = value;
  node.dispatchEvent(new (appWin().Event)('change', { bubbles: true }));
}

export function formFields() {
  const modal = topModal();
  return modal ? Array.prototype.slice.call(modal.querySelectorAll('.mb .input')) : [];
}

/** 当前最上层的弹窗（明细弹窗之上还会叠"补录/修改"弹窗）。 */
export function topModal() {
  const host = q('#modal-host');
  if (!host) return null;
  const modals = host.querySelectorAll('.modal');
  return modals.length ? modals[modals.length - 1] : null;
}

export function fieldByName(name) {
  const modal = topModal();
  return modal ? modal.querySelector('[data-field="' + name + '"]') : null;
}

export function modalButtons() {
  const modal = topModal();
  return modal ? Array.prototype.slice.call(modal.querySelectorAll('.mf .btn')) : [];
}

export function modalTitle() {
  const modal = topModal();
  if (!modal) return null;
  const head = modal.querySelector('.mh');
  return head ? head.textContent : null;
}

/** 把 #rrggbb 或 rgb(...) 统一成 #rrggbb，便于跨格式比较颜色。 */
export function normalizeColor(value) {
  const text = String(value || '').trim();
  if (text.indexOf('#') === 0) return text.toLowerCase();
  const match = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (!match) return text;
  const hex = function (n) { return ('0' + Number(n).toString(16)).slice(-2); };
  return '#' + hex(match[1]) + hex(match[2]) + hex(match[3]);
}

export function modalTitleOld() {
  return textOf('#modal-host .modal .mh');
}

export function lastToast() {
  const nodes = qa('#toast-host .toast');
  return nodes.length ? nodes[nodes.length - 1] : null;
}

export function clearToasts() {
  m('TTUI').toast.clearAll();
  // 弹窗/提示条也可能渲染在测试页的宿主里，一并清掉
  try {
    const testHost = document.getElementById('toast-host');
    if (testHost) while (testHost.firstChild) testHost.removeChild(testHost.firstChild);
    const testModal = document.getElementById('modal-host');
    if (testModal) {
      while (testModal.firstChild) testModal.removeChild(testModal.firstChild);
      testModal.hidden = true;
    }
  } catch (err) { /* ignore */ }
}
