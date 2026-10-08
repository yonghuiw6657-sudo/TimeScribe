/**
 * P8 设置（浏览器运行）
 *
 * 覆盖 PRD 验收 G1、G3、G4。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf, modalTitle,
  fieldByName, lastToast, clearToasts, sleep, setMinSeconds, commit, modalButtons, topModal
} from './helpers.mjs';

function clickModalButton(label) {
  const btn = modalButtons().filter(function (b) { return b.textContent === label; })[0];
  T.ok(btn, '弹窗里应有「' + label + '」按钮');
  click(btn);
}

function openSettings() {
  m('TTUI').settings.open();
}

T.defineSuite('P8', '设置项', async function () {
  T.test('设置弹窗打开后能看到三个设置项（阈值、撤销时长、图表层级）', async function () {
    await resetAppData();
    openSettings();
    T.contains(modalTitle(), '设置');
    T.ok(fieldByName('minMinutes'), '应有"不足多少时间不计入"');
    T.ok(fieldByName('undoSeconds'), '应有"撤销时长"');
    T.ok(fieldByName('chartScope'), '应有"扇形图显示层级"');
    m('TTUI').modal.closeAll();
  });

  T.test('阈值默认显示 2 分钟，保存后写入设置（G1）', async function () {
    await resetAppData();
    openSettings();
    T.equal(String(fieldByName('minMinutes').value), '2', '默认应显示 2 分钟');

    fieldByName('minMinutes').value = '5';
    clickModalButton('保存');

    T.equal(state().settings.minSeconds, 300, '5 分钟应存成 300 秒');
    T.contains(textOf('#toast-host'), '设置已保存');
  });

  T.test('阈值越界会被拒绝并提示（0–60 分钟）', async function () {
    await resetAppData();
    openSettings();
    fieldByName('minMinutes').value = '99';
    clickModalButton('保存');
    T.equal(state().settings.minSeconds, 120, '越界不该保存');
    T.contains(textOf('#modal-host .form-error'), '0 到 60');
    m('TTUI').modal.closeAll();
  });

  T.test('撤销时长越界会被拒绝并提示（3–30 秒）', async function () {
    await resetAppData();
    openSettings();
    fieldByName('undoSeconds').value = '1';
    clickModalButton('保存');
    T.equal(state().settings.undoSeconds, 5, '越界不该保存');
    T.contains(textOf('#modal-host .form-error'), '3 到 30');
    m('TTUI').modal.closeAll();
  });

  T.test('阈值改成 5 分钟后：3 分钟的段被丢弃，改回 2 分钟后能记录（G1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    function fakeSession(seconds) {
      m('TTTimer').debugRestore({ projectId: p.id, activeSec: seconds, pausedSec: 0 });
      return m('TTTimer').stop();
    }

    setMinSeconds(300);
    const discarded = fakeSession(180);
    T.equal(discarded.discarded, true, '5 分钟阈值下，3 分钟应被丢弃');
    T.equal(state().records.length, 0);

    setMinSeconds(120);
    const kept = fakeSession(180);
    T.equal(kept.discarded, false, '2 分钟阈值下，3 分钟应被记录');
    T.equal(state().records.length, 1);
  });

  T.test('改动阈值不会追溯修改已有记录（G2）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, m('TTCalc').todayStr(), 30);   // 只有 30 秒
    T.equal(state().records.length, 1);

    setMinSeconds(1800);      // 改成 30 分钟
    T.equal(state().records.length, 1, '已有记录不该被删掉');
    T.equal(state().records[0].activeSec, 30, '已有记录的时长也不该被改');
    T.equal(state().records[0].id, rec.id);
  });

  T.test('撤销时长改大以后，停止计时仍可撤销（G3）', async function () {
    await resetAppData();
    setMinSeconds(0);
    commit(function (s) { s.settings.undoSeconds = 10; return s; });
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));
    T.equal(state().records.length, 1);

    const undoBtn = q('#toast-host .undo');
    T.ok(undoBtn, '应提供撤销按钮');
    T.contains(textOf('#toast-host'), '10 秒内可撤销', '提示里应写明当前的撤销时长');

    click(undoBtn);
    T.equal(state().records.length, 0, '撤销后记录应被删除');
    T.equal(m('TTTimer').debugState().state, 'paused', '并回到停止前的"暂停中"状态');
    m('TTTimer').resetForTest();
  });

  T.test('撤销窗口过期后就没有撤销按钮了（G4）', async function () {
    await resetAppData();
    setMinSeconds(0);
    commit(function (s) { s.settings.undoSeconds = 3; return s; });
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));
    T.ok(q('#toast-host .undo'), '刚停止时应有撤销按钮');

    await sleep(4200);   // 超过 3 秒窗口
    T.equal(q('#toast-host .undo'), null, '过期后不该再有撤销按钮');
    T.equal(state().records.length, 1, '记录应保留');
    T.equal(m('TTTimer').undo().ok, false, '过期后调撤销应失败');
  });

  T.test('设置会被持久化（刷新/重开后仍是改过的值）', async function () {
    await resetAppData();
    openSettings();
    fieldByName('minMinutes').value = '7';
    fieldByName('undoSeconds').value = '12';
    clickModalButton('保存');
    m('TTStore').flush();

    const reloaded = m('TTStorage').loadAll();
    T.equal(reloaded.data.settings.minSeconds, 420, '7 分钟应被持久化');
    T.equal(reloaded.data.settings.undoSeconds, 12);

    // 模拟重启：重新从存储载入
    m('TTStore').resetForTest();
    m('TTStore').load();
    T.equal(state().settings.minSeconds, 420);
    T.equal(state().settings.undoSeconds, 12);
    m('TTUI').home.render();
  });

  T.test('设置弹窗可以取消，取消后不改动任何设置', async function () {
    await resetAppData();
    const before = JSON.stringify(state().settings);
    openSettings();
    fieldByName('minMinutes').value = '30';
    clickModalButton('取消');
    T.equal(JSON.stringify(state().settings), before, '取消后设置应保持原样');
  });

  T.test('阈值设为 0 表示"不丢弃任何段"', async function () {
    await resetAppData();
    openSettings();
    fieldByName('minMinutes').value = '0';
    clickModalButton('保存');
    T.equal(state().settings.minSeconds, 0);

    const p = addProject('工作');
    m('TTUI').home.render();
    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));
    T.equal(state().records.length, 1, '阈值 0 时 1 秒的段也应记录');
    void qa;
    void modalButtons;
    void topModal;
    void lastToast;
  });
});
