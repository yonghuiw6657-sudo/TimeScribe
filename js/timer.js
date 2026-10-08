/**
 * 计时状态机（全 app 只有一个计时器）。
 *
 * 规则（PRD 4.3）：
 * - 同一时刻只能有一个项目在计时；点别的项目"开始"时，正在计时的那段先结算。
 * - 暂停时间不计入投入，单独累积用于算专注度。
 * - 单段实际投入不足阈值（默认 2 分钟）→ 整段丢弃并提示。
 * - **切走浏览器/切到别的应用不算中断**：计时按时间戳累计，在后台照常走。
 * - **关闭页面/关闭浏览器/关掉应用 = 这一段直接结束**：够阈值就存成记录，不够就丢弃。
 * - 停止后一段时间内可撤销（手动点"停止"才有撤销；关闭页面时页面已经没了，无从撤销）。
 */
(function (global) {
  'use strict';

  const calc = global.TTCalc;

  /** 计时中每隔这么久把一次"快照"写进本机存储。
   *  作用：万一浏览器被强杀（来不及走正常关闭流程），也能把损失限制在这个间隔内。 */
  const HEARTBEAT_MS = 15000;

  function emptyRuntime() {
    return {
      projectId: null, state: null, activeMs: 0, pausedMs: 0,
      segmentStartAt: null, lastResumeAt: null, lastPauseAt: null, lastSeenAt: null,
      segmentId: null
    };
  }

  let rt = emptyRuntime();

  let snapshot = null;        // 撤销用：最近一次停止的完整现场
  let snapshotTimer = null;
  let heartbeatTimer = null;

  function store() { return global.TTStore; }

  function nowIso() { return new Date().toISOString(); }

  function minSeconds() {
    const s = store().getState().settings;
    return s && typeof s.minSeconds === 'number' ? s.minSeconds : 120;
  }

  function undoSeconds() {
    const s = store().getState().settings;
    return s && typeof s.undoSeconds === 'number' ? s.undoSeconds : 5;
  }

  function activeMsNow() {
    if (rt.state === 'running' && rt.lastResumeAt) {
      return rt.activeMs + Math.max(0, Date.now() - new Date(rt.lastResumeAt).getTime());
    }
    return rt.activeMs;
  }

  function pausedMsNow() {
    if (rt.state === 'paused' && rt.lastPauseAt) {
      return rt.pausedMs + Math.max(0, Date.now() - new Date(rt.lastPauseAt).getTime());
    }
    return rt.pausedMs;
  }

  /** 某个现场在指定时刻的投入/暂停毫秒数（用于"结算到关闭那一刻"）。 */
  function activeMsAt(saved, iso) {
    const base = saved.activeMs || 0;
    if (saved.state === 'running' && saved.lastResumeAt) {
      return base + Math.max(0, new Date(iso).getTime() - new Date(saved.lastResumeAt).getTime());
    }
    return base;
  }

  function pausedMsAt(saved, iso) {
    const base = saved.pausedMs || 0;
    if (saved.state === 'paused' && saved.lastPauseAt) {
      return base + Math.max(0, new Date(iso).getTime() - new Date(saved.lastPauseAt).getTime());
    }
    return base;
  }

  function currentSegmentMs() {
    return activeMsNow();
  }

  function isBusy(projectId) {
    if (!rt.state || !rt.projectId) return false;
    return projectId ? rt.projectId === projectId : true;
  }

  function activeProjectId() {
    return rt.state ? rt.projectId : null;
  }

  /** 写入数据层（供刷新后恢复）。会触发重绘。 */
  function persist() {
    store().commit(function (state) {
      state.runtime = runtimeSnapshot();
      return state;
    });
  }

  function runtimeSnapshot(atIso) {
    const at = atIso || nowIso();
    return {
      projectId: rt.state ? rt.projectId : null,
      state: rt.state,
      activeMs: Math.round(atIso ? activeMsAt(rt, at) : activeMsNow()),
      pausedMs: Math.round(atIso ? pausedMsAt(rt, at) : pausedMsNow()),
      segmentStartAt: rt.segmentStartAt,
      lastResumeAt: rt.lastResumeAt,
      lastPauseAt: rt.lastPauseAt,
      lastSeenAt: at,
      segmentId: rt.segmentId
    };
  }

  /**
   * 写入一条记录，但同一段只写一次。
   *
   * 为什么需要去重：如果计时中又打开了一个页面（例如再双击一次「启动.bat」），
   * 新页面会把存储里那段"进行中"的现场结算保存，而原来那个页面内存里还在继续计时，
   * 稍后它停止时又会写一条——同一段时间就被记了两次。
   * 每段计时带一个唯一编号，记录 id 由它推导而来，于是重复写入会被这条规则挡住。
   */
  function pushRecord(state, record) {
    if (!record) return false;
    const exists = state.records.some(function (r) { return r.id === record.id; });
    if (exists) return false;
    state.records.push(record);
    return true;
  }

  // ------------------------------------------------------------------ 心跳
  /**
   * 把当前进度静默写进存储（不重绘）。
   * 切到后台、最小化、以及每 15 秒都会做一次，这样"被强杀"也不会丢掉整段。
   */
  function heartbeat() {
    if (!rt.state) return false;
    const snap = runtimeSnapshot();
    store().patch(function (state) {
      state.runtime = snap;
      return state;
    });
    store().flush();
    return true;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function projectById(id) {
    return store().getState().projects.filter(function (p) { return p.id === id; })[0];
  }

  /** 按一段现场生成记录对象（不写入）。id 由段编号推导，保证同一段反复写入也只算一条。 */
  function buildRecord(payload) {
    return {
      id: payload.segmentId ? 'rec-' + payload.segmentId : calc.makeId('rec'),
      projectId: payload.projectId,
      date: calc.toDateStr(new Date(payload.segmentStartAt || payload.endAt)),
      startAt: payload.segmentStartAt,
      endAt: payload.endAt,
      activeSec: payload.activeSec,
      pausedSec: payload.pausedSec,
      note: '',
      source: 'timer',
      createdAt: payload.endAt
    };
  }

  // ------------------------------------------------------------------- 开始
  function start(projectId) {
    if (!projectById(projectId)) return { ok: false, reason: '项目不存在' };

    // 点的是正在计时的同一个项目：不重启，保持原样（防连点）
    if (rt.state && rt.projectId === projectId) return { ok: false, reason: 'already-active', ignored: true };
    if (rt.state) stop({ auto: true });

    rt = {
      projectId: projectId,
      state: 'running',
      activeMs: 0,
      pausedMs: 0,
      segmentStartAt: nowIso(),
      lastResumeAt: nowIso(),
      lastPauseAt: null,
      lastSeenAt: nowIso(),
      segmentId: calc.makeId('seg')
    };
    persist();
    startHeartbeat();
    return { ok: true };
  }

  function pause() {
    if (rt.state !== 'running') return { ok: false, reason: '当前没有在计时' };
    rt.activeMs = activeMsNow();
    rt.state = 'paused';
    rt.lastPauseAt = nowIso();
    rt.lastResumeAt = null;
    persist();
    return { ok: true };
  }

  function resume() {
    if (rt.state !== 'paused') return { ok: false, reason: '当前没有暂停中的计时' };
    rt.pausedMs = pausedMsNow();
    rt.state = 'running';
    rt.lastResumeAt = nowIso();
    rt.lastPauseAt = null;
    persist();
    startHeartbeat();
    return { ok: true };
  }

  /**
   * 停止并结算。
   * options: { auto: true 表示是被别的项目"开始"挤掉的，不再单独提示 }
   */
  function stop(options) {
    const opts = options || {};
    if (!rt.state) return { ok: false, reason: '当前没有在计时' };

    const project = projectById(rt.projectId);
    const activeMs = activeMsNow();
    const pausedMs = pausedMsNow();
    const activeSec = Math.round(activeMs / 1000);
    const pausedSec = Math.round(pausedMs / 1000);
    const endAt = nowIso();

    const payload = {
      projectId: rt.projectId,
      projectName: project ? project.name : '（已删除的项目）',
      state: rt.state,
      activeMs: activeMs,
      pausedMs: pausedMs,
      activeSec: activeSec,
      pausedSec: pausedSec,
      segmentStartAt: rt.segmentStartAt,
      lastResumeAt: rt.lastResumeAt,
      lastPauseAt: rt.lastPauseAt,
      endAt: endAt,
      segmentId: rt.segmentId
    };

    const threshold = minSeconds();
    let record = null;
    let discarded = false;

    if (activeSec >= threshold && project) {
      store().commit(function (state) {
        record = buildRecord(payload);
        pushRecord(state, record);
        return state;
      });
    } else {
      discarded = true;
    }

    // 清空计时状态
    rt = emptyRuntime();
    persist();
    stopHeartbeat();

    // 记录撤销现场。自动停止（被别的项目挤掉）不提供撤销：
    // 那种情况下用户已经在做下一件事了，弹出"撤销"只会造成困惑。
    if (!opts.auto) {
      setSnapshot({
        payload: payload,
        recordId: record ? record.id : null,
        discarded: discarded,
        threshold: threshold,
        auto: false
      });
    }

    notifyResult(payload, record, discarded, opts);
    return { ok: true, record: record, discarded: discarded, payload: payload };
  }

  function notifyResult(payload, record, discarded, opts) {
    const toast = global.TTUI && global.TTUI.toast;
    if (!toast) return;

    const focus = calc.focusText(payload.activeSec, payload.pausedSec);

    // 被别的项目挤掉的自动停止：不提供撤销（用户已经在做下一件事了），
    // 只给一句说明，避免看到"撤销"却不知道撤销的是哪一段。
    if (opts.auto) {
      if (discarded) {
        toast.show({
          text: '「' + payload.projectName + '」这段不到 ' + describeThreshold(minSeconds()) + '，没有计入',
          durationSec: 4,
          tone: 'warn'
        });
      } else {
        const autoParts = ['投入 ' + calc.fmtDuration(payload.activeSec)];
        if (focus) autoParts.push('专注 ' + focus);
        toast.show({
          text: '已自动停止「' + payload.projectName + '」',
          detail: autoParts.join(' · '),
          durationSec: 4
        });
      }
      return;
    }

    if (discarded) {
      toast.show({
        text: '「' + payload.projectName + '」这段不到 ' + describeThreshold(minSeconds()) + '，没有计入',
        detail: '实际投入 ' + calc.fmtDuration(payload.activeSec),
        durationSec: 5,
        tone: 'warn'
      });
      return;
    }

    const detailParts = ['投入 ' + calc.fmtDuration(payload.activeSec)];
    if (payload.pausedSec > 0) detailParts.push('暂停 ' + calc.fmtDuration(payload.pausedSec));
    if (focus) detailParts.push('专注 ' + focus);

    toast.show({
      text: '已记录「' + payload.projectName + '」',
      detail: detailParts.join(' · ') + '　' + undoSeconds() + ' 秒内可撤销',
      actionText: '撤销',
      durationSec: undoSeconds(),
      onAction: undo
    });
  }

  function describeThreshold(sec) {
    if (sec === 0) return '限制';
    if (sec < 60) return sec + ' 秒';
    const min = Math.round(sec / 60);
    return min + ' 分钟';
  }

  // ------------------------------------------------------------------- 撤销
  function setSnapshot(data) {
    snapshot = data;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(function () {
      snapshot = null;
      snapshotTimer = null;
    }, Math.max(1, undoSeconds()) * 1000 + 300);
  }

  function hasSnapshot() {
    return !!snapshot;
  }

  /**
   * 撤销上一次停止：删掉刚生成的记录，并把计时状态恢复到停止前（暂停中）。
   */
  function undo() {
    if (!snapshot) return { ok: false, reason: '没有可撤销的操作' };
    const snap = snapshot;
    snapshot = null;
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }

    store().commit(function (state) {
      if (snap.recordId) {
        state.records = state.records.filter(function (r) { return r.id !== snap.recordId; });
      }
      return state;
    });

    rt = {
      projectId: snap.payload.projectId,
      state: 'paused',
      activeMs: snap.payload.activeMs,
      pausedMs: snap.payload.pausedMs,
      segmentStartAt: snap.payload.segmentStartAt,
      lastResumeAt: null,
      lastPauseAt: snap.payload.lastPauseAt || snap.payload.endAt,
      lastSeenAt: nowIso()
    };
    persist();
    startHeartbeat();

    if (snap.recordId) {
      global.TTUI.toast.show({ text: '已撤销，那段计时回到了暂停状态', durationSec: 4 });
    } else {
      global.TTUI.toast.show({ text: '已撤销', durationSec: 4 });
    }
    return { ok: true };
  }

  // ------------------------------------------- 关闭页面：结束这一段并保存
  /**
   * 关闭页面 / 关闭浏览器 / 关掉应用时调用：
   * **这一段直接结束**——够阈值就存成记录，不够就丢弃；不会留下"暂停中"的段。
   *
   * 之所以要在这里同步做完：页面马上就没机会再执行代码了。
   * 所以整个过程只用同步的写入，不发提示（页面已经在关了，提示没人看得到）。
   *
   * options.nowIso 仅供自检使用（模拟"在某个时刻关闭了浏览器"）。
   */
  function finalizeOnClose(options) {
    const opts = options || {};
    if (!rt.state) return { ok: false, reason: 'idle', saved: false };

    const atIso = opts.nowIso || nowIso();
    const activeMs = opts.nowIso ? activeMsAt(rt, atIso) : activeMsNow();
    const pausedMs = opts.nowIso ? pausedMsAt(rt, atIso) : pausedMsNow();
    const activeSec = Math.round(activeMs / 1000);
    const pausedSec = Math.round(pausedMs / 1000);

    const project = projectById(rt.projectId);
    const threshold = minSeconds();
    const shouldSave = !!project && activeSec >= threshold;

    const payload = {
      projectId: rt.projectId,
      projectName: project ? project.name : '（已删除的项目）',
      segmentStartAt: rt.segmentStartAt,
      endAt: atIso,
      activeSec: activeSec,
      pausedSec: pausedSec,
      segmentId: rt.segmentId
    };

    let record = null;
    let savedForReal = false;
    store().commit(function (state) {
      if (shouldSave) {
        record = buildRecord(payload);
        savedForReal = pushRecord(state, record);
      }
      state.runtime = emptyRuntime();
      return state;
    });
    store().flush();          // 页面即将关闭，必须立刻落盘
    stopHeartbeat();
    rt = emptyRuntime();

    return {
      ok: true,
      saved: shouldSave,
      discarded: !shouldSave,
      duplicate: shouldSave && !savedForReal,
      activeSec: activeSec,
      pausedSec: pausedSec,
      record: record,
      threshold: threshold
    };
  }

  /**
   * 启动时的兜底：上次是"运行中/暂停中"却没有正常结束（浏览器被强杀、进程被杀），
   * 存储里还留着一段现场。处理方式与正常关闭一致：**结束这一段**，
   * 但只按"最后一次落盘的时刻"结算——绝不用当前时间补算（否则会凭空多出关机那几小时）。
   *
   * options.saved 仅供自检使用：直接指定"存储里的那段现场"，便于精确验证。
   */
  function reconcileOnLoad(options) {
    const opts = options || {};
    const state = store().getState();
    const saved = opts.saved || state.runtime;

    if (!saved || !saved.state || !saved.projectId) {
      rt = emptyRuntime();
      stopHeartbeat();
      return { recovered: false, saved: false };
    }

    // 结算到"最后一次落盘时刻"
    const settleIso = saved.lastSeenAt || saved.lastResumeAt || saved.lastPauseAt || nowIso();
    const activeMs = activeMsAt(saved, settleIso);
    const pausedMs = pausedMsAt(saved, settleIso);
    const activeSec = Math.round(activeMs / 1000);
    const pausedSec = Math.round(pausedMs / 1000);

    const project = state.projects.filter(function (p) { return p.id === saved.projectId; })[0];
    const threshold = minSeconds();
    const shouldSave = !!project && activeSec >= threshold;

    let record = null;
    let savedForReal = false;
    store().commit(function (s) {
      if (shouldSave) {
        record = buildRecord({
          projectId: saved.projectId,
          segmentStartAt: saved.segmentStartAt,
          endAt: settleIso,
          activeSec: activeSec,
          pausedSec: pausedSec,
          segmentId: saved.segmentId
        });
        savedForReal = pushRecord(s, record);
      }
      s.runtime = emptyRuntime();
      return s;
    });
    store().flush();
    stopHeartbeat();
    rt = emptyRuntime();

    const toast = global.TTUI && global.TTUI.toast;
    const projectName = project ? project.name : '（已删除的项目）';
    if (toast) {
      if (shouldSave) {
        toast.show({
          text: '上次「' + projectName + '」的计时没有正常结束，已按最后记录的时刻保存',
          detail: '投入 ' + calc.fmtDuration(activeSec) + '　请确认这段时间是否准确'
        });
      } else if (activeSec > 0) {
        toast.show({
          text: '上次「' + projectName + '」的计时没有正常结束，那段不到 ' +
            describeThreshold(threshold) + '，没有计入',
          detail: '实际投入 ' + calc.fmtDuration(activeSec),
          tone: 'warn'
        });
      }
    }

    return {
      recovered: true,
      saved: shouldSave,
      discarded: !shouldSave,
      duplicate: shouldSave && !savedForReal,
      activeSec: activeSec,
      pausedSec: pausedSec,
      projectId: saved.projectId,
      threshold: threshold
    };
  }

  /** 测试与诊断用：直接读内部状态。 */
  function debugState() {
    return {
      state: rt.state,
      projectId: rt.projectId,
      activeMs: activeMsNow(),
      pausedMs: pausedMsNow(),
      hasSnapshot: hasSnapshot()
    };
  }

  function resetForTest() {
    stopHeartbeat();
    rt = emptyRuntime();
    snapshot = null;
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }

  /**
   * 仅自检使用：直接摆出一段"暂停中"的现场。
   * 目的：在不必真的等几分钟的前提下验证结算规则（阈值判定、专注度、撤销）。
   * 业务代码不会调用它。
   */
  function debugRestore(session) {
    const s = session || {};
    if (!s.projectId) return { ok: false, reason: '需要 projectId' };
    rt = {
      projectId: s.projectId,
      state: 'paused',
      activeMs: Math.round((s.activeSec || 0) * 1000),
      pausedMs: Math.round((s.pausedSec || 0) * 1000),
      segmentStartAt: s.segmentStartAt || nowIso(),
      lastResumeAt: null,
      lastPauseAt: nowIso(),
      lastSeenAt: nowIso(),
      segmentId: s.segmentId || calc.makeId('seg')
    };
    persist();
    startHeartbeat();
    return { ok: true, segmentId: rt.segmentId };
  }

  global.TTTimer = {
    HEARTBEAT_MS: HEARTBEAT_MS,
    start: start,
    pause: pause,
    resume: resume,
    stop: stop,
    undo: undo,
    hasSnapshot: hasSnapshot,
    isBusy: isBusy,
    activeProjectId: activeProjectId,
    currentSegmentMs: currentSegmentMs,
    activeMsNow: activeMsNow,
    pausedMsNow: pausedMsNow,
    heartbeat: heartbeat,
    finalizeOnClose: finalizeOnClose,
    reconcileOnLoad: reconcileOnLoad,
    debugState: debugState,
    debugRestore: debugRestore,
    resetForTest: resetForTest
  };
})(typeof window !== 'undefined' ? window : globalThis);
