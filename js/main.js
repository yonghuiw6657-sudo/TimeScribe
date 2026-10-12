/**
 * TimeScribe · 入口
 *
 * 负责：加载数据 → 恢复上次计时 → 绑定全局交互 → 订阅重绘 → 报告启动状态。
 */
(function () {
  'use strict';

  const store = window.TTStore;
  const projects = window.TTProjects;

  function setBootStatus(text) {
    const el = document.getElementById('boot-status');
    if (el) el.textContent = text;
  }

  function storageProbe() {
    try {
      const key = 'timescribe.probe';
      const value = 'ok-' + Date.now();
      localStorage.setItem(key, value);
      const readBack = localStorage.getItem(key);
      localStorage.removeItem(key);
      return readBack === value;
    } catch (err) {
      return false;
    }
  }

  // ---------------------------------------------------------------- 交互绑定
  const ACTION_BINDINGS = [
    { attr: 'data-action', map: {
      'new-project': function () { window.TTUI.projects.openProjectForm({}); },
      'add-sub': function (node) { window.TTUI.projects.openProjectForm({ parentId: node.getAttribute('data-parent-for') }); },
      'start': function (node) { window.TTTimer.start(node.getAttribute('data-project-id')); },
      'pause': function () { window.TTTimer.pause(); },
      'resume': function () { window.TTTimer.resume(); },
      'stop': function () { window.TTTimer.stop(); },
      'quick-add': function (node) { window.TTUI.records.openQuickAdd(node.getAttribute('data-project-id')); },
      'menu': function (node) { window.TTUI.projects.openMenu(node.getAttribute('data-menu-for'), node); },
      // 打卡表：只有打过卡的日期才带 data-action（没打卡的日子渲染成 span），
      // 所以"点没打卡的日期没反应"在这一层就成立了。
      'checkin-day': function (node) { window.TTUI.checkin.openDay(node.getAttribute('data-date')); },
      'checkin-prev': function () { window.TTUI.checkin.shiftMonth(-1); },
      'checkin-next': function () { window.TTUI.checkin.shiftMonth(1); }
    } },
    { attr: 'data-detail-action', map: {
      'add-record': function (node) { window.TTUI.records.openRecordForm({ projectId: node.getAttribute('data-project-id') }); }
    } },
    { attr: 'data-record-action', map: {
      'edit': function (node) {
        const id = node.getAttribute('data-record-id');
        const record = store.getState().records.filter(function (r) { return r.id === id; })[0];
        if (record) window.TTUI.records.openRecordForm({ record: record });
      },
      'delete': function (node) { window.TTUI.records.requestDelete(node.getAttribute('data-record-id')); }
    } }
  ];

  function handleDelegatedClick(event) {
    const target = event.target;

    // 重绘后按钮上的项目 id 可能还没补上（例如明细弹窗里新渲染出来的按钮）
    window.TTUI.home.decorateButtons();

    // 展开/收起优先判断：三角位于卡片内，若不先判断会被动作分支抢先
    const toggle = target.closest ? target.closest('[data-toggle-for]') : null;
    if (toggle) {
      if (toggle.getAttribute('data-has-children') !== 'yes') return;
      event.preventDefault();
      const id = toggle.getAttribute('data-toggle-for');
      store.commit(function (state) {
        projects.toggleExpanded(state, id);
        return state;
      });
      return;
    }

    for (const binding of ACTION_BINDINGS) {
      const node = target.closest ? target.closest('[' + binding.attr + ']') : null;
      if (!node) continue;
      const key = node.getAttribute(binding.attr);
      const handler = binding.map[key];
      if (!handler) continue;
      // 防重复处理：同一个事件只能被消费一次。
      // （弹窗挂在 #modal-host 上，而它和对外的 #app 是两个分支，
      //   若两个监听器都收到事件就会把一次点击当成两次，例如"确认删除"直接生效。）
      if (event.__ttHandled) return;
      event.__ttHandled = true;
      event.preventDefault();
      handler(node);
      return;
    }
  }

  function bindEvents() {
    const app = document.getElementById('app');

    const newProject = document.getElementById('btn-new-project');
    if (newProject) newProject.addEventListener('click', function () {
      window.TTUI.projects.openProjectForm({});
    });

    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', function () { window.TTUI.data.exportNow(); });

    const importBtn = document.getElementById('btn-import');
    if (importBtn) importBtn.addEventListener('click', function () { window.TTUI.data.openImport(); });

    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { window.TTUI.settings.open(); });

    if (app) {
      app.addEventListener('click', handleDelegatedClick);
      app.addEventListener('change', function (event) {
        const select = event.target.closest ? event.target.closest('[data-action="sort-mode"]') : null;
        if (!select) return;
        store.commit(function (state) {
          state.ui.sortMode = select.value;
          return state;
        });
      });
    }

    const modalHost = document.getElementById('modal-host');
    if (modalHost) {
      modalHost.addEventListener('click', function (event) {
        // 颜色选择：点哪个色点就把它设为选中
        const colorDot = event.target.closest ? event.target.closest('.color-dot') : null;
        if (colorDot) {
          const row = colorDot.closest('.color-row');
          if (row) {
            row.querySelectorAll('.color-dot').forEach(function (n) { n.classList.remove('active'); });
            colorDot.classList.add('active');
          }
          return;
        }
        handleDelegatedClick(event);
      });
    }

    // 点空白处关掉"更多"菜单。
    // 菜单是挂在「⋯」按钮**旁边**（兄弟节点）而不是里面，所以不能只用 contains 判断：
    // 打开菜单的那一次点击会一路冒泡到这里，若不放行按钮自己，菜单刚建好就被关掉了。
    document.addEventListener('click', function (event) {
      const menu = document.getElementById('active-menu');
      if (!menu) return;
      if (menu.contains(event.target)) return;
      if (event.target.closest && event.target.closest('[data-menu-for]')) return;
      window.TTUI.projects.closeMenu();
    });
  }

  // ---------------------------------------------------------------- 生命周期
  /**
   * 切走浏览器 / 切到别的应用 / 最小化时调用：**只更新存储里的快照，绝不暂停计时**。
   *
   * 这里曾经犯过一个错：把这个时机和"关闭页面"混在一起处理，结果切走就暂停了。
   * 计时是按时间戳累计的，在后台照常走；这里只是顺手把进度写进存储，
   * 万一下一秒浏览器被强杀，也最多丢一个心跳间隔（15 秒）。
   */
  function handleHidden() {
    if (window.TTTimer && window.TTTimer.heartbeat) window.TTTimer.heartbeat();
    store.flush();
  }

  /**
   * 页面即将卸载时调用（**刷新页面和关闭页面都会触发它**）。
   *
   * 这里刻意**不做任何结算**：卸载这一刻分不清用户是按了刷新，还是关掉了浏览器/应用。
   * 所以只做两件事——把现场立刻落一次盘，再留下一个"正常告别"的记号。
   * 真正的收场留给下次打开页面的那一刻（`TTTimer.reconcileOnLoad`）：
   * 是刷新就接着计时，是关掉了就把这一段结算保存。判断依据见 `js/timer.js` 开头。
   */
  function handleClose() {
    if (window.TTTimer && window.TTTimer.heartbeat) window.TTTimer.heartbeat({ closing: true });
    store.flush();
  }

  function bindLifecycle() {
    window.addEventListener('pagehide', handleClose);
    window.addEventListener('beforeunload', handleClose);
    document.addEventListener('visibilitychange', function () {
      // 注意：变成 hidden 不等于要结束计时（切标签、切应用都会触发）
      if (document.visibilityState === 'hidden') handleHidden();
    });
    store.onQuotaError(function () {
      window.TTUI.toast.show({
        text: '本机存储空间不足，数据可能保存失败',
        detail: '请先点「导出」保存备份，再清理不用的记录',
        tone: 'warn',
        durationSec: 10
      });
    });
  }

  function bootDescribe(status, dropped) {
    const messages = {
      empty: '首次使用，还没有数据',
      ok: '数据已载入',
      repaired: '数据有一部分无法识别，已自动修复',
      corrupt: '原有数据已损坏，已备份并重置'
    };
    let text = messages[status] || '数据状态：' + status;
    if (status === 'repaired' && dropped) {
      text += '（丢弃 ' + dropped.projects + ' 个项目、' + dropped.records + ' 条记录）';
    }
    if (status === 'corrupt') {
      text += '（请先导出备份再继续录入）';
    }
    return text;
  }

  /**
   * 换浏览器打开会看到另一份存储（数据不会跟着走），
   * 必须明确提示，否则用户会以为"数据丢了"。
   * 返回 true 表示已经给出提示。
   */
  function warnIfNotEdge() {
    const ua = navigator.userAgent || '';
    const isEdge = /Edg\//.test(ua);
    if (isEdge) {
      window.__TT_EDGE_WARNING__ = false;
      return false;
    }
    window.__TT_EDGE_WARNING__ = true;
    window.TTUI.toast.show({
      text: '建议用 Microsoft Edge 打开这个应用',
      detail: '数据存在浏览器里，换一个浏览器会看不到之前的数据（不是数据丢了）',
      durationSec: 12,
      tone: 'warn'
    });
    return true;
  }

  /** 本应用自己写在 localStorage 里的键前缀（含改名前的旧前缀，测试要清干净两份）。 */
  const OWN_KEY_PREFIXES = ['timescribe.', 'timetracker.'];

  function boot() {
    // 自检页用 ?fresh=1 要求一个干净起点（测试之间不能互相污染数据）
    const params = new URLSearchParams(location.search);
    if (params.get('fresh') === '1') {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.forEach(function (k) {
          if (!k) return;
          if (OWN_KEY_PREFIXES.some(function (p) { return k.indexOf(p) === 0; })) {
            localStorage.removeItem(k);
          }
        });
      } catch (err) { /* ignore */ }
    }

    const writable = storageProbe();
    const loaded = store.load();

    if (window.TTTimer && window.TTTimer.reconcileOnLoad) {
      window.TTTimer.reconcileOnLoad();
    }

    const state = store.getState();
    window.__TIMESCRIBE_BOOT__ = {
      bootedAt: new Date().toISOString(),
      origin: location.origin,
      storageWritable: writable,
      loadStatus: loaded.status,
      dropped: loaded.dropped,
      projectCount: state.projects.length,
      recordCount: state.records.length
    };

    bindEvents();
    bindLifecycle();

    // 首页的两块内容各画各的：左边是打卡表与统计，右边是项目列表。
    // 这里的订阅顺序就是重绘顺序，两块互不依赖，先订阅的先画。
    store.subscribe(function () {
      window.TTUI.checkin.render();
      window.TTUI.home.render();
    });

    window.TTUI.checkin.render();
    window.TTUI.home.render();

    const parts = [
      '启动成功',
      new Date().toLocaleString('zh-CN', { hour12: false }),
      writable ? '本机存储可用' : '本机存储不可用（数据将无法保存）',
      bootDescribe(loaded.status, loaded.dropped)
    ];
    setBootStatus(parts.join(' · '));

    warnIfNotEdge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 供自检使用：验证"非 Edge 打开时给出提示"这条逻辑本身
  window.__TT_WARN_IF_NOT_EDGE__ = warnIfNotEdge;
  // 供自检使用：验证"切到后台不暂停""卸载时不留结算、只留现场"这两条生命周期的真实接线
  window.__TT_HANDLE_HIDDEN__ = handleHidden;
  window.__TT_HANDLE_CLOSE__ = handleClose;
})();
