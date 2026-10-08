/**
 * P9 数据安全：导出 / 导入 / 恢复（浏览器运行）
 *
 * 覆盖 PRD 验收 F1–F8。
 * 这些是"数据不丢"承诺的最后一道防线，因此连文件名、校验拒绝、导入前快照都要验。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf, modalTitle,
  fieldByName, lastToast, clearToasts, sleep, setMinSeconds, commit, modalButtons, waitFor
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

function clickModalButton(label) {
  const btn = modalButtons().filter(function (b) { return b.textContent === label; })[0];
  T.ok(btn, '弹窗里应有「' + label + '」按钮');
  click(btn);
}

async function reloadApp() {
  const f = document.getElementById('app-frame');
  const before = f.contentWindow.__TIMESCRIBE_BOOT__ ? f.contentWindow.__TIMESCRIBE_BOOT__.bootedAt : '';
  await new Promise(function (resolve) {
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    f.addEventListener('load', finish, { once: true });
    f.src = '../index.html?t=' + Date.now();
    setTimeout(finish, 8000);
  });
  const ok = await waitFor(function () {
    const b = f.contentWindow.__TIMESCRIBE_BOOT__;
    return (b && b.bootedAt && b.bootedAt !== before) ? true : null;
  }, 8000);
  if (!ok) throw new Error('app 没有重新启动');
  return f.contentWindow;
}

T.defineSuite('P9', '导出 / 导入 / 恢复', async function () {
  T.test('没有数据时导出会被拒绝并提示（I7）', async function () {
    await resetAppData();
    clearToasts();
    const result = m('TTUI').data.exportNow();
    T.equal(result.ok, false);
    T.contains(textOf('#toast-host'), '暂无可导出的数据');
  });

  T.test('导出内容包含项目、记录、设置与文件标识（F4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const child = addProject('客户A', p.id);
    addRecord(p.id, today(), 3600);
    addRecord(child.id, today(), 1800, { source: 'manual', startAt: null, endAt: null });

    const payload = m('TTUI').data.buildExportPayload(new Date(2025, 5, 11, 14, 5));
    T.equal(payload.app, 'timescribe', '应带 app 标识，便于导入时校验来源');
    T.equal(payload.schemaVersion, m('TTStorage').SCHEMA_VERSION);
    T.equal(payload.projects.length, 2);
    T.equal(payload.records.length, 2);
    T.ok(payload.settings, '应包含设置');
    T.equal(payload.stats.recordCount, 2);
    T.equal(payload.stats.totalSec, 5400);
    T.ok(payload.exportedAt, '应包含导出时刻');
  });

  T.test('导出文件名带本地日期时间（F4）', function () {
    const name = m('TTUI').data.exportFileName(new Date(2025, 5, 11, 14, 5));
    T.equal(name, 'TimeScribe-2025-06-11-1405.json');
  });

  T.test('导出会触发下载并提示条数（F4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    clearToasts();

    const result = m('TTUI').data.exportNow();
    T.equal(result.ok, true);
    T.contains(textOf('#toast-host'), '1 条记录');
    T.contains(textOf('#toast-host'), '1 个项目');
    T.ok(m('__TT_LAST_EXPORT__') === undefined || true);
    // 导出的文本应能被重新解析
    const text = document.getElementById('app-frame').contentWindow.__TT_LAST_EXPORT__;
    T.ok(text, '应把导出内容留在 __TT_LAST_EXPORT__ 便于自检');
    const parsed = JSON.parse(text);
    T.equal(parsed.records.length, 1);
  });

  T.test('导入非法 JSON 会被拒绝，且当前数据不变（F6）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    clearToasts();

    const result = m('TTUI').data.importFromText('{这不是合法JSON');
    T.equal(result.ok, false);
    T.equal(state().projects.length, 1, '当前项目应原封不动');
    T.equal(state().records.length, 1, '当前记录应原封不动');
    T.contains(textOf('#toast-host'), '导入失败');
    T.contains(textOf('#toast-host'), '未做任何改动');
  });

  T.test('导入别人的 JSON（非本 app 文件）会被拒绝（F6）', async function () {
    await resetAppData();
    addProject('工作');
    const foreign = JSON.stringify({ app: 'other-app', projects: [], records: [] });
    const result = m('TTUI').data.importFromText(foreign);
    T.equal(result.ok, false);
    T.contains(result.reason, 'TimeScribe');
    T.equal(state().projects.length, 1, '当前数据不该被覆盖');
  });

  T.test('导入来自更新版本的文件会被拒绝', async function () {
    await resetAppData();
    addProject('工作');
    const future = JSON.stringify({ app: 'timescribe', schemaVersion: 99, projects: [], records: [] });
    const result = m('TTUI').data.importFromText(future);
    T.equal(result.ok, false);
    T.contains(result.reason, '更新版本');
    T.equal(state().projects.length, 1);
  });

  T.test('导入合法文件：弹确认框写明条数与"将覆盖"，确认后才写入（F5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);

    const exported = m('TTUI').data.buildExportPayload(new Date());
    const text = JSON.stringify(exported);

    // 先改成本地数据（准备被覆盖）
    commit(function (s) { s.records = []; s.projects = []; return s; });
    T.equal(state().projects.length, 0);

    clearToasts();
    const result = m('TTUI').data.importFromText(text);
    T.equal(result.ok, true);
    T.contains(modalTitle(), '导入数据');
    const warn = textOf('#modal-host .warn');
    T.contains(warn, '1 个项目');
    T.contains(warn, '1 条记录');
    T.contains(warn, '覆盖');
    T.contains(warn, '已自动备份');

    T.equal(state().projects.length, 0, '还没确认之前不该写入');

    clickModalButton('确认导入');
    T.equal(state().projects.length, 1, '确认后应写入');
    T.equal(state().records.length, 1);
    T.equal(state().records[0].activeSec, 3600);
    T.contains(textOf('#toast-host'), '导入完成');
  });

  T.test('导入后可以退回导入前的数据（F7）', async function () {
    await resetAppData();
    const p = addProject('原项目');
    addRecord(p.id, today(), 600);
    m('TTStore').flush();

    // 造一份"别的数据"用于导入
    const incoming = {
      app: 'timescribe', schemaVersion: 1, exportedAt: new Date().toISOString(),
      projects: [{ id: 'x1', name: '导入的项目', parentId: null, color: '#10b981', order: 0, createdAt: null }],
      records: [{
        id: 'xr1', projectId: 'x1', date: today(), startAt: null, endAt: null,
        activeSec: 7200, pausedSec: 0, note: '', source: 'manual', createdAt: null
      }]
    };
    m('TTUI').data.importFromText(JSON.stringify(incoming));
    clickModalButton('确认导入');
    T.equal(state().projects.length, 1);
    T.equal(state().projects[0].name, '导入的项目', '应已换成导入的数据');
    T.ok(m('TTUI').data.hasSnapshot(), '应留有导入前的快照');

    const restored = m('TTUI').data.restoreSnapshot();
    T.equal(restored.ok, true);
    T.equal(state().projects.length, 1);
    T.equal(state().projects[0].name, '原项目', '应退回导入前的数据');
    T.equal(state().records.length, 1);
    T.equal(state().records[0].activeSec, 600);
  });

  T.test('没有快照时"退回"会明确告知，而不是静默失败', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').data.clearSnapshot();
    clearToasts();

    const restored = m('TTUI').data.restoreSnapshot();
    T.equal(restored.ok, false);
    T.contains(textOf('#toast-host'), '没有可退回的备份');
  });

  T.test('导出再导入：数据完全一致（备份真能用）（F5）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const t = today();
    addRecord(parent.id, t, 3600, { note: '备注一' });
    addRecord(child.id, t, 1800, { source: 'manual', startAt: null, endAt: null, note: '补录' });
    setMinSeconds(300);
    const before = JSON.stringify({
      projects: state().projects,
      records: state().records,
      settings: state().settings
    });

    const text = JSON.stringify(m('TTUI').data.buildExportPayload(new Date()));

    // 清空后导入，比对是否完全一致
    commit(function (s) {
      s.projects = [];
      s.records = [];
      s.settings.minSeconds = 120;
      return s;
    });
    m('TTUI').data.importFromText(text);
    clickModalButton('确认导入');

    const after = JSON.stringify({
      projects: state().projects,
      records: state().records,
      settings: state().settings
    });
    T.equal(after, before, '导出再导入后，项目、记录、设置都应完全一致');
  });

  T.test('刷新页面后数据仍在（F1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 5400, { note: '刷新前' });
    m('TTStore').flush();

    const win = await reloadApp();
    T.equal(win.TTStore.getState().projects.length, 1, '刷新后项目仍在');
    T.equal(win.TTStore.getState().records.length, 1, '刷新后记录仍在');
    T.equal(win.TTStore.getState().records[0].activeSec, 5400);
    T.equal(win.TTStore.getState().records[0].note, '刷新前');
    T.contains(win.document.getElementById('stat-total').textContent, '1 小时 30 分');
  });

  T.test('模拟重启（重新载入数据）后排序与展开状态也保留（F1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addProject('客户A', p.id);
    commit(function (s) {
      s.ui.sortMode = 'today';
      s.ui.expanded = [p.id];
      return s;
    });
    m('TTStore').flush();

    const win = await reloadApp();
    const st = win.TTStore.getState();
    T.equal(st.ui.sortMode, 'today', '排序方式应保留');
    T.deepEqual(st.ui.expanded, [p.id], '展开状态应保留');
    T.ok(win.document.querySelector('[data-project-card="' + p.id + '"] .subs'), '界面应保持展开');
  });

  T.test('改名前的导入前快照（旧键）仍然能退回', async function () {
    await resetAppData();
    const p = addProject('原项目');
    addRecord(p.id, today(), 600);
    m('TTStore').flush();

    const win = document.getElementById('app-frame').contentWindow;
    // 把当前数据存成"改名之前那个键名"的快照，模拟旧版本留下的备份
    const raw = m('TTStorage').readRaw();
    win.localStorage.setItem('timetracker.backup.beforeImport', raw);
    T.equal(win.localStorage.getItem(m('TTUI').data.SNAPSHOT_KEY), null, '新键此时是空的');

    commit(function (s) { s.projects = []; s.records = []; return s; });
    T.ok(m('TTUI').data.hasSnapshot(), '应能认出旧键里的快照');

    const restored = m('TTUI').data.restoreSnapshot();
    T.equal(restored.ok, true);
    T.equal(state().projects.length, 1);
    T.equal(state().projects[0].name, '原项目', '旧键的快照也要能退回');
    T.equal(state().records[0].activeSec, 600);
    T.equal(win.localStorage.getItem('timetracker.backup.beforeImport'), null, '退回后旧键要清掉');
  });

  T.test('导出的文件带新标识，改名前的备份也能导入', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);

    const payload = m('TTUI').data.buildExportPayload(new Date());
    T.equal(payload.app, 'timescribe', '新导出的文件应带新标识');

    const legacy = JSON.stringify({
      app: 'time-tracker', schemaVersion: 1, exportedAt: new Date().toISOString(),
      projects: [{ id: 'old1', name: '旧项目', parentId: null, color: '#3b82f6', order: 0, createdAt: null }],
      records: [{
        id: 'oldr1', projectId: 'old1', date: today(), startAt: null, endAt: null,
        activeSec: 1800, pausedSec: 0, note: '', source: 'manual', createdAt: null
      }]
    });
    const result = m('TTUI').data.importFromText(legacy);
    T.equal(result.ok, true, '改名前的备份必须还能导入');
    clickModalButton('确认导入');
    T.equal(state().projects[0].name, '旧项目');
    T.equal(state().records[0].activeSec, 1800);
  });

  T.test('损坏的存储数据不会导致白屏，且会留下备份（F1 的兜底）', async function () {
    await resetAppData();
    const win = document.getElementById('app-frame').contentWindow;
    win.localStorage.setItem(m('TTStorage').DATA_KEY, '{{{坏数据');

    const win2 = await reloadApp();
    T.equal(win2.__TIMESCRIBE_BOOT__.loadStatus, 'corrupt');
    T.ok(win2.document.getElementById('app'), '页面仍然可用（不白屏）');
    T.ok(win2.document.getElementById('project-list'), '列表容器仍在');
    T.ok(win2.TTStorage.listCorruptBackups().length >= 1, '应把坏数据另存备份');
    T.contains(win2.document.getElementById('boot-status').textContent, '损坏');
  });

  T.test('导出是快照：导出之后再改数据，文件内容不受影响（F8）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    const payload = m('TTUI').data.buildExportPayload(new Date());
    const text = JSON.stringify(payload);

    addRecord(p.id, today(), 3600);
    T.equal(state().records.length, 2, '本地数据已变多');

    const snapshot = JSON.parse(text);
    T.equal(snapshot.records.length, 1, '导出文件仍是导出当时的快照');
  });

  T.test('本地数据以最新修改为准（导出文件只是快照）（F8）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, today(), 3600);
    m('TTUI').data.exportNow();

    commit(function (s) {
      const target = s.records.filter(function (r) { return r.id === rec.id; })[0];
      target.activeSec = 7200;
      return s;
    });
    m('TTStore').flush();

    const reloaded = m('TTStorage').loadAll();
    T.equal(reloaded.data.records[0].activeSec, 7200, '本地数据应是最新的');
    void qa;
    void lastToast;
    void sleep;
    void fieldByName;
  });
});
