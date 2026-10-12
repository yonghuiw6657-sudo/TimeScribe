/**
 * P11 卡片「＋加时间」快捷补时长（浏览器运行）
 *
 * 覆盖 PRD 验收 D8–D16。
 *
 * 这个功能的全部意义是「不用开计时，直接把一段投入时长补上」，
 * 所以要盯住两件事：
 *   1) 入口足够浅——卡片上直接一个按钮，不用先进明细弹窗；
 *   2) 补进去的时长计入累计，但绝不参与专注度（D11 是这一条的核心断言）。
 */
import {
  T, q, m, resetAppData, state, addProject, addRecord, click, setValue, textOf,
  modalTitle, fieldByName, topModal, lastToast, clearToasts
} from './helpers.mjs';

function today() { return m('TTCalc').todayStr(); }

function sum() { return m('TTCalc').summarize(state(), new Date()); }

function cardOf(projectId) { return q('[data-project-card="' + projectId + '"]'); }

function quickAddButton(projectId) {
  return q('[data-project-card="' + projectId + '"] [data-action="quick-add"]');
}

/** 从卡片上的「＋加时间」进入弹窗。 */
function openQuickAdd(projectId) {
  const btn = quickAddButton(projectId);
  T.ok(btn, '卡片上应有「＋加时间」按钮');
  click(btn);
}

function expand(parentId) {
  click(q('[data-toggle-for="' + parentId + '"]'));
}

/** 弹窗里的快捷时长药丸（单位：分钟）。 */
function clickChip(min) {
  const chip = q('#modal-host .preset-chip[data-preset-min="' + min + '"]');
  T.ok(chip, '应有 +' + min + ' 分钟的快捷时长');
  click(chip);
}

function primaryButton() {
  const modal = topModal();
  return modal ? modal.querySelector('.mf .btn.primary') : null;
}

function confirmAdd() {
  const btn = primaryButton();
  T.ok(btn, '弹窗里应有确认按钮');
  click(btn);
}

/** 明细里的某一格（c1 日期 / c5 专注度 …）。 */
function detailCell(recordId, cls) {
  const row = q('#modal-host .rrow[data-record-id="' + recordId + '"]');
  T.ok(row, '明细里应有这条记录');
  return row.querySelector('.' + cls).textContent;
}

T.defineSuite('P11', '卡片快捷加时间', async function () {
  T.test('父项目卡片和子项目行上都有「＋加时间」，并且带上了正确的项目 id（D8）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户 A 官网', parent.id);
    m('TTUI').home.render();

    const pb = quickAddButton(parent.id);
    T.ok(pb, '父项目卡片上应有「＋加时间」');
    T.contains(pb.textContent, '加时间');
    T.equal(pb.getAttribute('data-project-id'), parent.id, '按钮要带上自己所属的项目 id');

    expand(parent.id);
    const cb = quickAddButton(child.id);
    T.ok(cb, '子项目行上也要有「＋加时间」');
    T.equal(cb.getAttribute('data-project-id'), child.id);
  });

  T.test('快捷时长只把数字填进输入框，主按钮文案跟着变，没点确认就不保存（D9）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    T.contains(modalTitle(), '加时间');
    T.contains(modalTitle(), '工作');
    T.equal(fieldByName('date').value, today(), '日期默认今天');

    clickChip(120);
    T.equal(fieldByName('hours').value, '2', '+2 小时应填进小时框');
    T.equal(fieldByName('minutes').value, '0');
    T.equal(primaryButton().textContent, '加 2 小时', '主按钮要写清这一下加多久');
    T.equal(state().records.length, 0, '没点确认就不该产生记录');
    T.ok(topModal(), '没点确认时弹窗应该还开着');

    // 手打数字覆盖药丸：输入框才是唯一事实来源
    setValue(fieldByName('hours'), '0');
    setValue(fieldByName('minutes'), '45');
    T.equal(primaryButton().textContent, '加 45 分');
    T.equal(state().records.length, 0);
    m('TTUI').modal.closeAll();
  });

  T.test('点确认才写入一条手动补录记录，字段口径正确（D10）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    clickChip(120);
    confirmAdd();

    T.equal(state().records.length, 1, '应生成 1 条记录');
    const r = state().records[0];
    T.equal(r.projectId, p.id);
    T.equal(r.source, 'manual', '走的是手动补录这条路，才不会被算进专注度');
    T.equal(r.activeSec, 7200, '2 小时 = 7200 秒');
    T.equal(r.date, today());
    T.equal(r.pausedSec, 0);
    T.equal(r.startAt, null, '加时间没有起始时刻');
    T.equal(r.endAt, null);
    T.equal(q('#modal-host .modal'), null, '保存后弹窗应关闭');
  });

  T.test('加时间只增累计，专注度一点不动（D11）', async function () {
    await resetAppData();
    const p = addProject('工作');
    // 一条计时记录：投入 3600、暂停 900 → 专注度 80%
    addRecord(p.id, today(), 3600, { pausedSec: 900 });
    m('TTUI').home.render();
    clearToasts();

    const before = sum().byId[p.id];
    T.equal(before.focusPercent, 80, '计时记录算出来是 80%');
    T.contains(cardOf(p.id).textContent, '专注 80%');

    openQuickAdd(p.id);
    clickChip(120);
    confirmAdd();

    const after = sum().byId[p.id];
    T.equal(after.focusPercent, 80, '加时间不参与专注度，百分比不该变');
    T.equal(after.totalActiveSec, before.totalActiveSec + 7200, '累计投入应增加 2 小时');
    T.contains(cardOf(p.id).textContent, '专注 80%', '卡片上的专注度也没变');
    T.contains(cardOf(p.id).textContent, '共 3 小时', '卡片上应看到新加的 2 小时');
  });

  T.test('日期默认今天，可以改成过去；改过去就不进「今天」（D12）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    T.equal(fieldByName('date').value, today());

    const yesterday = m('TTCalc').addDays(today(), -1);
    setValue(fieldByName('date'), yesterday);
    clickChip(60);
    confirmAdd();

    T.equal(state().records.length, 1);
    T.equal(state().records[0].date, yesterday, '要记在改过的日期上');
    const s = sum();
    T.equal(s.todayTotalSec, 0, '昨天的时长不该算进今天');
    T.equal(s.grandTotalSec, 3600, '但要算进累计');
  });

  T.test('时长为 0、日期在未来，都会被挡住且不产生记录（D13）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    confirmAdd();                                   // 小时、分都空着
    T.equal(state().records.length, 0, '0 时长不该落库');
    T.contains(textOf('#modal-host .form-error'), '大于 0');
    T.ok(topModal(), '报错时弹窗不该关掉，输入还得留着');

    setValue(fieldByName('hours'), '1');
    setValue(fieldByName('date'), m('TTCalc').addDays(today(), 1));
    confirmAdd();
    T.equal(state().records.length, 0, '未来日期不该落库');
    T.contains(textOf('#modal-host .form-error'), '未来');
    m('TTUI').modal.closeAll();
  });

  T.test('加完可以撤销，撤销后累计回退（D14）', async function () {
    await resetAppData();
    const p = addProject('工作');
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    clickChip(30);
    confirmAdd();
    T.equal(state().records.length, 1);

    const toast = lastToast();
    T.ok(toast, '应有提示条');
    T.contains(toast.textContent, '已加');

    const undo = q('#toast-host .undo');
    T.ok(undo, '提示条上应提供撤销');
    click(undo);

    T.equal(state().records.length, 0, '撤销后记录应被移除');
    T.equal(sum().grandTotalSec, 0, '累计也要退回去');
  });

  T.test('子项目加时间会汇总到父项目（D15）', async function () {
    await resetAppData();
    const parent = addProject('工作');
    const child = addProject('客户 A 官网', parent.id);
    m('TTUI').home.render();
    clearToasts();
    expand(parent.id);

    openQuickAdd(child.id);
    clickChip(60);
    confirmAdd();

    T.equal(state().records[0].projectId, child.id, '记录应挂在子项目上');
    T.equal(sum().byId[child.id].totalActiveSec, 3600);
    T.equal(sum().byId[parent.id].totalActiveSec, 3600, '父项目要合并子项目的时长');
    m('TTUI').modal.closeAll();
  });

  T.test('明细里手动补录行的专注度显示「—」，计时行照常显示百分比（D16）', async function () {
    await resetAppData();
    const p = addProject('工作');
    addRecord(p.id, today(), 1800, { pausedSec: 300 });   // 计时：1800/(1800+300) = 86%
    m('TTUI').home.render();
    clearToasts();

    openQuickAdd(p.id);
    clickChip(60);
    confirmAdd();
    m('TTUI').modal.closeAll();

    const manual = state().records.filter(function (r) { return r.source === 'manual'; })[0];
    const timed = state().records.filter(function (r) { return r.source !== 'manual'; })[0];
    m('TTUI').records.openDetail(p.id);
    T.equal(detailCell(manual.id, 'c5'), '—', '手动补录没有暂停数据，不该显示成 100%');
    T.contains(detailCell(timed.id, 'c5'), '86%', '计时记录的专注度照常显示');
    m('TTUI').modal.closeAll();
  });
});
