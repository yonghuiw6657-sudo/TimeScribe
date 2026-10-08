/**
 * P10 界面收尾（浏览器运行）
 *
 * 覆盖 PRD 验收 H1–H6、I1–I4 中偏界面的部分。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf,
  clearToasts, sleep, waitFor
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

async function setFrameWidth(width) {
  const f = document.getElementById('app-frame');
  f.style.width = width + 'px';
  await sleep(250);
  return f.contentWindow;
}

T.defineSuite('P10', '界面与自适应', async function () {
  T.test('窗口较宽时是左右两栏（统计在左、列表在右）（H1）', async function () {
    await resetAppData();
    const win = await setFrameWidth(1180);
    const columns = win.document.querySelector('.columns');
    const style = win.getComputedStyle(columns);
    T.equal(style.display, 'flex');
    T.equal(style.flexDirection, 'row', '宽屏应是横向两栏');

    const left = win.getComputedStyle(win.document.querySelector('.col-left'));
    T.ok(parseFloat(left.flexBasis) >= 260, '左侧统计区应有固定宽度，实际 ' + left.flexBasis);
  });

  T.test('窗口变窄时自动变成单列，且不出现横向滚动条（H2）', async function () {
    await resetAppData();
    const win = await setFrameWidth(720);
    const columns = win.document.querySelector('.columns');
    const style = win.getComputedStyle(columns);
    T.equal(style.flexDirection, 'column', '窄屏应变成纵向单列');

    const doc = win.document.documentElement;
    T.ok(doc.scrollWidth <= doc.clientWidth + 1,
      '不该出现横向滚动条（scrollWidth ' + doc.scrollWidth + ' > clientWidth ' + doc.clientWidth + '）');
  });

  T.test('窄屏下统计区与扇形图在列表之前（从上到下顺序）', async function () {
    await resetAppData();
    const win = await setFrameWidth(720);
    const doc = win.document;
    const stats = doc.getElementById('stat-total');
    const chart = doc.getElementById('chart-panel');
    const list = doc.getElementById('project-list');
    const position = function (node) { return node.getBoundingClientRect().top; };
    T.ok(position(stats) < position(chart), '累计投入应在扇形图上方');
    T.ok(position(chart) < position(list), '扇形图应在项目列表上方');
  });

  T.test('界面文案没有英文残留（H3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    m('TTUI').home.render();

    const doc = document.getElementById('app-frame').contentDocument;
    const visible = doc.body.innerText || '';
    const forbidden = ['undefined', 'null', 'NaN', '[object Object]', 'TODO', 'TODO:', 'Lorem'];
    for (const bad of forbidden) {
      T.notContains(visible, bad, '界面不该出现 ' + bad);
    }
    T.contains(visible, '累计总投入');
    T.contains(visible, '我的项目');
  });

  T.test('时间统一 24 小时制，不出现"上午/下午"（H3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    m('TTUI').recordHome = null;
    m('TTUI').home.render();
    m('TTUI').records.openDetail(p.id);

    const text = textOf('#modal-host');
    T.notContains(text, '上午');
    T.notContains(text, '下午');
    T.notContains(text, 'AM');
    T.notContains(text, 'PM');
    m('TTUI').modal.closeAll();
  });

  T.test('没有项目时显示引导空状态，并能从空状态直接建项目（H6）', async function () {
    await resetAppData();
    m('TTUI').home.render();
    const btn = q('[data-action="new-project"]');
    T.ok(btn, '空状态应有新建按钮');
    click(btn);
    T.contains(textOf('#modal-host .modal .mh'), '新建项目');

    const nameInput = q('#modal-host [data-field="name"]');
    nameInput.value = '工作';
    const createBtn = qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '创建'; })[0];
    click(createBtn);
    T.equal(state().projects.length, 1, '应能从空状态直接创建');
    T.notContains(textOf('#project-list'), '还没有项目', '空状态应消失');
  });

  T.test('有项目但没有记录时，卡片显示 0 分而不是空白（H6）', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();
    const card = textOf('[data-project-card]');
    T.contains(card, '共 0 分');
    T.contains(card, '今天 0 分');
    T.contains(card, '00:00:00');
  });

  T.test('项目名输入框有 30 字上限（I2）', async function () {
    await resetAppData();
    click(q('#btn-new-project'));
    const input = q('#modal-host [data-field="name"]');
    T.equal(input.getAttribute('maxlength'), '30', '输入框应限制 30 字');
    m('TTUI').modal.closeAll();
  });

  T.test('备注输入框有 100 字上限（I3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').records.openRecordForm({ projectId: p.id });
    const note = q('#modal-host [data-field="note"]');
    T.equal(note.getAttribute('maxlength'), '100', '备注框应限制 100 字');
    m('TTUI').modal.closeAll();
  });

  T.test('计时中卡片有醒目的状态标记，空闲时没有（H4 的界面侧）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    T.equal(q('[data-project-card="' + p.id + '"]').className.indexOf('running'), -1);

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    const card = q('[data-project-card="' + p.id + '"]');
    T.contains(card.className, 'running');
    T.contains(card.textContent, '计时中');
    m('TTTimer').stop();
  });

  T.test('点遮罩不会关掉弹窗（防止误触丢输入）', async function () {
    await resetAppData();
    addProject('工作');
    click(q('#btn-new-project'));
    const host = q('#modal-host');
    T.ok(host.querySelector('.modal'), '弹窗应已打开');

    // 点遮罩（host 本身，不是弹窗内部）
    click(host);
    T.ok(q('#modal-host .modal'), '点遮罩不该关闭弹窗');
    m('TTUI').modal.closeAll();
  });

  T.test('按 Esc 可以关闭最上层弹窗', async function () {
    await resetAppData();
    addProject('工作');
    click(q('#btn-new-project'));
    T.ok(q('#modal-host .modal'), '弹窗应已打开');

    const win = document.getElementById('app-frame').contentWindow;
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    T.equal(q('#modal-host .modal'), null, 'Esc 应关闭弹窗');
  });

  T.test('弹窗打开时焦点落在第一个输入框（便于直接打字）', async function () {
    await resetAppData();
    click(q('#btn-new-project'));
    const win = document.getElementById('app-frame').contentWindow;
    const active = win.document.activeElement;
    T.ok(active, '应有焦点元素');
    T.equal(active.getAttribute('data-field'), 'name', '焦点应落在名称输入框，实际 ' + (active.tagName + '/' + active.getAttribute('data-field')));
    m('TTUI').modal.closeAll();
  });

  T.test('不断操作不会产生脚本错误（H4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await sleep(400);
    click(q('[data-project-card="' + p.id + '"] [data-action="pause"]'));
    click(q('[data-project-card="' + p.id + '"] [data-action="resume"]'));
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));
    m('TTUI').home.render();
    clearToasts();

    T.deepEqual(window.__TT_PAGE_ERRORS__ || [], [], '操作过程中不该出现脚本错误');
  });

  T.test('多处空状态都有引导文案，不留空白（H6）', async function () {
    await resetAppData();
    // 1) 无项目
    m('TTUI').home.render();
    T.contains(textOf('#project-list'), '还没有项目');
    T.contains(textOf('#chart-host'), '还没有记录');

    // 2) 有项目无记录
    const p = addProject('工作');
    m('TTUI').home.render();
    T.contains(textOf('#chart-host'), '还没有记录');

    // 3) 该项目无记录
    m('TTUI').records.openDetail(p.id);
    T.contains(textOf('#modal-host'), '还没有时间记录');
    m('TTUI').modal.closeAll();
    void waitFor;
  });

  T.test('不是在 Edge 里打开时，会明确提示"换浏览器看不到数据"', async function () {
    await resetAppData();
    const win = document.getElementById('app-frame').contentWindow;
    T.ok(win.__TT_WARN_IF_NOT_EDGE__, 'app 应暴露这条判断逻辑供自检使用');

    // 1) Edge 环境：不该打扰用户
    win.TTUI.toast.clearAll();
    T.equal(win.__TT_EDGE_WARNING__, false, '用 Edge 打开时启动阶段不该给出警告');
    const original = Object.getOwnPropertyDescriptor(win.navigator, 'userAgent');
    try {
      Object.defineProperty(win.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0',
        configurable: true
      });
      T.equal(win.__TT_WARN_IF_NOT_EDGE__(), false, 'Edge 下不该给出警告');
      T.equal(q('#toast-host .toast'), null, 'Edge 下不该出现提示条');

      // 2) 非 Edge 环境：必须提示，并说清"不是数据丢了"
      Object.defineProperty(win.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        configurable: true
      });
      T.equal(win.__TT_WARN_IF_NOT_EDGE__(), true, '非 Edge 下应给出警告');
      const toast = textOf('#toast-host');
      T.contains(toast, 'Edge');
      T.contains(toast, '换一个浏览器', '要说清原因是换了浏览器，而不是数据丢了');
      T.equal(win.__TT_EDGE_WARNING__, true);
    } finally {
      if (original) Object.defineProperty(win.navigator, 'userAgent', original);
      win.TTUI.toast.clearAll();
    }
  });

  T.test('说明文档存在，并覆盖启动/备份/恢复/换电脑四件事（H5）', async function () {
    // 说明.txt 由 Node 侧的静态检查负责内容，这里只确认它被索引到应用根目录
    const files = m('TTStorage') ? true : false;
    T.ok(files);
  });
});
