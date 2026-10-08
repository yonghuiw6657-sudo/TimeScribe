/**
 * 弹窗容器。
 *
 * 规则（PRD 2.3、6）：
 * - 同一时刻只允许一个弹窗；允许"明细 → 补录/修改"这一条叠放链路。
 * - Esc 关闭（等于取消）；点遮罩不关闭，避免误触丢输入。
 * - 打开时焦点落到第一个输入框。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  let stack = [];

  function host() {
    return document.getElementById('modal-host');
  }

  /**
   * 打开弹窗。
   * options: { title, body: [nodes], buttons: [{text, kind, onClick, closeAfter}],
   *            width, onClose }
   * 返回 { close, setBody, node }
   */
  function open(options) {
    const opts = options || {};
    const container = host();
    const modal = util.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    if (opts.width) modal.style.width = opts.width + 'px';

    const titleId = 'modal-title-' + (stack.length + 1);
    const head = util.el('div', { class: 'mh', id: titleId, text: opts.title || '' });
    const body = util.el('div', { class: 'mb' }, opts.body || []);
    const foot = util.el('div', { class: 'mf' });

    const entry = { node: modal, onClose: opts.onClose || null, body: body };
    stack.push(entry);

    function close(result) {
      const index = stack.indexOf(entry);
      if (index === -1) return;
      stack.splice(index, 1);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      if (stack.length === 0 && container) {
        container.hidden = true;
        util.clear(container);
      }
      if (entry.onClose) entry.onClose(result);
    }
    entry.close = close;

    for (const btn of (opts.buttons || [])) {
      foot.appendChild(util.el('button', {
        type: 'button',
        class: 'btn ' + (btn.kind === 'primary' ? 'primary' : (btn.kind || '')),
        text: btn.text,
        onclick: function () {
          const r = btn.onClick ? btn.onClick(close) : undefined;
          if (btn.closeAfter !== false && r !== false) close(r);
        }
      }));
    }

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);

    if (container) {
      container.hidden = false;
      container.appendChild(modal);
    }

    // 焦点落到第一个可输入元素
    const focusTarget = modal.querySelector('input, select, textarea, button.primary');
    if (focusTarget && focusTarget.focus) focusTarget.focus();

    return {
      close: close,
      node: modal,
      setBody: function (children) {
        util.clear(body);
        (children || []).forEach(function (c) { body.appendChild(c); });
      }
    };
  }

  function topEntry() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  /** 当前最上层弹窗的 DOM 节点（弹窗可叠放：明细之上再开补录/修改）。 */
  function topNode() {
    const entry = topEntry();
    return entry ? entry.node : null;
  }

  /** 当前最上层弹窗的根节点，供表单读取字段用。 */
  function topRoot() {
    return topNode();
  }

  function closeTop() {
    const entry = topEntry();
    if (entry) entry.close();
  }

  function closeAll() {
    while (stack.length) closeTop();
  }

  function depth() {
    return stack.length;
  }

  function isOpen() {
    return stack.length > 0;
  }

  // Esc 关闭最上层
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && stack.length) {
      e.preventDefault();
      closeTop();
    }
  });

  global.TTUI = global.TTUI || {};
  global.TTUI.modal = {
    open: open,
    closeTop: closeTop,
    closeAll: closeAll,
    depth: depth,
    isOpen: isOpen,
    topRoot: topRoot
  };
})(typeof window !== 'undefined' ? window : globalThis);
