/**
 * 项目与子项目的业务操作（纯函数式，便于测试）。
 *
 * 硬性规则（PRD 4.2）：
 * - 最多两层：父项目 → 子项目；子项目下面不允许再建。
 * - 删除父项目会连带删除其子项目与全部记录；删除子项目连带其记录；不留孤儿记录。
 * - 正在计时（运行中或暂停中）的项目不允许删除。
 */
(function (global) {
  'use strict';

  const calc = global.TTCalc;
  const util = global.TTUtil;

  const NAME_MAX = 30;
  const NOTE_MAX = 100;

  function normalizeName(raw) {
    return String(raw === null || raw === undefined ? '' : raw).trim().slice(0, NAME_MAX);
  }

  /** 新建/编辑时的校验。返回 { ok, name, reason } */
  function validateName(raw) {
    const name = normalizeName(raw);
    if (!name) return { ok: false, reason: '请填写项目名称', name: '' };
    return { ok: true, name: name };
  }

  /**
   * 把 parentId 修正为合法值：
   * - 父项目必须存在
   * - 父项目不能是子项目（否则会出现第三层）
   * 返回修正后的 parentId（null 表示顶层）
   */
  function resolveParentId(projects, parentId) {
    if (!parentId) return null;
    const parent = projects.filter(function (p) { return p.id === parentId; })[0];
    if (!parent) return null;
    if (!parent.parentId) return parent.id;
    // 指定的是一个子项目 → 提升到它的父项目，从根上杜绝第三层
    return parent.parentId;
  }

  function childCount(projects, projectId) {
    return projects.filter(function (p) { return p.parentId === projectId; }).length;
  }

  function isDescendant(projects, candidateId, ancestorId) {
    const map = {};
    projects.forEach(function (p) { map[p.id] = p; });
    let cursor = map[candidateId];
    const guard = 10;
    for (let i = 0; i < guard && cursor && cursor.parentId; i++) {
      if (cursor.parentId === ancestorId) return true;
      cursor = map[cursor.parentId];
    }
    return false;
  }

  function nextColor(projects, parentId) {
    const root = parentId
      ? projects.filter(function (p) { return p.id === parentId; })[0]
      : null;
    if (root) return root.color;                       // 子项目沿用父项目颜色
    const used = {};
    projects.forEach(function (p) {
      if (!p.parentId) used[p.color] = true;
    });
    for (let i = 0; i < 40; i++) {
      const c = util.pickColor(i);
      if (!used[c]) return c;
    }
    return util.pickColor(projects.length);
  }

  function nextOrder(projects, parentId) {
    const siblings = projects.filter(function (p) { return p.parentId === parentId; });
    if (siblings.length === 0) return 0;
    return Math.max.apply(null, siblings.map(function (p) { return p.order || 0; })) + 1;
  }

  /** 新建项目。返回 { ok, project, reason } */
  function createProject(state, input, options) {
    const opts = options || {};
    const check = validateName(input && input.name);
    if (!check.ok) return { ok: false, reason: check.reason };

    const parentId = resolveParentId(state.projects, input.parentId);
    const project = {
      id: calc.makeId(parentId ? 'sub' : 'proj'),
      name: check.name,
      parentId: parentId,
      color: (input.color && String(input.color)) || nextColor(state.projects, parentId),
      order: nextOrder(state.projects, parentId),
      createdAt: opts.now || new Date().toISOString()
    };

    state.projects.push(project);
    return { ok: true, project: project };
  }

  /** 编辑项目：可改名称与颜色（不改归属，避免统计错乱）。 */
  function updateProject(state, projectId, patch) {
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return { ok: false, reason: '项目不存在' };

    if (patch.name !== undefined) {
      const check = validateName(patch.name);
      if (!check.ok) return { ok: false, reason: check.reason };
      project.name = check.name;
    }
    if (patch.color !== undefined && !project.parentId && patch.color) {
      project.color = String(patch.color);
    }
    if (patch.order !== undefined && isFinite(Number(patch.order))) {
      project.order = Number(patch.order);
    }
    return { ok: true, project: project };
  }

  /** 计时中的项目不允许删除（PRD B8）。 */
  function isProjectBusy(state, projectId) {
    const rt = state.runtime;
    if (!rt || !rt.state || !rt.projectId) return false;
    return rt.projectId === projectId;
  }

  function collectIdsToDelete(projects, projectId) {
    const ids = [projectId];
    projects.forEach(function (p) {
      if (p.parentId === projectId) ids.push(p.id);
    });
    return ids;
  }

  /**
   * 删除前的预检与统计（用于确认弹窗的文案）。
   * 返回 { ok, reason, project, subCount, totalSec, recordCount }
   */
  function describeDeletion(state, projectId, now) {
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return { ok: false, reason: '项目不存在' };

    if (isProjectBusy(state, projectId)) {
      return { ok: false, reason: '请先停止计时再删除' };
    }
    const childIds = state.projects.filter(function (p) { return p.parentId === projectId; }).map(function (p) { return p.id; });
    if (childIds.some(function (cid) { return isProjectBusy(state, cid); })) {
      return { ok: false, reason: '该项目下有子项目正在计时，请先停止' };
    }

    const ids = collectIdsToDelete(state.projects, projectId);
    const records = state.records.filter(function (r) { return ids.indexOf(r.projectId) !== -1; });
    const totalSec = records.reduce(function (sum, r) { return sum + r.activeSec; }, 0);

    return {
      ok: true,
      project: project,
      isChild: !!project.parentId,
      subCount: childIds.length,
      recordCount: records.length,
      totalSec: totalSec
    };
  }

  /**
   * 执行删除。返回 { ok, reason, removedProjects, removedRecords }
   * 会同时清理 ui.expanded 里的残留 id。
   */
  function deleteProject(state, projectId) {
    const info = describeDeletion(state, projectId);
    if (!info.ok) return { ok: false, reason: info.reason };

    const ids = collectIdsToDelete(state.projects, projectId);
    const before = { projects: state.projects.length, records: state.records.length };

    state.projects = state.projects.filter(function (p) { return ids.indexOf(p.id) === -1; });
    state.records = state.records.filter(function (r) { return ids.indexOf(r.projectId) === -1; });

    if (state.ui && Array.isArray(state.ui.expanded)) {
      state.ui.expanded = state.ui.expanded.filter(function (id) { return ids.indexOf(id) === -1; });
    }

    return {
      ok: true,
      removedProjects: before.projects - state.projects.length,
      removedRecords: before.records - state.records.length
    };
  }

  function toggleExpanded(state, projectId) {
    if (!state.ui) state.ui = { sortMode: 'total', expanded: [] };
    if (!Array.isArray(state.ui.expanded)) state.ui.expanded = [];
    const i = state.ui.expanded.indexOf(projectId);
    if (i === -1) state.ui.expanded.push(projectId);
    else state.ui.expanded.splice(i, 1);
    return state.ui.expanded.indexOf(projectId) !== -1;
  }

  function isExpanded(state, projectId) {
    return !!(state.ui && Array.isArray(state.ui.expanded) && state.ui.expanded.indexOf(projectId) !== -1);
  }

  /**
   * 列表排序（PRD 4.2）：
   * total  按累计投入（默认，从多到少）
   * today  按今天投入
   * manual 按 order 字段
   * 子项目也按同一规则排序；返回 { parents: [...], childrenOf: fn }
   */
  function sortProjects(state, summary) {
    const mode = (state.ui && state.ui.sortMode) || 'total';

    function metricOf(item) {
      if (!item) return 0;
      if (mode === 'today') return item.todayActiveSec;
      if (mode === 'manual') return item.project.order || 0;
      return item.totalActiveSec;
    }

    function compare(a, b) {
      const ia = summary.byId[a.id];
      const ib = summary.byId[b.id];
      const ma = metricOf(ia);
      const mb = metricOf(ib);
      if (mode === 'manual') return ma - mb;            // 手动顺序：从小到大
      if (mb !== ma) return mb - ma;                    // 其余：从多到少
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    }
    const parents = state.projects.filter(function (p) { return !p.parentId; }).slice().sort(compare);
    const childrenOf = function (parentId) {
      return state.projects.filter(function (p) { return p.parentId === parentId; }).slice().sort(compare);
    };

    return { mode: mode, parents: parents, childrenOf: childrenOf, compare: compare };
  }

  /** 上下移动（手动顺序模式用）。 */
  function moveProject(state, projectId, delta) {
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return { ok: false, reason: '项目不存在' };
    const siblings = state.projects
      .filter(function (p) { return p.parentId === project.parentId; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    const index = siblings.findIndex(function (p) { return p.id === projectId; });
    const target = index + (delta > 0 ? 1 : -1);
    if (target < 0 || target >= siblings.length) return { ok: false, reason: '已经在边界' };
    siblings.forEach(function (p, i) { p.order = i; });
    const tmp = siblings[index].order;
    siblings[index].order = siblings[target].order;
    siblings[target].order = tmp;
    return { ok: true };
  }

  global.TTProjects = {
    NAME_MAX: NAME_MAX,
    NOTE_MAX: NOTE_MAX,
    normalizeName: normalizeName,
    validateName: validateName,
    resolveParentId: resolveParentId,
    childCount: childCount,
    isDescendant: isDescendant,
    nextColor: nextColor,
    createProject: createProject,
    updateProject: updateProject,
    isProjectBusy: isProjectBusy,
    describeDeletion: describeDeletion,
    deleteProject: deleteProject,
    toggleExpanded: toggleExpanded,
    isExpanded: isExpanded,
    sortProjects: sortProjects,
    moveProject: moveProject
  };
})(typeof window !== 'undefined' ? window : globalThis);
