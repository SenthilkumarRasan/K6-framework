// k6 does not support importing from node_modules. It only supports local files (with relative/absolute paths)
// This script copies all files from the utils directory of the dee-qe-perf-libs package
// to a local utils directory.
// This script is intended to be run in a Node.js environment.
import { readdirSync, cpSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const srcDir = './node_modules/dee-qe-perf-libs/utils/';
const destDir = './utils/';

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir);

for (const file of files) {
  const srcFile = join(srcDir, file);
  const destFile = join(destDir, file);
  if (statSync(srcFile).isFile()) {
    cpSync(srcFile, destFile);
  }
}
console.log('Copied all perf libs from package utils/ to local utils/');