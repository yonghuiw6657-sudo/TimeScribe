/**
 * 测试结果收集器 —— 在 test/*.test.js 之前加载。
 * Node 与浏览器共用同一套断言，避免"两边标准不一致"。
 *
 * 浏览器：用 selftest.html?p=P0 运行
 * Node  ：用 node tests/run-node-tests.mjs 运行（纯逻辑测试）
 */
(function (global) {
  'use strict';

  const suites = [];
  let current = null;

  async function defineSuite(phase, name, fn) {
    const suite = { phase: phase, name: name, tests: [] };
    suites.push(suite);
    current = suite;
    // 允许定义函数是 async（有些用例需要在开始前等 app 重启）
    try {
      await fn();
    } finally {
      current = null;
    }
  }

  function test(name, fn) {
    if (!current) throw new Error('test() 必须在 defineSuite() 内调用');
    current.tests.push({ name: name, fn: fn });
  }

  // ------------------------------------------------------------ assertions
  function fail(message) {
    throw new Error(message);
  }

  function ok(value, message) {
    if (!value) fail(message || '期望为真，实际为 ' + describe(value));
  }

  function notOk(value, message) {
    if (value) fail(message || '期望为假，实际为 ' + describe(value));
  }

  function equal(actual, expected, message) {
    if (actual !== expected) {
      fail((message || '值不相等') + ' — 期望 ' + describe(expected) + '，实际 ' + describe(actual));
    }
  }

  function notEqual(actual, expected, message) {
    if (actual === expected) {
      fail((message || '值不应相等') + ' — 两者都是 ' + describe(actual));
    }
  }

  function deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      fail((message || '结构不相等') + ' — 期望 ' + b + '，实际 ' + a);
    }
  }

  function almost(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      fail((message || '数值超出容差') + ' — 期望 ' + expected + '±' + tolerance + '，实际 ' + actual);
    }
  }

  function throws(fn, message) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) fail(message || '期望抛出异常，但没有');
  }

  function contains(haystack, needle, message) {
    if (String(haystack).indexOf(needle) === -1) {
      fail((message || '未包含期望内容') + ' — 在 ' + describe(haystack) + ' 中找不到 ' + describe(needle));
    }
  }

  function notContains(haystack, needle, message) {
    if (String(haystack).indexOf(needle) !== -1) {
      fail((message || '不应包含该内容') + ' — 在 ' + describe(haystack) + ' 中出现了 ' + describe(needle));
    }
  }

  function describe(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  // ---------------------------------------------------------------- runner
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function run(phase) {
    const wanted = (!phase || String(phase).toUpperCase() === 'ALL') ? null : String(phase).toUpperCase();
    const results = [];
    const list = suites.filter(function (s) { return !wanted || s.phase === wanted; });
    for (const suite of list) {
      for (const t of suite.tests) {
        const row = { phase: suite.phase, suite: suite.name, test: t.name, passed: false, message: '' };
        try {
          await t.fn();
          row.passed = true;
        } catch (err) {
          row.passed = false;
          row.message = (err && err.message) ? err.message : String(err);
        }
        results.push(row);
      }
    }
    return results;
  }

  function summarize(results) {
    const failed = results.filter(function (r) { return !r.passed; });
    return {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed
    };
  }

  global.TTTest = {
    defineSuite: defineSuite,
    test: test,
    ok: ok,
    notOk: notOk,
    equal: equal,
    notEqual: notEqual,
    deepEqual: deepEqual,
    almost: almost,
    throws: throws,
    contains: contains,
    notContains: notContains,
    describe: describe,
    sleep: sleep,
    run: run,
    summarize: summarize,
    suites: suites
  };
})(typeof window !== 'undefined' ? window : globalThis);
