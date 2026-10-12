/**
 * 纯计算层：时长格式化、日期与周边界、专注度、统计汇总、扇形图分组、按天聚合（打卡）。
 *
 * 这里是全 app **唯一**的统计口径来源：
 *   一个项目的累计投入 = 该项目自身记录之和 + 其全部子项目记录之和
 *   累计总投入       = 所有父项目累计投入之和（= 全部记录之和）
 * 界面任何地方都不许自己算，否则数字迟早对不上。
 *
 * 重要：所有内部计算一律用"秒"这个整数，只在展示的最后一刻格式化；
 * 日期一律用本地时区的 YYYY-MM-DD 字符串比较，绝不用 toISOString()（那是 UTC，会差一天）。
 */
(function (global) {
  'use strict';

  const MINUTE = 60;
  const HOUR = 3600;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 本地时区的 YYYY-MM-DD。 */
  function toDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayStr(now) {
    return toDateStr(now === undefined ? new Date() : now);
  }

  function parseDateStr(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addDays(dateStr, days) {
    const d = parseDateStr(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() + days);
    return toDateStr(d);
  }

  function isoWeekday(dateStr) {
    const d = parseDateStr(dateStr);
    if (!d) return null;
    const wd = d.getDay();               // 0=周日
    return wd === 0 ? 7 : wd;            // 1=周一 ... 7=周日
  }

  /** 本周范围：周一为一周首日。返回 { start, end }。 */
  function weekRange(dateStr) {
    const base = dateStr || todayStr();
    const wd = isoWeekday(base);
    if (!wd) return { start: null, end: null };
    const start = addDays(base, -(wd - 1));
    return { start: start, end: addDays(start, 6) };
  }

  function isInWeek(dateStr, weekStart, weekEnd) {
    if (weekStart && dateStr < weekStart) return false;
    if (weekEnd && dateStr > weekEnd) return false;
    return true;
  }

  /**
   * 时长格式化（PRD 4.5）。
   * 先四舍五入到分钟，再拆分小时与分钟，避免 3599 秒被显示成 "59 分"。
   */
  function fmtDuration(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const minutes = Math.round(total / MINUTE);
    if (minutes === 0) return '0 分';
    if (minutes < 60) return minutes + ' 分';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return h + ' 小时';
    return h + ' 小时 ' + m + ' 分';
  }

  /** 秒表显示：HH:MM:SS，小时可以超过两位。 */
  function fmtClock(ms) {
    const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  /**
   * 把秒数拆成 { hours, minutes }（先四舍五入到分钟，与 fmtDuration 口径一致）。
   * 界面需要分别显示数字与单位，因此不能在格式化后的字符串上做切分。
   */
  function durationParts(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const minutes = Math.round(total / MINUTE);
    return { hours: Math.floor(minutes / 60), minutes: minutes % 60, totalMinutes: minutes };
  }

  /** 专注度（整数百分比）。分母为 0 时返回 null（表示不显示）。 */
  function focusRate(activeSec, pausedSec) {
    const a = Math.max(0, Number(activeSec) || 0);
    const p = Math.max(0, Number(pausedSec) || 0);
    const total = a + p;
    if (total <= 0) return null;
    return Math.round((a / total) * 100);
  }

  function focusText(activeSec, pausedSec) {
    const r = focusRate(activeSec, pausedSec);
    return r === null ? null : r + '%';
  }

  /**
   * 把秒数按项目聚合。
   * 返回 { perProject, byId, childrenOf }
   */
  function aggregate(state) {
    const projects = (state && state.projects) || [];
    const records = (state && state.records) || [];

    const byId = {};
    projects.forEach(function (p) { byId[p.id] = p; });

    const perProject = {};
    projects.forEach(function (p) {
      perProject[p.id] = {
        id: p.id,
        ownActiveSec: 0,
        ownPausedSec: 0,
        subActiveSec: 0,
        subPausedSec: 0,
        todayActiveSec: 0,
        todayPausedSec: 0,
        weekActiveSec: 0,
        ownTodayActiveSec: 0,
        recordCount: 0
      };
    });

    for (const r of records) {
      const entry = perProject[r.projectId];
      if (!entry) continue;                       // 孤儿记录（正常流程不会出现）
      entry.recordCount += 1;
      entry.ownActiveSec += r.activeSec;
      entry.ownPausedSec += r.pausedSec;
    }

    return { perProject: perProject, byId: byId };
  }

  function childrenOf(projects, parentId) {
    return projects.filter(function (p) { return p.parentId === parentId; });
  }

  /**
   * 统计汇总：界面所需的全部数字一次性算完（PRD 4.5）。
   *
   * 口径（唯一来源，不要在别处再算一遍）：
   * - 项目的累计投入（父项目）= 自身记录投入 + 全部子项目记录投入
   * - 项目的累计投入（子项目）= 自身记录投入
   * - 累计总投入 = 全部记录投入之和
   * - 今天/本周（父项目）= 自身 + 子项目
   * - 专注度用"计时产生"的时长计算，手动补录不参与
   */
  function summarize(state, now) {
    const projects = (state && state.projects) || [];
    const records = (state && state.records) || [];
    const today = todayStr(now);
    const week = weekRange(today);

    const byId = {};
    projects.forEach(function (p) { byId[p.id] = p; });

    function blank() {
      return {
        ownActiveSec: 0, ownPausedSec: 0,
        ownTimerActiveSec: 0, ownTimerPausedSec: 0,
        subActiveSec: 0,
        subTimerActiveSec: 0, subTimerPausedSec: 0,
        todayActiveSec: 0, weekActiveSec: 0,
        ownTodayActiveSec: 0, ownWeekActiveSec: 0,
        recordCount: 0
      };
    }

    const acc = {};
    projects.forEach(function (p) { acc[p.id] = blank(); });

    let grandTotalSec = 0;
    let todayTotalSec = 0;
    let weekTotalSec = 0;

    for (const r of records) {
      const project = byId[r.projectId];
      if (!project) continue;                       // 孤儿记录（正常流程不会出现）
      const mine = acc[project.id];
      if (!mine) continue;

      const isToday = r.date === today;
      const isWeek = isInWeek(r.date, week.start, week.end);

      mine.recordCount += 1;
      mine.ownActiveSec += r.activeSec;
      mine.ownPausedSec += r.pausedSec;
      if (isToday) mine.ownTodayActiveSec += r.activeSec;
      if (isWeek) mine.ownWeekActiveSec += r.activeSec;
      if (r.source !== 'manual') {
        mine.ownTimerActiveSec += r.activeSec;
        mine.ownTimerPausedSec += r.pausedSec;
      }

      grandTotalSec += r.activeSec;
      if (isToday) todayTotalSec += r.activeSec;
      if (isWeek) weekTotalSec += r.activeSec;

      // 子项目的时长并入其父项目（最多两层，直接找到根即可）
      if (project.parentId) {
        const parent = acc[project.parentId];
        if (parent) {
          parent.subActiveSec += r.activeSec;
          if (isToday) parent.todayActiveSec += r.activeSec;
          if (isWeek) parent.weekActiveSec += r.activeSec;
          if (r.source !== 'manual') {
            parent.subTimerActiveSec += r.activeSec;
            parent.subTimerPausedSec += r.pausedSec;
          }
        }
      }
    }

    // 父项目自身的今天/本周也要算上
    projects.forEach(function (p) {
      const a = acc[p.id];
      if (!a || p.parentId) return;
      a.todayActiveSec += a.ownTodayActiveSec;
      a.weekActiveSec += a.ownWeekActiveSec;
    });

    const listItems = projects.map(function (p) {
      const a = acc[p.id];
      const isChild = !!p.parentId;
      const focusActive = isChild ? a.ownTimerActiveSec : (a.ownTimerActiveSec + a.subTimerActiveSec);
      const focusPaused = isChild ? a.ownTimerPausedSec : (a.ownTimerPausedSec + a.subTimerPausedSec);
      return {
        project: p,
        isChild: isChild,
        ownActiveSec: a.ownActiveSec,
        subActiveSec: isChild ? 0 : a.subActiveSec,
        totalActiveSec: isChild ? a.ownActiveSec : (a.ownActiveSec + a.subActiveSec),
        todayActiveSec: isChild ? a.ownTodayActiveSec : a.todayActiveSec,
        weekActiveSec: isChild ? a.ownWeekActiveSec : a.weekActiveSec,
        recordCount: a.recordCount,
        focusPercent: focusRate(focusActive, focusPaused),
        focusActiveSec: focusActive,
        focusPausedSec: focusPaused
      };
    });

    const byIdItems = {};
    listItems.forEach(function (item) { byIdItems[item.project.id] = item; });

    return {
      today: today,
      weekStart: week.start,
      weekEnd: week.end,
      projects: listItems,
      byId: byIdItems,
      grandTotalSec: grandTotalSec,
      todayTotalSec: todayTotalSec,
      weekTotalSec: weekTotalSec
    };
  }

  /**
   * 扇形图数据：按父项目分块（PRD 3.2）。
   * 百分比用"最大余数法"分配，保证加起来正好是 100%。
   */
  function chartData(state, now) {
    const summary = summarize(state, now);
    const parents = summary.projects.filter(function (item) { return !item.isChild; });
    const total = parents.reduce(function (sum, item) { return sum + item.totalActiveSec; }, 0);

    const raw = parents
      .filter(function (item) { return item.totalActiveSec > 0; })
      .map(function (item) {
        return {
          id: item.project.id,
          name: item.project.name,
          color: item.project.color,
          seconds: item.totalActiveSec,
          exact: total > 0 ? (item.totalActiveSec / total) * 100 : 0
        };
      })
      .sort(function (a, b) { return b.seconds - a.seconds; });

    // 最大余数法：先取整，再把余下的名额分给小数部分最大的
    const percents = raw.map(function (item) { return Math.floor(item.exact); });
    let used = percents.reduce(function (s, n) { return s + n; }, 0);
    let remaining = total > 0 ? 100 - used : 0;
    const order = raw.map(function (item, i) {
      return { i: i, frac: item.exact - Math.floor(item.exact) };
    }).sort(function (a, b) { return b.frac - a.frac; });
    for (let k = 0; k < order.length && remaining > 0; k++) {
      percents[order[k].i] += 1;
      remaining -= 1;
    }

    return {
      totalSec: total,
      slices: raw.map(function (item, i) {
        return {
          id: item.id,
          name: item.name,
          color: item.color,
          seconds: item.seconds,
          percent: percents[i]
        };
      })
    };
  }

  /**
   * 按天聚合：每一天用了哪些项目、各投入多少。
   *
   * 这是「每日打卡」与「当天矩形图」的唯一口径来源，规则与 summarize 完全一致：
   * - 一行 = 一个父项目，数值 = 它自身的记录 + 全部子项目记录（最多两层，直接找根）
   * - 只列当天真的有时长的项目；手动补录同样计入（它本来就进累计口径）
   * - 挂在未知项目上的记录跳过（正常流程不会出现）
   *
   * 返回 { dates, byDate }
   *   dates  : 有投入的日期，升序（YYYY-MM-DD 的字符串序就是时间序，不用再转日期）
   *   byDate : { 'YYYY-MM-DD': { totalSec, items: [{ id, name, color, seconds }] } }
   *            items 按时长降序；等长时按名字、再按 id 兜底，保证每次渲染的顺序都一样
   */
  function dailyTotals(state) {
    const projects = (state && state.projects) || [];
    const records = (state && state.records) || [];

    const byId = {};
    projects.forEach(function (p) { byId[p.id] = p; });

    // 先把每条记录归到它的"根项目"上：子项目的记录算在父项目名下
    const perDate = {};
    for (const r of records) {
      const project = byId[r.projectId];
      if (!project) continue;
      const root = (project.parentId && byId[project.parentId]) ? byId[project.parentId] : project;
      const day = perDate[r.date] || (perDate[r.date] = {});
      day[root.id] = (day[root.id] || 0) + r.activeSec;
    }

    const byDate = {};
    Object.keys(perDate).forEach(function (date) {
      const items = [];
      Object.keys(perDate[date]).forEach(function (rootId) {
        const seconds = perDate[date][rootId];
        if (seconds <= 0) return;            // 0 秒的记录不算这一天的投入
        const project = byId[rootId];
        items.push({ id: rootId, name: project.name, color: project.color, seconds: seconds });
      });
      if (!items.length) return;             // 一天里全是 0 秒 → 这一天不算打卡
      items.sort(function (a, b) {
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      byDate[date] = {
        totalSec: items.reduce(function (sum, it) { return sum + it.seconds; }, 0),
        items: items
      };
    });

    return { dates: Object.keys(byDate).sort(), byDate: byDate };
  }

  /**
   * 打卡统计：界面上的「连续打卡 N 天 / 本月打卡 N 天」。
   *
   * 打卡的定义 = 这一天有投入（也就是 dailyTotals 里存在这一天）。
   *
   * 连续天数：今天打过卡就从今天往前数；**今天还没打卡就从昨天往前数**——
   * 否则每天早上打开应用都会看到「连续 0 天」，把"今天还没开始用"误报成中断。
   */
  function checkinStats(state, now) {
    const today = todayStr(now);
    const totals = dailyTotals(state);
    const monthKey = today.slice(0, 7);

    let monthCount = 0;
    for (const d of totals.dates) {
      if (d.slice(0, 7) === monthKey) monthCount += 1;
    }

    let streak = 0;
    let cursor = totals.byDate[today] ? today : addDays(today, -1);
    while (cursor && totals.byDate[cursor]) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    return {
      today: today,
      todayChecked: !!totals.byDate[today],
      monthKey: monthKey,
      monthCount: monthCount,
      streak: streak,
      dates: totals.dates,
      byDate: totals.byDate
    };
  }

  let idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + rand;
  }

  global.TTCalc = {
    MINUTE: MINUTE,
    HOUR: HOUR,
    toDateStr: toDateStr,
    todayStr: todayStr,
    parseDateStr: parseDateStr,
    addDays: addDays,
    isoWeekday: isoWeekday,
    weekRange: weekRange,
    isInWeek: isInWeek,
    fmtDuration: fmtDuration,
    fmtClock: fmtClock,
    durationParts: durationParts,
    focusRate: focusRate,
    focusText: focusText,
    childrenOf: childrenOf,
    summarize: summarize,
    chartData: chartData,
    dailyTotals: dailyTotals,
    checkinStats: checkinStats,
    makeId: makeId
  };
})(typeof window !== 'undefined' ? window : globalThis);
