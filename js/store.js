/**
 * 状态容器：内存态为唯一数据源 + 订阅重绘 + 防抖落盘。
 *
 * 约定（PRD 0.3 / 7.2）：
 * - 所有数据改动都走 commit()，commit 之后立即通知订阅者重绘，并防抖落盘。
 * - 页面隐藏/关闭时调用 flush()，保证最后一步操作不丢。
 * - 落盘失败（配额不足）通过 onQuotaError 回调提示用户导出备份，不静默吞掉。
 * - 秒表跳动**不经过这里**，避免每秒写盘。
 */
(function (global) {
  'use strict';

  const storage = global.TTStorage;
  const SAVE_DEBOUNCE_MS = 250;

  let state = storage.emptyData();
  let loadStatus = 'empty';
  let dirty = false;
  let timer = null;
  let lastError = null;
  const subscribers = [];
  const errorHandlers = [];

  // ------------------------------------------------------------------ 订阅
  function subscribe(fn) {
    if (typeof fn !== 'function') throw new Error('subscribe 需要函数');
    subscribers.push(fn);
    return function unsubscribe() {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  function onQuotaError(fn) {
    if (typeof fn === 'function') errorHandlers.push(fn);
  }

  function notify() {
    for (const fn of subscribers.slice()) {
      try {
        fn(state);
      } catch (err) {
        lastError = err;
        if (typeof console !== 'undefined' && console.error) {
          console.error('订阅者执行出错：', err);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 读写
  function getState() {
    return state;
  }

  function getLoadStatus() {
    return loadStatus;
  }

  function getLastError() {
    return lastError;
  }

  function isDirty() {
    return dirty;
  }

  function load() {
    const result = storage.loadAll();
    state = result.data;
    loadStatus = result.status;
    dirty = false;
    return result;
  }

  /** 立即落盘。返回 true 表示成功。 */
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return true;
    try {
      state.updatedAt = new Date().toISOString();
      storage.saveAll(state);
      dirty = false;
      lastError = null;
      return true;
    } catch (err) {
      lastError = err;
      if (storage.isQuotaError(err)) {
        for (const fn of errorHandlers.slice()) {
          try { fn(err, state); } catch (e) { /* ignore */ }
        }
      }
      return false;
    }
  }

  function scheduleSave() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 修改数据的唯一入口。
   * mutator(state) 可以直接改 state；如果返回非 undefined，则用返回值作为新 state。
   */
  function commit(mutator) {
    if (typeof mutator !== 'function') throw new Error('commit 需要函数');
    const returned = mutator(state);
    if (returned !== undefined) state = returned;
    scheduleSave();
    notify();
    return state;
  }

  /**
   * 修改数据但**不通知重绘**，只安排落盘。
   * 用于"心跳"这类只需要更新持久化快照、不需要重画界面的场景。
   */
  function patch(mutator) {
    if (typeof mutator !== 'function') throw new Error('patch 需要函数');
    const returned = mutator(state);
    if (returned !== undefined) state = returned;
    scheduleSave();
    return state;
  }

  /** 整体替换（导入时使用）。 */
  function replaceState(next, options) {
    const opts = options || {};
    state = next;
    dirty = true;
    if (opts.immediate !== false) flush();
    notify();
    return state;
  }

  /** 仅重置内存态（测试用）。 */
  function resetForTest(next) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    state = next || storage.emptyData();
    loadStatus = 'empty';
    dirty = false;
    lastError = null;
  }

  global.TTStore = {
    SAVE_DEBOUNCE_MS: SAVE_DEBOUNCE_MS,
    subscribe: subscribe,
    onQuotaError: onQuotaError,
    getState: getState,
    getLoadStatus: getLoadStatus,
    getLastError: getLastError,
    isDirty: isDirty,
    load: load,
    flush: flush,
    commit: commit,
    patch: patch,
    replaceState: replaceState,
    resetForTest: resetForTest
  };
})(typeof window !== 'undefined' ? window : globalThis);
