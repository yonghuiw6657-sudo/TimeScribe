/**
 * 每日打卡：日期表 + 点某一天看那天的矩形图。
 *
 * 这里只负责"画"。所有数字都来自 TTCalc.checkinStats / dailyTotals，
 * 与累计投入、扇形图共用同一套口径，不在这里另算一遍。
 *
 * 三条界面约定：
 * - 「本月」是纯界面状态（我现在在看哪个月），不落盘、也不进 state.ui：
 *   没必要为了"翻到哪个月"去动存储结构。
 * - 没打卡的日期**不给 data-action**（渲染成 span 而不是按钮），
 *   所以"点上去没反应"是结构上就成立的，不是靠回调里 early return 兜出来的。
 * - 深色主题下"加深"是看不见的，所以打卡日改成**点亮**（用星光蓝填上）。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  const calc = global.TTCalc;
  const modal = global.TTUI ? global.TTUI.modal : null;

  /** 周一为一周首日，与 TTCalc.weekRange / isoWeekday 的口径一致。 */
  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

  let viewMonth = null;      // 'YYYY-MM'；null 表示还没初始化，跟当前月走
  let selectedDate = null;   // 最近点开过的那一天，只用来画选中态

  function store() { return global.TTStore; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function statsNow() {
    return calc.checkinStats(store().getState(), new Date());
  }

  // ------------------------------------------------------------------ 面板
  function statsRow(stats) {
    return util.el('div', { class: 'ck-stats' }, [
      util.el('div', {}, ['连续打卡', util.el('b', { text: stats.streak + ' 天' })]),
      util.el('div', {}, ['本月打卡', util.el('b', { text: stats.monthCount + ' 天' })])
    ]);
  }

  function monthBar(stats) {
    const parts = viewMonth.split('-');
    const isCurrent = viewMonth === stats.monthKey;

    return util.el('div', { class: 'ck-month' }, [
      util.el('button', {
        type: 'button', class: 'ck-nav', 'data-action': 'checkin-prev', text: '‹', title: '上个月'
      }),
      util.el('span', { class: 'ck-title', text: Number(parts[0]) + ' 年 ' + Number(parts[1]) + ' 月' }),
      // 已经在本月时不给 data-action：往未来翻只会看到一片空白，还会让人误以为漏打卡
      isCurrent
        ? util.el('span', { class: 'ck-nav is-off', text: '›', title: '已经是本月了' })
        : util.el('button', {
            type: 'button', class: 'ck-nav', 'data-action': 'checkin-next', text: '›', title: '下个月'
          })
    ]);
  }

  function weekdayRow() {
    const row = util.el('div', { class: 'ck-grid' });
    WEEKDAYS.forEach(function (label) {
      row.appendChild(util.el('span', { class: 'ck-wd', text: label }));
    });
    return row;
  }

  function dayCell(dateStr, day, stats) {
    const entry = stats.byDate[dateStr];
    const classes = ['ck-day'];
    if (entry) classes.push('is-checked');
    if (dateStr === stats.today) classes.push('is-today');
    if (dateStr > stats.today) classes.push('is-future');      // 将来的日子，永远点不动
    if (dateStr === selectedDate) classes.push('is-selected');

    const attrs = { class: classes.join(' '), 'data-date': dateStr, text: String(day) };

    // 没打卡的日子到此为止：只有样式，没有动作
    if (!entry) return util.el('span', attrs);

    attrs.type = 'button';
    attrs['data-action'] = 'checkin-day';
    attrs.title = util.fmtDateLabel(dateStr) + ' · 投入 ' + calc.fmtDuration(entry.totalSec);
    return util.el('button', attrs);
  }

  function dayGrid(stats) {
    const parts = viewMonth.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);

    const grid = util.el('div', { class: 'ck-grid' });
    const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;   // 周一开头，补齐月初空格
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < lead; i++) {
      grid.appendChild(util.el('span', { class: 'ck-day is-blank' }));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      grid.appendChild(dayCell(viewMonth + '-' + pad2(day), day, stats));
    }
    const tail = (7 - ((lead + daysInMonth) % 7)) % 7;              // 补完最后一行
    for (let i = 0; i < tail; i++) {
      grid.appendChild(util.el('span', { class: 'ck-day is-blank' }));
    }
    return grid;
  }

  function render() {
    const host = document.getElementById('checkin-panel');
    if (!host) return;

    const stats = statsNow();
    if (!viewMonth || !/^\d{4}-\d{2}$/.test(viewMonth)) viewMonth = stats.monthKey;

    util.clear(host);
    host.appendChild(util.el('h3', { text: '每日打卡' }));
    host.appendChild(statsRow(stats));
    // 日历单独包一层，便于给它一个宽度上限（见 css 的 .ck-cal）
    host.appendChild(util.el('div', { class: 'ck-cal' }, [
      monthBar(stats),
      weekdayRow(),
      dayGrid(stats)
    ]));
  }

  /** 翻月。返回新的月份；被挡住（想翻到未来）时返回 null。 */
  function shiftMonth(delta) {
    const stats = statsNow();
    if (!viewMonth) viewMonth = stats.monthKey;

    const parts = viewMonth.split('-');
    const moved = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
    const next = moved.getFullYear() + '-' + pad2(moved.getMonth() + 1);

    if (next > stats.monthKey) return null;
    viewMonth = next;
    render();
    return viewMonth;
  }

  // -------------------------------------------------------------- 当天矩形图
  /**
   * 当天的矩形图：一行一个项目，条长按「当天最大值」取比例，右边写确切时长。
   *
   * 基准用当天最大值而不是当天合计，是为了让最长的那条正好占满，
   * 短条之间的差别才看得出来（用合计当基准的话，条全都缩在左边一小截）。
   */
  function buildDayBody(day) {
    const max = day.items.reduce(function (m, it) { return Math.max(m, it.seconds); }, 0);

    const bars = util.el('div', { class: 'ck-bars' });
    day.items.forEach(function (it) {
      const width = max > 0 ? Math.max(2, Math.round((it.seconds / max) * 100)) : 100;
      bars.appendChild(util.el('div', { class: 'ck-bar-row', 'data-project-id': it.id }, [
        util.el('span', { class: 'ck-bar-name', text: it.name, title: it.name }),
        util.el('div', { class: 'ck-bar-track' }, [
          util.el('i', { class: 'ck-bar-fill', style: { width: width + '%', background: it.color || '#3b82f6' } })
        ]),
        util.el('span', { class: 'ck-bar-val', text: calc.fmtDuration(it.seconds) })
      ]));
    });

    return util.el('div', { class: 'ck-detail' }, [
      util.el('div', { class: 'ck-summary' }, [
        util.el('span', { class: 'ck-total', text: '当天合计 ' + calc.fmtDuration(day.totalSec) }),
        util.el('span', { class: 'ck-count', text: day.items.length + ' 个有投入的项目' })
      ]),
      bars
    ]);
  }

  /** 打开某一天的矩形图。没打卡的日期返回 null（点了不该有任何反应）。 */
  function openDay(dateStr) {
    const day = statsNow().byDate[dateStr];
    if (!day) return null;

    selectedDate = dateStr;
    render();                                  // 让被点的那一格有选中态

    return modal.open({
      title: util.fmtDateLabel(dateStr) + ' · 当天投入',
      width: 600,
      body: [buildDayBody(day)],
      buttons: [{ text: '关闭', kind: '' }]
    });
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.checkin = {
    render: render,
    openDay: openDay,
    shiftMonth: shiftMonth,
    getViewMonth: function () { return viewMonth; },
    getSelectedDate: function () { return selectedDate; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
