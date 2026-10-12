/**
 * P3 浏览器测试：项目与子项目的界面行为
 *
 * 覆盖 PRD 验收 B1–B9（界面侧）、I1、I2。
 *
 * 重要：app 运行在同源 iframe 里、和测试页共用一份 localStorage。
 * 因此每个用例开始前都要把 iframe 以 ?fresh=1 重新加载（app 会在启动时清空数据），
 * 否则会读到上一个用例留下的数据。
 */
import {
  T, q, qa, doc, m, resetAppData, commit, state, addProject, addRecord,
  click, textOf, modalTitle, fieldByName, lastToast, clearToasts, waitFor, sleep, normalizeColor
} from './helpers.mjs';

T.defineSuite('P3', '项目界面：卡片与操作', async function () {
  T.test('没有项目时显示引导空状态（B1 前提）', async function () {
    await resetAppData();
    const btn = q('[data-action="new-project"]');
    T.ok(btn, '空状态里应有"新建第一个项目"按钮');
    T.contains(btn.textContent, '新建');
    T.contains(textOf('#project-list'), '还没有项目');
    T.equal(textOf('#list-title'), '我的项目（0）');
  });

  T.test('新建项目后卡片出现在列表里，并显示累计与今天投入（B1）', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();

    const cards = qa('[data-project-card]');
    T.equal(cards.length, 1, '应该只有一张项目卡片');
    T.contains(cards[0].textContent, '工作');
    T.contains(cards[0].textContent, '共 0 分');
    T.contains(cards[0].textContent, '今天 0 分');
    T.contains(textOf('#list-title'), '我的项目（1）');
  });

  T.test('累计投入显示在卡片上，并随记录变化（B4/E1 的界面侧）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 5400);          // 1 小时 30 分
    m('TTUI').home.render();

    const card = q('[data-project-card="' + p.id + '"]');
    T.contains(card.textContent, '共 1 小时 30 分');
    T.contains(card.textContent, '今天 1 小时 30 分');
    T.contains(textOf('#stat-total'), '1 小时 30 分', '统计区的累计总投入也应更新');
  });

  T.test('新建子项目后父项目可展开，子项目行缩进显示（B2/B3）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    m('TTUI').home.render();

    T.equal(q('[data-project-card="' + child.id + '"]'), null, '收起时不该看到子项目行');

    click(q('[data-toggle-for="' + parent.id + '"]'));
    const childRow = q('[data-project-card="' + child.id + '"]');
    T.ok(childRow, '展开后应看到子项目行');
    T.contains(childRow.textContent, '客户A');
    T.contains(childRow.className, 'srow', '子项目行应使用缩进样式');
  });

  T.test('子项目行不提供"新建子项目"入口（B3：不能建第三层）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    m('TTUI').home.render();
    click(q('[data-toggle-for="' + parent.id + '"]'));

    const childRow = q('[data-project-card="' + child.id + '"]');
    T.equal(childRow.querySelector('[data-action="add-sub"]'), null, '子项目行里不该有新建子项目入口');
    T.ok(q('[data-action="add-sub"][data-parent-for="' + parent.id + '"]'), '父项目下应有新建子项目入口');
  });

  T.test('父项目累计包含子项目投入（B4/E1）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const today = m('TTCalc').todayStr();
    addRecord(parent.id, today, 600);
    addRecord(child.id, today, 1200);
    m('TTUI').home.render();

    const card = q('[data-project-card="' + parent.id + '"]');
    T.contains(card.textContent, '共 30 分', '父项目累计应为 600 + 1200 = 30 分');
    T.contains(card.textContent, '父亲自计时 10 分');

    click(q('[data-toggle-for="' + parent.id + '"]'));
    const childCard = q('[data-project-card="' + child.id + '"]');
    T.contains(childCard.textContent, '共 20 分');
  });

  T.test('点击"新建子项目"打开表单，且表单里没有"放到子项目里"的选项（B2/B3）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    addProject('客户A', parent.id);
    m('TTUI').home.render();
    click(q('[data-toggle-for="' + parent.id + '"]'));

    click(q('[data-action="add-sub"][data-parent-for="' + parent.id + '"]'));
    T.contains(modalTitle(), '新建子项目');

    const parentSelect = fieldByName('parentId');
    T.equal(parentSelect, null, '新建子项目时不该再问"放在哪里"，从根上杜绝第三层');
    T.ok(fieldByName('name'), '应有名称输入框');

    m('TTUI').modal.closeAll();
  });

  T.test('新建项目表单：父项目下拉里只有父项目（B3）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    addProject('客户A', parent.id);

    click(q('#btn-new-project'));
    const select = fieldByName('parentId');
    T.ok(select, '新建项目时应能选择放在哪里');
    const options = Array.prototype.slice.call(select.querySelectorAll('option')).map(function (o) { return o.textContent; });
    T.equal(options.length, 2, '应该是"独立项目"+ 1 个父项目');
    T.contains(options[1], '工作');
    T.notContains(options.join('|'), '客户A（作为子项目）', '子项目不该出现在可选父级里');
    m('TTUI').modal.closeAll();
  });

  T.test('名称为空时拒绝创建并提示（I1）', async function () {
    await resetAppData();
    const before = state().projects.length;
    click(q('#btn-new-project'));
    fieldByName('name').value = '   ';
    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '创建'; })[0]);

    T.equal(state().projects.length, before, '不该创建出项目');
    const err = q('#modal-host .form-error');
    T.ok(err, '应显示错误提示');
    T.contains(err.textContent, '名称');
    m('TTUI').modal.closeAll();
  });

  T.test('名称超长被截断到 30 字（I2）', async function () {
    await resetAppData();
    click(q('#btn-new-project'));
    fieldByName('name').value = '名'.repeat(80);
    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '创建'; })[0]);

    T.equal(state().projects.length, 1);
    T.equal(state().projects[0].name.length, 30, '应被截断到 30 字');
    m('TTUI').modal.closeAll();
  });

  T.test('编辑项目名称后列表与扇形图图例同步更新（B5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 1800);
    m('TTUI').home.render();

    m('TTUI').projects.openProjectForm({ project: state().projects[0] });
    fieldByName('name').value = '主业';
    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '保存'; })[0]);

    T.equal(state().projects[0].name, '主业');
    m('TTUI').home.render();
    T.contains(textOf('#project-list'), '主业');
    T.contains(textOf('#chart-host'), '主业', '扇形图图例也要跟着改名');
  });

  T.test('把父项目颜色改掉后卡片进度条颜色同步（B5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    const before = normalizeColor(q('[data-project-card="' + p.id + '"] .bar i').style.background);

    m('TTUI').projects.openProjectForm({ project: state().projects[0] });
    const dots = qa('#modal-host .color-dot');
    T.ok(dots.length >= 2, '应提供颜色可选');
    click(dots[1]);
    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '保存'; })[0]);

    m('TTUI').home.render();
    const after = normalizeColor(q('[data-project-card="' + p.id + '"] .bar i').style.background);
    T.notEqual(after, before, '颜色应已改变');
    T.equal(normalizeColor(state().projects[0].color), after, '数据里的颜色与界面一致');
  });

  T.test('删除子项目：只删子项目与其记录，父项目自身记录保留（B6）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const today = m('TTCalc').todayStr();
    addRecord(parent.id, today, 600);
    addRecord(child.id, today, 1200);

    m('TTUI').projects.openDeleteConfirm(child.id);
    T.contains(modalTitle(), '删除项目');
    const warn = q('#modal-host .warn');
    T.ok(warn, '应显示确认说明');
    T.contains(warn.textContent, '客户A');
    T.contains(warn.textContent, '20 分', '应写明将删除的时长');

    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '确认删除'; })[0]);
    T.equal(state().projects.length, 1);
    T.equal(state().records.length, 1);
    T.equal(state().records[0].projectId, parent.id);
  });

  T.test('删除父项目：连带子项目与全部记录，并写明子项目数量（B7）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const other = addProject('学习');
    const today = m('TTCalc').todayStr();
    addRecord(parent.id, today, 600);
    addRecord(child.id, today, 1200);
    addRecord(other.id, today, 300);

    m('TTUI').projects.openDeleteConfirm(parent.id);
    const warn = q('#modal-host .warn');
    T.contains(warn.textContent, '工作');
    T.contains(warn.textContent, '1 个子项目');
    T.contains(warn.textContent, '找不回来');

    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '确认删除'; })[0]);
    T.equal(state().projects.length, 1, '只应剩下学习');
    T.equal(state().projects[0].id, other.id);
    T.equal(state().records.length, 1);
    m('TTUI').home.render();
    T.notContains(textOf('#project-list'), '客户A');
  });

  T.test('删除确认框里能取消，取消后什么都不变（B7）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, m('TTCalc').todayStr(), 600);

    m('TTUI').projects.openDeleteConfirm(p.id);
    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '取消'; })[0]);
    T.equal(state().projects.length, 1);
    T.equal(state().records.length, 1);
  });

  T.test('点卡片上的「⋯」能打开菜单，菜单里有"删除"；点空白处能关掉（回归）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    m('TTUI').projects.closeMenu();
    T.ok(!q('#active-menu'), '一开始不该有菜单');

    // 曾经这里是个死键：按钮只带了 data-menu-for、没带 data-action，
    // 事件委托找不到它，点上去什么都不会发生（整个「⋯」菜单形同虚设）。
    click(q('[data-project-card="' + p.id + '"] [data-menu-for]'));
    const menu = q('#active-menu');
    T.ok(menu, '点「⋯」后应出现菜单');
    const items = qa('#active-menu .menu-item').map(function (b) { return b.textContent; });
    T.ok(items.indexOf('编辑') !== -1, '菜单里应有"编辑"');
    T.ok(items.indexOf('查看时间明细') !== -1, '菜单里应有"查看时间明细"');
    T.ok(items.indexOf('删除') !== -1, '菜单里应有"删除"');

    // 菜单挂在按钮旁边（兄弟节点）而不是里面，所以"点空白关菜单"不能用 contains 判断；
    // 若处理不当，打开菜单的那一次点击就会把菜单立刻关掉。
    await sleep(30);
    T.ok(q('#active-menu'), '打开菜单的那一次点击不该顺手把菜单关掉');

    click(doc().body);
    await sleep(30);
    T.ok(!q('#active-menu'), '点空白处应关掉菜单');
  });

  T.test('走真实点击路径删除项目：⋯ → 删除 → 确认（B7 的端到端）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const other = addProject('学习');
    const today = m('TTCalc').todayStr();
    addRecord(parent.id, today, 600);
    addRecord(child.id, today, 1200);
    m('TTUI').home.render();

    click(q('[data-project-card="' + parent.id + '"] [data-menu-for]'));
    const deleteItem = qa('#active-menu .menu-item').filter(function (b) { return b.textContent === '删除'; })[0];
    T.ok(deleteItem, '菜单里应有删除项');
    click(deleteItem);
    T.ok(!q('#active-menu'), '点完菜单项后菜单应关掉');
    T.contains(modalTitle(), '删除项目', '应弹出删除确认框');

    click(qa('#modal-host .modal .mf .btn').filter(function (b) { return b.textContent === '确认删除'; })[0]);
    T.equal(state().projects.length, 1, '只剩"学习"');
    T.equal(state().projects[0].id, other.id);
    T.equal(state().records.length, 0, '父项目与子项目的记录都要删掉');
    m('TTUI').home.render();
    T.notContains(textOf('#project-list'), '客户A');
    T.notContains(textOf('#project-list'), '工作');
  });

  T.test('计时中的项目：菜单里的"删除"不可用并说明原因（B8）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    T.equal(m('TTTimer').debugState().state, 'running', '应已开始计时');

    m('TTUI').home.render();
    // 走真实点击路径（不要直接调 openMenu）：曾经「⋯」按钮漏了 data-action，
    // 直接调用能过、真实点击却点不开，菜单里的删除也就永远够不着。
    m('TTUI').projects.closeMenu();
    click(q('[data-project-card="' + p.id + '"] [data-menu-for]'));
    const deleteItem = qa('#active-menu .menu-item').filter(function (b) { return b.textContent === '删除'; })[0];
    T.ok(deleteItem, '菜单里应有删除项');
    T.contains(deleteItem.className, 'disabled');
    T.equal(deleteItem.title, '请先停止计时');

    m('TTUI').projects.closeMenu();
    m('TTTimer').stop();
  });

  T.test('计时中即使直接调用删除，也会被拒绝并给出原因（B8）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    clearToasts();
    m('TTUI').projects.openDeleteConfirm(p.id);
    T.equal(q('#modal-host .modal .mh'), null, '不该弹出删除确认框');
    const toast = lastToast();
    T.ok(toast, '应给出提示');
    T.contains(toast.textContent, '停止计时');
    m('TTTimer').stop();
  });

  T.test('展开状态会被记住（刷新后仍展开）（B9）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    m('TTUI').home.render();
    click(q('[data-toggle-for="' + parent.id + '"]'));
    T.ok(q('[data-project-card="' + child.id + '"]'), '展开后能看到子项目');

    m('TTStore').flush();
    const raw = m('TTStorage').readRaw();
    T.contains(raw, parent.id, '展开状态应写入存储');
    T.deepEqual(state().ui.expanded, [parent.id]);
  });

  T.test('排序切换：按今天投入会改变顺序，并写入设置（B9）', async function () {
    await resetAppData();
    const a = addProject('甲');
    const b = addProject('乙');
    const today = m('TTCalc').todayStr();
    const old = m('TTCalc').addDays(today, -40);
    addRecord(a.id, old, 99999);         // 累计极大，但不是今天
    addRecord(b.id, today, 600);         // 今天有投入
    m('TTUI').home.render();

    let names = qa('#project-list > .pcard .pname .n > span:first-child').map(function (n) { return n.textContent; });
    T.equal(names[0], '甲', '默认按累计投入，甲应该在前');

    const select = q('[data-action="sort-mode"]');
    T.ok(select, '应有排序下拉');
    select.value = 'today';
    select.dispatchEvent(new (m('TTTimer') ? window : window).Event('change', { bubbles: true }));
    names = qa('#project-list > .pcard .pname .n > span:first-child').map(function (n) { return n.textContent; });
    T.equal(names[0], '乙', '按今天投入排序时，乙应该在前');
    T.equal(state().ui.sortMode, 'today', '排序方式应写入数据，刷新后保留');
  });

  T.test('手动顺序模式下可以上下移动（B9）', async function () {
    await resetAppData();
    const a = addProject('甲');
    addProject('乙');
    addProject('丙');
    commit(function (s) { s.ui.sortMode = 'manual'; return s; });
    m('TTUI').home.render();

    let names = qa('#project-list > .pcard .pname .n > span:first-child').map(function (n) { return n.textContent; });
    T.deepEqual(names, ['甲', '乙', '丙']);
    const moved = m('TTProjects').moveProject(state(), a.id, 1);
    T.equal(moved.ok, true, '应能向下移动');
    m('TTUI').home.render();
    names = qa('#project-list > .pcard .pname .n > span:first-child').map(function (n) { return n.textContent; });
    T.deepEqual(names, ['乙', '甲', '丙']);
  });

  T.test('项目卡片上的按钮会带上正确的项目 id（防止点错项目）', async function () {
    await resetAppData();
    const a = addProject('甲');
    const b = addProject('乙');
    m('TTUI').home.render();

    const cardB = q('[data-project-card="' + b.id + '"]');
    const startB = cardB.querySelector('[data-action="start"]');
    T.ok(startB, '乙的卡片上应有"开始"按钮');
    T.equal(startB.getAttribute('data-project-id'), b.id, '乙的开始按钮应指向乙');

    const cardA = q('[data-project-card="' + a.id + '"]');
    T.equal(cardA.querySelector('[data-action="start"]').getAttribute('data-project-id'), a.id);
  });

  T.test('没有子项目的父项目，三角不可展开（不显示可点的手型）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    const caret = q('[data-toggle-for="' + p.id + '"]');
    T.ok(caret, '三角元素存在');
    T.equal(caret.textContent, '·', '没有子项目时三角显示为占位符');
    click(caret);
    T.equal(state().ui.expanded.length, 0, '没有子项目时点它不该产生展开状态');
  });

  T.test('项目列表不会残留已删除项目的展开状态（B7 附带）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    addProject('客户A', parent.id);
    m('TTUI').home.render();
    click(q('[data-toggle-for="' + parent.id + '"]'));
    T.deepEqual(state().ui.expanded, [parent.id]);

    commit(function (s) {
      m('TTProjects').deleteProject(s, parent.id);
      return s;
    });
    T.deepEqual(state().ui.expanded, [], '删除项目后展开状态里的 id 应被清掉');
    void doc;
    void waitFor;
    void sleep;
  });
});
