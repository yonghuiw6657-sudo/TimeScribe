/**
 * P5 统计与扇形图（浏览器运行）
 *
 * 覆盖 PRD 验收 E1–E5、E8（界面呈现侧）。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf, setMinSeconds
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

T.defineSuite('P5', '统计区与扇形图', async function () {
  T.test('没有记录时扇形图显示空环与引导文案（I8）', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();

    T.ok(q('#chart-host svg'), '扇形图容器应有一个空环 svg');
    T.equal(qa('#chart-host svg circle').length, 1, '空状态只有一个底环');
    T.contains(textOf('#chart-host'), '还没有记录');
    T.contains(textOf('#stat-total'), '0');
  });

  T.test('累计总投入 / 今天 / 本周三项数字都显示（E5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const t = today();
    const lastWeek = m('TTCalc').addDays(m('TTCalc').weekRange(t).start, -8);
    addRecord(p.id, t, 3600);          // 今天 1 小时
    addRecord(p.id, lastWeek, 5400);   // 更早的 1 小时 30 分
    m('TTUI').home.render();

    const panel = q('#stat-total');
    // 大数字是分开的节点（数字 + 单位），因此用 data 校验更可靠
    const big = q('#stat-total .bignum').textContent;
    T.contains(big.replace(/\s+/g, ''), '2小时30分', '累计总投入 = 1 小时 + 1 小时 30 分，实际 "' + big + '"');

    const subs = q('#stat-total .subnums').textContent;
    T.contains(subs, '今天');
    T.contains(subs, '1 小时', '今天的投入');
    T.contains(subs, '本周');
  });

  T.test('扇形图按父项目分块，子项目并入父项目（E3/E4）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const study = addProject('学习');
    addRecord(parent.id, today(), 600);
    addRecord(child.id, today(), 1800);
    addRecord(study.id, today(), 600);
    m('TTUI').home.render();

    const slices = qa('#chart-host svg circle[data-slice-id]');
    T.equal(slices.length, 2, '应按父项目分成 2 块（工作、学习）');
    const legendRows = qa('#chart-host .legend .row');
    T.equal(legendRows.length, 2);

    const names = legendRows.map(function (r) { return r.querySelector('.nm').textContent; });
    T.deepEqual(names, ['工作', '学习'], '按占比降序排列');
    T.contains(legendRows[0].textContent, '40 分', '工作 = 600 + 1800 = 40 分');
    T.contains(legendRows[0].textContent, '80%');
    T.contains(legendRows[1].textContent, '20%');
  });

  T.test('扇形图百分比相加正好 100%（E3）', async function () {
    await resetAppData();
    const names = ['A', 'B', 'C'];
    const weights = [1, 1, 1];
    names.forEach(function (n, i) {
      const p = addProject(n);
      addRecord(p.id, today(), weights[i] * 60);
    });
    m('TTUI').home.render();

    const percents = qa('#chart-host .legend .pc').map(function (n) {
      return parseInt(n.textContent, 10);
    });
    const sum = percents.reduce(function (a, b) { return a + b; }, 0);
    T.equal(sum, 100, '三块各 33/33/34，相加必须是 100，实际 ' + percents.join('+') + '=' + sum);
  });

  T.test('图例颜色与项目卡片颜色一一对应（E4）', async function () {
    await resetAppData();
    const a = addProject('工作');
    const b = addProject('学习');
    addRecord(a.id, today(), 3600);
    addRecord(b.id, today(), 1800);
    m('TTUI').home.render();

    const legendColors = qa('#chart-host .legend .sw').map(function (n) {
      return n.style.background;
    });
    const cardColors = [a, b].map(function (p) {
      return q('[data-project-card="' + p.id + '"] .bar i').style.background;
    });
    T.equal(legendColors.length, 2);
    T.equal(legendColors[0], cardColors[0], '占比最大的项目颜色应与卡片一致');
    T.equal(legendColors[1], cardColors[1]);
  });

  T.test('扇形图每块都有悬停提示（项目名 · 时长 · 百分比）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 3600);
    m('TTUI').home.render();

    const title = q('#chart-host svg circle[data-slice-id] title');
    T.ok(title, '扇区里应有 title 作为悬停提示');
    T.contains(title.textContent, '工作');
    T.contains(title.textContent, '1 小时');
    T.contains(title.textContent, '100%');
  });

  T.test('卡片上的累计、今天、专注度都显示（E1 的界面侧）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 5400, { pausedSec: 600 });
    m('TTUI').home.render();

    const card = textOf('[data-project-card="' + p.id + '"]');
    T.contains(card, '共 1 小时 30 分');
    T.contains(card, '今天 1 小时 30 分');
    T.contains(card, '专注 90%', '5400 / (5400+600) = 90%');
  });

  T.test('没有记录的项目不显示专注度标签（避免显示假的 0%）', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();
    T.notContains(textOf('[data-project-card]'), '专注');
  });

  T.test('数据变化后统计立即重算：加记录、删记录都立刻反映（E8）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    T.contains(textOf('#stat-total'), '0');

    let rec = null;
    m('TTStore').commit(function (s) {
      rec = addRecord(p.id, today(), 3600);
      return s;
    });
    T.contains(textOf('#stat-total'), '1 小时', '新增记录后应立刻更新');

    m('TTStore').commit(function (s) {
      s.records = s.records.filter(function (r) { return r.id !== rec.id; });
      return s;
    });
    T.contains(textOf('#stat-total'), '0', '删除记录后也应立刻更新');
    T.contains(textOf('#chart-host'), '还没有记录', '没有记录时扇形图回到空状态');
  });

  T.test('父项目累计等于自身 + 子项目，且与总投入对得上（E1/E2）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    const study = addProject('学习');
    addRecord(parent.id, today(), 1800);
    addRecord(child.id, today(), 3600);
    addRecord(study.id, today(), 1800);
    m('TTUI').home.render();

    const sum = m('TTCalc').summarize(state(), new Date());
    const parentCard = textOf('[data-project-card="' + parent.id + '"]');
    T.contains(parentCard, '共 1 小时 30 分', '父项目 = 30 分 + 60 分');

    const parentsTotal = sum.projects
      .filter(function (i) { return !i.isChild; })
      .reduce(function (acc, i) { return acc + i.totalActiveSec; }, 0);
    T.equal(parentsTotal, sum.grandTotalSec, '父项目相加必须等于累计总投入');
    T.contains(textOf('#stat-total'), m('TTCalc').fmtDuration(sum.grandTotalSec));
  });

  T.test('计时中停止后，扇形图与统计立刻出现新的一段（E8）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    T.contains(textOf('#chart-host'), '还没有记录');

    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await m('TTUI').home ? null : null;
    await new Promise(function (r) { setTimeout(r, 31000); });
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));

    T.equal(state().records.length, 1);
    T.notContains(textOf('#chart-host'), '还没有记录', '停止后扇形图应出现一块');
    T.equal(qa('#chart-host svg circle[data-slice-id]').length, 1);
    T.contains(textOf('#chart-host'), '100%');
  });
});
