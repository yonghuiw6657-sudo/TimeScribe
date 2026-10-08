/**
 * Node 与浏览器共用的路径与文件工具。
 * Node 下由 tests/run-node-tests.mjs 注入真实实现；
 * 浏览器下由 tests/root.browser.js 提供同名接口（浏览器测试不读文件系统）。
 */
(function (global) {
  'use strict';
  if (!global.TT) global.TT = {};
  if (!global.TT.ROOT) global.TT.ROOT = '.';
})(typeof window !== 'undefined' ? window : globalThis);
