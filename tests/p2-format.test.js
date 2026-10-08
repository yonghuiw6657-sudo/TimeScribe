/**
 * P2 时间与计算工具（Node 运行）
 *
 * 这些是最容易算错、且错了会导致"数字对不上"的地方：时区、跨周、四舍五入、统计口径。
 * 全部用精确断言，不用"看起来差不多"。
 */
TTTest.defineSuite('P2', '时长与日期格式化', function () {
  const T = TTTest;
  const C = TT.TTCalc;

  // -------------------------------------------------------- fmtDuration
  T.test('时长格式化：分钟、小时、小时+分钟、0 的四种形态', function () {
    T.equal(C.fmtDuration(0), '0 分');
    T.equal(C.fmtDuration(59), '1 分', '不足 1 分钟按四舍五入到 1 分');
    T.equal(C.fmtDuration(90), '2 分', '90 秒应显示 2 分');
    T.equal(C.fmtDuration(1800), '30 分');
    T.equal(C.fmtDuration(3600), '1 小时');
    T.equal(C.fmtDuration(3620), '1 小时', '3620 秒 = 60.3 分，取整为 60 分即 1 小时');
    T.equal(C.fmtDuration(5400), '1 小时 30 分');
    T.equal(C.fmtDuration(45240), '12 小时 34 分');
  });

  T.test('时长格式化先四舍五入到分钟再拆分（避免差一分钟）', function () {
    T.equal(C.fmtDuration(3599), '1 小时', '3599 秒是 59.98 分，四舍五入应为 60 分');
    T.equal(C.fmtDuration(3590), '1 小时', '3590 秒是 59.83 分，四舍五入应为 60 分');
    T.equal(C.fmtDuration(3569), '59 分', '3569 秒是 59.48 分，仍是 59 分');
    T.equal(C.fmtDuration(29), '0 分', '29 秒不足半分钟');
    T.equal(C.fmtDuration(30), '1 分', '30 秒刚好半分钟，向上取整');
  });

  T.test('时长格式化对异常输入不炸（负数、字符串、空值）', function () {
    T.equal(C.fmtDuration(-100), '0 分');
    T.equal(C.fmtDuration('abc'), '0 分');
    T.equal(C.fmtDuration(null), '0 分');
    T.equal(C.fmtDuration('4500'), '1 小时 15 分', '字符串数字应能正常处理');
  });

  // ----------------------------------------------------------- fmtClock
  T.test('秒表格式 HH:MM:SS，小时可超过两位', function () {
    T.equal(C.fmtClock(0), '00:00:00');
    T.equal(C.fmtClock(1000), '00:00:01');
    T.equal(C.fmtClock(61000), '00:01:01');
    T.equal(C.fmtClock(3661000), '01:01:01');
    T.equal(C.fmtClock(367200000), '102:00:00', '超过 99 小时不截断');
  });

  T.test('秒表格式向下取整（未满 1 秒不显示）', function () {
    T.equal(C.fmtClock(1999), '00:00:01');
    T.equal(C.fmtClock(999), '00:00:00');
    T.equal(C.fmtClock(-5000), '00:00:00', '负数显示为 0');
  });

  // ------------------------------------------------------ 日期与周边界
  T.test('日期用本地时区，不用 UTC（否则会差一天）', function () {
    // 本地时间 2025-06-11 00:30，UTC 时间是 06-10 16:30
    const d = new Date(2025, 5, 11, 0, 30, 0);
    T.equal(C.toDateStr(d), '2025-06-11', '必须按本地日期，不能用 toISOString');
    // 本地时间 2025-06-11 23:30，UTC 已是 06-11 15:30（同一天，但反过来在西部时区会差一天）
    const d2 = new Date(2025, 5, 11, 23, 30, 0);
    T.equal(C.toDateStr(d2), '2025-06-11');
    T.equal(C.toDateStr(new Date(2025, 0, 1, 0, 0, 0)), '2025-01-01');
    T.equal(C.toDateStr(new Date(2024, 1, 29)), '2024-02-29', '闰年 2 月 29 日');
  });

  T.test('一周从周一开始（ISO 周）', function () {
    // 2025-06-11 是周三
    const w = C.weekRange('2025-06-11');
    T.equal(w.start, '2025-06-09', '周三所在周的周一');
    T.equal(w.end, '2025-06-15', '周日');

    // 周一当天
    const mon = C.weekRange('2025-06-09');
    T.equal(mon.start, '2025-06-09');
    T.equal(mon.end, '2025-06-15');

    // 周日当天：仍属于本周（周一开始）
    const sun = C.weekRange('2025-06-15');
    T.equal(sun.start, '2025-06-09');
    T.equal(sun.end, '2025-06-15');

    // 紧邻的下周一属于下一周
    const nextMon = C.weekRange('2025-06-16');
    T.equal(nextMon.start, '2025-06-16');
    T.equal(nextMon.end, '2025-06-22');
  });

  T.test('周日 23:59 与周一 00:01 分属不同周', function () {
    const sunday = C.weekRange('2025-06-15');
    const monday = C.weekRange('2025-06-16');
    T.notEqual(sunday.start, monday.start);
    T.equal(C.isInWeek('2025-06-15', sunday.start, sunday.end), true);
    T.equal(C.isInWeek('2025-06-16', sunday.start, sunday.end), false, '周一的记录不该算进上周');
    T.equal(C.isInWeek('2025-06-16', monday.start, monday.end), true);
  });

  T.test('跨月与跨年的周边界正确', function () {
    const w = C.weekRange('2025-03-01');   // 2025-03-01 是周六
    T.equal(w.start, '2025-02-24');
    T.equal(w.end, '2025-03-02');

    const y = C.weekRange('2025-01-01');   // 2025-01-01 是周三
    T.equal(y.start, '2024-12-30');
    T.equal(y.end, '2025-01-05');

    const y2 = C.weekRange('2026-01-01');  // 2026-01-01 是周四
    T.equal(y2.start, '2025-12-29');
    T.equal(y2.end, '2026-01-04');
  });

  T.test('addDays 能正确跨月、跨年、闰年', function () {
    T.equal(C.addDays('2025-02-28', 1), '2025-03-01', '平年 2 月只有 28 天');
    T.equal(C.addDays('2024-02-28', 1), '2024-02-29', '闰年有 2 月 29 日');
    T.equal(C.addDays('2024-02-29', 1), '2024-03-01');
    T.equal(C.addDays('2025-12-31', 1), '2026-01-01');
    T.equal(C.addDays('2026-01-01', -1), '2025-12-31');
    T.equal(C.addDays('2025-06-11', 0), '2025-06-11');
  });

  // ------------------------------------------------------------ 专注度
  T.test('专注度 = 投入 ÷（投入 + 暂停），四舍五入到整数百分比', function () {
    T.equal(C.focusRate(100, 0), 100);
    T.equal(C.focusRate(0, 100), 0);
    T.equal(C.focusRate(50, 50), 50);
    T.equal(C.focusRate(75, 25), 75);
    T.equal(C.focusRate(1, 2), 33, '33.33% 向下');
    T.equal(C.focusRate(2, 1), 67, '66.67% 向上');
    T.equal(C.focusRate(1, 1), 50);
  });

  T.test('没有时长时不显示专注度（返回 null 而不是 0%）', function () {
    T.equal(C.focusRate(0, 0), null);
    T.equal(C.focusRate(null, null), null);
    T.equal(C.focusText(0, 0), null);
    T.equal(C.focusText(90, 10), '90%');
  });

  T.test('专注度对异常输入不产生负数或超过 100', function () {
    T.equal(C.focusRate(-50, 100), 0);
    T.equal(C.focusRate(100, -50), 100);
    T.equal(C.focusRate('abc', 100), 0);
  });

  // ---------------------------------------------------------- id 生成
  T.test('生成的 id 唯一且可读前缀', function () {
    const ids = {};
    for (let i = 0; i < 500; i++) {
      const id = C.makeId('p');
      T.ok(id.indexOf('p-') === 0, '应带前缀');
      T.notOk(ids[id], '不应重复：' + id);
      ids[id] = true;
    }
  });
});
