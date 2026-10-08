/**
 * 给 PowerShell 脚本补 UTF-8 BOM。
 * 原因：Windows PowerShell 5.1 读取无 BOM 的 UTF-8 文件时会按 ANSI 解码，中文会乱码。
 *
 * 注意：**.bat / .cmd 绝对不能加 BOM**——cmd.exe 会把 BOM 当成命令的一部分，
 * 导致 "@echo off" 变成 "?@echo off"，整份脚本逐行回显甚至执行失败。
 * 批处理文件一律保持纯 ASCII，中文说明放到 说明.txt。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NEEDS_BOM = new Set(['.ps1']);
const NEVER_BOM = new Set(['.bat', '.cmd']);
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'tmp') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const ext = path.extname(file).toLowerCase();
  if (!NEEDS_BOM.has(ext) && !NEVER_BOM.has(ext)) continue;
  const buf = readFileSync(file);
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  if (NEEDS_BOM.has(ext)) {
    if (hasBom) continue;
    writeFileSync(file, Buffer.concat([BOM, buf]));
    changed += 1;
    console.log('已补 BOM: ' + path.relative(ROOT, file));
    continue;
  }

  // .bat / .cmd：去掉 BOM，并确认没有非 ASCII 字节
  if (hasBom) {
    writeFileSync(file, buf.subarray(3));
    changed += 1;
    console.log('已移除 BOM: ' + path.relative(ROOT, file));
  }
  const check = readFileSync(file);
  for (let i = 0; i < check.length; i++) {
    if (check[i] > 0x7F) {
      throw new Error(path.relative(ROOT, file) + ' 存在非 ASCII 字节（位置 ' + i + '），cmd 下会乱码，请改用英文');
    }
  }
}
console.log(changed === 0 ? '脚本文件编码检查通过，无需修改。' : `处理完成，共修改 ${changed} 个文件。`);
