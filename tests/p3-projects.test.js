/**
 * P3 项目管理（Node 运行）
 *
 * 对应 PRD 验收 B1–B9、I1、I2 的业务规则部分。
 */
TTTest.defineSuite('P3', '项目与子项目', function () {
  const T = TTTest;
  const P = TT.TTProjects;
  const C = TT.TTCalc;

  function newState() {
    return {
      schemaVersion: 1,
      projects: [],
      records: [],
      settings: { minSeconds: 120, undoSeconds: 5, chartScope: 'parent' },
      runtime: { projectId: null, state: null, activeMs: 0, pausedMs: 0 },
      ui: { sortMode: 'total', expanded: [] }
    };
  }

  function rec(id, projectId, date, activeSec, extra) {
    return Object.assign({
      id: id, projectId: projectId, date: date, startAt: null, endAt: null,
      activeSec: activeSec, pausedSec: 0, note: '', source: 'timer', createdAt: null
    }, extra || {});
  }

  // -------------------------------------------------------------- 新建
  T.test('新建父项目：字段完整、颜色自动分配（B1）', function () {
    const s = newState();
    const r = P.createProject(s, { name: '工作' });
    T.equal(r.ok, true);
    T.equal(s.projects.length, 1);
    T.equal(r.project.name, '工作');
    T.equal(r.project.parentId, null, '默认是顶层项目');
    T.ok(r.project.color, '必须自动分配颜色');
    T.ok(r.project.id, '必须有唯一 id');
    T.equal(r.project.order, 0);

    const r2 = P.createProject(s, { name: '学习' });
    T.notEqual(r2.project.color, r.project.color, '第二个项目应使用不同颜色，便于扇形图区分');
  });

  T.test('名称为空或只有空格时拒绝创建（I1）', function () {
    const s = newState();
    const a = P.createProject(s, { name: '' });
    T.equal(a.ok, false);
    T.contains(a.reason, '名称');
    const b = P.createProject(s, { name: '     ' });
    T.equal(b.ok, false);
    T.equal(s.projects.length, 0, '拒绝创建时不应留下半个项目');
  });

  T.test('名称前后空格被清理，超长被截断到 30 字（I2）', function () {
    const s = newState();
    const a = P.createProject(s, { name: '  工作  ' });
    T.equal(a.project.name, '工作');
    const b = P.createProject(s, { name: '名'.repeat(80) });
    T.equal(b.project.name.length, 30);
  });

  T.test('新建子项目：挂在父项目下并沿用父项目颜色（B2）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    T.equal(child.parentId, parent.id);
    T.equal(child.color, parent.color, '子项目沿用父项目颜色');
  });

  // ---------------------------------------------------------- 层级限制
  T.test('子项目下不能再建子项目：尝试指定子项目为父级时自动提升（B3）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    // 界面不会提供这个入口，但即使传进来也必须被挡住
    const grand = P.createProject(s, { name: '第三层', parentId: child.id }).project;
    T.equal(grand.parentId, parent.id, '第三层应被提升为第二层，而不是真的建成三层');
    T.equal(P.resolveParentId(s.projects, child.id), parent.id, 'resolveParentId 应提升到父项目');
    const depth = s.projects.filter(function (p) {
      return p.id === grand.id || p.parentId === grand.id;
    });
    T.equal(P.childCount(s.projects, grand.id), 0, '被提升后的项目仍然不能再挂子项目');
    T.ok(depth.length >= 1);
  });

  T.test('父项目不存在时按顶层项目处理（不产生孤儿）', function () {
    const s = newState();
    const r = P.createProject(s, { name: '孤儿', parentId: '不存在' });
    T.equal(r.project.parentId, null);
  });

  // -------------------------------------------------------------- 编辑
  T.test('编辑项目：可改名、父项目可改色（B5）', function () {
    const s = newState();
    const p = P.createProject(s, { name: '工作' }).project;
    const r = P.updateProject(s, p.id, { name: '主业', color: '#ff0000' });
    T.equal(r.ok, true);
    T.equal(p.name, '主业');
    T.equal(p.color, '#ff0000');
  });

  T.test('编辑时名称仍受校验（不能改成空）', function () {
    const s = newState();
    const p = P.createProject(s, { name: '工作' }).project;
    const r = P.updateProject(s, p.id, { name: '   ' });
    T.equal(r.ok, false);
    T.equal(p.name, '工作', '失败的编辑不该改动原名');
  });

  T.test('子项目的颜色不随编辑改变（跟随父项目）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    const before = child.color;
    P.updateProject(s, child.id, { color: '#00ff00' });
    T.equal(child.color, before, '子项目颜色应由父项目决定');
  });

  // -------------------------------------------------------------- 删除
  T.test('删除父项目会连带删除子项目与全部记录，并清理展开状态（B7）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    const other = P.createProject(s, { name: '学习' }).project;
    s.records.push(rec('r1', parent.id, '2025-06-11', 600));
    s.records.push(rec('r2', child.id, '2025-06-11', 1200));
    s.records.push(rec('r3', other.id, '2025-06-11', 300));
    s.ui.expanded.push(parent.id);

    const r = P.deleteProject(s, parent.id);
    T.equal(r.ok, true);
    T.equal(r.removedProjects, 2);
    T.equal(r.removedRecords, 2);
    T.equal(s.projects.length, 1);
    T.equal(s.projects[0].id, other.id);
    T.equal(s.records.length, 1, '只应剩下学习的那条记录');
    T.deepEqual(s.ui.expanded, [], '展开状态里的残留 id 也要清掉');
  });

  T.test('删除子项目只影响自己，父项目自身记录保留（B6）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    s.records.push(rec('r1', parent.id, '2025-06-11', 600));
    s.records.push(rec('r2', child.id, '2025-06-11', 1200));

    const r = P.deleteProject(s, child.id);
    T.equal(r.ok, true);
    T.equal(s.projects.length, 1);
    T.equal(s.records.length, 1);
    T.equal(s.records[0].projectId, parent.id);
  });

  T.test('删除确认信息包含子项目数量与将删除的总时长（确认弹窗文案）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    s.records.push(rec('r1', parent.id, '2025-06-11', 600));
    s.records.push(rec('r2', child.id, '2025-06-11', 1200));

    const info = P.describeDeletion(s, parent.id);
    T.equal(info.ok, true);
    T.equal(info.project.name, '工作');
    T.equal(info.subCount, 1);
    T.equal(info.recordCount, 2);
    T.equal(info.totalSec, 1800);
    T.equal(info.isChild, false);
  });

  T.test('计时中的项目不允许删除，且给出明确原因（B8）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    s.runtime = { projectId: parent.id, state: 'running', activeMs: 1000, pausedMs: 0 };

    const info = P.describeDeletion(s, parent.id);
    T.equal(info.ok, false);
    T.contains(info.reason, '停止计时');

    const del = P.deleteProject(s, parent.id);
    T.equal(del.ok, false);
    T.equal(s.projects.length, 2, '被拒绝时不应删除任何东西');

    // 父项目被锁定时，也不能通过删除父项目把正在计时的子项目带走
    s.runtime = { projectId: child.id, state: 'paused', activeMs: 1000, pausedMs: 500 };
    const info2 = P.describeDeletion(s, parent.id);
    T.equal(info2.ok, false, '子项目在计时时，父项目也不能删');
  });

  T.test('删除不存在的项目会失败而不是静默成功', function () {
    const s = newState();
    const r = P.deleteProject(s, '不存在');
    T.equal(r.ok, false);
  });

  // -------------------------------------------------------- 展开与排序
  T.test('展开/收起状态可切换并能记住（B9 的一半）', function () {
    const s = newState();
    const p = P.createProject(s, { name: '工作' }).project;
    T.equal(P.isExpanded(s, p.id), false, '默认收起');
    P.toggleExpanded(s, p.id);
    T.equal(P.isExpanded(s, p.id), true);
    P.toggleExpanded(s, p.id);
    T.equal(P.isExpanded(s, p.id), false);
  });

  T.test('排序：按累计投入（默认，从多到少）', function () {
    const s = newState();
    const a = P.createProject(s, { name: '少' }).project;
    const b = P.createProject(s, { name: '多' }).project;
    s.records.push(rec('r1', a.id, '2025-06-11', 100));
    s.records.push(rec('r2', b.id, '2025-06-11', 900));
    const summary = C.summarize(s, '2025-06-11');
    const sorted = P.sortProjects(s, summary);
    T.equal(sorted.mode, 'total');
    T.deepEqual(sorted.parents.map(function (p) { return p.name; }), ['多', '少']);
  });

  T.test('排序：按今天投入（今天为 0 的项目排后面）', function () {
    const s = newState();
    const a = P.createProject(s, { name: 'A' }).project;
    const b = P.createProject(s, { name: 'B' }).project;
    s.records.push(rec('r1', a.id, '2025-06-11', 60));     // 今天少
    s.records.push(rec('r2', b.id, '2025-06-11', 1000));   // 今天多
    s.records.push(rec('r3', a.id, '2025-06-01', 5000));   // 不是今天，但把 A 的累计推高
    s.ui.sortMode = 'today';
    const summary = C.summarize(s, '2025-06-11');
    const sorted = P.sortProjects(s, summary);
    T.equal(sorted.mode, 'today');
    T.deepEqual(sorted.parents.map(function (p) { return p.name; }), ['B', 'A'],
      '今天投入多的排前面');

    // 今天完全没有记录的项目，即使累计很多，也应排在今天有投入的项目之后
    const c = P.createProject(s, { name: 'C' }).project;
    s.records.push(rec('r4', c.id, '2025-06-01', 99999));
    const sorted2 = P.sortProjects(s, C.summarize(s, '2025-06-11'));
    T.deepEqual(sorted2.parents.map(function (p) { return p.name; }), ['B', 'A', 'C']);
  });

  T.test('排序：手动顺序 + 上下移动', function () {
    const s = newState();
    const a = P.createProject(s, { name: 'A' }).project;
    const b = P.createProject(s, { name: 'B' }).project;
    const c = P.createProject(s, { name: 'C' }).project;
    s.ui.sortMode = 'manual';
    const summary = C.summarize(s, '2025-06-11');

    T.deepEqual(P.sortProjects(s, summary).parents.map(function (p) { return p.name; }), ['A', 'B', 'C']);
    P.moveProject(s, c.id, -1);
    T.deepEqual(P.sortProjects(s, summary).parents.map(function (p) { return p.name; }), ['A', 'C', 'B']);
    P.moveProject(s, c.id, -1);
    T.deepEqual(P.sortProjects(s, summary).parents.map(function (p) { return p.name; }), ['C', 'A', 'B']);
    const edge = P.moveProject(s, c.id, -1);
    T.equal(edge.ok, false, '已经在最前面，不能再往上');
    T.deepEqual(P.sortProjects(s, summary).parents.map(function (p) { return p.name; }), ['C', 'A', 'B']);
  });

  T.test('排序：子项目按各自规则排序，且不会混到父项目列表里', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const c1 = P.createProject(s, { name: '小活', parentId: parent.id }).project;
    const c2 = P.createProject(s, { name: '大活', parentId: parent.id }).project;
    s.records.push(rec('r1', c1.id, '2025-06-11', 100));
    s.records.push(rec('r2', c2.id, '2025-06-11', 900));
    const summary = C.summarize(s, '2025-06-11');
    const sorted = P.sortProjects(s, summary);
    T.equal(sorted.parents.length, 1, '父项目列表只应有 1 个');
    T.deepEqual(sorted.childrenOf(parent.id).map(function (p) { return p.name; }), ['大活', '小活']);
  });

  T.test('父项目累加后会超过子项目，排序时子项目不参与父项目排名（E1 的排序侧）', function () {
    const s = newState();
    const parent = P.createProject(s, { name: '工作' }).project;
    const child = P.createProject(s, { name: '客户A', parentId: parent.id }).project;
    const solo = P.createProject(s, { name: '学习' }).project;
    s.records.push(rec('r1', child.id, '2025-06-11', 5000));
    s.records.push(rec('r2', solo.id, '2025-06-11', 100));
    const summary = C.summarize(s, '2025-06-11');
    const sorted = P.sortProjects(s, summary);
    T.deepEqual(sorted.parents.map(function (p) { return p.name; }), ['工作', '学习'],
      '工作的累计 = 子项目的 5000，应排在学习之前');
    T.equal(summary.byId[parent.id].totalActiveSec, 5000);
  });
});
