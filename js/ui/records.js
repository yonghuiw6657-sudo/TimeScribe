/**
 * 记录管理：项目时间明细、手动补录、修改、删除（两步确认 + 撤销）。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  const calc = global.TTCalc;
  const form = global.TTUI ? global.TTUI.form : null;
  const modal = global.TTUI ? global.TTUI.modal : null;

  const PENDING_DELETE_MS = 3000;
  let pendingDeleteId = null;
  let pendingDeleteTimer = null;

  function store() { return global.TTStore; }

  function recordsOf(state, projectId) {
    return state.records
      .filter(function (r) { return r.projectId === projectId; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        const at = a.startAt || a.createdAt || '';
        const bt = b.startAt || b.createdAt || '';
        if (at !== bt) return at < bt ? 1 : -1;
        return 0;
      });
  }

  function totalsOf(records) {
    return records.reduce(function (acc, r) {
      acc.activeSec += r.activeSec;
      acc.pausedSec += r.pausedSec;
      if (r.source === 'manual') { acc.manualSec += r.activeSec; acc.manualCount += 1; }
      else { acc.timerSec += r.activeSec; acc.timerCount += 1; }
      return acc;
    }, { activeSec: 0, pausedSec: 0, manualSec: 0, timerSec: 0, manualCount: 0, timerCount: 0 });
  }

  function projectPath(state, projectId) {
    const p = state.projects.filter(function (x) { return x.id === projectId; })[0];
    if (!p) return '未知项目';
    if (!p.parentId) return p.name;
    const parent = state.projects.filter(function (x) { return x.id === p.parentId; })[0];
    return (parent ? parent.name + ' → ' : '') + p.name;
  }

  // ---------------------------------------------------------------- 明细弹窗
  let handle = null;
  let detailProjectId = null;

  function openDetail(projectId) {
    const state = store().getState();
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return;

    detailProjectId = projectId;
    handle = modal.open({
      title: projectPath(state, projectId) + ' · 时间明细',
      width: 720,
      body: [buildDetailBody(projectId)],
      buttons: [
        { text: '关闭', kind: '' }
      ],
      onClose: function () {
        handle = null;
        detailProjectId = null;
        clearPendingDelete();
      }
    });
    return handle;
  }

  function buildDetailBody(projectId) {
    const state = store().getState();
    const records = recordsOf(state, projectId);
    const totals = totalsOf(records);

    const wrap = util.el('div', { class: 'detail-wrap', 'data-detail-for': projectId });

    // 顶部操作条
    const bar = util.el('div', { class: 'detail-bar' }, [
      util.el('button', {
        type: 'button', class: 'btn primary tiny', 'data-detail-action': 'add-record',
        'data-project-id': projectId, text: '＋ 手动补一条'
      }),
      util.el('span', {
        class: 'detail-summary',
        text: '合计 ' + calc.fmtDuration(totals.activeSec) +
          '（计时 ' + calc.fmtDuration(totals.timerSec) +
          ' · 手动补录 ' + calc.fmtDuration(totals.manualSec) + '）'
      })
    ]);
    wrap.appendChild(bar);

    if (records.length === 0) {
      wrap.appendChild(util.el('div', { class: 'empty-state small' }, [
        util.el('div', { class: 'empty-sub', text: '这个项目还没有时间记录' })
      ]));
      return wrap;
    }

    const table = util.el('div', { class: 'rlist' });
    table.appendChild(util.el('div', { class: 'rhead' }, [
      util.el('span', { class: 'c1', text: '日期' }),
      util.el('span', { class: 'c2', text: '时间段' }),
      util.el('span', { class: 'c3', text: '投入' }),
      util.el('span', { class: 'c4', text: '暂停' }),
      util.el('span', { class: 'c5', text: '专注度' }),
      util.el('span', { class: 'c6', text: '备注' }),
      util.el('span', { class: 'c7', text: '操作' })
    ]));

    records.forEach(function (r) {
      const isManual = r.source === 'manual';
      const period = isManual
        ? '手动补录'
        : (util.fmtTimeOfDay(r.startAt) || '?') + '–' + (util.fmtTimeOfDay(r.endAt) || '?');
      // 手动补录没有暂停数据，focusText(投入, 0) 恒等于 100%，显示出来会和卡片上
      // "手动补录不参与专注度"的说法自相矛盾，所以这里直接给 —。
      const focus = isManual ? null : calc.focusText(r.activeSec, r.pausedSec);
      const row = util.el('div', { class: 'rrow', 'data-record-id': r.id }, [
        util.el('span', { class: 'c1', text: util.fmtDateLabel(r.date) }),
        util.el('span', { class: 'c2', text: period }),
        util.el('span', { class: 'c3', text: calc.fmtDuration(r.activeSec) }),
        util.el('span', { class: 'c4', text: isManual ? '—' : calc.fmtDuration(r.pausedSec) }),
        util.el('span', { class: 'c5', text: focus || '—' }),
        util.el('span', { class: 'c6', text: r.note || '（无）' }),
        util.el('span', { class: 'c7' }, [
          util.el('button', {
            type: 'button', class: 'btn ghost tiny', 'data-record-action': 'edit',
            'data-record-id': r.id, text: '改'
          }),
          util.el('button', {
            type: 'button', class: 'btn ghost tiny',
            'data-record-action': 'delete',
            'data-record-id': r.id,
            text: pendingDeleteId === r.id ? '确认删除' : '删'
          })
        ])
      ]);
      table.appendChild(row);
    });

    const totalRow = util.el('div', { class: 'rrow total' }, [
      util.el('span', { class: 'c1', style: { flex: '0 0 204px' }, text: '合计' }),
      util.el('span', { class: 'c3', text: calc.fmtDuration(totals.activeSec) }),
      util.el('span', { class: 'c6', text: '手动补录 ' + calc.fmtDuration(totals.manualSec) + ' · 计时 ' + calc.fmtDuration(totals.timerSec) })
    ]);
    table.appendChild(totalRow);
    wrap.appendChild(table);

    return wrap;
  }

  function refreshDetail() {
    if (!handle || !detailProjectId) return;
    handle.setBody([buildDetailBody(detailProjectId)]);
  }

  // ------------------------------------------------------------ 手动补录/修改
  /**
   * 两种补录入口（「手动补一条」与卡片上的「＋加时间」）共用这一条写入路径，
   * 保证记录字段口径不会各写各的。
   */
  function commitManualRecord(projectId, date, activeSec, note) {
    const record = {
      id: calc.makeId('rec'),
      projectId: projectId,
      date: date,
      startAt: null,
      endAt: null,
      activeSec: activeSec,
      pausedSec: 0,
      note: note,
      source: 'manual',
      createdAt: new Date().toISOString()
    };
    store().commit(function (s) {
      s.records.push(record);
      return s;
    });
    return record;
  }

  function removeRecordById(recordId) {
    store().commit(function (s) {
      s.records = s.records.filter(function (r) { return r.id !== recordId; });
      return s;
    });
  }

  // ------------------------------------------------------------ 快速加时间
  /** 预设时长（分钟）。只把数字填进输入框，不直接保存。 */
  const QUICK_PRESETS = [15, 30, 60, 120];

  function presetLabel(min) {
    if (min < 60) return min + ' 分';
    return (min / 60) + ' 小时';
  }

  /**
   * 卡片上的「＋加时间」：不用开计时，直接补一段投入时长。
   *
   * 存的是 source:'manual' 记录——和「手动补一条」完全同一种数据，因此自动满足：
   * 计入累计/今天/本周与扇形图，但不参与专注度，也不受最短时长阈值限制。
   * 两者差别只在界面：这里不用选项目（卡片已经指明了），多了几个快捷时长。
   */
  function openQuickAdd(projectId) {
    const state = store().getState();
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return null;

    const durationField = form.field('要加多久', util.el('div', { class: 'duo-inline' }, [
      form.numberInput({ name: 'hours', value: '', min: 0, max: 24 }),
      util.el('span', { class: 'unit', text: '小时' }),
      form.numberInput({ name: 'minutes', value: '', min: 0, max: 59 }),
      util.el('span', { class: 'unit', text: '分' })
    ]));

    const presetRow = util.el('div', { class: 'preset-row' }, QUICK_PRESETS.map(function (min) {
      return util.el('button', {
        type: 'button', class: 'preset-chip', 'data-preset-min': String(min),
        text: '+' + presetLabel(min)
      });
    }));

    const body = [
      form.field('记在哪个项目', util.el('div', {
        class: 'readonly-field', text: projectPath(state, projectId)
      })),
      form.field('记在哪一天', form.textInput({
        name: 'date', value: calc.todayStr(), placeholder: 'YYYY-MM-DD'
      })),
      util.el('div', { class: 'quick-time' }, [durationField, presetRow]),
      form.field('备注（可不写）', form.textArea({
        name: 'note', value: '', maxlength: global.TTProjects.NOTE_MAX
      })),
      form.warn('加时间只补投入时长，不受「不足 ' + describeThreshold(state.settings.minSeconds) +
        '不计入」的限制，也不参与专注度计算。')
    ];

    const handle = modal.open({
      title: '加时间 · ' + projectPath(state, projectId),
      body: body,
      buttons: [
        { text: '取消', kind: '' },
        {
          text: '确定',
          kind: 'primary',
          closeAfter: false,
          onClick: function (close) {
            const root = modal.topRoot();
            const values = readRecordForm(root);
            values.projectId = projectId;   // 项目由卡片决定，表单里没有这个控件
            if (!store().getState().projects.some(function (p) { return p.id === projectId; })) {
              showError(root, '这个项目已经被删除了，不能再加时间');
              return false;
            }
            const check = validateRecordInput(values, null);
            if (!check.ok) {
              showError(root, check.reason);
              return false;
            }
            const record = commitManualRecord(projectId, values.date, check.activeSec, values.note);
            global.TTUI.toast.show({
              text: '已加 ' + calc.fmtDuration(check.activeSec),
              detail: projectPath(store().getState(), projectId) + ' · ' + values.date,
              actionText: '撤销',
              durationSec: store().getState().settings.undoSeconds,
              onAction: function () {
                removeRecordById(record.id);   // 只删刚加的这条，别的记录不受影响
                refreshDetail();
                global.TTUI.toast.show({ text: '已撤销刚才的增加', durationSec: 3 });
              }
            });
            close();
            refreshDetail();   // 明细弹窗没开着时是空操作
            return true;
          }
        }
      ]
    });

    // 预设药丸和手填数字都实时刷新主按钮文案；真正的保存只由主按钮触发。
    const root = handle.node;
    const hoursNode = root.querySelector('[data-field="hours"]');
    const minutesNode = root.querySelector('[data-field="minutes"]');
    const primary = root.querySelector('.mf .btn.primary');

    function syncLabel() {
      const sec = Math.round((Number(hoursNode.value) || 0) * 3600 + (Number(minutesNode.value) || 0) * 60);
      if (primary) primary.textContent = sec > 0 ? '加 ' + calc.fmtDuration(sec) : '确定';
    }

    root.querySelectorAll('.preset-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const min = Number(chip.getAttribute('data-preset-min')) || 0;
        hoursNode.value = String(Math.floor(min / 60));
        minutesNode.value = String(min % 60);
        syncLabel();
      });
    });
    [hoursNode, minutesNode].forEach(function (n) {
      n.addEventListener('input', syncLabel);
      n.addEventListener('change', syncLabel);
    });
    syncLabel();

    // modal.open 默认聚焦第一个输入框（也就是日期）。这个弹窗的主路径是"填时长"，
    // 直接把光标落到小时框上，省掉一次点击——少点一下正是这个功能的全部意义。
    if (hoursNode && hoursNode.focus) hoursNode.focus();

    return handle;
  }

  function openRecordForm(options) {
    const opts = options || {};
    const state = store().getState();
    const editing = opts.record || null;

    const candidates = state.projects.map(function (p) {
      return { value: p.id, label: projectPath(state, p.id) };
    });

    const projectId = editing ? editing.projectId : (opts.projectId || (candidates[0] && candidates[0].value));
    const today = calc.todayStr();

    const hours = editing ? Math.floor(editing.activeSec / 3600) : 0;
    const minutes = editing ? Math.round((editing.activeSec % 3600) / 60) : 0;

    const body = [];
    if (!editing) {
      // 只有"补录"才需要选项目；修改时不允许改归属，否则统计会错乱
      body.push(form.field('记在哪个项目', form.select({
        name: 'projectId', value: projectId, options: candidates
      })));
    }
    if (editing) {
      body.push(form.field('记在哪个项目', util.el('div', {
        class: 'readonly-field',
        text: projectPath(state, editing.projectId) + '（修改时不能改归属）'
      })));
    }

    body.push(util.el('div', { class: 'duo' }, [
      form.field('日期', form.textInput({
        name: 'date', value: editing ? editing.date : today, placeholder: 'YYYY-MM-DD'
      })),
      form.field('投入', util.el('div', { class: 'duo-inline' }, [
        form.numberInput({ name: 'hours', value: hours, min: 0, max: 24 }),
        util.el('span', { class: 'unit', text: '小时' }),
        form.numberInput({ name: 'minutes', value: minutes, min: 0, max: 59 }),
        util.el('span', { class: 'unit', text: '分' })
      ]))
    ]));
    body.push(form.field('备注（可不写）', form.textArea({
      name: 'note', value: editing ? editing.note : '', maxlength: global.TTProjects.NOTE_MAX
    })));
    body.push(form.warn('手动补录不受「不足 ' + describeThreshold(state.settings.minSeconds) +
      '不计入」的限制，填多少就记多少；它不参与专注度计算。'));

    modal.open({
      title: editing ? '修改记录' : '手动补一条记录',
      body: body,
      buttons: [
        { text: '取消', kind: '' },
        {
          text: '保存',
          kind: 'primary',
          closeAfter: false,
          onClick: function (close) {
            const root = modal.topRoot();
            const values = readRecordForm(root);
            if (editing) values.projectId = editing.projectId;   // 归属不可改
            const check = validateRecordInput(values, editing);
            if (!check.ok) {
              showError(root, check.reason);
              return false;
            }
            if (editing) {
              store().commit(function (s) {
                const target = s.records.filter(function (r) { return r.id === editing.id; })[0];
                if (target) {
                  target.date = values.date;
                  target.activeSec = check.activeSec;
                  target.note = values.note;
                }
                return s;
              });
              global.TTUI.toast.show({ text: '记录已修改', durationSec: 3 });
            } else {
              commitManualRecord(values.projectId, values.date, check.activeSec, values.note);
              global.TTUI.toast.show({
                text: '已补录 ' + calc.fmtDuration(check.activeSec),
                detail: projectPath(store().getState(), values.projectId) + ' · ' + values.date,
                durationSec: 4
              });
            }
            close();
            refreshDetail();
            return true;
          }
        }
      ]
    });
  }

  function readRecordForm(root) {
    const dateNode = root.querySelector('[data-field="date"]');
    const noteNode = root.querySelector('[data-field="note"]');
    const projectNode = root.querySelector('[data-field="projectId"]');
    const hoursNode = root.querySelector('[data-field="hours"]');
    const minutesNode = root.querySelector('[data-field="minutes"]');
    return {
      projectId: projectNode ? projectNode.value : null,
      date: dateNode ? String(dateNode.value).trim() : '',
      hours: hoursNode ? Number(hoursNode.value || 0) : 0,
      minutes: minutesNode ? Number(minutesNode.value || 0) : 0,
      note: noteNode ? String(noteNode.value).trim().slice(0, global.TTProjects.NOTE_MAX) : ''
    };
  }

  function validateRecordInput(values, editing) {
    const activeSec = Math.round((Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60);
    if (!values.projectId) return { ok: false, reason: '请选择项目' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) return { ok: false, reason: '日期格式应为 2025-06-11' };
    const parsed = calc.parseDateStr(values.date);
    if (!parsed) return { ok: false, reason: '日期不合法' };
    const today = calc.todayStr();
    if (values.date > today) return { ok: false, reason: '不能补录未来的日期' };
    if (activeSec <= 0) return { ok: false, reason: '投入时长要大于 0' };
    if (activeSec > 24 * 3600) return { ok: false, reason: '单条记录不能超过 24 小时' };
    return { ok: true, activeSec: activeSec };
  }

  function showError(root, message) {
    const existing = root.querySelector('.form-error');
    if (existing) existing.parentNode.removeChild(existing);
    const box = util.el('div', { class: 'form-error', text: message });
    const body = root.querySelector('.mb');
    if (body) body.insertBefore(box, body.firstChild);
  }

  function describeThreshold(sec) {
    if (!sec) return '0 分钟';
    if (sec < 60) return sec + ' 秒';
    return Math.round(sec / 60) + ' 分钟';
  }

  // ------------------------------------------------------------------ 删除
  function clearPendingDelete() {
    pendingDeleteId = null;
    if (pendingDeleteTimer) {
      clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = null;
    }
  }

  function requestDelete(recordId) {
    const state = store().getState();
    const record = state.records.filter(function (r) { return r.id === recordId; })[0];
    if (!record) return;

    if (pendingDeleteId !== recordId) {
      // 第一次点击：进入"确认删除"状态
      pendingDeleteId = recordId;
      if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = setTimeout(function () {
        clearPendingDelete();
        refreshDetail();
      }, PENDING_DELETE_MS);
      refreshDetail();
      const btn = document.querySelector('[data-record-action="delete"][data-record-id="' + recordId + '"]');
      if (btn) btn.textContent = '确认删除';
      return;
    }

    // 第二次点击：执行删除
    clearPendingDelete();
    let removed = null;
    store().commit(function (s) {
      removed = s.records.filter(function (r) { return r.id === recordId; })[0] || null;
      s.records = s.records.filter(function (r) { return r.id !== recordId; });
      return s;
    });

    if (removed) {
      global.TTUI.toast.show({
        text: '已删掉 1 条记录',
        detail: calc.fmtDuration(removed.activeSec) + ' · ' + util.fmtDateLabel(removed.date),
        actionText: '撤销',
        durationSec: store().getState().settings.undoSeconds,
        onAction: function () {
          store().commit(function (s) {
            s.records.push(removed);   // 放回数组末尾，明细按日期排序展示，位置不受影响
            return s;
          });
          refreshDetail();
          global.TTUI.toast.show({ text: '已恢复那条记录', durationSec: 3 });
        }
      });
    }
    refreshDetail();
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.records = {
    openDetail: openDetail,
    refreshDetail: refreshDetail,
    openRecordForm: openRecordForm,
    openQuickAdd: openQuickAdd,
    requestDelete: requestDelete,
    clearPendingDelete: clearPendingDelete,
    recordsOf: recordsOf,
    totalsOf: totalsOf,
    projectPath: projectPath,
    validateRecordInput: validateRecordInput
  };
})(typeof window !== 'undefined' ? window : globalThis);
