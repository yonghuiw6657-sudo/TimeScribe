/**
 * P0 静态资源自检（只在 Node 下运行，浏览器无文件系统，跳过）
 * 覆盖 PRD 验收 A4：除本机资源外，没有任何外部引用。
 */
(function () {
  'use strict';
  if (!TTTest || typeof TT === 'undefined' || !TT.fs) {
    // 浏览器环境没有文件系统：本套用例只在 Node 侧执行
    return;
  }

TTTest.defineSuite('P0', '静态资源：目录结构与离线约束', function () {
  const T = TTTest;

  function extractUrls(text) {
    const out = [];
    const re = /https?:\/\/[^\s"'`)<>\]]+/g;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[0]);
    return out;
  }

  function getHost(url) {
    const m = /^https?:\/\/([^\/:?#]+)/.exec(url);
    return m ? m[1] : null;
  }

  /**
   * XML 命名空间标识符不是网络请求。
   * 例如创建 SVG 元素时必须写 http://www.w3.org/2000/svg，它永远不会被访问。
   */
  function isNamespaceUrl(url) {
    return /^https?:\/\/www\.w3\.org\/\d{4}\//.test(url) ||
      /^https?:\/\/www\.w3\.org\/(XML|TR|svg)/i.test(url);
  }

  T.test('index.html 存在且使用中文界面', function () {
    const html = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'index.html'), 'utf8');
    T.contains(html, 'lang="zh-CN"', 'index.html 应声明中文语言');
    T.contains(html, 'TimeScribe', 'index.html 应包含中文标题');
    T.contains(html, 'charset="utf-8"', 'index.html 应声明 UTF-8 编码');
  });

  T.test('index.html 引用了样式与入口脚本', function () {
    const html = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'index.html'), 'utf8');
    T.contains(html, 'css/app.css', '应引用 css/app.css');
    T.contains(html, 'js/main.js', '应引用 js/main.js');
  });

  T.test('引用的每个本地文件都真实存在', function () {
    const html = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'index.html'), 'utf8');
    const refs = [];
    const re = /(?:href|src)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (/^https?:/i.test(url) || url.startsWith('//')) continue;
      refs.push(url);
    }
    T.ok(refs.length >= 2, '应至少引用 2 个本地资源，实际 ' + refs.length);
    for (const ref of refs) {
      const file = TT.path.join(TT.ROOT, ref);
      T.ok(TT.fs.existsSync(file), '被引用的文件不存在：' + ref);
    }
  });

  T.test('交付文件里没有任何网络引用，连 localhost 都不需要（A4）', function () {
    const mustExist = ['index.html', 'css/app.css', 'js/main.js'];
    const shipped = [];
    for (const rel of mustExist) {
      const full = TT.path.join(TT.ROOT, rel);
      T.ok(TT.fs.existsSync(full), '交付文件缺失：' + rel);
      shipped.push(full);
    }
    for (const extra of TT.walk(TT.path.join(TT.ROOT, 'js')).concat(TT.walk(TT.path.join(TT.ROOT, 'css')))) {
      if (shipped.indexOf(extra) === -1) shipped.push(extra);
    }
    const offenders = [];
    for (const file of shipped) {
      const text = TT.fs.readFileSync(file, 'utf8');
      const urls = extractUrls(text).filter(function (u) {
        return !/\$\{/.test(u) && !isNamespaceUrl(u);
      });
      for (const url of urls) {
        offenders.push(TT.path.relative(TT.ROOT, file) + ' → ' + url);
      }
    }
    T.deepEqual(offenders, [], '交付文件引用了网络地址，离线运行时可能失败');
  });

  T.test('整个目录内不存在指向外部主机的地址（A4）', function () {
    const textExt = ['.html', '.css', '.js', '.mjs', '.json', '.txt', '.md'];
    const files = TT.walk(TT.ROOT).filter(function (f) {
      return textExt.indexOf(TT.path.extname(f).toLowerCase()) !== -1;
    });
    T.ok(files.length > 0, '应该找到待检查的文本文件');
    const offenders = [];
    for (const file of files) {
      const text = TT.fs.readFileSync(file, 'utf8');
      const urls = extractUrls(text);
      for (const url of urls) {
        if (/\$\{/.test(url)) continue;                 // 模板占位地址，无法判定主机
        if (isNamespaceUrl(url)) continue;              // XML 命名空间，不是请求
        const host = getHost(url);
        if (!host) continue;
        if (host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0') continue; // 本机地址
        offenders.push(TT.path.relative(TT.ROOT, file) + ' → ' + url);
      }
    }
    T.deepEqual(offenders, [], '存在指向外部主机的引用');
  });

  T.test('目录结构齐全（启动/停止脚本、说明文件）', function () {
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, '启动.bat')), '缺少 启动.bat');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, 'launch.ps1')), '缺少 launch.ps1');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, '停止.bat')), '缺少 停止.bat');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, 'serve.ps1')), '缺少 serve.ps1');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, 'start-server.ps1')), '缺少 start-server.ps1');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, 'css', 'app.css')), '缺少 css/app.css');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, 'js', 'main.js')), '缺少 js/main.js');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, '说明.txt')), '缺少 说明.txt');
    T.ok(TT.fs.existsSync(TT.path.join(TT.ROOT, '备份')), '缺少 备份 文件夹');
  });

  T.test('说明.txt 用大白话讲清了启动、备份、恢复、换电脑（H5）', function () {
    const doc = TT.fs.readFileSync(TT.path.join(TT.ROOT, '说明.txt'), 'utf8');
    T.contains(doc, '启动.bat', '要讲怎么启动');
    T.contains(doc, '导出', '要讲怎么备份');
    T.contains(doc, '导入', '要讲怎么恢复');
    T.contains(doc, '换电脑', '要讲换电脑怎么搬');
    T.contains(doc, '清理', '要提醒不要清理浏览器数据');
    T.contains(doc, 'Edge', '要提醒一直用 Edge 打开');
    T.ok(doc.length > 800, '说明不该太短（当前 ' + doc.length + ' 字）');
  });

  T.test('启动脚本只使用本机回环地址，并优先用 Edge 打开', function () {
    const launcher = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'launch.ps1'), 'utf8');
    T.contains(launcher, '127.0.0.1', 'launch.ps1 应访问本机回环地址');
    T.contains(launcher, 'msedge.exe', 'launch.ps1 应用 Edge 打开');
    T.notContains(launcher, 'http://0.0.0.0', '不应绑定到所有网卡');
    const bat = TT.fs.readFileSync(TT.path.join(TT.ROOT, '启动.bat'), 'utf8');
    T.contains(bat, 'launch.ps1', '启动.bat 应把逻辑交给 launch.ps1');
  });

  T.test('serve.ps1 只监听回环地址，且有 TCP 兜底方案', function () {
    const ps = TT.fs.readFileSync(TT.path.join(TT.ROOT, 'serve.ps1'), 'utf8');
    T.contains(ps, '127.0.0.1', 'serve.ps1 应只监听 127.0.0.1');
    T.contains(ps, 'TcpListener', 'serve.ps1 应保留 TCP 兜底实现');
    T.contains(ps, 'HttpListener', 'serve.ps1 应优先使用 HttpListener');
  });

  T.test('脚本文件编码正确（.ps1 带 BOM，.bat 纯 ASCII 且无 BOM）', function () {
    for (const name of ['serve.ps1', 'start-server.ps1', 'launch.ps1']) {
      const buf = TT.fs.readFileSync(TT.path.join(TT.ROOT, name));
      const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
      T.ok(hasBom, name + ' 缺少 UTF-8 BOM（PowerShell 5.1 下中文会乱码）');
    }
    for (const name of ['启动.bat', '停止.bat', '测试.bat']) {
      const buf = TT.fs.readFileSync(TT.path.join(TT.ROOT, name));
      const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
      T.notOk(hasBom, name + ' 不应带 BOM（cmd 会把 BOM 当成命令的一部分）');
      for (let i = 0; i < buf.length; i++) {
        T.ok(buf[i] <= 0x7F, name + ' 存在非 ASCII 字节（位置 ' + i + '），cmd 下会乱码');
      }
    }
  });
});

})();
