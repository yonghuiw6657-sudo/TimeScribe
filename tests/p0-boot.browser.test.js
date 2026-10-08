/**
 * P0 浏览器自检（在 Edge 无头模式下真实执行）
 * 覆盖 PRD 验收 A1、A3、A4。
 *
 * 被测 app 运行在同源 iframe 中，因此这里检查的是"真实的 app 页面"，
 * 而不是测试页面自己（否则 DOM 断言会全部落空，得到假绿）。
 */
TTTest.defineSuite('P0', '浏览器：启动与运行', function () {
  const T = TTTest;

  function appWindow() {
    T.ok(window.__TT_APP__, '被测 app 没有加载（iframe 不可用），本套测试无效');
    return window.__TT_APP__;
  }

  function appDoc() {
    T.ok(window.__TT_APP_DOC__, '被测 app 文档不可用，本套测试无效');
    return window.__TT_APP_DOC__;
  }

  T.test('app 运行在 http://127.0.0.1 下（不是 file://）', function () {
    const w = appWindow();
    T.notEqual(w.location.protocol, 'file:', 'app 不应以 file:// 打开（Edge 会限制本地存储）');
    T.equal(w.location.protocol, 'http:', 'app 应通过 http 协议打开');
    T.equal(w.location.hostname, '127.0.0.1', 'app 应来自本机回环地址');
  });

  T.test('入口脚本已执行并暴露启动标记', function () {
    const boot = appWindow().__TIMESCRIBE_BOOT__;
    T.ok(boot, 'window.__TIMESCRIBE_BOOT__ 未定义，说明 main.js 没有执行');
    T.equal(boot.storageWritable, true, '本机存储不可写，数据将无法保存');
    T.ok(boot.bootedAt, '未记录启动时间');
  });

  T.test('骨架 DOM 完整', function () {
    const doc = appDoc();
    T.ok(doc.getElementById('app'), '缺少 #app 容器');
    T.equal(doc.documentElement.getAttribute('lang'), 'zh-CN', '页面语言应为 zh-CN');
    T.equal(doc.title, 'TimeScribe', '页面标题应为「TimeScribe」');
    T.ok(doc.getElementById('project-list'), '缺少项目列表容器');
    T.ok(doc.getElementById('modal-host'), '缺少弹窗容器');
    T.ok(doc.getElementById('toast-host'), '缺少提示条容器');
    T.ok(doc.getElementById('chart-host'), '缺少扇形图容器');
  });

  T.test('启动后页面上有可见的启动状态（不是空白页）', function () {
    const doc = appDoc();
    const status = doc.getElementById('boot-status');
    T.ok(status, '缺少启动状态元素，用户看不到任何反馈');
    T.contains(status.textContent, '启动成功', '启动状态没有报告成功');
    T.contains(status.textContent, '本机存储可用', '未确认本机存储可用');
  });

  T.test('本机存储可写入并读回（刷新后数据不丢的基础）', function () {
    const key = 'timescribe.__selftest__';
    const value = 'v-' + Date.now();
    localStorage.setItem(key, value);
    T.equal(localStorage.getItem(key), value, '写入后读回不一致');
    localStorage.removeItem(key);
    T.equal(localStorage.getItem(key), null, '删除后仍能读到内容');
  });

  T.test('app 与测试页共用同一份本机存储（同源，数据才能持久化）', function () {
    const w = appWindow();
    const key = 'timescribe.__shared__';
    w.localStorage.setItem(key, 'from-app');
    T.equal(localStorage.getItem(key), 'from-app', 'app 与测试页的本机存储不互通');
    w.localStorage.removeItem(key);
  });

  T.test('页面只加载了本机资源，没有任何外部请求（A4）', function () {
    const entries = performance.getEntriesByType('resource');
    T.ok(entries.length > 0, '没有采集到任何资源记录，测试本身无效');
    const external = [];
    for (const e of entries) {
      const url = e.name;
      if (!/^https?:\/\//.test(url)) continue;
      if (/^https?:\/\/127\.0\.0\.1(:\d+)?\//.test(url)) continue;
      external.push(url);
    }
    T.deepEqual(external, [], '页面加载了外部资源');
  });

  T.test('样式表已生效（app 自己的样式，不是测试页的）', function () {
    const w = appWindow();
    const doc = appDoc();
    T.ok(doc.styleSheets.length > 0, 'app 没有加载到任何样式表');
    const header = doc.querySelector('.appbar');
    T.ok(header, '缺少顶栏元素，样式无法验证');
    const display = w.getComputedStyle(header).display;
    T.equal(display, 'flex', '顶栏没有应用弹性布局，说明 app.css 未生效');
  });

  T.test('没有脚本错误', function () {
    T.deepEqual(window.__TT_PAGE_ERRORS__ || [], [], '页面出现了脚本错误');
  });
});
