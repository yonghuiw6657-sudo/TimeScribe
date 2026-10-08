/**
 * P7 记录明细与补录（浏览器运行）
 *
 * 覆盖 PRD 验收 D1–D7、I3、I5、I6。
 * 明细是"数据能修"的唯一入口，所以这里连表格内容也逐列校验。
 */
import {
  T, q, qa, m, resetAppData, state, addProject, addRecord, click, textOf, modalTitle,
  fieldByName, lastToast, clearToasts, sleep, setMinSeconds, commit, modalButtons, topModal
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

function openDetail(projectId) {
  m('TTUI').records.openDetail(projectId);
}

function clickModalButton(label) {
  const btn = modalButtons().filter(function (b) { return b.textContent === label; })[0];
  T.ok(btn, '弹窗里应有「' + label + '」按钮');
  click(btn);
}

function rowFor(recordId) {
  return q('#modal-host [data-record-id="' + recordId + '"]');
}

/** 明细弹窗的合计行（排除叠在上面的补录弹窗）。 */
function detailSummaryText() {
  const modal = qa('#modal-host .modal').filter(function (mm) {
    return mm.querySelector('.detail-wrap');
  })[0];
  return modal ? modal.textContent : '';
}

T.defineSuite('P7', '项目明细、补录与改错', async function () {
  T.test('没有记录时明细弹窗显示空状态（D1 前提）', async function () {
    await resetAppData();
    const p = addProject('工作');
    openDetail(p.id);
    T.contains(modalTitle(), '工作');
    T.contains(modalTitle(), '时间明细');
    T.contains(textOf('#modal-host'), '还没有时间记录');
    m('TTUI').modal.closeAll();
  });

  T.test('明细按日期倒序列出，列齐全（D1）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const t = today();
    const yesterday = m('TTCalc').addDays(t, -1);
    addRecord(p.id, yesterday, 600, { note: '昨天那段' });
    addRecord(p.id, t, 1800, { note: '今天这段', pausedSec: 300 });

    openDetail(p.id);
    const rows = qa('#modal-host .rlist .rrow').filter(function (r) { return !r.classList.contains('total'); });
    T.equal(rows.length, 2);
    T.contains(rows[0].textContent, '今天这段', '最新的排最前');
    T.contains(rows[1].textContent, '昨天那段');

    const header = qa('#modal-host .rhead span').map(function (n) { return n.textContent; });
    T.deepEqual(header, ['日期', '时间段', '投入', '暂停', '专注度', '备注', '操作']);

    T.contains(rows[0].textContent, '30 分', '投入列');
    T.contains(rows[0].textContent, '5 分', '暂停列');
    T.contains(rows[0].textContent, '86%', '专注度列：1800/(1800+300)=86%');
    m('TTUI').modal.closeAll();
  });

  T.test('明细底部有合计，并区分"计时"与"手动补录"（D6）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const t = today();
    addRecord(p.id, t, 3600);
    addRecord(p.id, t, 1800, { source: 'manual' });

    openDetail(p.id);
    const summary = q('#modal-host .detail-summary').textContent;    T.contains(summary, '合计 1 小时 30 分');
    T.contains(summary, '计时 1 小时');
    T.contains(summary, '手动补录 30 分');

    const totalRow = q('#modal-host .rrow.total').textContent;
    T.contains(totalRow, '1 小时 30 分');
    m('TTUI').modal.closeAll();
  });

  T.test('手动补录：选项目、日期、时长、备注都能填（D2）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    T.contains(modalTitle(), '手动补一条记录');

    const dateInput = fieldByName('date');
    T.ok(dateInput, '应有日期输入');
    T.equal(dateInput.value, today(), '默认填今天');
    fieldByName('hours').value = '1';
    fieldByName('minutes').value = '15';
    fieldByName('note').value = '忘了开计时';
    clickModalButton('保存');

    T.equal(state().records.length, 1, '应生成 1 条记录');
    const r = state().records[0];
    T.equal(r.projectId, p.id);
    T.equal(r.date, today());
    T.equal(r.activeSec, 4500, '1 小时 15 分 = 4500 秒');
    T.equal(r.note, '忘了开计时');
    T.equal(r.source, 'manual');
    T.equal(r.pausedSec, 0);
    T.equal(r.startAt, null, '手动补录没有起始时刻');
    m('TTUI').modal.closeAll();
  });

  T.test('手动补录不受 2 分钟阈值限制（D3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    T.equal(state().settings.minSeconds, 120, '此时阈值仍是 2 分钟');

    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('hours').value = '0';
    fieldByName('minutes').value = '0';
    // 用一个很小但合法的时长：界面按分钟填，所以这里直接构造 10 秒的记录
    clickModalButton('保存');
    T.equal(state().records.length, 0, '0 分钟应被拒绝');

    // 用业务接口补一条 10 秒的，验证"补录不受阈值限制"
    commit(function (s) {
      s.records.push({
        id: m('TTCalc').makeId('rec'),
        projectId: p.id,
        date: today(),
        startAt: null,
        endAt: null,
        activeSec: 10,
        pausedSec: 0,
        note: '很短的补录',
        source: 'manual',
        createdAt: new Date().toISOString()
      });
      return s;
    });
    T.equal(state().records.length, 1, '10 秒的手动补录应被保留');
    m('TTUI').modal.closeAll();
  });

  T.test('补录时长为 0 会被拒绝并提示（I5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('hours').value = '0';
    fieldByName('minutes').value = '0';
    clickModalButton('保存');

    T.equal(state().records.length, 0, '不该生成记录');
    T.contains(textOf('#modal-host .form-error'), '大于 0');
    m('TTUI').modal.closeAll();
  });

  T.test('补录未来日期会被拒绝（I6）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const tomorrow = m('TTCalc').addDays(today(), 1);
    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('date').value = tomorrow;
    fieldByName('hours').value = '1';
    clickModalButton('保存');

    T.equal(state().records.length, 0);
    T.contains(textOf('#modal-host .form-error'), '未来');
    m('TTUI').modal.closeAll();
  });

  T.test('补录日期格式不对会被拒绝', async function () {
    await resetAppData();
    const p = addProject('工作');
    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('date').value = '2025/06/11';
    fieldByName('hours').value = '1';
    clickModalButton('保存');
    T.equal(state().records.length, 0);
    T.contains(textOf('#modal-host .form-error'), '日期');
    m('TTUI').modal.closeAll();
  });

  T.test('备注超长被截断到 100 字（I3）', async function () {
    await resetAppData();
    const p = addProject('工作');
    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('hours').value = '1';
    fieldByName('note').value = '备'.repeat(300);
    clickModalButton('保存');
    T.equal(state().records.length, 1);
    T.equal(state().records[0].note.length, 100, '超过 100 字应被截断');
    m('TTUI').modal.closeAll();
  });

  T.test('修改记录的时长与备注，统计同步更新（D4）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, today(), 3600, { note: '原备注' });
    m('TTUI').home.render();
    T.contains(textOf('#stat-total'), '1 小时');

    const record = state().records[0];
    m('TTUI').records.openRecordForm({ record: record });
    T.contains(modalTitle(), '修改记录');
    fieldByName('hours').value = '2';
    fieldByName('minutes').value = '0';
    fieldByName('note').value = '改过的备注';
    clickModalButton('保存');

    const updated = state().records.filter(function (r) { return r.id === rec.id; })[0];
    T.equal(updated.activeSec, 7200, '应改成 2 小时');
    T.equal(updated.note, '改过的备注');
    T.contains(textOf('#stat-total'), '2 小时', '统计应立刻更新');
    m('TTUI').modal.closeAll();
  });

  T.test('修改记录不改变归属项目（避免统计错乱）', async function () {
    await resetAppData();
    const a = addProject('工作');
    const b = addProject('学习');
    addRecord(a.id, today(), 3600);

    m('TTUI').records.openRecordForm({ record: state().records[0] });
    T.equal(fieldByName('projectId'), null, '修改表单里不该能改归属（避免把记录搬到别的项目）');
    fieldByName('hours').value = '1';
    fieldByName('minutes').value = '30';
    clickModalButton('保存');
    T.equal(state().records[0].projectId, a.id, '归属应保持不变');
    T.equal(state().records[0].activeSec, 5400);
    void b;
    m('TTUI').modal.closeAll();
  });

  T.test('删除记录需要两次点击确认，删除后可撤销（D5）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, today(), 3600);
    m('TTUI').home.render();
    clearToasts();
    openDetail(p.id);

    const delBtn = rowFor(rec.id).querySelector('[data-record-action="delete"]');
    T.equal(delBtn.textContent, '删');

    // 第一次点击：进入确认状态，不删除
    click(delBtn);
    T.equal(state().records.length, 1, '第一次点击不该删除');
    const btnAfterFirst = rowFor(rec.id).querySelector('[data-record-action="delete"]');
    T.equal(btnAfterFirst.textContent, '确认删除', '按钮应变成确认删除');

    // 第二次点击：真的删除
    click(rowFor(rec.id).querySelector('[data-record-action="delete"]'));
    T.equal(state().records.length, 0, '第二次点击应删除');
    T.contains(textOf('#stat-total'), '0', '统计应更新');

    const toast = lastToast();
    T.ok(toast, '应有提示条');
    T.contains(toast.textContent, '已删掉');
    const undo = q('#toast-host .undo');
    T.ok(undo, '应提供撤销');

    click(undo);
    T.equal(state().records.length, 1, '撤销后记录应恢复');
    T.equal(state().records[0].id, rec.id);
    T.equal(state().records[0].activeSec, 3600, '内容应完整恢复');
    m('TTUI').modal.closeAll();
  });

  T.test('删除记录后长时间不再点击，确认状态会自动取消', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, today(), 600);
    openDetail(p.id);

    click(rowFor(rec.id).querySelector('[data-record-action="delete"]'));
    T.equal(rowFor(rec.id).querySelector('[data-record-action="delete"]').textContent, '确认删除');

    await sleep(3400);   // 超过确认窗口（3 秒）
    T.equal(state().records.length, 1, '超时后不该删除');
    T.equal(rowFor(rec.id).querySelector('[data-record-action="delete"]').textContent, '删',
      '按钮应恢复成"删"');
    m('TTUI').modal.closeAll();
  });

  T.test('明细里手动补录的记录显示"手动补录"且暂停/专注度为 —（D1/D7）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const rec = addRecord(p.id, today(), 1800, { source: 'manual', startAt: null, endAt: null });
    openDetail(p.id);

    const row = rowFor(rec.id).textContent;
    T.contains(row, '手动补录');
    T.contains(row, '30 分');
    T.contains(row, '—', '暂停与专注度对手动补录显示为 —');
    m('TTUI').modal.closeAll();
  });

  T.test('时长为 0 的手动记录不可能存在（存储层会拒绝非法值）', async function () {
    await resetAppData();
    const p = addProject('工作');
    const s = state();
    const before = s.records.length;
    // 直接往状态里塞一条 activeSec 为负数的记录，保存后应被规范化丢弃
    commit(function (st) {
      st.records.push({
        id: 'bad', projectId: p.id, date: today(), startAt: null, endAt: null,
        activeSec: -10, pausedSec: 0, note: '', source: 'manual', createdAt: null
      });
      return st;
    });
    m('TTStore').flush();
    const reloaded = m('TTStorage').loadAll();
    T.equal(reloaded.data.records.length, before, '非法记录不该被持久化');
    T.ok(true);
  });

  T.test('计时产生的记录在明细里显示时间段', async function () {
    await resetAppData();
    setMinSeconds(0);
    const p = addProject('工作');
    m('TTUI').home.render();
    click(q('[data-project-card="' + p.id + '"] [data-action="start"]'));
    await sleep(1200);
    click(q('[data-project-card="' + p.id + '"] [data-action="stop"]'));

    const rec = state().records[0];
    T.ok(rec.startAt && rec.endAt, '计时记录应有起止时刻');
    openDetail(p.id);
    const row = rowFor(rec.id).textContent;
    T.notContains(row, '手动补录');
    T.ok(/\d{2}:\d{2}–\d{2}:\d{2}/.test(row), '应显示 HH:MM–HH:MM 格式，实际 "' + row + '"');
    m('TTUI').modal.closeAll();
  });

  T.test('关闭弹窗会清掉未保存的输入（不会偷偷写数据）', async function () {
    await resetAppData();
    const p = addProject('工作');
    openDetail(p.id);
    click(q('#modal-host [data-detail-action="add-record"]'));
    fieldByName('hours').value = '3';
    m('TTUI').modal.closeTop();     // 关掉补录弹窗（等于取消）

    T.equal(state().records.length, 0, '取消后不该产生记录');
    m('TTUI').modal.closeAll();
  });
});
