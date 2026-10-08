/**
 * 底部提示条（含"撤销"按钮与倒计时）。
 * 用于：停止计时后撤销、删除记录后撤销、各类操作反馈。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  let current = null;

  function host() {
    return document.getElementById('toast-host');
  }

  /**
   * 显示一条提示。
   * options: { text, detail, actionText, onAction, durationSec, tone }
   * 返回 { dismiss }
   */
  function show(options) {
    const opts = options || {};
    const container = host();
    if (!container) return { dismiss: function () { } };

    dismissCurrent();

    const children = [util.el('span', { text: opts.text || '' })];
    if (opts.detail) children.push(util.el('span', { class: 'spacer', text: opts.detail }));
    else children.push(util.el('span', { class: 'spacer' }));

    let timer = null;
    const record = { timer: null, onAction: opts.onAction || null };

    if (opts.actionText && typeof opts.onAction === 'function') {
      children.push(util.el('button', {
        class: 'undo',
        type: 'button',
        text: opts.actionText,
        onclick: function () {
          dismissCurrent();
          try {
            opts.onAction();
          } catch (err) {
            if (global.console && console.error) console.error('撤销操作失败：', err);
          }
        }
      }));
    }

    const node = util.el('div', { class: 'toast' + (opts.tone ? ' tone-' + opts.tone : '') }, children);
    container.appendChild(node);
    current = record;

    const duration = Math.max(1, Number(opts.durationSec) || 5) * 1000;
    record.timer = setTimeout(function () {
      if (current === record) current = null;
      if (node.parentNode) node.parentNode.removeChild(node);
    }, duration);

    return {
      dismiss: function () {
        if (record.timer) clearTimeout(record.timer);
        if (node.parentNode) node.parentNode.removeChild(node);
        if (current === record) current = null;
      }
    };
  }

  function dismissCurrent() {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    current = null;
    const container = host();
    if (container) util.clear(container);
  }

  function clearAll() {
    dismissCurrent();
    const container = host();
    if (container) util.clear(container);
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.toast = { show: show, dismissCurrent: dismissCurrent, clearAll: clearAll };
})(typeof window !== 'undefined' ? window : globalThis);
