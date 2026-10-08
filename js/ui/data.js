/**
 * 数据安全：导出备份、导入恢复、导入前快照与回退。
 *
 * 规则（PRD 7.3–7.5）：
 * - 导出：JSON 文件，文件名带本地时间。
 * - 导入：先校验 → 自动保存当前数据快照 → 弹确认（写清条数与时长）→ 才覆盖。
 * - 导入后可以"恢复导入前的数据"。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  const calc = global.TTCalc;

  const SNAPSHOT_KEY = 'timescribe.backup.beforeImport';
  const LEGACY_SNAPSHOT_KEY = 'timetracker.backup.beforeImport';

  function store() { return global.TTStore; }
  function storage() { return global.TTStorage; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function exportFileName(now) {
    const d = now || new Date();
    const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    return 'TimeScribe-' + stamp + '.json';
  }

  /** 生成导出内容（纯函数，便于测试）。 */
  function buildExportPayload(now) {
    const state = store().getState();
    const payload = storage().buildExport(state, (now || new Date()).toISOString());
    payload.stats = {
      projectCount: state.projects.length,
      recordCount: state.records.length,
      totalSec: state.records.reduce(function (sum, r) { return sum + r.activeSec; }, 0)
    };
    return payload;
  }

  function exportNow() {
    const state = store().getState();
    if (state.projects.length === 0 && state.records.length === 0) {
      global.TTUI.toast.show({ text: '暂无可导出的数据', durationSec: 4, tone: 'warn' });
      return { ok: false, reason: 'empty' };
    }

    const payload = buildExportPayload(new Date());
    const text = JSON.stringify(payload, null, 2);
    downloadText(text, exportFileName());
    global.__TT_LAST_EXPORT__ = text;

    global.TTUI.toast.show({
      text: '已导出 ' + payload.stats.recordCount + ' 条记录、' + payload.stats.projectCount + ' 个项目',
      detail: '合计 ' + calc.fmtDuration(payload.stats.totalSec) + '　建议保存到「备份」文件夹',
      durationSec: 6
    });
    return { ok: true, payload: payload, fileName: exportFileName() };
  }

  function downloadText(text, fileName) {
    try {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      if (global.console) console.error('导出失败：', err);
      global.TTUI.toast.show({ text: '导出失败：' + err.message, tone: 'warn', durationSec: 6 });
    }
  }

  // ------------------------------------------------------------------ 导入
  function openImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      if (file) readFile(file);
      setTimeout(function () {
        if (input.parentNode) input.parentNode.removeChild(input);
      }, 500);
    });
    input.click();
    return input;
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      importFromText(String(reader.result || ''));
    };
    reader.onerror = function () {
      global.TTUI.toast.show({ text: '文件读取失败', tone: 'warn', durationSec: 5 });
    };
    reader.readAsText(file, 'utf-8');
  }

  /** 从文本导入（弹窗流程）。返回 { ok, reason }。 */
  function importFromText(text) {
    const validated = storage().validateImport(text);
    if (!validated.ok) {
      global.TTUI.toast.show({
        text: '导入失败：' + validated.reason,
        detail: '当前数据未做任何改动',
        tone: 'warn',
        durationSec: 8
      });
      return { ok: false, reason: validated.reason };
    }

    const data = validated.data;
    const recordCount = data.records.length;
    const projectCount = data.projects.length;
    const totalSec = data.records.reduce(function (sum, r) { return sum + r.activeSec; }, 0);
    const droppedCount = (validated.dropped.projects || 0) + (validated.dropped.records || 0);

    // 导入前自动保存当前数据的完整快照
    const snapshotSaved = saveSnapshot();

    const lines = [
      '文件包含 ' + projectCount + ' 个项目、' + recordCount + ' 条记录，累计 ' + calc.fmtDuration(totalSec) + '。',
      '导入将覆盖当前的全部数据。',
      snapshotSaved ? '当前数据已自动备份，导入后可以退回。' : '注意：当前数据备份失败，导入后无法退回。'
    ];
    if (droppedCount > 0) {
      lines.push('文件里有 ' + droppedCount + ' 条内容无法识别，将被跳过。');
    }

    const warnBox = global.TTUI.form.warn(lines.join('\n'));
    warnBox.style.whiteSpace = 'pre-line';

    global.TTUI.modal.open({
      title: '导入数据',
      body: [warnBox],
      buttons: [
        { text: '取消', kind: '' },
        {
          text: '确认导入',
          kind: 'primary',
          onClick: function () {
            applyImport(data);
          }
        }
      ]
    });

    return { ok: true, data: data };
  }

  function applyImport(data) {
    store().replaceState(data, { immediate: true });
    if (global.TTTimer && global.TTTimer.resetForTest) global.TTTimer.resetForTest();

    const recordCount = data.records.length;
    const totalSec = data.records.reduce(function (sum, r) { return sum + r.activeSec; }, 0);
    global.TTUI.toast.show({
      text: '导入完成：' + data.projects.length + ' 个项目、' + recordCount + ' 条记录',
      detail: '合计 ' + calc.fmtDuration(totalSec) + '　可点「撤销」退回导入前的数据',
      actionText: '撤销',
      durationSec: 10,
      onAction: restoreSnapshot
    });
    return { ok: true };
  }

  // ------------------------------------------------------------ 快照与回退
  function saveSnapshot() {
    try {
      // 防抖可能还没落盘，先把当前内存态写下去，否则快照会拿到旧数据（甚至空数据）
      store().flush();
      const raw = storage().readRaw();
      if (!raw) return false;
      localStorage.setItem(SNAPSHOT_KEY, raw);
      return true;
    } catch (err) {
      return false;
    }
  }

  function readSnapshot() {
    try {
      const current = localStorage.getItem(SNAPSHOT_KEY);
      if (current) return current;
      return localStorage.getItem(LEGACY_SNAPSHOT_KEY);
    } catch (err) {
      return null;
    }
  }

  function hasSnapshot() {
    return !!readSnapshot();
  }

  function restoreSnapshot() {
    const raw = readSnapshot();
    if (!raw) {
      global.TTUI.toast.show({ text: '没有可退回的备份', tone: 'warn', durationSec: 4 });
      return { ok: false, reason: 'no-snapshot' };
    }
    const validated = storage().validateImport(raw);
    if (!validated.ok) {
      global.TTUI.toast.show({ text: '备份无法读取：' + validated.reason, tone: 'warn', durationSec: 6 });
      return { ok: false, reason: validated.reason };
    }
    store().replaceState(validated.data, { immediate: true });
    clearSnapshot();
    global.TTUI.toast.show({ text: '已退回导入前的数据', durationSec: 4 });
    return { ok: true };
  }

  function clearSnapshot() {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
      localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
    } catch (err) { /* ignore */ }
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.data = {
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    exportFileName: exportFileName,
    buildExportPayload: buildExportPayload,
    exportNow: exportNow,
    openImport: openImport,
    importFromText: importFromText,
    applyImport: applyImport,
    saveSnapshot: saveSnapshot,
    hasSnapshot: hasSnapshot,
    restoreSnapshot: restoreSnapshot,
    clearSnapshot: clearSnapshot
  };
})(typeof window !== 'undefined' ? window : globalThis);
