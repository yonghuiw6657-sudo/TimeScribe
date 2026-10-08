/**
 * 项目相关弹窗与操作：新建/编辑、删除确认、项目明细、排序切换、展开收起。
 */
(function (global) {
  'use strict';

  const util = global.TTUtil;
  const form = global.TTUI.form;
  const modal = global.TTUI.modal;
  const projects = global.TTProjects;

  function store() { return global.TTStore; }

  // ---------------------------------------------------------------- 新建/编辑
  function openProjectForm(options) {
    const opts = options || {};
    const state = store().getState();
    const editing = opts.project || null;
    // 顶层项目不能通过"编辑"改成子项目，所以编辑模式下只有"本来就是子项目"才算子项目表单
    const isChildEdit = (editing && !!editing.parentId) || (!editing && !!opts.parentId);

    const parents = state.projects.filter(function (p) { return !p.parentId; });
    const parentOptions = [{ value: '', label: '（作为独立项目）' }].concat(
      parents.map(function (p) { return { value: p.id, label: p.name + '（作为子项目）' }; })
    );

    const defaultColor = editing ? editing.color : projects.nextColor(state.projects, null);

    const body = [
      form.field('名称', form.textInput({
        name: 'name',
        value: editing ? editing.name : '',
        placeholder: '例如：工作、学英语、客户A的官网',
        maxlength: projects.NAME_MAX
      }))
    ];

    if (!isChildEdit) {
      body.push(form.field('放在哪里', form.select({
        name: 'parentId',
        value: editing ? (editing.parentId || '') : (opts.parentId || ''),
        options: parentOptions
      })));
      body.push(form.field('颜色（用于扇形图区分）', form.colorPicker({
        name: 'color',
        value: defaultColor
      })));
      body.push(form.warn('子项目下面不能再建子项目，所以"放到子项目里"这个选项不会出现。'));
    }

    modal.open({
      title: editing ? '编辑项目' : (opts.parentId ? '新建子项目' : '新建项目'),
      body: body,
      buttons: [
        { text: '取消', kind: '' },
        {
          text: editing ? '保存' : '创建',
          kind: 'primary',
          closeAfter: false,
          onClick: function (close) {
            const root = modal.topRoot();
            const nameNode = root.querySelector('[data-field="name"]');
            const nameValue = nameNode ? nameNode.value : '';
            const check = projects.validateName(nameValue);
            if (!check.ok) {
              showFieldError(root, check.reason);
              return false;
            }
            const parentId = isChildEdit
              ? editing.parentId
              : (form.readField(root, 'parentId') || null);
            const color = isChildEdit ? editing.color : form.readField(root, 'color');

            let result;
            if (editing) {
              store().commit(function (state2) {
                result = projects.updateProject(state2, editing.id, { name: check.name, color: color });
                return state2;
              });
            } else {
              let created = null;
              store().commit(function (state2) {
                created = projects.createProject(state2, { name: check.name, parentId: parentId, color: color });
                return state2;
              });
              result = created;
              if (created && created.ok && parentId) {
                store().commit(function (state2) {
                  if (!projects.isExpanded(state2, parentId)) projects.toggleExpanded(state2, parentId);
                  return state2;
                });
              }
            }

            if (!result || !result.ok) {
              showFieldError(root, (result && result.reason) || '保存失败');
              return false;
            }
            close();
            if (!editing) {
              global.TTUI.toast.show({
                text: '已创建「' + check.name + '」',
                durationSec: 3
              });
            }
            return true;
          }
        }
      ]
    });
  }

  function showFieldError(root, message) {
    const existing = root.querySelector('.form-error');
    if (existing) existing.parentNode.removeChild(existing);
    const box = util.el('div', { class: 'form-error', text: message });
    const body = root.querySelector('.mb');
    if (body) body.insertBefore(box, body.firstChild);
  }

  // ---------------------------------------------------------------- 删除确认
  function openDeleteConfirm(projectId) {
    const state = store().getState();
    const info = projects.describeDeletion(state, projectId);
    if (!info.ok) {
      global.TTUI.toast.show({ text: info.reason, durationSec: 4, tone: 'warn' });
      return;
    }

    const lines = [];
    lines.push('确定删除「' + info.project.name + '」吗？');
    if (info.subCount > 0) {
      lines.push('它下面的 ' + info.subCount + ' 个子项目会一起删掉。');
    }
    if (info.recordCount > 0) {
      lines.push('全部 ' + info.recordCount + ' 条时间记录（共 ' + global.TTCalc.fmtDuration(info.totalSec) + '）也会一起删掉，累计总投入里不再包含它。');
    } else {
      lines.push('它目前没有时间记录。');
    }
    lines.push('这个操作找不回来。建议先点一次「导出」留个备份。');

    const warnBox = form.warn(lines.join('\n'));
    warnBox.style.whiteSpace = 'pre-line';
    warnBox.style.fontSize = '13.5px';

    modal.open({
      title: '删除项目',
      body: [warnBox],
      buttons: [
        { text: '取消', kind: '' },
        {
          text: '确认删除',
          kind: 'danger',
          onClick: function () {
            let removed = null;
            store().commit(function (state2) {
              removed = projects.deleteProject(state2, projectId);
              return state2;
            });
            if (removed && removed.ok) {
              global.TTUI.toast.show({
                text: '已删除「' + info.project.name + '」',
                detail: '同时删除 ' + removed.removedRecords + ' 条记录 · ' + global.TTCalc.fmtDuration(info.totalSec),
                durationSec: 4
              });
            } else {
              global.TTUI.toast.show({ text: (removed && removed.reason) || '删除失败', tone: 'warn' });
            }
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------------- 更多菜单
  function openMenu(projectId, anchor) {
    const state = store().getState();
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return;
    const busy = projects.isProjectBusy(state, projectId);

    const items = [];
    items.push({
      text: '编辑',
      onClick: function () { openProjectForm({ project: project }); }
    });
    if (!project.parentId) {
      items.push({
        text: '在这个项目下新建子项目',
        onClick: function () { openProjectForm({ parentId: project.id }); }
      });
    }
    items.push({
      text: '查看时间明细',
      onClick: function () {
        if (global.TTUI.records && global.TTUI.records.openDetail) {
          global.TTUI.records.openDetail(project.id);
        }
      }
    });
    items.push({
      text: '删除',
      danger: true,
      disabled: busy,
      disabledReason: '请先停止计时',
      onClick: function () {
        if (busy) {
          global.TTUI.toast.show({ text: '请先停止计时再删除', tone: 'warn' });
          return;
        }
        openDeleteConfirm(project.id);
      }
    });

    const menu = util.el('div', { class: 'menu' });
    items.forEach(function (item) {
      menu.appendChild(util.el('button', {
        type: 'button',
        class: 'menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : ''),
        text: item.text,
        title: item.disabled ? item.disabledReason : '',
        onclick: function (e) {
          e.stopPropagation();
          closeMenu();
          item.onClick();
        }
      }));
    });

    closeMenu();
    const wrap = util.el('div', { class: 'menu-wrap', id: 'active-menu' }, [menu]);
    if (anchor && anchor.parentNode) anchor.parentNode.appendChild(wrap);
    else document.body.appendChild(wrap);

    setTimeout(function () {
      document.addEventListener('click', closeMenu, { once: true });
    }, 0);
  }

  function closeMenu() {
    const existing = document.getElementById('active-menu');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function openDetail(projectId) {
    if (global.TTUI.records && global.TTUI.records.openDetail) {
      global.TTUI.records.openDetail(projectId);
      return;
    }
    const state = store().getState();
    const project = state.projects.filter(function (p) { return p.id === projectId; })[0];
    if (!project) return;
    global.TTUI.toast.show({ text: '「' + project.name + '」的时间明细即将开放', durationSec: 3 });
  }

  global.TTUI = global.TTUI || {};
  global.TTUI.projects = {
    openProjectForm: openProjectForm,
    openDeleteConfirm: openDeleteConfirm,
    openMenu: openMenu,
    closeMenu: closeMenu,
    openDetail: openDetail
  };
})(typeof window !== 'undefined' ? window : globalThis);
