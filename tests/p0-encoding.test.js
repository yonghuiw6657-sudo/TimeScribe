/**
 * 源码编码自检（Node 运行）
 *
 * 由来：用 PowerShell 5.1 的 Set-Content 改文件会把 UTF-8 中文写成 ANSI 乱码，
 * 而且这种破坏**不会**被普通逻辑测试发现（文件语法都可能还是"合法"的）。
 * 因此这里对所有源码做一次编码体检：
 *   - 必须是合法 UTF-8（出现替换字符 U+FFFD 即视为已损坏）
 *   - 中文字符必须能被正确读出（比如"TimeScribe"必须读得到）
 */
TTTest.defineSuite('P0', '源码编码体检', function () {
  const T = TTTest;
  const path = TT.path;
  const fs = TT.fs;

  function readUtf8(file) {
    const buf = fs.readFileSync(file);
    return { buf: buf, text: buf.toString('utf8') };
  }

  function isProbablyBinary(buf) {
    const sample = buf.subarray(0, Math.min(400, buf.length));
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  }

  const sourceFiles = function () {
    const files = [];
    ['js', 'css'].forEach(function (dir) {
      const full = path.join(TT.ROOT, dir);
      files.push.apply(files, TT.walk(full));
    });
    files.push(path.join(TT.ROOT, 'index.html'));
    files.push(path.join(TT.ROOT, 'tests', 'selftest.html'));
    return files.filter(function (f) { return fs.existsSync(f) && !isProbablyBinary(fs.readFileSync(f)); });
  };

  T.test('所有源码文件都是合法 UTF-8，没有出现替换字符（说明没有被写成 ANSI）', function () {
    const bad = [];
    for (const file of sourceFiles()) {
      const r = readUtf8(file);
      if (r.text.indexOf('\uFFFD') !== -1) {
        bad.push(path.relative(TT.ROOT, file));
      }
    }
    T.deepEqual(bad, [], '这些文件疑似被以 ANSI 写入导致中文损坏');
  });

  T.test('源码里的中文能正确读出（抽查关键文案）', function () {
    const checks = [
      ['js/main.js', '本机存储空间不足'],
      ['js/main.js', '启动成功'],
      ['js/calc.js', '小时'],
      ['js/projects.js', '请填写项目名称'],
      ['js/ui/home.js', '累计总投入'],
      ['js/ui/records.js', '手动补一条'],
      ['js/ui/data.js', '已导出'],
      ['index.html', 'TimeScribe'],
      ['tests/selftest.html', '自检']
    ];
    for (const pair of checks) {
      const file = path.join(TT.ROOT, pair[0]);
      const text = readUtf8(file).text;
      T.contains(text, pair[1], pair[0] + ' 里的中文文案读不出来，可能编码已损坏');
    }
  });

  T.test('源码文件里没有出现常见的乱码片段', function () {
    const garbage = ['鏈', '瀛樺', '鏂囦', '锛', '鈥'];
    const offenders = [];
    for (const file of sourceFiles()) {
      const text = readUtf8(file).text;
      for (const g of garbage) {
        if (text.indexOf(g) !== -1) {
          offenders.push(path.relative(TT.ROOT, file) + ' 含乱码片段 ' + g);
          break;
        }
      }
    }
    T.deepEqual(offenders, [], '源码里出现 ANSI 乱码');
  });
});
