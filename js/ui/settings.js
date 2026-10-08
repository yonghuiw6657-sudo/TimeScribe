/**
 * 设置弹窗：最短计时阈值、撤销时长、扇形图显示层级。
 */
(function (global) {
  'use strict';

  const form = global.TTUI.form;
  const modal = global.TTUI.modal;

  function store() { return global.TTStore; }

  function open() {
    const state = store().getState();
    const settings = state.settings;

    const body = [
      form.field('不足多少时间不计入（默认 2 分钟）',
        form.numberInput({ name: 'minMinutes', value: Math.round((settings.minSeconds || 0) / 60), min: 0, max: 60 })),
      form.warn('单段实际投入低于这个时长就整段丢弃（暂停的时间也一起丢）。手动补录不受此限制。改动只影响之后的计时。'),
      form.field('计时停止后，可撤销的时间（秒）',
        form.numberInput({ name: 'undoSeconds', value: settings.undoSeconds, min: 3, max: 30 })),
      form.field('扇形图显示到哪一层',
        form.select({
          name: 'chartScope',
          value: settings.chartScope,
          options: [
            { value: 'parent', label: '只显示父项目（子项目归到父项目里）' },
            { value: 'child', label: '显示子项目明细（后续版本）' }
          ]
        }))
    ];

    modal.open({
      title: '设置',
      body: body,
      buttons: [
        { text: '取消', kind: '' },
        {
          text: '保存',
          kind: 'primary',
          closeAfter: false,
          onClick: function (close) {
            const root = modal.topRoot();
            const minNode = root.querySelector('[data-field="minMinutes"]');
            const undoNode = root.querySelector('[data-field="undoSeconds"]');
            const scopeNode = root.querySelector('[data-field="chartScope"]');

            const minMinutes = Number(minNode && minNode.value);
            const undoSeconds = Number(undoNode && undoNode.value);

            if (!isFinite(minMinutes) || minMinutes < 0 || minMinutes > 60) {
              showError(root, '阈值应在 0 到 60 分钟之间');
              return false;
            }
            if (!isFinite(undoSeconds) || undoSeconds < 3 || undoSeconds > 30) {
              showError(root, '撤销时长应在 3 到 30 秒之间');
              return false;
            }

            store().commit(function (s) {
              s.settings.minSeconds = Math.round(minMinutes * 60);
              s.settings.undoSeconds = Math.round(undoSeconds);
              if (scopeNode) s.settings.chartScope = scopeNode.value;
              return s;
            });
            close();
            global.TTUI.toast.show({ text: '设置已保存', durationSec: 3 });
            return true;
          }
        }
      ]
    });
  }

  function showError(root, message) {
    const existing = root.querySelector('.form-error');
    if (existing) existing.parentNode.removeChild(existing);
    const box = global.TTUtil.el('div', { class: 'form-error', text: message });
    const body = root.querySelector('.mb');
    if (body) body.insertBefore(box, body.firstChild);
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.settings = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
