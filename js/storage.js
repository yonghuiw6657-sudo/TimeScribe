/**
 * 数据层：localStorage 读写、结构校验、导入校验、损坏恢复。
 *
 * 设计要点：
 * - 全部读写都经过这一层，任何地方都不许直接碰 localStorage。
 * - 存储后端可注入（Node 测试用内存实现），因此本文件同时可在 Node 与浏览器运行。
 * - 读取失败**不抛异常**：坏数据另存备份，然后返回一份干净的空数据，保证界面不白屏。
 */
(function (global) {
  'use strict';

  const DATA_KEY = 'timescribe.v1';
  const CORRUPT_PREFIX = 'timescribe.corrupt.';
  const LEGACY_PREFIX = 'timetracker.';
  const LEGACY_DATA_KEY = 'timetracker.v1';
  const LEGACY_CORRUPT_PREFIX = 'timetracker.corrupt.';
  const SCHEMA_VERSION = 1;
  const APP_TAG = 'timescribe';
  const LEGACY_APP_TAGS = ['time-tracker'];

  const DEFAULT_SETTINGS = {
    minSeconds: 120,        // 不足 2 分钟不计入
    undoSeconds: 5,         // 停止后撤销窗口
    chartScope: 'parent'    // 扇形图只按父项目分块
  };

  const DEFAULT_UI = {
    sortMode: 'total',      // total | today | manual
    expanded: []            // 记住展开了哪些父项目
  };

  const EMPTY_RUNTIME = {
    projectId: null,
    state: null,            // running | paused | null
    activeMs: 0,
    pausedMs: 0,
    segmentStartAt: null,
    lastResumeAt: null,
    lastPauseAt: null,
    lastSeenAt: null,
    closedAt: null          // 页面卸载时留下的"正常告别"记号（见 js/timer.js）
  };

  // ------------------------------------------------------------ storage 后端
  function defaultBackend() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* 访问被禁用 */ }
    return null;
  }

  let backend = defaultBackend();
  let memoryFallback = null;

  function memoryStore() {
    if (!memoryFallback) {
      const map = {};
      memoryFallback = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
        setItem: function (k, v) { map[k] = String(v); },
        removeItem: function (k) { delete map[k]; },
        key: function (i) { return Object.keys(map)[i] || null; },
        get length() { return Object.keys(map).length; }
      };
    }
    return memoryFallback;
  }

  /** 测试用：注入自定义存储后端（传 null 表示回到默认）。 */
  function setBackend(custom) {
    backend = custom === undefined ? defaultBackend() : custom;
  }

  function activeBackend() {
    return backend || memoryStore();
  }

  /** 本机存储是否真的可写（不可写时应用需要提示用户）。 */
  function isStorageWritable() {
    try {
      const b = activeBackend();
      const probe = '__tt_probe__';
      b.setItem(probe, '1');
      const ok = b.getItem(probe) === '1';
      b.removeItem(probe);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------- 默认与规范化
  function emptyData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      projects: [],
      records: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      runtime: Object.assign({}, EMPTY_RUNTIME),
      ui: { sortMode: DEFAULT_UI.sortMode, expanded: [] }
    };
  }

  function toInt(value, fallback) {
    const n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.round(n);
  }

  function clampInt(value, min, max, fallback) {
    const n = toInt(value, fallback);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.minSeconds = clampInt(s.minSeconds, 0, 3600, DEFAULT_SETTINGS.minSeconds);
    s.undoSeconds = clampInt(s.undoSeconds, 3, 30, DEFAULT_SETTINGS.undoSeconds);
    s.chartScope = s.chartScope === 'child' ? 'child' : 'parent';
    return s;
  }

  function normalizeUi(raw) {
    const u = Object.assign({}, DEFAULT_UI, raw || {});
    if (['total', 'today', 'manual'].indexOf(u.sortMode) === -1) u.sortMode = DEFAULT_UI.sortMode;
    u.expanded = Array.isArray(u.expanded) ? u.expanded.filter(function (x) { return typeof x === 'string'; }) : [];
    return u;
  }

  function normalizeRuntime(raw) {
    const r = Object.assign({}, EMPTY_RUNTIME, raw || {});
    r.activeMs = Math.max(0, toInt(r.activeMs, 0));
    r.pausedMs = Math.max(0, toInt(r.pausedMs, 0));
    r.closedAt = typeof r.closedAt === 'string' ? r.closedAt : null;
    if (['running', 'paused'].indexOf(r.state) === -1) {
      return Object.assign({}, EMPTY_RUNTIME);
    }
    if (!r.projectId) return Object.assign({}, EMPTY_RUNTIME);
    return r;
  }

  function normalizeProject(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.id || typeof raw.id !== 'string') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return null;
    return {
      id: raw.id,
      name: name.slice(0, 30),
      parentId: (typeof raw.parentId === 'string' && raw.parentId) ? raw.parentId : null,
      color: typeof raw.color === 'string' ? raw.color : 'var(--c-blue)',
      order: toInt(raw.order, 0),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null
    };
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.id || typeof raw.id !== 'string') return null;
    if (!raw.projectId || typeof raw.projectId !== 'string') return null;
    const date = typeof raw.date === 'string' ? raw.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const activeSec = toInt(raw.activeSec, -1);
    if (activeSec < 0) return null;
    return {
      id: raw.id,
      projectId: raw.projectId,
      date: date,
      startAt: typeof raw.startAt === 'string' ? raw.startAt : null,
      endAt: typeof raw.endAt === 'string' ? raw.endAt : null,
      activeSec: activeSec,
      pausedSec: Math.max(0, toInt(raw.pausedSec, 0)),
      note: typeof raw.note === 'string' ? raw.note.slice(0, 100) : '',
      source: raw.source === 'manual' ? 'manual' : 'timer',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null
    };
  }

  /**
   * 把任意输入规范成合法数据结构。丢弃无法修复的条目，并记录丢弃数量。
   * 只做"规范化"，不做"是否为本 app 文件"的判断（那是 validateImport 的职责）。
   */
  function normalizeData(raw) {
    const dropped = { projects: 0, records: 0 };
    const base = emptyData();
    if (!raw || typeof raw !== 'object') {
      return { data: base, dropped: dropped };
    }

    const projects = [];
    const seenIds = {};
    (Array.isArray(raw.projects) ? raw.projects : []).forEach(function (p) {
      const np = normalizeProject(p);
      if (!np || seenIds[np.id]) { dropped.projects += 1; return; }
      seenIds[np.id] = true;
      projects.push(np);
    });

    // 父项目必须存在；子项目不能再有子项目（最多两层）
    const validParents = {};
    projects.forEach(function (p) {
      if (!p.parentId) validParents[p.id] = true;
    });
    const kept = [];
    projects.forEach(function (p) {
      if (p.parentId && !validParents[p.parentId]) {
        p = Object.assign({}, p, { parentId: null });   // 父项目不存在则提升为顶层，避免产生孤儿
      }
      kept.push(p);
    });

    const records = [];
    const seenRecordIds = {};
    const projectById = {};
    kept.forEach(function (p) { projectById[p.id] = p; });
    (Array.isArray(raw.records) ? raw.records : []).forEach(function (r) {
      const nr = normalizeRecord(r);
      if (!nr || !projectById[nr.projectId]) { dropped.records += 1; return; }
      // 记录 id 必须唯一：两个页面同时结算同一段时可能写出同一个 id，这里兜底去重
      if (seenRecordIds[nr.id]) { dropped.records += 1; return; }
      seenRecordIds[nr.id] = true;
      records.push(nr);
    });

    // 子项目下面不能再挂子项目
    const parentIds = {};
    kept.forEach(function (p) { if (p.parentId) parentIds[p.id] = true; });
    const finalProjects = kept.map(function (p) {
      if (p.parentId && parentIds[p.parentId]) {
        return Object.assign({}, p, { parentId: null });
      }
      return p;
    });

    return {
      data: {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
        projects: finalProjects,
        records: records,
        settings: normalizeSettings(raw.settings),
        runtime: normalizeRuntime(raw.runtime),
        ui: normalizeUi(raw.ui)
      },
      dropped: dropped
    };
  }

  // ------------------------------------------------------------------ 读写
  /**
   * 读取当前数据键；如果新键还没有数据，就把旧版本（改名前的 timetracker.v1）搬过来。
   * 旧键**保留不删**，万一新版本有问题还能退回。
   */
  function readDataWithMigration() {
    const b = activeBackend();
    const current = b.getItem(DATA_KEY);
    if (current !== null && current !== undefined && current !== '') {
      return { text: current, migrated: false };
    }
    try {
      const legacy = b.getItem(LEGACY_DATA_KEY);
      if (legacy !== null && legacy !== undefined && legacy !== '') {
        try {
          b.setItem(DATA_KEY, legacy);
        } catch (e) {
          return { text: legacy, migrated: false, migrateFailed: true };
        }
        return { text: legacy, migrated: true };
      }
    } catch (e) { /* 旧键读不到就当没有 */ }
    return { text: null, migrated: false };
  }

  /**
   * 读取全部数据。
   * 返回 { data, status, dropped, migrated }
   *   status: 'empty'   没有数据（首次使用）
   *           'ok'      正常读取
   *           'repaired' 结构有问题，已尽力修复
   *           'corrupt' JSON 解析失败，坏数据已另存备份
   *   migrated: 是否从改名前的旧数据搬过来的
   */
  function loadAll() {
    const b = activeBackend();
    let text = null;
    let migrated = false;
    try {
      const read = readDataWithMigration();
      text = read.text;
      migrated = read.migrated;
    } catch (e) {
      return { data: emptyData(), status: 'corrupt', dropped: { projects: 0, records: 0 }, error: 'read-failed', migrated: false };
    }

    if (text === null || text === undefined || text === '') {
      return { data: emptyData(), status: 'empty', dropped: { projects: 0, records: 0 }, migrated: false };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      backupCorrupt(text);
      return { data: emptyData(), status: 'corrupt', dropped: { projects: 0, records: 0 }, error: 'parse-failed', migrated: migrated };
    }

    const result = normalizeData(parsed);
    const hadLoss = result.dropped.projects > 0 || result.dropped.records > 0;
    const structuralLoss = !Array.isArray(parsed.projects) || !Array.isArray(parsed.records);
    return {
      data: result.data,
      status: (hadLoss || structuralLoss) ? 'repaired' : 'ok',
      dropped: result.dropped,
      migrated: migrated
    };
  }

  function backupCorrupt(text) {
    try {
      const b = activeBackend();
      b.setItem(CORRUPT_PREFIX + Date.now(), String(text).slice(0, 200000));
    } catch (e) { /* 备份失败也不能让应用起不来 */ }
  }

  /** 列出损坏数据的备份（用于提示与导出）。新旧前缀的备份都会列出来。 */
  function listCorruptBackups() {
    const b = activeBackend();
    const out = [];
    try {
      for (let i = 0; i < b.length; i++) {
        const key = b.key(i);
        if (!key) continue;
        if (key.indexOf(CORRUPT_PREFIX) === 0 || key.indexOf(LEGACY_CORRUPT_PREFIX) === 0) out.push(key);
      }
    } catch (e) { /* ignore */ }
    return out.sort();
  }

  class QuotaError extends Error {
    constructor(message) {
      super(message || '本机存储空间不足');
      this.name = 'QuotaError';
    }
  }

  function isQuotaError(err) {
    if (!err) return false;
    if (err instanceof QuotaError) return true;
    const name = String(err.name || '');
    const msg = String(err.message || '');
    return name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota/i.test(msg) ||
      /exceeded/i.test(msg);
  }

  /** 写入全部数据；配额不足时抛 QuotaError（由调用方提示用户导出备份）。 */
  function saveAll(data) {
    const b = activeBackend();
    const payload = Object.assign({}, data, { schemaVersion: SCHEMA_VERSION });
    let text;
    try {
      text = JSON.stringify(payload);
    } catch (e) {
      throw new Error('数据无法序列化：' + e.message);
    }
    try {
      b.setItem(DATA_KEY, text);
    } catch (err) {
      if (isQuotaError(err)) throw new QuotaError();
      throw err;
    }
    return text.length;
  }

  /** 读取原始文本（导出前的快照/诊断用）。新键没有时也认旧键。 */
  function readRaw() {
    try {
      const b = activeBackend();
      const current = b.getItem(DATA_KEY);
      if (current !== null && current !== undefined && current !== '') return current;
      return b.getItem(LEGACY_DATA_KEY);
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------ 导入
  /**
   * 校验导入对象。
   * 返回 { ok: true, data, dropped } 或 { ok: false, reason }
   */
  function validateImport(obj) {
    if (obj === null || obj === undefined) {
      return { ok: false, reason: '文件内容为空' };
    }
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch (e) {
        return { ok: false, reason: '不是合法的 JSON 文件' };
      }
    }
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, reason: '文件结构不正确（不是一个对象）' };
    }
    const knownTags = [APP_TAG].concat(LEGACY_APP_TAGS);
    if (obj.app && knownTags.indexOf(obj.app) === -1) {
      return { ok: false, reason: '这不是「TimeScribe」导出的文件' };
    }
    if (!obj.app && !Array.isArray(obj.projects) && !Array.isArray(obj.records)) {
      return { ok: false, reason: '这不是「TimeScribe」导出的文件' };
    }
    const version = toInt(obj.schemaVersion, 0);
    if (version > SCHEMA_VERSION) {
      return { ok: false, reason: '文件来自更新版本的 TimeScribe（数据版本 ' + version + '），当前版本无法导入' };
    }
    if (!Array.isArray(obj.projects)) {
      return { ok: false, reason: '文件里缺少项目列表' };
    }
    if (!Array.isArray(obj.records)) {
      return { ok: false, reason: '文件里缺少时间记录列表' };
    }

    const result = normalizeData(obj);
    const droppedCount = result.dropped.projects + result.dropped.records;
    if (obj.projects.length + obj.records.length > 0 && droppedCount === obj.projects.length + obj.records.length) {
      return { ok: false, reason: '文件里的项目和记录都无法识别，可能已损坏' };
    }
    return { ok: true, data: result.data, dropped: result.dropped };
  }

  /** 生成导出对象。 */
  function buildExport(data, nowIso) {
    return {
      app: APP_TAG,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso || new Date().toISOString(),
      projects: data.projects,
      records: data.records,
      settings: data.settings
    };
  }

  global.TTStorage = {
    DATA_KEY: DATA_KEY,
    CORRUPT_PREFIX: CORRUPT_PREFIX,
    LEGACY_PREFIX: LEGACY_PREFIX,
    LEGACY_DATA_KEY: LEGACY_DATA_KEY,
    LEGACY_CORRUPT_PREFIX: LEGACY_CORRUPT_PREFIX,
    SCHEMA_VERSION: SCHEMA_VERSION,
    APP_TAG: APP_TAG,
    LEGACY_APP_TAGS: LEGACY_APP_TAGS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_UI: DEFAULT_UI,
    EMPTY_RUNTIME: EMPTY_RUNTIME,
    QuotaError: QuotaError,
    isQuotaError: isQuotaError,
    setBackend: setBackend,
    isStorageWritable: isStorageWritable,
    emptyData: emptyData,
    normalizeData: normalizeData,
    normalizeSettings: normalizeSettings,
    loadAll: loadAll,
    saveAll: saveAll,
    readRaw: readRaw,
    listCorruptBackups: listCorruptBackups,
    validateImport: validateImport,
    buildExport: buildExport
  };
})(typeof window !== 'undefined' ? window : globalThis);
