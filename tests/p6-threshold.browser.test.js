/**
 * P6 阈值与专注度（浏览器运行）
 *
 * 覆盖 PRD 验收 C5–C8、C13、G2。
 * 阈值默认 2 分钟，所以短段会被丢弃——这本身就是要验证的行为。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf, lastToast,
  clearToasts, sleep, setMinSeconds, commit
} from './helpers.mjs';

function startTimer(projectId) {
  click(q('[data-project-card="' + projectId + '"] [data-action="start"]'));
}

function stopTimer(projectId) {
  click(q('[data-project-card="' + projectId + '"] [data-action="stop"]'));
}

T.defineSuite('P6', '最短时长门槛与专注度', async function () {
  T.test('默认阈值是 2 分钟（120 秒）', async function () {
    await resetAppData();
    T.equal(state().settings.minSeconds, 120);
  });

  T.test('单段实际投入不足 2 分钟：整段丢弃且不生成记录（C6）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    startTimer(p.id);
    await sleep(1500);
    stopTimer(p.id);

    T.equal(state().records.length, 0, '不足阈值不该生成记录');
    const toast = lastToast();
    T.ok(toast, '应给出提示');
    T.contains(toast.textContent, '没有计入');
    T.contains(toast.textContent, '2 分钟', '提示里应写清阈值');
    T.contains(textOf('[data-project-card="' + p.id + '"]'), '共 0 分', '累计投入不该变化');
  });

  T.test('把阈值改成 0 后，3 秒的段也会被记录（C7）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    startTimer(p.id);
    await sleep(3000);
    stopTimer(p.id);

    T.equal(state().records.length, 1, '阈值 0 表示不丢弃，应生成记录');
    const r = state().records[0];
    T.ok(r.activeSec >= 2 && r.activeSec <= 6, '投入秒数应约为 3，实际 ' + r.activeSec);
  });

  T.test('阈值 5 分钟时，3 分钟的段被丢弃；改回 2 分钟后 3 分钟的段被记录（G1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    // 用"自检接缝"摆出一段 3 分钟的现场，再走真实结算流程（判定只看 activeSec）
    function runFakeSession(seconds) {
      const before = state().records.length;
      m('TTTimer').debugRestore({ projectId: p.id, activeSec: seconds, pausedSec: 0 });
      const result = m('TTTimer').stop();
      return { added: state().records.length - before, result: result };
    }

    setMinSeconds(300);
    const discarded = runFakeSession(180);
    T.equal(discarded.result.discarded, true, '阈值 5 分钟时，3 分钟的段应被丢弃');
    T.equal(discarded.added, 0);

    setMinSeconds(120);
    const kept = runFakeSession(180);
    T.equal(kept.result.discarded, false, '阈值 2 分钟时，3 分钟的段应被记录');
    T.equal(kept.added, 1);
  });

  T.test('阈值可以自定义（单位是秒，界面用分钟），只影响之后的计时（G2）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 30);        // 已存在的 30 秒记录

    setMinSeconds(600);                // 改成 10 分钟
    T.equal(state().settings.minSeconds, 600);
    T.equal(state().records.length, 1, '已有的记录不该被追溯删除');
    T.equal(state().records[0].activeSec, 30, '已有记录的时长也不该被改');

    // 阈值只影响新结算：现在计 2 秒会被丢弃
    m('TTUI').home.render();
    startTimer(p.id);
    await sleep(1500);
    stopTimer(p.id);
    T.equal(state().records.length, 1, '新的一段不足 10 分钟，应被丢弃');
  });

  T.test('专注度 = 投入 ÷（投入 + 暂停），显示在卡片上（C13）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 5400, { pausedSec: 600 });
    m('TTUI').home.render();

    T.contains(textOf('[data-project-card="' + p.id + '"]'), '专注 90%');
  });

  T.test('专注度按整数百分比四舍五入', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 2, { pausedSec: 1 });      // 66.7% → 67%
    m('TTUI').home.render();
    T.contains(textOf('[data-project-card="' + p.id + '"]'), '专注 67%');
  });

  T.test('完全没有暂停时专注度是 100%', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, m('TTCalc').todayStr(), 3600);
    m('TTUI').home.render();
    T.contains(textOf('[data-project-card="' + p.id + '"]'), '专注 100%');
  });

  T.test('父项目"整体专注度"包含子项目的计时（C13）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const today = m('TTCalc').todayStr();
    addRecord(parent.id, today, 600, { pausedSec: 0 });      // 自身 100%
    addRecord(child.id, today, 900, { pausedSec: 300 });     // 子项目 75%
    m('TTUI').home.render();

    const parentCard = textOf('[data-project-card="' + parent.id + '"]');
    // (600 + 900) / (600 + 0 + 900 + 300) = 1500 / 1800 = 83.3% → 83%
    T.contains(parentCard, '专注 83%', '父项目整体专注度应合并子项目');

    click(q('[data-toggle-for="' + parent.id + '"]'));
    T.contains(textOf('[data-project-card="' + child.id + '"]'), '专注 75%', '子项目只看自己');
  });

  T.test('手动补录的记录不参与专注度（D7 的界面侧）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 900, { pausedSec: 100 });                       // 计时 → 90%
    addRecord(p.id, today, 3600, { source: 'manual', pausedSec: 0 });      // 手动补录，不该拉高专注度
    m('TTUI').home.render();

    const card = textOf('[data-project-card="' + p.id + '"]');
    T.contains(card, '专注 90%', '手动补录不该把专注度抬到 98%');
    T.contains(card, '共 1 小时 15 分', '但累计投入要含手动补录（900+3600=4500 秒）');
  });

  T.test('阈值与专注度互不干扰：丢弃的段也不参与专注度', async function () {
    await resetAppData();
    const p = addProject('工作');
    const today = m('TTCalc').todayStr();
    addRecord(p.id, today, 3600, { pausedSec: 3600 });   // 50%

    // 再计一段很短的（会被默认阈值丢弃），它不该影响专注度
    m('TTUI').home.render();
    startTimer(p.id);
    await sleep(1500);
    stopTimer(p.id);

    T.equal(state().records.length, 1, '短段被丢弃，仍只有 1 条记录');
    T.contains(textOf('[data-project-card="' + p.id + '"]'), '专注 50%', '专注度应保持 50%');
  });

  T.test('停止时提示条会写明投入、暂停与专注度', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    startTimer(p.id);
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="pause"]'));
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="resume"]'));
    await sleep(300);
    stopTimer(p.id);

    const toast = lastToast();
    T.ok(toast, '应有提示条');
    T.contains(toast.textContent, '已记录');
    T.contains(toast.textContent, '投入');
    T.contains(toast.textContent, '暂停');
    T.contains(toast.textContent, '专注');
    T.ok(q('#toast-host .undo'), '应有撤销按钮');
  });
});
