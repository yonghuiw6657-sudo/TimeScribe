/**
 * P1 数据底座（Node 运行）：localStorage 读写、结构校验、损坏恢复、导入校验。
 *
 * 用内存假存储替代 localStorage，因此这些是真正的逻辑测试，不是"跑起来看看"。
 */
TTTest.defineSuite('P1', '数据层：读写与校验', function () {
  const T = TTTest;
  const S = TT.TTStorage;

  // ---------------------------------------------------------- 假存储后端
  function makeBackend(options) {
    const opts = options || {};
    const map = {};
    const calls = { set: 0, get: 0, remove: 0 };
    return {
      calls: calls,
      map: map,
      failAfter: opts.failAfter === undefined ? Infinity : opts.failAfter,
      failMode: opts.failMode || 'quota',
      getItem: function (k) {
        calls.get += 1;
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      },
      setItem: function (k, v) {
        calls.set += 1;
        if (calls.set > this.failAfter) {
          if (this.failMode === 'quota') {
            const err = new Error('QuotaExceededError: storage full');
            err.name = 'QuotaExceededError';
            throw err;
          }
          throw new Error('disk on fire');
        }
        map[k] = String(v);
      },
      removeItem: function (k) {
        calls.remove += 1;
        delete map[k];
      },
      key: function (i) { return Object.keys(map)[i] || null; },
      get length() { return Object.keys(map).length; }
    };
  }

  function freshBackend(options) {
    const b = makeBackend(options);
    S.setBackend(b);
    return b;
  }

  function sampleProject(over) {
    return Object.assign({
      id: 'p1', name: '工作', parentId: null, color: '#3b82f6', order: 0, createdAt: '2025-06-01T00:00:00.000Z'
    }, over || {});
  }

  function sampleRecord(over) {
    return Object.assign({
      id: 'r1', projectId: 'p1', date: '2025-06-11',
      startAt: '2025-06-11T06:05:00.000Z', endAt: '2025-06-11T07:20:00.000Z',
      activeSec: 4500, pausedSec: 300, note: '首屏改稿', source: 'timer',
      createdAt: '2025-06-11T07:20:00.000Z'
    }, over || {});
  }

  // ------------------------------------------------------------------ 基础
  T.test('首次使用：没有数据时返回空结构且不报错', function () {
    freshBackend();
    const r = S.loadAll();
    T.equal(r.status, 'empty');
    T.deepEqual(r.data.projects, []);
    T.deepEqual(r.data.records, []);
    T.equal(r.data.schemaVersion, S.SCHEMA_VERSION);
    T.equal(r.data.settings.minSeconds, 120, '默认阈值应为 2 分钟');
    T.equal(r.data.ui.sortMode, 'total', '默认排序应为按累计投入');
  });

  T.test('写入后能原样读回（大小写、中文、备注都不丢）', function () {
    freshBackend();
    const data = S.emptyData();
    data.projects.push(sampleProject());
    data.records.push(sampleRecord());
    data.settings.minSeconds = 300;
    data.ui.expanded = ['p1'];
    S.saveAll(data);

    const r = S.loadAll();
    T.equal(r.status, 'ok');
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.projects[0].name, '工作');
    T.equal(r.data.records.length, 1);
    T.equal(r.data.records[0].note, '首屏改稿');
    T.equal(r.data.records[0].activeSec, 4500);
    T.equal(r.data.settings.minSeconds, 300);
    T.deepEqual(r.data.ui.expanded, ['p1']);
  });

  T.test('存储不可写时 isStorageWritable 返回 false 而不是抛异常', function () {
    S.setBackend({
      getItem: function () { return null; },
      setItem: function () { throw new Error('private mode'); },
      removeItem: function () { },
      key: function () { return null; },
      length: 0
    });
    T.equal(S.isStorageWritable(), false);
    S.setBackend();  // 还原
  });

  // ------------------------------------------------------------ 损坏与修复
  T.test('数据是坏 JSON 时不白屏：返回空数据、状态为 corrupt、并留下备份', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = '{这不是合法JSON';
    const r = S.loadAll();
    T.equal(r.status, 'corrupt');
    T.deepEqual(r.data.projects, [], '应返回可用的空数据');
    const backups = S.listCorruptBackups();
    T.equal(backups.length, 1, '应把坏数据另存为备份，便于事后抢救');
    T.contains(b.map[backups[0]], '这不是合法JSON');
  });

  T.test('缺少设置与界面偏好时自动补默认值（旧数据可平滑升级）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({ schemaVersion: 1, projects: [], records: [] });
    const r = S.loadAll();
    T.equal(r.status, 'ok');
    T.equal(r.data.settings.minSeconds, 120);
    T.equal(r.data.settings.undoSeconds, 5);
    T.equal(r.data.ui.sortMode, 'total');
    T.deepEqual(r.data.ui.expanded, []);
  });

  T.test('设置项越界会被夹到合法范围（防止界面出现不可能的值）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [], records: [],
      settings: { minSeconds: -50, undoSeconds: 999, chartScope: '乱写' }
    });
    const r = S.loadAll();
    T.equal(r.data.settings.minSeconds, 0, '负数阈值应夹到 0');
    T.equal(r.data.settings.undoSeconds, 30, '撤销时长上限 30 秒');
    T.equal(r.data.settings.chartScope, 'parent', '非法图表层级应回退为父项目');
  });

  T.test('不属于任何项目的记录会被丢弃并计数（不留孤儿记录）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject()],
      records: [sampleRecord(), sampleRecord({ id: 'r2', projectId: '不存在' })]
    });
    const r = S.loadAll();
    T.equal(r.status, 'repaired');
    T.equal(r.data.records.length, 1);
    T.equal(r.data.records[0].id, 'r1');
    T.equal(r.dropped.records, 1);
  });

  T.test('父项目不存在的子项目会被提升为顶层（避免看不见的孤儿）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject({ id: 'child', parentId: '不存在' })],
      records: []
    });
    const r = S.loadAll();
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.projects[0].parentId, null, '应提升为顶层项目');
  });

  T.test('超过两层的结构会被压平（子项目下不能有子项目）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [
        sampleProject({ id: 'a' }),
        sampleProject({ id: 'b', parentId: 'a' }),
        sampleProject({ id: 'c', parentId: 'b' })
      ],
      records: []
    });
    const r = S.loadAll();
    const c = r.data.projects.filter(function (p) { return p.id === 'c'; })[0];
    T.ok(c, '第三层项目不应消失');
    T.equal(c.parentId, null, '第三层应被压平成顶层');
  });

  T.test('字段非法的记录被丢弃（日期格式、负数时长、缺 id）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject()],
      records: [
        sampleRecord({ id: 'ok' }),
        sampleRecord({ id: 'badDate', date: '2025/06/11' }),
        sampleRecord({ id: 'neg', activeSec: -10 }),
        sampleRecord({ id: '' }),
        sampleRecord({ id: 'badProject', projectId: 123 })
      ]
    });
    const r = S.loadAll();
    T.equal(r.data.records.length, 1);
    T.equal(r.data.records[0].id, 'ok');
    T.equal(r.dropped.records, 4);
  });

  T.test('项目名前后空格被清理，超长名称被截断到 30 字', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [
        sampleProject({ id: 'x', name: '   有空格   ' }),
        sampleProject({ id: 'y', name: '很长的名字'.repeat(20) })
      ],
      records: []
    });
    const r = S.loadAll();
    T.equal(r.data.projects[0].name, '有空格');
    T.equal(r.data.projects[1].name.length, 30);
  });

  T.test('备注超长会被截断到 100 字（防止撑破界面）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject()],
      records: [sampleRecord({ note: '备'.repeat(500) })]
    });
    const r = S.loadAll();
    T.equal(r.data.records[0].note.length, 100);
  });

  T.test('重复的项目 id 只保留第一个（避免统计翻倍）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject({ name: '第一个' }), sampleProject({ name: '重复的' })],
      records: []
    });
    const r = S.loadAll();
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.projects[0].name, '第一个');
    T.equal(r.dropped.projects, 1);
  });

  T.test('重复的记录 id 只保留第一条（两个页面同时结算同一段时的兜底）', function () {
    const b = freshBackend();
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject()],
      records: [
        sampleRecord({ id: 'rec-same', activeSec: 600 }),
        sampleRecord({ id: 'rec-same', activeSec: 600 }),
        sampleRecord({ id: 'rec-other', activeSec: 300 })
      ]
    });
    const r = S.loadAll();
    T.equal(r.data.records.length, 2, '同一个 id 只应留下一条');
    T.equal(r.dropped.records, 1);
    T.equal(r.data.records.filter(function (x) { return x.id === 'rec-same'; }).length, 1);
  });

  // -------------------------------------------- 改名（我的时间账本 → TimeScribe）
  T.test('改名前的旧数据会被自动搬到新键，旧键保留作备份', function () {
    const b = freshBackend();
    const legacyText = JSON.stringify({ projects: [sampleProject()], records: [sampleRecord()] });
    b.map[S.LEGACY_DATA_KEY] = legacyText;
    T.equal(b.map[S.DATA_KEY], undefined, '一开始新键应该是空的');

    const r = S.loadAll();
    T.equal(r.migrated, true, '应识别出这份数据是从改名前的旧键搬过来的');
    T.equal(r.status, 'ok');
    T.equal(r.data.projects.length, 1, '旧数据不能丢');
    T.equal(r.data.records.length, 1);
    T.equal(b.map[S.DATA_KEY], legacyText, '应写入新的数据键');
    T.ok(b.map[S.LEGACY_DATA_KEY], '旧键要保留，万一新版本有问题还能退回');
  });

  T.test('新键已有数据时，不会被旧键覆盖', function () {
    const b = freshBackend();
    b.map[S.LEGACY_DATA_KEY] = JSON.stringify({
      projects: [sampleProject({ id: 'old', name: '旧的' })], records: []
    });
    b.map[S.DATA_KEY] = JSON.stringify({
      projects: [sampleProject({ id: 'new', name: '新的' })], records: []
    });

    const r = S.loadAll();
    T.equal(r.migrated, false, '已经有新键数据就不该做迁移');
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.projects[0].name, '新的', '不能被旧数据覆盖');
  });

  T.test('改名前的导出文件（app 标识是 time-tracker）仍然可以导入', function () {
    freshBackend();
    const legacyExport = JSON.stringify({
      app: 'time-tracker',
      schemaVersion: 1,
      exportedAt: '2025-06-11T10:00:00.000Z',
      projects: [sampleProject()],
      records: [sampleRecord()],
      settings: { minSeconds: 60 }
    });

    const r = S.validateImport(legacyExport);
    T.equal(r.ok, true, '旧备份必须还能导入，否则用户之前的备份就废了');
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.records.length, 1);
    T.equal(r.data.settings.minSeconds, 60);
  });

  T.test('导出的文件用新标识，同时保留对旧标识的接受', function () {
    const payload = S.buildExport(S.emptyData(), '2025-06-11T10:00:00.000Z');
    T.equal(payload.app, 'timescribe', '新导出的文件应带新标识');
    T.equal(S.APP_TAG, 'timescribe');
    T.deepEqual(S.LEGACY_APP_TAGS, ['time-tracker'], '旧标识要在接受列表里');
    T.equal(S.DATA_KEY, 'timescribe.v1');
    T.equal(S.LEGACY_DATA_KEY, 'timetracker.v1');
  });

  // ------------------------------------------------------------------ 落盘
  T.test('存储写不下时抛出可识别的 QuotaError（供界面提示导出备份）', function () {
    const b = freshBackend({ failAfter: 0 });
    let caught = null;
    try {
      S.saveAll(S.emptyData());
    } catch (err) {
      caught = err;
    }
    T.ok(caught, '空间不足时必须抛错，不能静默失败');
    T.equal(S.isQuotaError(caught), true, '应被识别为配额错误');
    T.equal(caught instanceof S.QuotaError, true);
  });

  T.test('非配额错误原样抛出，不误报为"空间不足"', function () {
    const b = freshBackend({ failAfter: 0, failMode: 'other' });
    let caught = null;
    try {
      S.saveAll(S.emptyData());
    } catch (err) {
      caught = err;
    }
    T.ok(caught);
    T.equal(S.isQuotaError(caught), false, '不该把其他错误当成配额不足');
  });

  // ------------------------------------------------------------------ 导入
  T.test('导入校验：非法 JSON 字符串会被明确拒绝', function () {
    freshBackend();
    const r = S.validateImport('{不是json');
    T.equal(r.ok, false);
    T.contains(r.reason, 'JSON');
  });

  T.test('导入校验：不是本 app 的文件会被拒绝', function () {
    freshBackend();
    const r = S.validateImport({ app: 'other-app', projects: [], records: [] });
    T.equal(r.ok, false);
    T.contains(r.reason, 'TimeScribe', '拒绝理由里要写清是本应用的名称，用户才知道选错了文件');
  });

  T.test('导入校验：缺少项目或记录列表会被拒绝并说明原因', function () {
    freshBackend();
    const a = S.validateImport({ app: 'timescribe', records: [] });
    T.equal(a.ok, false);
    T.contains(a.reason, '项目列表');
    const b = S.validateImport({ app: 'timescribe', projects: [] });
    T.equal(b.ok, false);
    T.contains(b.reason, '时间记录');
  });

  T.test('导入校验：来自更新版本的文件会被拒绝（避免数据被写坏）', function () {
    freshBackend();
    const r = S.validateImport({ app: 'timescribe', schemaVersion: 99, projects: [], records: [] });
    T.equal(r.ok, false);
    T.contains(r.reason, '更新版本');
  });

  T.test('导入校验：内容全部无法识别时拒绝，而不是导入一份空数据覆盖用户现有数据', function () {
    freshBackend();
    const r = S.validateImport({
      app: 'timescribe', schemaVersion: 1,
      projects: [{ 没有id: true }, { 也没有: 1 }],
      records: [{ 缺字段: 1 }]
    });
    T.equal(r.ok, false);
    T.contains(r.reason, '无法识别');
  });

  T.test('导入校验：合法文件通过，并报告丢弃了多少条', function () {
    freshBackend();
    const r = S.validateImport({
      app: 'timescribe', schemaVersion: 1,
      projects: [sampleProject(), { 坏项目: true }],
      records: [sampleRecord(), sampleRecord({ id: 'r2', projectId: '不存在' })]
    });
    T.equal(r.ok, true);
    T.equal(r.data.projects.length, 1);
    T.equal(r.data.records.length, 1);
    T.equal(r.dropped.projects, 1);
    T.equal(r.dropped.records, 1);
  });

  T.test('导出再导入：数据完全一致（备份真能用）', function () {
    freshBackend();
    const original = S.emptyData();
    original.projects.push(sampleProject({ id: 'a', name: '工作' }));
    original.projects.push(sampleProject({ id: 'b', name: '客户A', parentId: 'a' }));
    original.records.push(sampleRecord({ id: 'r1', projectId: 'a', activeSec: 900 }));
    original.records.push(sampleRecord({ id: 'r2', projectId: 'b', activeSec: 1800, source: 'manual', startAt: null, endAt: null }));
    original.settings.minSeconds = 60;

    const payload = S.buildExport(original, '2025-06-11T10:00:00.000Z');
    T.equal(payload.app, 'timescribe');
    T.equal(payload.schemaVersion, S.SCHEMA_VERSION);
    T.equal(payload.exportedAt, '2025-06-11T10:00:00.000Z');

    const imported = S.validateImport(JSON.parse(JSON.stringify(payload)));
    T.equal(imported.ok, true);
    T.deepEqual(imported.data.projects, original.projects);
    T.deepEqual(imported.data.records, original.records);
    T.equal(imported.data.settings.minSeconds, 60);
  });

  T.test('自检页加载的全局模块与 manifest 声明一致（防止测试环境与真实环境脱节）', function () {
    const manifest = JSON.parse(TT.fs.readFileSync(TT.path.join(TT.ROOT, 'tests', 'manifest.json'), 'utf8'));
    const base = function (p) { return String(p).split('/').pop(); };
    const declared = (manifest.browserGlobals || []).map(base).sort();
    const selftest = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'tests', 'selftest.html'), 'utf8');
    const loaded = [];
    const re = /<script src="\.\.\/js\/([^"]+)"><\/script>/g;
    let m;
    while ((m = re.exec(selftest)) !== null) loaded.push(base(m[1]));
    T.deepEqual(loaded.sort(), declared, '自检页与 manifest 的全局模块列表必须一致');
    T.equal(loaded.length, (manifest.browserGlobals || []).length, '模块数量也要一致');
  });

  T.test('index.html 也会加载这些全局模块（真实环境与测试环境一致）', function () {
    const manifest = JSON.parse(TT.fs.readFileSync(TT.path.join(TT.ROOT, 'tests', 'manifest.json'), 'utf8'));
    const html = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'index.html'), 'utf8');
    for (const rel of manifest.browserGlobals || []) {
      T.contains(html, rel, 'index.html 应加载 ' + rel);
    }
  });
});
