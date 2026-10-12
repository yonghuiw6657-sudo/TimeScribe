/**
 * P4 计时核心（浏览器运行）
 *
 * 覆盖 PRD 验收 C1–C4、C9–C12。计时是全 app 最关键的部分。
 * 这里全部通过**真实点击界面按钮**来驱动，而不是直接调函数，
 * 这样按钮绑定错了也能被测出来。
 *
 * 三条容易搞混的生命周期规则（都曾经写错过，见测试里的注释）：
 *   · 切走浏览器（切标签、切应用、最小化）→ 计时**照常在后台走**，绝不暂停
 *   · 刷新页面 → **这一段不结束**，刷新后接着计时（第六轮按用户反馈改的）
 *   · 关闭页面 / 关闭浏览器 / 关掉应用 → **这一段结束**：够阈值就存成记录，不够就丢弃
 *
 * 注意"刷新"和"重新打开"在测试里必须是两种不同的动作：
 *   · `hardReloadApp()` 调 location.reload()，浏览器算"刷新"，应用才会接着计时
 *   · `reloadApp()` 换一个网址重新加载，浏览器算"导航"，等同于关掉再打开
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

/** 真正地刷新一次（等同用户按 F5），并等它启动完成。 */
async function hardReloadApp() {
  const f = document.getElementById('app-frame');
  const win = f.contentWindow;
  T.ok(win && win.location, '被测 app 未加载，无法刷新');
  await new Promise(function (resolve) {
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    f.addEventListener('load', finish, { once: true });
    win.location.reload();
    setTimeout(finish, 8000);
  });
  const ok = await waitFor(function () {
    return f.contentWindow.__TIMESCRIBE_BOOT__ ? true : null;
  }, 8000);
  if (!ok) throw new Error('刷新后 app 没有完成启动');
  return f.contentWindow;
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

  // ------------------------------------------- 卸载那一刻：只留现场，不结算
  T.test('卸载页面时（刷新和关闭都会触发）不急着结算，只留下现场与"告别记号"', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    click(startButton(p.id));
    await sleep(1200);

    // 这一步就是真实接线挂在 pagehide / beforeunload 上的处理器
    const win = document.getElementById('app-frame').contentWindow;
    win.__TT_HANDLE_CLOSE__();

    const snap = diskRuntime();
    T.equal(snap.state, 'running', '卸载时不该把这一段结算掉——现场要留着，等下次打开再定');
    T.ok(snap.closedAt, '卸载时应留下"正常告别"的记号（用于区分"关掉了/刷新了"与"被强杀"）');
    T.ok(snap.activeMs >= 1000, '离开那一刻的投入量应写进快照，实际 ' + snap.activeMs + 'ms');
    T.equal(state().records.length, 0, '卸载那一刻不该生成记录（此刻还分不清是刷新还是关闭）');
    T.equal(timer().debugState().state, 'running', '内存里也还在计时——页面此刻并没有真的走');
  });

  T.test('关闭浏览器/关掉应用：下次打开才结算，且只算到离开那一刻（C9）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);

    // 用户离开了页面（应用只落盘，不结算）
    const win0 = document.getElementById('app-frame').contentWindow;
    win0.__TT_HANDLE_CLOSE__();
    // 让这个页面在内存里也进入空闲：它真的已经关掉了。
    // 不这么做的话，等一下测试页去导航时它还会再触发一次 pagehide，
    // 把"离开那一刻"顺手推后——那是测试的假象，真实关闭只会触发一次。
    win0.TTTimer.resetForTest();

    // 之后过了 2.5 秒才重新打开——这段时间绝不能算成投入
    await sleep(2500);
    const win = await reloadApp('');        // 重新打开 = 一次导航，不是刷新
    const records = win.TTStore.getState().records;
    T.equal(records.length, 1, '重新打开时应把上一次那一段结算保存下来');
    const sec = records[0].activeSec;
    T.ok(sec >= 1 && sec <= 3,
      '只应算到离开页面那一刻（约 2 秒），不能把关掉后等的 2.5 秒算进去。实际 ' + sec + ' 秒');
    T.equal(records[0].projectId, p.id);
    T.equal(win.TTTimer.debugState().state, null, '重新打开时不该有进行中的段');
    T.equal(win.TTStore.getState().runtime.state, null, '存储里也不该残留进行中的段');
    T.notContains(win.document.getElementById('toast-host').textContent, '没有正常结束',
      '用户是自己关掉的，不该说他"没有正常结束"');
  });

  T.test('关闭页面时不足阈值：直接丢弃，不留残留', async function () {
    await resetAppData();
    T.equal(state().settings.minSeconds, 120, '默认阈值是 2 分钟');
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const win0 = document.getElementById('app-frame').contentWindow;
    win0.__TT_HANDLE_CLOSE__();
    win0.TTTimer.resetForTest();       // 页面真的走了

    const win = await reloadApp('');
    T.equal(win.TTStore.getState().records.length, 0, '不足阈值不该生成记录');
    T.equal(win.TTTimer.debugState().state, null);
    T.equal(diskRuntime().state, null, '也不该留下"进行中"的段让下次打开继续');
  });

  // ------------------------------------------- 刷新 = 接着计时（第六轮）
  T.test('刷新页面：这一段的计时不结束，刷新后接着走（C10 的新行为）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');

    // 先回到不带 fresh=1 的网址：那是测试页用来清数据的开关，真刷新时会把它一起带回来
    await reloadApp('');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const before = timer().currentSegmentMs();
    T.ok(before >= 1000, '刷新前应已经走了一点，实际 ' + before + 'ms');

    const win = await hardReloadApp();       // 真刷新（等同按 F5）
    const st = win.TTTimer.debugState();
    T.equal(st.state, 'running', '刷新后应继续计时，而不是把这一段结束掉');
    T.equal(st.projectId, p.id, '刷新后仍是同一个项目在计时');
    T.equal(win.TTStore.getState().records.length, 0, '刷新不该生成任何记录');
    T.contains(win.document.querySelector('[data-project-card="' + p.id + '"]').textContent, '计时中',
      '刷新后卡片应仍显示"计时中"');
    T.ok(win.TTTimer.currentSegmentMs() >= before,
      '刷新后已投入时间应从刷新前接着涨（' + before + ' → ' + win.TTTimer.currentSegmentMs() + 'ms）');

    // 刷新后继续累计，而且是一段连续的时间
    await sleep(1200);
    T.ok(win.TTTimer.currentSegmentMs() >= before + 1000, '刷新后应继续累计');
    T.equal(win.TTTimer.debugState().state, 'running');

    win.TTTimer.stop();
    const records = win.TTStore.getState().records;
    T.equal(records.length, 1, '刷新前后应算作同一段，最终只落一条记录');
    T.ok(records[0].activeSec >= 2,
      '刷新前 + 刷新后都应算进这一段，实际 ' + records[0].activeSec + ' 秒');
  });

  T.test('刷新时处于"暂停中"：刷新后仍是暂停中，这一段也不结束', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    await reloadApp('');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    click(actionButton(p.id, 'pause'));
    const invested = timer().currentSegmentMs();
    T.equal(timer().debugState().state, 'paused');

    const win = await hardReloadApp();
    const st = win.TTTimer.debugState();
    T.equal(st.state, 'paused', '刷新后应仍是"暂停中"，而不是把这一段结束掉');
    T.equal(st.projectId, p.id, '刷新后仍是同一个项目的这一段');
    T.equal(win.TTStore.getState().records.length, 0, '刷新不该生成任何记录');
    T.ok(Math.abs(win.TTTimer.currentSegmentMs() - invested) < 1000,
      '已投入时间应原样接回来（' + invested + ' → ' + win.TTTimer.currentSegmentMs() + 'ms）');
    T.ok(actionButton(p.id, 'resume'), '刷新后界面应处于暂停态，能点"继续"');
  });

  T.test('异常退出（被强杀、没走正常关闭）：按最后一次落盘时刻结算并保存（C9 兜底）', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    // 造一段现场：开始于 30 秒前，最后一次落盘在 10 秒前。
    // 快照里记的 activeMs 就是"截至 lastSeenAt 一共投入了 20 秒"，
    // 而最后 10 秒是崩溃之后流逝的，必须只结算那 20 秒，不能补算到"现在"（那会变成 30 秒）。
    // 注意这里没有 closedAt：说明上一次不是关掉/刷新，而是被强杀。
    const base = Date.now();
    const resumeAt = new Date(base - 30000).toISOString();
    const seenAt = new Date(base - 10000).toISOString();
    timer().resetForTest();

    const result = timer().reconcileOnLoad({
      saved: {
        projectId: p.id,
        state: 'running',
        activeMs: 20000,
        pausedMs: 0,
        segmentStartAt: resumeAt,
        lastResumeAt: resumeAt,
        lastPauseAt: null,
        lastSeenAt: seenAt
      }
    });

    T.equal(result.recovered, true);
    T.equal(result.crashed, true, '没有"告别记号"应判为被强杀');
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
        projectId: p.id, state: 'running', activeMs: 28000, pausedMs: 0,
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

  T.test('刷新接回来：投入量从离开那一刻接着走，绝不翻倍', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    // 一段真实走过 20 秒的现场，3 秒前被刷掉了（快照里的 activeMs 就是那 20 秒）
    const base = Date.now();
    const resumeAt = new Date(base - 23000).toISOString();
    const seenAt = new Date(base - 3000).toISOString();
    timer().resetForTest();

    const result = timer().reconcileOnLoad({
      isReload: true,
      saved: {
        projectId: p.id, state: 'running', activeMs: 20000, pausedMs: 0,
        segmentStartAt: resumeAt, lastResumeAt: resumeAt, lastPauseAt: null,
        lastSeenAt: seenAt, closedAt: seenAt, segmentId: 'seg-reload-1'
      }
    });

    T.equal(result.recovered, true);
    T.equal(result.restored, true, '刷新应走"接回来"这条路');
    T.equal(result.saved, false);
    T.equal(state().records.length, 0, '刷新不该生成记录');
    T.equal(timer().debugState().state, 'running');
    T.equal(timer().debugState().projectId, p.id);

    // 离开的那 3 秒算作投入（本来也不该扣），所以是 20 + 3 秒左右；
    // 如果哪天又写出"锚点加两遍"的毛病，这里会直接变成 40 秒以上。
    const now = timer().currentSegmentMs();
    T.ok(now >= 23000 && now < 24000,
      '刷新后投入量应是 20 秒 + 离开的 3 秒 ≈ 23 秒，不能翻倍也不能丢。实际 ' + now + 'ms');
    T.equal(diskRuntime().segmentId, 'seg-reload-1', '存储里应还是同一段（不是新开一段）');
    timer().stop();
  });

  T.test('现场躺了太久（比如关掉浏览器几小时后由浏览器恢复标签）不当作刷新', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    // 两小时前离开的现场：即便浏览器说"这是 reload"，也绝不能接回来——
    // 否则这两小时会被当成投入。
    const base = Date.now();
    const resumeAt = new Date(base - 2 * 3600 * 1000).toISOString();
    const seenAt = new Date(base - 2 * 3600 * 1000 + 20000).toISOString();
    timer().resetForTest();

    const result = timer().reconcileOnLoad({
      isReload: true,
      saved: {
        projectId: p.id, state: 'running', activeMs: 20000, pausedMs: 0,
        segmentStartAt: resumeAt, lastResumeAt: resumeAt, lastPauseAt: null,
        lastSeenAt: seenAt, closedAt: seenAt, segmentId: 'seg-stale-1'
      }
    });

    T.equal(result.restored, false, '躺了太久的现场不该接回来');
    T.equal(result.saved, true);
    T.equal(result.activeSec, 20, '只结算当时真正投入的 20 秒，那两小时不算');
    T.equal(timer().debugState().state, null, '不该留下进行中的段');
  });

  T.test('暂停中关闭页面：那一段也结束并保存', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();

    click(startButton(p.id));
    await sleep(1200);
    const runningFor = timer().currentSegmentMs();
    click(actionButton(p.id, 'pause'));
    await sleep(500);

    // 卸载那一刻只落盘，不结算
    const win0 = document.getElementById('app-frame').contentWindow;
    win0.__TT_HANDLE_CLOSE__();
    const snap = diskRuntime();
    const detail = '（快照：' + JSON.stringify(snap) + '，暂停前走了 ' + runningFor + 'ms）';
    T.equal(snap.state, 'paused', '卸载时存储里应还是"暂停中"（说明没有提前结算）' + detail);
    T.ok(snap.activeMs >= 1000, '已投入的毫秒数应写进快照' + detail);
    T.ok(snap.pausedMs >= 400, '暂停时长也应写进快照' + detail);
    win0.TTTimer.resetForTest();       // 页面真的走了，别让它稍后再补一次 pagehide

    // 重新打开时才结算
    const win = await reloadApp('');
    const records = win.TTStore.getState().records;
    T.equal(records.length, 1, '暂停中关掉也应把已投入的部分保存下来' + detail);
    T.ok(records[0].activeSec >= 1, '已投入应至少 1 秒' + detail);
    T.ok(records[0].pausedSec >= 0, '暂停时长不该是负数或缺失' + detail);
    T.equal(win.TTTimer.debugState().state, null, '不该留下进行中的段' + detail);
  });

  T.test('空闲时关闭页面不会产生任何记录或残留', async function () {
    await resetAppData();
    addProject('工作');
    m('TTUI').home.render();
    m('TTStore').flush();

    // 空闲时卸载：没有现场可留，更不该冒出记录
    document.getElementById('app-frame').contentWindow.__TT_HANDLE_CLOSE__();
    T.equal(diskRuntime().state, null, '存储里本来就没有进行中的段');

    const win = await reloadApp('');
    T.equal(win.TTStore.getState().records.length, 0);
    T.equal(diskRuntime().state, null, '重新打开后也不该有残留');
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
    T.equal(state().records[0].activeSec, Math.round(snapshot.activeMs / 1000),
      '结算出来的时长就是快照里那个总量（快照存的是"截至 lastSeenAt 的总量"，不能再叠一遍锚点导致翻倍）');

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
