/**
 * P1 状态容器（浏览器运行）：真实 localStorage 下的落盘、防抖与恢复。
 */
TTTest.defineSuite('P1', '状态容器：落盘与订阅', function () {
  const T = TTTest;

  function cleanStorage() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(function (k) {
      if (!k) return;
      // 新旧两种键前缀都清掉（改名后旧键仍可能残留）
      if (k.indexOf('timescribe.') === 0 || k.indexOf('timetracker.') === 0) localStorage.removeItem(k);
    });
  }

  T.test('改数据后刷新页面仍能读回（本机持久化）', function () {
    cleanStorage();
    const storage = window.TTStorage;
    const store = window.TTStore;
    storage.setBackend();
    store.resetForTest();
    const loaded = store.load();
    T.equal(loaded.status, 'empty');

    store.commit(function (state) {
      state.projects.push({
        id: 'p1', name: '工作', parentId: null, color: '#3b82f6', order: 0, createdAt: new Date().toISOString()
      });
    });
    T.equal(store.flush(), true, '落盘应成功');

    // 模拟"重新打开页面"：重新从 localStorage 读
    const again = storage.loadAll();
    T.equal(again.status, 'ok');
    T.equal(again.data.projects.length, 1);
    T.equal(again.data.projects[0].name, '工作');
  });

  T.test('订阅者会在每次改动后收到通知，并能取消订阅', function () {
    cleanStorage();
    const store = window.TTStore;
    store.resetForTest();
    store.load();

    let count = 0;
    let lastState = null;
    const unsubscribe = store.subscribe(function (s) { count += 1; lastState = s; });
    store.commit(function (s) { s.ui.sortMode = 'today'; });
    T.equal(count, 1, '应通知一次');
    T.equal(lastState.ui.sortMode, 'today');
    unsubscribe();
    store.commit(function (s) { s.ui.sortMode = 'manual'; });
    T.equal(count, 1, '取消订阅后不应再收到通知');
    store.flush();
  });

  T.test('数据改动是防抖落盘的（连续多次改动不会每次都写盘）', function () {
    cleanStorage();
    const store = window.TTStore;
    store.resetForTest();
    store.load();

    // 用真实 localStorage 观察写入次数：先记录当前内容
    for (let i = 0; i < 5; i++) {
      store.commit(function (s) { s.ui.expanded = ['p' + i]; });
    }
    T.equal(store.isDirty(), true, '尚未落盘时应为脏');
    const ok = store.flush();
    T.equal(ok, true);
    T.equal(store.isDirty(), false, 'flush 之后不再是脏');
    const raw = window.TTStorage.readRaw();
    T.contains(raw, '"p4"', '最后一次改动应已写入存储');
  });

  T.test('读取到损坏数据时不抛异常，界面能继续运行', function () {
    cleanStorage();
    const store = window.TTStore;
    localStorage.setItem(window.TTStorage.DATA_KEY, '{{{坏数据');
    const r = store.load();
    T.equal(r.status, 'corrupt');
    T.deepEqual(store.getState().projects, []);
    cleanStorage();
  });
});
