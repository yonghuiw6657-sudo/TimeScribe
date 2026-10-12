/**
 * P12 每日打卡：日期表 + 点某天看当天的矩形图（浏览器运行）
 *
 * 这个功能有两条最容易做歪的地方，用例主要盯它们：
 *   1) 点没打卡的日期必须**真的什么反应都没有**（不弹窗、不选中、不提示）；
 *   2) 矩形图的口径必须和累计/扇形图一致——只列父项目，子项目并进父项目。
 * 另外"连续打卡"的边界（今天还没打卡算不算断）在 P2 里有用例，这里只看界面上写出来的字。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf,
  modalTitle, topModal, lastToast, clearToasts
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

function shift(days) { return m('TTCalc').addDays(today(), days); }

/** 面板上写的统计数字（0 = 连续打卡，1 = 本月打卡）。 */
function statValue(index) {
  const nodes = qa('#checkin-panel .ck-stats b');
  T.ok(nodes[index], '打卡统计里应有第 ' + index + ' 项');
  return nodes[index].textContent;
}

/** 日历上的某一格。没打卡的日子也是这一格，只是不带动作。 */
function cell(dateStr) {
  const node = q('#checkin-panel .ck-day[data-date="' + dateStr + '"]');
  T.ok(node, '日历上应该有 ' + dateStr + ' 这一格');
  return node;
}

function isChecked(dateStr) { return cell(dateStr).classList.contains('is-checked'); }

function monthKey() { return today().slice(0, 7); }

function firstOfMonth() { return monthKey() + '-01'; }

function daysInThisMonth() {
  const t = today();
  return new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0).getDate();
}

/** 本月里某个"肯定不是今天"的日子：今天是一号就取二号，否则取一号。 */
function otherDayInMonth() {
  const t = today();
  const day = Number(t.slice(8, 10)) === 1 ? 2 : 1;
  return t.slice(0, 8) + ('0' + day).slice(-2);
}

function dayBars() { return qa('#modal-host .ck-bar-row'); }

T.defineSuite('P12', '每日打卡', async function () {

  T.test('首页有打卡面板：标题、七个星期头、当月每一天都有格子', async function () {
    await resetAppData();
    const panel = q('#checkin-panel');
    T.ok(panel, '首页左栏应有打卡面板');
    T.contains(textOf('#checkin-panel h3'), '每日打卡');
    T.contains(textOf('#checkin-panel .ck-stats'), '连续打卡');
    T.contains(textOf('#checkin-panel .ck-stats'), '本月打卡');
    T.equal(qa('#checkin-panel .ck-wd').length, 7, '星期头应该是七个');
    T.equal(qa('#checkin-panel .ck-day[data-date]').length, daysInThisMonth(), '当月每一天都要有一格');
    T.contains(textOf('#checkin-panel .ck-title'), '月', '面板上要写清看的是哪个月');
  });

  T.test('用过的日子被点亮，没用过的日子连动作都没有（E1/E4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 1800);

    const used = cell(today());
    T.ok(used.classList.contains('is-checked'), '有记录的日子应该点亮');
    T.ok(used.classList.contains('is-today'), '今天那一格要有额外标记');
    T.equal(used.getAttribute('data-action'), 'checkin-day', '点亮的日子才是可点的');
    T.contains(used.getAttribute('title'), '投入 30 分');

    const idle = cell(otherDayInMonth());
    T.notOk(idle.classList.contains('is-checked'), '没用过的日子不该点亮');
    T.equal(idle.getAttribute('data-action'), null, '没用过的日子不该带任何动作');
  });

  T.test('今天有没有打卡，界面上立刻反映出来（不需要刷新页面）', async function () {
    await resetAppData();
    const p = addProject('工作');
    T.notOk(isChecked(today()), '一开始今天还没打卡');

    addRecord(p.id, today(), 300);                  // commit → 订阅 → 重绘
    T.ok(isChecked(today()), '记完这一笔，今天那一格应该自己亮起来');
    T.equal(statValue(0), '1 天', '连续打卡跟着变成 1 天');
  });

  T.test('点用过的日子：弹出当天的矩形图（E2/E3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 1800);
    clearToasts();

    click(cell(today()));
    T.ok(topModal(), '应该弹出当天投入的弹窗');
    T.contains(modalTitle(), '当天投入');
    T.contains(modalTitle(), today().slice(5), '标题里要写明看的是哪一天');
    T.contains(textOf('#modal-host .ck-total'), '当天合计 30 分');
    T.contains(textOf('#modal-host .ck-count'), '1 个有投入的项目');
    T.equal(dayBars().length, 1, '只有一个项目有投入');
    T.contains(textOf('#modal-host .ck-bar-row'), '工作');
    T.contains(textOf('#modal-host .ck-bar-val'), '30 分');

    // 关掉之后选中态还在，方便用户对照着看
    m('TTUI').modal.closeAll();
    T.ok(cell(today()).classList.contains('is-selected'), '看过的那天要留个选中标记');
  });

  T.test('矩形图的条长按当天投入的比例（最大的一条占满）', async function () {
    await resetAppData();
    const a = addProject('工作');
    const b = addProject('学习');
    addRecord(a.id, today(), 3600);
    addRecord(b.id, today(), 1800);

    click(cell(today()));
    const rows = dayBars();
    T.equal(rows.length, 2);
    T.contains(rows[0].textContent, '工作', '投入多的排在前面');
    T.equal(rows[0].querySelector('.ck-bar-fill').style.width, '100%', '最长的一条占满');
    T.equal(rows[1].querySelector('.ck-bar-fill').style.width, '50%', '一半时长 → 一半长度');
    T.contains(textOf('#modal-host .ck-total'), '1 小时 30 分');
  });

  T.test('矩形图只列父项目，子项目的投入并进父项目（与扇形图同一口径）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户A', parent.id);
    addRecord(parent.id, today(), 1800);            // 30 分
    addRecord(child.id, today(), 900);              // 15 分，要并进"工作"

    click(cell(today()));
    const rows = dayBars();
    T.equal(rows.length, 1, '子项目不该单独占一行');
    T.contains(rows[0].textContent, '工作');
    T.notContains(textOf('#modal-host .ck-bars'), '客户A');
    T.contains(textOf('#modal-host .ck-total'), '当天合计 45 分', '父项目那一行要含子项目的时长');
    T.contains(textOf('#modal-host .ck-count'), '1 个有投入的项目');
  });

  T.test('矩形图只算当天：别的日子的记录不会混进来', async function () {
    await resetAppData();
    const a = addProject('工作');
    const b = addProject('学习');
    addRecord(a.id, today(), 3600);
    addRecord(b.id, shift(-1), 1800);               // 昨天的

    click(cell(today()));
    T.equal(dayBars().length, 1, '昨天有投入的项目不该出现在今天的图里');
    T.contains(textOf('#modal-host .ck-bars'), '工作');
    T.notContains(textOf('#modal-host .ck-bars'), '学习');
    T.contains(textOf('#modal-host .ck-total'), '当天合计 1 小时');
  });

  T.test('点没用过的日子：不弹窗、不选中、也不提示（E4 的正面验证）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 600);
    m('TTUI').modal.closeAll();
    clearToasts();

    const idle = cell(otherDayInMonth());
    click(idle);

    T.equal(topModal(), null, '点没用过的日子不该弹出任何东西');
    T.equal(m('TTUI').checkin.getSelectedDate(), null, '也不该被选中');
    T.equal(lastToast(), null, '更不该弹提示（要的是"没反应"，不是"告诉你不行"）');
    T.notOk(idle.classList.contains('is-selected'));
  });

  T.test('手动补录同样算这一天有投入', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 1200, { source: 'manual' });

    T.ok(isChecked(today()), '手动补录也是这一天的投入，应该点亮');
    click(cell(today()));
    T.contains(textOf('#modal-host .ck-total'), '当天合计 20 分');
  });

  T.test('连续打卡与本月打卡两个数字都写在面板上', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 600);
    addRecord(p.id, shift(-1), 600);
    addRecord(p.id, shift(-2), 600);

    T.equal(statValue(0), '3 天', '今天起往前数三天都打过卡');
    T.equal(statValue(1), String(m('TTCalc').checkinStats(state(), new Date()).monthCount) + ' 天');
  });

  T.test('今天还没打卡时，连续天数从昨天接着算（不显示成中断）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, shift(-1), 600);
    addRecord(p.id, shift(-2), 600);

    T.equal(statValue(0), '2 天', '今天还没开始用，不该把连续记录算断');
    T.notOk(isChecked(today()));
  });

  T.test('本月打卡天数只数本月，上个月的记录不算进去', async function () {
    await resetAppData();
    const p = addProject('工作');
    const first = firstOfMonth();
    addRecord(p.id, today(), 600);
    if (first !== today()) addRecord(p.id, first, 600);
    addRecord(p.id, m('TTCalc').addDays(first, -1), 600);   // 上个月最后一天

    T.equal(statValue(1), (first === today() ? 1 : 2) + ' 天', '本月打卡不该把上个月算进来');
  });

  T.test('没有任何记录时：两个数字都是 0 天，日历一格都不亮', async function () {
    await resetAppData();
    T.equal(statValue(0), '0 天');
    T.equal(statValue(1), '0 天');
    T.equal(qa('#checkin-panel .ck-day.is-checked').length, 0);
    T.ok(q('#checkin-panel .ck-grid'), '没数据也要把日历画出来（不然用户不知道这儿能点）');
  });

  T.test('可以往前翻月，上个月的打卡格照样点亮；回到本月后就不能再往后翻', async function () {
    await resetAppData();
    const p = addProject('工作');
    const first = firstOfMonth();
    const lastOfPrev = m('TTCalc').addDays(first, -1);
    addRecord(p.id, lastOfPrev, 1800);                       // 上个月最后一天

    T.equal(m('TTUI').checkin.getViewMonth(), monthKey(), '默认看本月');
    click(q('#checkin-panel [data-action="checkin-prev"]'));
    T.notEqual(m('TTUI').checkin.getViewMonth(), monthKey(), '应该翻到上个月');
    T.contains(textOf('#checkin-panel .ck-title'), '月');
    T.ok(isChecked(lastOfPrev), '上个月打过的卡也要点亮');

    click(q('#checkin-panel [data-action="checkin-next"]'));
    T.equal(m('TTUI').checkin.getViewMonth(), monthKey(), '应该能翻回本月');
    T.equal(q('#checkin-panel [data-action="checkin-next"]'), null, '已经在本月时不该再有"下个月"按钮');
    T.equal(m('TTUI').checkin.shiftMonth(1), null, '直接调用也要挡住，不能翻到未来');
  });

  T.test('将来的日子点不动，也不点亮', async function () {
    await resetAppData();
    const t = today();
    const lastDay = t.slice(0, 8) + ('0' + daysInThisMonth()).slice(-2);
    if (lastDay === t) return;                               // 今天正好是月末，这轮没有"未来"可测

    const future = cell(lastDay);
    T.ok(future.classList.contains('is-future'), '将来的日子要有"还没到"的样子');
    T.notOk(future.classList.contains('is-checked'));
    T.equal(future.getAttribute('data-action'), null);
    clearToasts();
    click(future);
    T.equal(topModal(), null, '点将来的日子也不该有反应');
  });
});
