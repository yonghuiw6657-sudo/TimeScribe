/**
 * P4 计时核心（浏览器运行）
 *
 * 覆盖 PRD 验收 C1–C4、C9–C12。计时是全 app 最关键的部分。
 * 这里全部通过**真实点击界面按钮**来驱动，而不是直接调函数，
 * 这样按钮绑定错了也能被测出来。
 *
 * 两条容易搞混的生命周期规则（曾经写错过，见测试里的注释）：
 *   · 切走浏览器（切标签、切应用、最小化）→ 计时**照常在后台走**，绝不暂停
 *   · 关闭页面 / 关闭浏览器 / 关掉应用 → **这一段直接结束**：够阈值就存成记录，不够就丢弃
 */
import {
  T, q, qa, m, resetAppData, state, addProject, click, textOf, lastToast, clearToasts,
  sleep, waitFor, setMinSeconds
} from './helpers.mjs';

function timer() { return m('TTTimer'); }

function startButton(projectId) {
  return q('[data-project-card="' + projectId + '"] [data-action="start"]');
}

function actionButton(projectId, action) {
  return q('[data-project-card="' + projectId + '"] [data-action="' + action + '"]');
}

function meterText(projectId) {
  return textOf('[data-meter-for="' + projectId + '"]');
}

function diskRuntime() {
  return JSON.parse(m('TTStorage').readRaw()).runtime;
}

/** 让被测 app 重新加载，并等它启动完成。 */
async function reloadApp(query) {
  const f = document.getElementById('app-frame');
  await new Promise(function (resolve) {
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    f.addEventListener('load', finish, { once: true });
    f.src = '../index.html?' + (query || '') + '&t=' + Date.now();
    setTimeout(finish, 8000);
  });
  const ok = await waitFor(function () {
    return f.contentWindow.__TIMESCRIBE_BOOT__ ? true : null;
  }, 8000);
  if (!ok) throw new Error('重新加载后 app 没有完成启动');
  return f.contentWindow;
}

T.defineSuite('P4', '计时器：四种状态与规则', async function () {
  T.test('开始计时：秒表开始走，卡片显示"计时中"（C1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    const st = timer().debugState();
    T.equal(st.state, 'running');
    T.equal(st.projectId, p.id);

    const card = q('[data-project-card="' + p.id + '"]');
    T.contains(card.textContent, '计时中', '卡片应显示"计时中"');
    T.contains(card.className, 'running', '卡片应带计时中的高亮样式');
    T.ok(actionButton(p.id, 'pause'), '计时中应显示暂停按钮');
    T.ok(actionButton(p.id, 'stop'), '计时中应显示停止按钮');

    await sleep(1100);
    T.ok(/00:00:0[1-9]/.test(meterText(p.id)), '秒表应该开始走动，实际 ' + meterText(p.id));
    timer().stop();
  });

  T.test('暂停期间秒表不动，继续后接着走（C2）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    click(startButton(p.id));
    await sleep(1100);

    click(actionButton(p.id, 'pause'));
    T.equal(timer().debugState().state, 'paused');

    const frozen = timer().currentSegmentMs();
    await sleep(900);
    T.equal(Math.round(timer().currentSegmentMs() / 1000), Math.round(frozen / 1000),
      '暂停期间投入时间不该增长');
    T.ok(timer().pausedMsNow() >= 800, '暂停时长应在累积，实际 ' + timer().pausedMsNow());

    const card = q('[data-project-card="' + p.id + '"]');
    T.contains(card.textContent, '已暂停');
    T.ok(actionButton(p.id, 'resume'), '暂停中应显示继续按钮');

    click(actionButton(p.id, 'resume'));
    T.equal(timer().debugState().state, 'running');
    await sleep(700);
    T.ok(timer().currentSegmentMs() > frozen, '继续后投入时间应继续增长');
    timer().stop();
  });

  T.test('停止后生成一条记录，暂停时长也如实记下（C3）', async function () {
    await resetAppData();
    setMinSeconds(0);                 // 门槛行为由 P6 专门验证，这里验证的是结算本身
    const p = addProject('工作');
    m('TTUI').home.render();
    click(startButton(p.id));
    await sleep(1100);
    click(actionButton(p.id, 'pause'));
    await sleep(700);
    click(actionButton(p.id, 'resume'));
    await sleep(300);
    click(actionButton(p.id, 'stop'));

    T.equal(timer().debugState().state, null, '停止后应回到空闲');
    T.equal(state().records.length, 1, '应生成一条记录');
    const r = state().records[0];
    T.equal(r.projectId, p.id);
    T.ok(r.activeSec >= 1, '投入至少 1 秒，实际 ' + r.activeSec);
    T.ok(r.pausedSec >= 0, '暂停秒数应被记下');
    T.equal(r.source, 'timer');
    T.equal(r.date, m('TTCalc').todayStr(), '日期应是今天（本地时区）');
    T.equal(meterText(p.id), '00:00:00', '秒表应归零');
  });

  T.test('全局只有一个计时器：开始新的会自动停掉旧的（C4）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const a = addProject('甲');
    const b = addProject('乙');
    m('TTUI').home.render();

    click(startButton(a.id));
    await sleep(1100);
    T.equal(timer().debugState().projectId, a.id);

    click(startButton(b.id));
    const st = timer().debugState();
    T.equal(st.projectId, b.id, '当前计时器应切换到乙');
    T.ok(st.activeMs < 1000, '乙应从 0 开始计时');

    T.equal(state().records.length, 1, '甲那一段应被自动结算成 1 条记录');
    T.equal(state().records[0].projectId, a.id);

    const running = qa('.pcard.running, .srow.running');
    T.equal(running.length, 1, '同一时刻只能有一个计时中的卡片');
    T.contains(running[0].textContent, '乙');
    timer().stop();
  });

  T.test('自动停止（被别的项目挤掉）不提供撤销，避免误解（C5 的反面）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const a = addProject('甲');
    const b = addProject('乙');
    m('TTUI').home.render();

    click(startButton(a.id));
    await sleep(1100);
    clearToasts();
    click(startButton(b.id));

    T.equal(q('#toast-host .undo'), null, '自动停止不该给出撤销按钮（用户已经在做下一件事了）');
    const toast = lastToast();
    T.ok(toast, '应有一句说明');
    T.contains(toast.textContent, '自动停止');

    const undone = timer().undo();
    T.equal(undone.ok, false, '没有可撤销的现场');
    T.equal(state().records.length, 1, '甲那一段的记录应该保留');
    timer().stop();
  });

  // ------------------------------------------------------ 后台运行（曾经的 bug）
  T.test('切走浏览器（切标签/切应用）不会暂停计时，在后台照常累计', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    const win = m('TTUI') ? document.getElementById('app-frame').contentWindow : null;

    click(startButton(p.id));
    await sleep(1200);
    const before = timer().currentSegmentMs();

    // 这一步就是真实接线的"切到后台"处理器
    win.__TT_HANDLE_HIDDEN__();

    T.equal(timer().debugState().state, 'running', '切走浏览器绝不该把计时改成暂停');
    T.contains(textOf('[data-project-card="' + p.id + '"]'), '计时中');
    T.equal(diskRuntime().state, 'running', '存储里的快照也应是"进行中"');

    await sleep(1200);
    T.ok(timer().currentSegmentMs() >= before + 1000,
      '切走期间计时应继续累计（' + before + ' → ' + timer().currentSegmentMs() + '）');

    // 切回来（visible）不该有任何副作用
    click(actionButton(p.id, 'stop'));
    T.equal(state().records.length, 1, '切走再切回来不该丢掉这一段');
    T.ok(state().records[0].activeSec >= 2, '应记下后台那段时间，实际 ' + state().records[0].activeSec + ' 秒');
  });

  T.test('切到后台时会把进度写进存储（万一被强杀，最多丢一个心跳）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    const win = document.getElementById('app-frame').contentWindow;

    click(startButton(p.id));
    await sleep(1200);
    const beforeSeen = diskRuntime().lastSeenAt;
    await sleep(1100);
    win.__TT_HANDLE_HIDDEN__();

    const after = diskRuntime();
    T.equal(after.state, 'running');
    T.ok(after.lastSeenAt > beforeSeen, '切到后台时应刷新"最后一次落盘时刻"');
    T.ok(after.activeMs >= 1000, '快照里应带上已投入的毫秒数，实际 ' + after.activeMs);
    timer().stop();
  });

  T.test('心跳间隔是个合理的小数值（保证强杀时损失可控）', function () {
    T.ok(timer().HEARTBEAT_MS <= 30000, '心跳应不慢于 30 秒，实际 ' + timer().HEARTBEAT_MS);
    T.ok(timer().HEARTBEAT_MS >= 5000, '也不该过于频繁地写盘，实际 ' + timer().HEARTBEAT_MS);
  });

  // ------------------------------------------- 关闭页面 = 结束这一段并保存
  T.test('关闭页面：这一段直接结束并保存，够阈值才存（用户要的行为）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    click(startButton(p.id));
    await sleep(1200);

    // 模拟"1 秒后关闭了浏览器"
    const closeAt = new Date(Date.now() + 1000).toISOString();
    const result = timer().finalizeOnClose({ nowIso: closeAt });

    T.equal(result.saved, true, '够阈值就应保存');
    T.equal(result.activeSec, 2, '应结算到关闭那一刻（约 2 秒），实际 ' + result.activeSec);
    T.equal(state().records.length, 1, '应生成 1 条记录');
    T.equal(state().records[0].activeSec, 2);
    T.equal(state().records[0].projectId, p.id);

    T.equal(timer().debugState().state, null, '不该留下任何"暂停中"的段');
    T.equal(diskRuntime().state, null, '存储里也不该残留进行中的段');

    // 关闭之后的时间不能被算进去
    await sleep(2500);
    T.equal(state().records.length, 1);
    T.equal(state().records[0].activeSec, 2, '关闭之后的时间不该被补算');
  });

  T.test('关闭页面时不足阈值：直接丢弃，不留残留', async function () {
    await resetAppData();
    T.equal(state().settings.minSeconds, 120, '默认阈值是 2 分钟');
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const result = timer().finalizeOnClose();

    T.equal(result.saved, false);
    T.equal(result.discarded, true);
    T.equal(state().records.length, 0, '不足阈值不该生成记录');
    T.equal(timer().debugState().state, null);
    T.equal(diskRuntime().state, null, '也不该留下"暂停中"的段让下次打开继续');
  });

  T.test('真实刷新页面：那一段被结算成记录，不再有"暂停中"（C10 的新行为）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const before = timer().currentSegmentMs();

    const win = await reloadApp('');       // 真实刷新（会触发 pagehide）
    const st = win.TTTimer.debugState();
    T.equal(st.state, null, '刷新后不该留下暂停中的段');
    T.equal(st.projectId, null);

    const records = win.TTStore.getState().records;
    T.equal(records.length, 1, '刷新前那一段应被保存下来（数据不丢）');
    const sec = records[0].activeSec;
    T.ok(sec >= 1, '时长应至少 1 秒，实际 ' + sec);
    T.ok(sec <= 5, '只应算到关闭那一刻，不能把刷新后的时间也算进去（' + before + ' → ' + sec + ' 秒）');
    T.contains(win.document.getElementById('stat-total').textContent, win.TTCalc.fmtDuration(sec));
  });

  T.test('关闭浏览器只结算到关闭那一刻，不凭空多出时间（C9）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1100);

    // 1 秒后关闭，然后我们故意再等 3 秒才"重新打开"
    const closeAt = new Date(Date.now() + 1000).toISOString();
    timer().finalizeOnClose({ nowIso: closeAt });
    await sleep(3000);

    const win = await reloadApp('');
    const records = win.TTStore.getState().records;
    T.equal(records.length, 1);
    const sec = records[0].activeSec;
    T.ok(sec >= 1 && sec <= 3,
      '记录时长应只到"关闭那一刻"（约 2 秒），不能把关闭后等的 3 秒算进去。实际 ' + sec + ' 秒');
    T.equal(win.TTTimer.debugState().state, null, '重新打开时不该有进行中的段');
  });

  T.test('异常退出（被强杀、没走正常关闭）：按最后一次落盘时刻结算并保存（C9 兜底）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    // 造一段现场：开始于 30 秒前，最后一次落盘在 10 秒前。
    // 也就是说这 20 秒是"计时中真实走过并被落盘的时间"，而最后 10 秒是崩溃后流逝的，
    // 必须只结算前 20 秒，不能补算到"现在"（那会变成 30 秒）。
    const base = Date.now();
    const resumeAt = new Date(base - 30000).toISOString();
    const seenAt = new Date(base - 10000).toISOString();
    timer().resetForTest();

    const result = timer().reconcileOnLoad({
      saved: {
        projectId: p.id,
        state: 'running',
        activeMs: 0,
        pausedMs: 0,
        segmentStartAt: resumeAt,
        lastResumeAt: resumeAt,
        lastPauseAt: null,
        lastSeenAt: seenAt
      }
    });

    T.equal(result.recovered, true);
    T.equal(result.saved, true, '够阈值应保存');
    T.equal(result.activeSec, 20, '只应结算到最后落盘时刻（20 秒），而不是补算到"现在"（30 秒）');
    T.ok(result.activeSec < 30, '崩溃后的那 10 秒绝不能被算进去');
    T.equal(state().records.length, 1);
    T.equal(state().records[0].activeSec, 20);
    T.equal(timer().debugState().state, null, '兜底后不该留进行中的段');
    T.contains(textOf('#toast-host'), '已按最后记录的时刻保存');
  });

  T.test('异常退出且不足阈值：丢弃并明确告知', async function () {
    await resetAppData();      // 默认 2 分钟阈值
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    const resumeAt = new Date(Date.now() - 30000).toISOString();
    const seenAt = new Date(Date.now() - 2000).toISOString();
    timer().resetForTest();

    const result = timer().reconcileOnLoad({
      saved: {
        projectId: p.id, state: 'running', activeMs: 0, pausedMs: 0,
        segmentStartAt: resumeAt, lastResumeAt: resumeAt, lastPauseAt: null, lastSeenAt: seenAt
      }
    });

    T.equal(result.saved, false);
    T.equal(result.discarded, true);
    T.equal(state().records.length, 0, '不足 2 分钟不该生成记录');
    T.contains(textOf('#toast-host'), '没有正常结束');
    T.contains(textOf('#toast-host'), '2 分钟');
    T.equal(timer().debugState().state, null);
  });

  T.test('暂停中关闭页面：那一段也直接结束并保存', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const runningFor = timer().currentSegmentMs();
    click(actionButton(p.id, 'pause'));
    await sleep(500);

    const result = timer().finalizeOnClose();
    const detail = '（返回：' + JSON.stringify(result) + '，暂停前走了 ' + runningFor + 'ms）';
    T.ok(result.ok, '应真的处理了一段，而不是以为自己空闲' + detail);
    T.equal(result.saved, true, '暂停中关闭也应把已投入的部分保存下来' + detail);
    T.ok(result.activeSec >= 1, '已投入应至少 1 秒' + detail);
    T.ok(result.pausedSec >= 0, '暂停时长不该是负数或缺失' + detail);
    T.equal(state().records.length, 1, '应生成记录' + detail);
    T.equal(timer().debugState().state, null, '不该留下进行中的段' + detail);
  });

  T.test('空闲时关闭页面不会产生任何记录或残留', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();
    m('TTStore').flush();

    const result = timer().finalizeOnClose();
    T.equal(result.ok, false);
    T.equal(result.saved, false);
    T.equal(state().records.length, 0);
    T.equal(diskRuntime().state, null, '存储里不该有进行中的段');
  });

  T.test('同一段被重复结算时只记一条（比如计时中又打开了一个页面）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    m('TTStore').flush();

    // 存储里这段现场的编号
    const snapshot = diskRuntime();
    T.ok(snapshot.segmentId, '每段计时应带一个唯一编号，便于去重');

    // 模拟"第二个页面"启动：它会把存储里这段进行中的现场结算保存
    const fromSecondWindow = timer().reconcileOnLoad({
      saved: {
        projectId: snapshot.projectId,
        state: 'running',
        activeMs: snapshot.activeMs,
        pausedMs: snapshot.pausedMs,
        segmentStartAt: snapshot.segmentStartAt,
        lastResumeAt: snapshot.lastResumeAt,
        lastPauseAt: null,
        lastSeenAt: snapshot.lastSeenAt,
        segmentId: snapshot.segmentId
      }
    });
    T.equal(fromSecondWindow.saved, true, '第二个页面应把这段保存下来');
    T.equal(state().records.length, 1);

    // 第一个页面并不知道这件事，它内存里还在继续计时，稍后停止
    timer().debugRestore({
      projectId: p.id,
      activeSec: 90,
      pausedSec: 0,
      segmentId: snapshot.segmentId
    });
    const stopped = timer().stop();

    T.equal(state().records.length, 1,
      '同一段绝不能被记两次（否则投入时间会凭空翻倍）');
    T.equal(state().records[0].id, 'rec-' + snapshot.segmentId, '记录 id 由段编号推导');
    T.equal(stopped.record.id, 'rec-' + snapshot.segmentId);
  });

  T.test('计时中卡片上的"共 X"不实时跳动，停止后才更新（C12）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    click(startButton(p.id));

    // 31 秒：展示时会四舍五入成 1 分，便于确认"停止后才更新"
    await sleep(31000);

    T.contains(textOf('[data-project-card="' + p.id + '"]'), '共 0 分', '计时中累计数字不该动');

    click(actionButton(p.id, 'stop'));
    const after = textOf('[data-project-card="' + p.id + '"]');
    T.contains(after, '共 1 分', '停止后累计数字应更新');
    T.contains(textOf('#stat-total'), '1 分', '统计区也要更新');
  });

  T.test('快速连点"开始/停止"不会产生两个计时器或重复记录（I4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    for (let i = 0; i < 5; i++) {
      const btn = startButton(p.id);
      if (btn) click(btn);
    }
    T.equal(timer().debugState().state, 'running', '仍应处于计时中');
    T.equal(state().records.length, 0, '连点开始不该产生记录');

    for (let i = 0; i < 5; i++) {
      const btn = actionButton(p.id, 'stop');
      if (btn) click(btn);
    }
    T.equal(timer().debugState().state, null, '应回到空闲');
    T.ok(state().records.length <= 1, '连点停止不该产生多条记录，实际 ' + state().records.length);
  });

  T.test('空闲时点"暂停/继续/停止"没有副作用（不会崩，也不会造数据）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();

    T.equal(timer().pause().ok, false);
    T.equal(timer().resume().ok, false);
    T.equal(timer().stop().ok, false);
    T.equal(state().records.length, 0);
    T.equal(timer().debugState().state, null);
  });

  T.test('计时状态会写入本机存储，便于被强杀后兜底（F1 的地基）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    click(startButton(p.id));
    await sleep(600);
    m('TTStore').flush();

    const parsed = JSON.parse(m('TTStorage').readRaw());
    T.equal(parsed.runtime.projectId, p.id, '计时状态应已落盘');
    T.equal(parsed.runtime.state, 'running', '且应标记为进行中');
    timer().stop();
  });
});
