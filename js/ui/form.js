/**
 * 弹窗表单（新建/编辑项目、手动补录、修改记录、设置）共用的控件工具。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;

  function field(labelText, control) {
    return util.el('div', { class: 'field' }, [
      util.el('label', { text: labelText }),
      control
    ]);
  }

  function textInput(options) {
    const opts = options || {};
    return util.el('input', {
      type: 'text',
      class: 'input',
      id: opts.id,
      value: opts.value === undefined || opts.value === null ? '' : opts.value,
      placeholder: opts.placeholder || '',
      maxlength: opts.maxlength || null,
      'data-field': opts.name
    });
  }

  function numberInput(options) {
    const opts = options || {};
    return util.el('input', {
      type: 'number',
      class: 'input',
      id: opts.id,
      value: opts.value === undefined || opts.value === null ? '' : opts.value,
      min: opts.min === undefined ? null : opts.min,
      max: opts.max === undefined ? null : opts.max,
      step: opts.step || 1,
      'data-field': opts.name
    });
  }

  function textArea(options) {
    const opts = options || {};
    return util.el('textarea', {
      class: 'input',
      id: opts.id,
      rows: opts.rows || 2,
      maxlength: opts.maxlength || null,
      placeholder: opts.placeholder || '',
      'data-field': opts.name,
      text: opts.value || ''
    });
  }

  function select(options) {
    const opts = options || {};
    const node = util.el('select', { class: 'input', id: opts.id, 'data-field': opts.name });
    (opts.options || []).forEach(function (o) {
      node.appendChild(util.el('option', {
        value: o.value,
        text: o.label,
        selected: String(o.value) === String(opts.value)
      }));
    });
    return node;
  }

  function colorPicker(options) {
    const opts = options || {};
    const wrap = util.el('div', { class: 'color-row', 'data-field': opts.name });
    util.PALETTE.forEach(function (c) {
      wrap.appendChild(util.el('button', {
        type: 'button',
        class: 'color-dot' + (c.value === opts.value ? ' active' : ''),
        title: c.name,
        'data-color': c.value,
        style: { background: c.value }
      }));
    });
    // 当前颜色不在预设里时，补一个自定义色点
    const known = util.PALETTE.some(function (c) { return c.value === opts.value; });
    if (opts.value && !known) {
      wrap.appendChild(util.el('button', {
        type: 'button',
        class: 'color-dot active',
        'data-color': opts.value,
        style: { background: opts.value }
      }));
    }
    return wrap;
  }

  function warn(text) {
    return util.el('div', { class: 'warn', text: text });
  }

  /** 从弹窗节点里读出一个字段的值。 */
  function readField(root, name) {
    const node = root.querySelector('[data-field="' + name + '"]');
    if (!node) return null;
    if (node.classList && node.classList.contains('color-row')) {
      const active = node.querySelector('.color-dot.active');
      return active ? active.getAttribute('data-color') : null;
    }
    return node.value;
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.form = {
    field: field,
    textInput: textInput,
    numberInput: numberInput,
    textArea: textArea,
    select: select,
    colorPicker: colorPicker,
    warn: warn,
    readField: readField
  };
})(typeof window !== 'undefined' ? window : globalThis);
