/**
 * 浏览器下的路径占位实现（浏览器测试不读文件系统，只测运行时行为）。
 */
(function (global) {
  'use strict';
  if (!global.TT) global.TT = {};
  global.TT.ROOT = global.TT.ROOT || '.';
  global.TT.walk = function () { return []; };
})(window);
