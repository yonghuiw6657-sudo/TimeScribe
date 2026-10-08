/**
 * 首页渲染：统计区、扇形图、项目列表（父项目卡片 + 子项目行）。
 *
 * 渲染策略：数据变了就整体重绘（数据量小，逻辑简单不易出错）。
 * 唯一例外是秒表数字——走独立的定时更新通道，避免每秒重绘与写盘。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  const calc = global.TTCalc;

  let clockTimer = null;

  function store() {
    return global.TTStore;
  }

  function currentState() {
    return store().getState();
  }

  function summaryOf(state) {
    return calc.summarize(state, new Date());
  }

  // ------------------------------------------------------------------ 统计区
  function renderTotal(state, summary) {
    const host = document.getElementById('stat-total');
    if (!host) return;
    util.clear(host);
    host.appendChild(util.el('h3', { text: '累计总投入' }));

    // 用结构化数值拼装，不要在格式化后的字符串上做切分（口径容易乱）
    const parts = calc.durationParts(summary.grandTotalSec);
    const big = util.el('div', { class: 'bignum' });
    if (parts.hours > 0) {
      big.appendChild(document.createTextNode(String(parts.hours)));
      big.appendChild(util.el('small', { text: '小时' }));
      if (parts.minutes > 0) {
        big.appendChild(document.createTextNode(' ' + parts.minutes));
        big.appendChild(util.el('small', { text: '分' }));
      }
    } else {
      big.appendChild(document.createTextNode(String(parts.minutes)));
      big.appendChild(util.el('small', { text: '分' }));
    }

    const subs = util.el('div', { class: 'subnums' }, [
      util.el('div', {}, ['今天', util.el('b', { text: calc.fmtDuration(summary.todayTotalSec) })]),
      util.el('div', {}, ['本周', util.el('b', { text: calc.fmtDuration(summary.weekTotalSec) })])
    ]);

    host.appendChild(big);
    host.appendChild(subs);
  }

  // ---------------------------------------------------------------- 扇形图
  function renderChart(state, summary) {
    const host = document.getElementById('chart-host');
    const panel = document.getElementById('chart-panel');
    if (!host || !panel) return;
    util.clear(host);

    const chart = calc.chartData(state, new Date());
    if (!chart.slices.length) {
      host.appendChild(util.el('svg', { width: 132, height: 132, viewBox: '0 0 42 42' }, [
        util.el('circle', {
          cx: 21, cy: 21, r: 15.9, fill: 'none', stroke: '#eef2f7', 'stroke-width': 6
        })
      ]));
      host.appendChild(util.el('div', {
        class: 'empty-hint', text: '还没有记录，先建一个项目开始计时吧'
      }));
      return;
    }

    const total = chart.totalSec;
    const radius = 15.9;
    const circumference = 2 * Math.PI * radius;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '132');
    svg.setAttribute('height', '132');
    svg.setAttribute('viewBox', '0 0 42 42');

    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '21'); bg.setAttribute('cy', '21'); bg.setAttribute('r', String(radius));
    bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#eef2f7'); bg.setAttribute('stroke-width', '6');
    svg.appendChild(bg);

    let offset = 0;
    chart.slices.forEach(function (slice) {
      const fraction = slice.seconds / total;
      const length = fraction * circumference;
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', '21');
      circle.setAttribute('cy', '21');
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', slice.color || '#3b82f6');
      circle.setAttribute('stroke-width', '6');
      circle.setAttribute('stroke-dasharray', length + ' ' + (circumference - length));
      circle.setAttribute('stroke-dashoffset', String(-offset));
      circle.setAttribute('data-slice-id', slice.id);
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = slice.name + ' · ' + calc.fmtDuration(slice.seconds) + ' · ' + slice.percent + '%';
      circle.appendChild(title);
      svg.appendChild(circle);
      offset += length;
    });

    host.appendChild(svg);

    const legend = util.el('div', { class: 'legend' });
    chart.slices.forEach(function (slice) {
      legend.appendChild(util.el('div', { class: 'row', 'data-legend-id': slice.id }, [
        util.el('i', { class: 'sw', style: { background: slice.color || '#3b82f6' } }),
        util.el('span', { class: 'nm', text: slice.name }),
        util.el('span', { class: 'vl', text: calc.fmtDuration(slice.seconds) }),
        util.el('span', { class: 'pc', text: slice.percent + '%' })
      ]));
    });
    host.appendChild(legend);
  }

  // ------------------------------------------------------------ 项目卡片
  function actionButton(item) {
    const rt = currentState().runtime;
    const active = rt && rt.state && rt.projectId === item.project.id;

    if (active && rt.state === 'running') {
      return util.el('button', { type: 'button', class: 'btn primary tiny', 'data-action': 'pause', text: '暂停' });
    }
    if (active && rt.state === 'paused') {
      return [
        util.el('button', { type: 'button', class: 'btn primary tiny', 'data-action': 'resume', text: '继续' }),
        util.el('button', { type: 'button', class: 'btn tiny', 'data-action': 'stop', text: '停止' })
      ];
    }
    return util.el('button', { type: 'button', class: 'btn tiny', 'data-action': 'start', text: '开始' });
  }

  function meterNode(item) {
    const rt = currentState().runtime;
    const active = rt && rt.state && rt.projectId === item.project.id;
    const cls = 'timer-face' + (active && rt.state === 'running' ? ' on' : (active && rt.state === 'paused' ? ' hold' : ''));
    const text = active ? calc.fmtClock(global.TTTimer.currentSegmentMs()) : '00:00:00';
    return util.el('span', {
      class: cls,
      'data-meter-for': item.project.id,
      text: text
    });
  }

  function focusChip(item, label) {
    if (item.focusPercent === null || item.focusPercent === undefined) return null;
    return util.el('span', { class: 'focus-chip', text: (label || '') + '专注 ' + item.focusPercent + '%' });
  }

  function menuButton(project, isChild) {
    return util.el('button', {
      type: 'button',
      class: 'btn ghost tiny',
      'data-menu-for': project.id,
      text: '⋯',
      title: '更多操作'
    });
  }

  function renderParentCard(project, item, sorted, state) {
    const expanded = global.TTProjects.isExpanded(state, project.id);
    const children = sorted.childrenOf(project.id);
    const rt = state.runtime;
    const isRunning = rt && rt.state === 'running' && rt.projectId === project.id;
    const isPaused = rt && rt.state === 'paused' && rt.projectId === project.id;

    const cardClass = 'pcard' + (isRunning ? ' running' : (isPaused ? ' paused' : ''));
    const card = util.el('div', { class: cardClass, 'data-project-card': project.id });

    const nameRow = util.el('div', { class: 'n' }, [
      util.el('span', { text: project.name }),
      isRunning ? util.el('span', { class: 'kick run', text: '计时中' }) : null,
      isPaused ? util.el('span', { class: 'kick pause', text: '已暂停' }) : null,
      focusChip(item, '整体')
    ]);

    const metaParts = ['共 ' + calc.fmtDuration(item.totalActiveSec), '今天 ' + calc.fmtDuration(item.todayActiveSec)];
    if (children.length) metaParts.push(children.length + ' 个子项目');
    if (item.ownActiveSec > 0) metaParts.push('父亲自计时 ' + calc.fmtDuration(item.ownActiveSec));

    const progress = Math.max(0, Math.min(100, item.progressPercent === undefined ? 0 : item.progressPercent));
    const row = util.el('div', { class: 'prow' }, [
      util.el('span', {
        class: 'caret',
        'data-toggle-for': project.id,
        'data-has-children': children.length ? 'yes' : 'no',
        text: children.length ? (expanded ? '▼' : '▶') : '·',
        style: { cursor: children.length ? 'pointer' : 'default' }
      }),
      util.el('div', { class: 'pname' }, [
        nameRow,
        util.el('div', { class: 'm', text: metaParts.join(' · ') }),
        util.el('div', { class: 'bar' }, [
          util.el('i', { style: { width: progress + '%', background: project.color || '#3b82f6' } })
        ])
      ]),
      util.el('div', { class: 'pact' }, [
        meterNode(item),
        actionButton(item),
        isRunning || isPaused ? util.el('button', { type: 'button', class: 'btn tiny', 'data-action': 'stop', text: '停止' }) : null,
        menuButton(project, false)
      ])
    ]);
    card.appendChild(row);

    if (expanded && children.length) {
      const subs = util.el('div', { class: 'subs' });
      children.forEach(function (child) {
        subs.appendChild(renderChildRow(child, summaryCache.byId[child.id], state));
      });
      subs.appendChild(util.el('div', {
        class: 'addsub',
        'data-action': 'add-sub',
        'data-parent-for': project.id,
        text: '＋ 新建子项目'
      }));
      card.appendChild(subs);
    }

    return card;
  }

  function renderChildRow(project, item, state) {
    const rt = state.runtime;
    const isRunning = rt && rt.state === 'running' && rt.projectId === project.id;
    const isPaused = rt && rt.state === 'paused' && rt.projectId === project.id;

    const row = util.el('div', {
      class: 'srow' + (isRunning ? ' running' : (isPaused ? ' paused' : '')),
      'data-project-card': project.id
    });

    row.appendChild(util.el('span', { class: 'caret', text: '·', style: { visibility: 'hidden' } }));
    row.appendChild(util.el('div', { class: 'pname' }, [
      util.el('div', { class: 'n' }, [
        util.el('span', { text: project.name }),
        isRunning ? util.el('span', { class: 'kick run', text: '计时中' }) : null,
        isPaused ? util.el('span', { class: 'kick pause', text: '已暂停' }) : null,
        focusChip(item, '')
      ]),
      util.el('div', { class: 'm', text: '共 ' + calc.fmtDuration(item.totalActiveSec) + ' · 今天 ' + calc.fmtDuration(item.todayActiveSec) })
    ]));
    row.appendChild(util.el('div', { class: 'pact' }, [
      meterNode(item),
      actionButton(item),
      isRunning || isPaused ? util.el('button', { type: 'button', class: 'btn tiny', 'data-action': 'stop', text: '停止' }) : null,
      menuButton(project, true)
    ]));
    return row;
  }

  let summaryCache = { byId: {} };

  function renderList(state, summary) {
    const host = document.getElementById('project-list');
    const title = document.getElementById('list-title');
    const sortHost = document.getElementById('sort-host');
    if (!host) return;

    util.clear(host);
    summaryCache = summary;

    const sorted = global.TTProjects.sortProjects(state, summary);
    const parents = sorted.parents;

    if (title) title.textContent = '我的项目（' + state.projects.filter(function (p) { return !p.parentId; }).length + '）';

    // 排序切换
    if (sortHost) {
      util.clear(sortHost);
      const modes = [
        { key: 'total', label: '按累计投入' },
        { key: 'today', label: '按今天投入' },
        { key: 'manual', label: '手动顺序' }
      ];
      const select = util.el('select', { class: 'sort-select', 'data-action': 'sort-mode' });
      modes.forEach(function (m) {
        select.appendChild(util.el('option', { value: m.key, text: m.label, selected: sorted.mode === m.key }));
      });
      sortHost.appendChild(select);
    }

    if (parents.length === 0) {
      host.appendChild(util.el('div', { class: 'empty-state' }, [
        util.el('div', { class: 'empty-title', text: '还没有项目' }),
        util.el('div', { class: 'empty-sub', text: '先建一个你最近在做的事，比如「工作」或「学英语」' }),
        util.el('button', {
          type: 'button', class: 'btn primary', 'data-action': 'new-project', text: '＋ 新建第一个项目'
        })
      ]));
      return;
    }

    // 进度条基准：累计投入最多的父项目
    const maxTotal = parents.reduce(function (m, p) {
      const item = summary.byId[p.id];
      return Math.max(m, item ? item.totalActiveSec : 0);
    }, 0);
    parents.forEach(function (p) {
      const item = summary.byId[p.id];
      if (item) {
        item.progressPercent = maxTotal > 0 ? Math.round((item.totalActiveSec / maxTotal) * 100) : 0;
      }
    });

    parents.forEach(function (project) {
      host.appendChild(renderParentCard(project, summary.byId[project.id], sorted, state));
    });
  }

  // ------------------------------------------------------------------ 秒表
  function updateClocks() {
    const state = currentState();
    const rt = state.runtime;
    if (!rt || !rt.state) return;
    const node = document.querySelector('[data-meter-for="' + rt.projectId + '"]');
    if (!node) return;
    const text = calc.fmtClock(global.TTTimer.currentSegmentMs());
    if (node.textContent !== text) node.textContent = text;
  }

  function startClock(intervalMs) {
    stopClock();
    clockTimer = setInterval(updateClocks, intervalMs || 250);
  }

  function stopClock() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  // ------------------------------------------------------------------ 总渲染
  /**
   * 渲染层只写 data-action，这里把所在卡片的项目 id / 记录 id 补到按钮上。
   * 放在渲染内部（而不是事件绑定处），保证"渲染完成"就等于"按钮可点"。
   */
  function decorateButtons() {
    const TIMER_ACTIONS = { start: true, pause: true, resume: true, stop: true };

    document.querySelectorAll('[data-project-card]').forEach(function (card) {
      const projectId = card.getAttribute('data-project-card');
      card.querySelectorAll('[data-action]').forEach(function (node) {
        if (TIMER_ACTIONS[node.getAttribute('data-action')]) {
          node.setAttribute('data-project-id', projectId);
        }
      });
    });

    document.querySelectorAll('[data-record-id]').forEach(function (row) {
      const recordId = row.getAttribute('data-record-id');
      row.querySelectorAll('[data-record-action]').forEach(function (node) {
        if (!node.getAttribute('data-record-id')) node.setAttribute('data-record-id', recordId);
      });
    });

    document.querySelectorAll('.detail-wrap').forEach(function (wrap) {
      const projectId = wrap.getAttribute('data-detail-for');
      wrap.querySelectorAll('[data-detail-action]').forEach(function (node) {
        if (!node.getAttribute('data-project-id')) node.setAttribute('data-project-id', projectId);
      });
    });
  }

  function render() {
    const state = currentState();
    const summary = summaryOf(state);
    renderTotal(state, summary);
    renderChart(state, summary);
    renderList(state, summary);
    decorateButtons();
    if (state.runtime && state.runtime.state) startClock();
    else stopClock();
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.home = {
    render: render,
    decorateButtons: decorateButtons,
    updateClocks: updateClocks,
    startClock: startClock,
    stopClock: stopClock
  };
})(typeof window !== 'undefined' ? window : globalThis);
