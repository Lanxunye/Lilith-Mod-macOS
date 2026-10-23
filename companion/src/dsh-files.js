'use strict';
const fs = require('node:fs');
const path = require('node:path');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
function createFileTools({workspace, readRoots = [], allowWrite = false}) {
  workspace = fs.realpathSync(workspace);
  const roots = [workspace, ...readRoots.map(p => fs.realpathSync(p))];
  function readable(value) {
    if (typeof value !== 'string') throw new Error('path_required');
    const target = fs.realpathSync(path.resolve(workspace, value));
    if (!roots.some(root => inside(root, target))) throw new Error('file_outside_allowed_scope');
    return target;
  }
  return {
    read(value, offset = 1, limit = 250) {
      const target = readable(value), stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('text_file_required_max_2mb');
      const text = fs.readFileSync(target, 'utf8');
      if (text.includes('\0')) throw new Error('utf8_text_file_required');
      const lines = text.split(/\r?\n/), start = Math.max(0, Math.floor(Number(offset) || 1) - 1);
      return {path: target, total_lines: lines.length,
        text: lines.slice(start, start + Math.min(500, Math.max(1, Number(limit) || 250))).join('\n').slice(0, 40000)};
    },
    list(value = '.') {
      const target = readable(value);
      return {path: target, entries: fs.readdirSync(target, {withFileTypes: true}).slice(0, 200)
        .map(entry => ({name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file'}))};
    },
    write(value, text) {
      if (!allowWrite) throw new Error('file_creation_disabled');
      if (typeof value !== 'string' || typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024)
        throw new Error('invalid_output_file');
      const target = path.resolve(workspace, value);
      if (!inside(workspace, target) || target === workspace) throw new Error('output_outside_task_workspace');
      // Only existing directories with a real path inside the workspace; no symlink traversal or overwrite.
      const parent = fs.realpathSync(path.dirname(target));
      if (!inside(workspace, parent)) throw new Error('output_outside_task_workspace');
      fs.writeFileSync(target, text, {encoding: 'utf8', flag: 'wx', mode: 0o600});
      return {path: target, bytes: Buffer.byteLength(text)};
    }
  };
}
module.exports = {createFileTools, inside};
