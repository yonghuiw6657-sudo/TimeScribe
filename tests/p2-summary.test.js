/**
 * P2 统计汇总与扇形图（Node 运行）
 *
 * 对应 PRD 验收 E1–E5、E7、E8 的底层逻辑。
 * 所有日期都相对"今天"动态生成，因此这组测试在任何日期运行都成立。
 */
TTTest.defineSuite('P2', '统计汇总与扇形图', function () {
  const T = TTTest;
  const C = TT.TTCalc;

  function rec(id, projectId, date, activeSec, extra) {
    return Object.assign({
      id: id, projectId: projectId, date: date,
      startAt: null, endAt: null, activeSec: activeSec, pausedSec: 0,
      note: '', source: 'timer', createdAt: null
    }, extra || {});
  }

  function proj(id, name, parentId, over) {
    return Object.assign({
      id: id, name: name, parentId: parentId || null,
      color: '#3b82f6', order: 0, createdAt: null
    }, over || {});
  }

  /** 构造一套固定结构的数据：工作（含子项目 客户A）+ 学习 */
  function buildState(today) {
    const week = C.weekRange(today);
    const weekStart = week.start;            // 本周一
    const lastWeek = C.addDays(weekStart, -8); // 上周一（一定不在本周）

    const projects = [
      proj('work', '工作'),
      proj('clientA', '客户A', 'work'),
      proj('study', '学习')
    ];

    const records = [
      // 工作自身：今天 600 秒 + 上周 3000 秒
      rec('r1', 'work', today, 600, { pausedSec: 100 }),
      rec('r2', 'work', lastWeek, 3000),
      // 客户A（工作的子项目）：本周一 1800 秒 + 上周 900 秒
      rec('r3', 'clientA', weekStart, 1800, { pausedSec: 200 }),
      rec('r4', 'clientA', lastWeek, 900),
      // 学习：上周 4000 秒
      rec('r5', 'study', lastWeek, 4000),
      // 手动补录（今天 1200 秒，不应参与专注度）
      rec('r6', 'clientA', today, 1200, { source: 'manual' })
    ];

    return { projects: projects, records: records, today: today, weekStart: weekStart, lastWeek: lastWeek };
  }

  T.test('父项目累计 = 自身记录 + 全部子项目记录（E1）', function () {
    const today = '2025-06-11';
    const s = buildState(today);
    const sum = C.summarize({ projects: s.projects, records: s.records }, today);
    const work = sum.byId['work'];
    const clientA = sum.byId['clientA'];

    T.equal(work.ownActiveSec, 3600, '工作自身：600 + 3000');
    T.equal(clientA.totalActiveSec, 3900, '客户A：1800 + 900 + 1200（含手动补录）');
    T.equal(work.totalActiveSec, 3600 + 3900, '父项目应为两者之和');
  });

  T.test('所有父项目累计相加 = 累计总投入（E2）', function () {
    const today = '2025-06-11';
    const s = buildState(today);
    const sum = C.summarize({ projects: s.projects, records: s.records }, today);

    const sumOfParents = sum.projects
      .filter(function (i) { return !i.isChild; })
      .reduce(function (acc, i) { return acc + i.totalActiveSec; }, 0);

    T.equal(sumOfParents, sum.grandTotalSec, '父项目相加必须等于累计总投入');
    T.equal(sum.grandTotalSec, 600 + 3000 + 1800 + 900 + 4000 + 1200, '也等于全部记录之和');
  });

  T.test('今天与本周的口径正确（E5、E6）', function () {
    const today = '2025-06-11';
    const s = buildState(today);
    const sum = C.summarize({ projects: s.projects, records: s.records }, today);

    T.equal(sum.todayTotalSec, 600 + 1200, '今天：工作 600 + 客户A 手动补录 1200');
    T.equal(sum.weekTotalSec, 600 + 1800 + 1200, '本周：今天两条 + 周一那条');

    // 父项目的今天/本周包含子项目
    T.equal(sum.byId['work'].todayActiveSec, 600 + 1200, '工作的今天应含子项目');
    T.equal(sum.byId['work'].weekActiveSec, 600 + 1800 + 1200, '工作的本周应含子项目');
    // 子项目只看自己
    T.equal(sum.byId['clientA'].todayActiveSec, 1200);
    T.equal(sum.byId['clientA'].weekActiveSec, 1800 + 1200);
    // 学习只有上周的数据
    T.equal(sum.byId['study'].todayActiveSec, 0);
    T.equal(sum.byId['study'].weekActiveSec, 0);
  });

  T.test('今天/本周随"今天是周几"自适应（周一到周日任意一天都成立）', function () {
    for (let offset = 0; offset < 7; offset++) {
      const today = C.addDays('2025-06-02', offset);          // 2025-06-02 是周一
      const week = C.weekRange(today);
      // 取本周三；若"今天"恰好是周三，则改用本周四，保证两条记录不在同一天
      let inWeek = C.addDays(week.start, 2);
      if (inWeek === today) inWeek = C.addDays(week.start, 3);
      const outWeek = C.addDays(week.start, -3);               // 上周五
      const state = {
        projects: [proj('p1', '工作')],
        records: [
          rec('rToday', 'p1', today, 100),
          rec('rWeek', 'p1', inWeek, 200),
          rec('rOut', 'p1', outWeek, 400)
        ]
      };
      const sum = C.summarize(state, today);
      T.equal(sum.todayTotalSec, 100, today + '（周' + C.isoWeekday(today) + '）的今天投入');
      T.equal(sum.weekTotalSec, 300, today + ' 的本周投入应含今天与本周另一天两条');
      T.equal(sum.grandTotalSec, 700, today + ' 的累计投入');
      T.equal(sum.byId['p1'].todayActiveSec, 100, today + ' 的父项目今天投入');
      T.equal(sum.byId['p1'].weekActiveSec, 300, today + ' 的父项目本周投入');
    }
  });

  T.test('专注度只用计时产生的时长，手动补录不参与（D7 的底层）', function () {
    const today = '2025-06-11';
    const s = buildState(today);
    const sum = C.summarize({ projects: s.projects, records: s.records }, today);

    // 客户A 的计时记录：r3 = 1800/200，r4 = 900/0 → 合计 2700 投入 / 200 暂停 → 93%
    // 今天那条 1200 秒是手动补录（r6），没有暂停数据；若算进专注度会把它虚高成 94%
    T.equal(sum.byId['clientA'].focusActiveSec, 1800 + 900, '只算计时产生的投入');
    T.equal(sum.byId['clientA'].focusPausedSec, 200);
    T.equal(sum.byId['clientA'].focusPercent, Math.round(2700 / 2900 * 100));
    // 但累计投入必须含手动补录
    T.equal(sum.byId['clientA'].totalActiveSec, 1800 + 900 + 1200);

    // 工作整体：自身 r1 600/100 + r2 3000/0，子项目 2700/200 → 6300 投入 / 300 暂停
    T.equal(sum.byId['work'].focusActiveSec, 600 + 3000 + 1800 + 900);
    T.equal(sum.byId['work'].focusPausedSec, 100 + 200);
    T.equal(sum.byId['work'].focusPercent, Math.round(6300 / 6600 * 100));
  });

  T.test('手动补录等同于暂停时间为 0，不会把专注度算成 100% 而掩盖真实暂停', function () {
    const today = '2025-06-11';
    const sum = C.summarize({
      projects: [proj('p1', '工作')],
      records: [
        rec('timer', 'p1', today, 900, { pausedSec: 100 }),
        rec('manual', 'p1', today, 900, { source: 'manual' })
      ]
    }, today);
    // 只该按 900/100 算 → 90%
    T.equal(sum.byId['p1'].focusPercent, 90);
    T.equal(sum.byId['p1'].totalActiveSec, 1800, '但累计投入要把手动补录算进去');
  });

  T.test('没有记录的父项目专注度为 null（界面不显示该标签）', function () {
    const today = '2025-06-11';
    const sum = C.summarize({
      projects: [proj('empty', '空项目')],
      records: []
    }, today);
    T.equal(sum.byId['empty'].focusPercent, null);
    T.equal(sum.byId['empty'].totalActiveSec, 0);
    T.equal(sum.byId['empty'].todayActiveSec, 0);
  });

  T.test('孤儿记录被忽略，不会污染统计（正常流程不该出现）', function () {
    const today = '2025-06-11';
    const sum = C.summarize({
      projects: [proj('p1', '工作')],
      records: [rec('r1', 'p1', today, 100), rec('ghost', '不存在', today, 99999)]
    }, today);
    T.equal(sum.grandTotalSec, 100);
    T.equal(sum.todayTotalSec, 100);
  });

  // ------------------------------------------------------------ 扇形图
  T.test('扇形图按父项目分块，子项目并入父项目（E3、E4）', function () {
    const today = '2025-06-11';
    const s = buildState(today);
    const chart = C.chartData({ projects: s.projects, records: s.records }, today);

    T.equal(chart.slices.length, 2, '只有两个父项目');
    T.equal(chart.slices[0].id, 'work', '按占比降序，工作在前');
    T.equal(chart.slices[0].seconds, 3600 + 3900);
    T.equal(chart.slices[1].id, 'study');
    T.equal(chart.slices[1].seconds, 4000);
    T.equal(chart.totalSec, chart.slices.reduce(function (a, x) { return a + x.seconds; }, 0));
  });

  T.test('扇形图百分比之和正好是 100（用最大余数法，不出现 99 或 101）', function () {
    const cases = [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [10, 10, 10],
      [333, 333, 334],
      [1, 2, 3, 4, 5, 6, 7]
    ];
    for (const weights of cases) {
      const projects = [];
      const records = [];
      weights.forEach(function (w, i) {
        projects.push(proj('p' + i, '项目' + i));
        records.push(rec('r' + i, 'p' + i, '2025-06-11', w));
      });
      const chart = C.chartData({ projects: projects, records: records }, '2025-06-11');
      const sum = chart.slices.reduce(function (a, x) { return a + x.percent; }, 0);
      T.equal(sum, 100, '权重 ' + weights.join('/') + ' 的百分比之和应为 100，实际 ' + sum);
    }
  });

  T.test('没有任何记录时扇形图为空，且不出现除零错误（I8）', function () {
    const today = '2025-06-11';
    const chart = C.chartData({ projects: [proj('p1', '工作')], records: [] }, today);
    T.equal(chart.slices.length, 0);
    T.equal(chart.totalSec, 0);
    const empty = C.chartData({ projects: [], records: [] }, today);
    T.equal(empty.slices.length, 0);
  });

  T.test('时长为 0 的项目不出现在扇形图里（避免 0% 的碎片）', function () {
    const today = '2025-06-11';
    const chart = C.chartData({
      projects: [proj('a', '有记录'), proj('b', '没记录')],
      records: [rec('r1', 'a', today, 60)]
    }, today);
    T.equal(chart.slices.length, 1);
    T.equal(chart.slices[0].id, 'a');
    T.equal(chart.slices[0].percent, 100);
  });

  T.test('切换"今天"时统计跟着变（E8 的底层：每次都按当前日期重算）', function () {
    const state = {
      projects: [proj('p1', '工作')],
      records: [rec('r1', 'p1', '2025-06-11', 100), rec('r2', 'p1', '2025-06-12', 200)]
    };
    const d1 = C.summarize(state, new Date(2025, 5, 11, 10, 0, 0));
    const d2 = C.summarize(state, new Date(2025, 5, 12, 10, 0, 0));
    T.equal(d1.todayTotalSec, 100);
    T.equal(d2.todayTotalSec, 200);
    T.equal(d1.grandTotalSec, 300, '累计总投入与具体某天无关');
    T.equal(d2.grandTotalSec, 300);
  });

  // ---------------------------------------------------------- 压力与边界
  T.test('大量数据下统计仍然快且准（3000 条记录、60 个项目）', function () {
    const projects = [];
    const records = [];
    for (let i = 0; i < 20; i++) {
      projects.push(proj('p' + i, '父项目' + i));
      for (let j = 0; j < 2; j++) projects.push(proj('p' + i + '_' + j, '子项目' + i + '-' + j, 'p' + i));
    }
    const allIds = projects.map(function (p) { return p.id; });
    let expectedTotal = 0;
    for (let k = 0; k < 3000; k++) {
      const id = allIds[k % allIds.length];
      const activeSec = (k % 97) + 1;
      expectedTotal += activeSec;
      records.push(rec('r' + k, id, '2025-06-11', activeSec));
    }

    const started = Date.now();
    const sum = C.summarize({ projects: projects, records: records }, '2025-06-11');
    const elapsed = Date.now() - started;

    T.equal(sum.grandTotalSec, expectedTotal, '累计总投入必须精确');
    T.equal(sum.todayTotalSec, expectedTotal, '全部记录都是今天');
    const parentsSum = sum.projects
      .filter(function (i) { return !i.isChild; })
      .reduce(function (acc, i) { return acc + i.totalActiveSec; }, 0);
    T.equal(parentsSum, expectedTotal, '父项目相加仍等于总投入');
    T.ok(elapsed < 500, '3000 条记录的统计应在 500ms 内完成，实际 ' + elapsed + 'ms');

    const chartStarted = Date.now();
    const chart = C.chartData({ projects: projects, records: records }, '2025-06-11');
    const chartElapsed = Date.now() - chartStarted;
    T.equal(chart.slices.length, 20, '只按父项目分块');
    const percentSum = chart.slices.reduce(function (a, x) { return a + x.percent; }, 0);
    T.equal(percentSum, 100, '大量数据下百分比仍须正好 100');
    T.ok(chartElapsed < 500, '扇形图计算应在 500ms 内完成，实际 ' + chartElapsed + 'ms');
  });
});
