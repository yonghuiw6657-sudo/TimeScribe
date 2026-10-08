/**
 * 小工具：DOM 构建、时间格式化快捷方式、调色板。
 */
(function (global) {
  'use strict';

  const PALETTE = [
    { name: '蓝色', value: '#3b82f6' },
    { name: '绿色', value: '#10b981' },
    { name: '橙色', value: '#f59e0b' },
    { name: '紫色', value: '#8b5cf6' },
    { name: '玫红', value: '#f43f5e' },
    { name: '青色', value: '#06b6d4' },
    { name: '青柠', value: '#84cc16' },
    { name: '深橙', value: '#f97316' }
  ];

  /** 第 n 个项目的颜色：前 8 个用预设，之后按色相旋转生成，保证不撞色。 */
  function pickColor(index) {
    const i = Math.max(0, Number(index) || 0);
    if (i < PALETTE.length) return PALETTE[i].value;
    const hue = Math.round((i * 47) % 360);
    return 'hsl(' + hue + ', 65%, 52%)';
  }

  /**
   * 创建一个元素。
   * el('div', { class: 'card', onclick: fn }, [child1, '文字'])
   */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset' && typeof value === 'object') {
          Object.assign(node.dataset, value);
        } else {
          node.setAttribute(key, value);
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach(function (c) { appendChildren(node, c); });
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children.nodeType) node.appendChild(children);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  /** 把 YYYY-MM-DD 显示成「06-11 周三」。 */
  function fmtDateLabel(dateStr) {
    const C = global.TTCalc;
    const d = C.parseDateStr(dateStr);
    if (!d) return dateStr;
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    const mm = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);
    return mm + '-' + dd + ' ' + wd;
  }

  function fmtTimeOfDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hh = ('0' + d.getHours()).slice(-2);
    const mm = ('0' + d.getMinutes()).slice(-2);
    return hh + ':' + mm;
  }

  global.TTUtil = {
    PALETTE: PALETTE,
    pickColor: pickColor,
    el: el,
    clear: clear,
    $: $,
    fmtDateLabel: fmtDateLabel,
    fmtTimeOfDay: fmtTimeOfDay
  };
})(typeof window !== 'undefined' ? window : globalThis);
