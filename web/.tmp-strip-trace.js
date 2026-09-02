// Strip trace function calls from a file. Match call start with `(`, walk forward
// to balance `(` / `{` / `)` / `}`, then drop the lines that form the call.
// Drop one optional trailing blank line so we don't leave a double blank.

const fs = require('fs');
const path = process.argv[2];
const funcName = process.argv[3];

const text = fs.readFileSync(path, 'utf8');
const lines = text.split(/\r?\n/);
const out = [];
let i = 0;
let deleted = 0;

while (i < lines.length) {
  const line = lines[i];
  const stripped = line.trimStart();
  if (stripped.startsWith(funcName + '(')) {
    const openIdx = line.indexOf(funcName + '(');
    let paren = 0;
    let brace = 0;
    // Init counts from current line (after opening paren)
    for (let k = openIdx + funcName.length + 1; k < line.length; k++) {
      const ch = line[k];
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '{') brace++;
      else if (ch === '}') brace--;
    }
    let endLine = -1;
    if (paren === 0 && brace === 0) {
      endLine = i;
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        for (let k = 0; k < lines[j].length; k++) {
          const ch = lines[j][k];
          if (ch === '(') paren++;
          else if (ch === ')') paren--;
          else if (ch === '{') brace++;
          else if (ch === '}') brace--;
        }
        if (paren === 0 && brace === 0) {
          endLine = j;
          break;
        }
      }
    }
    if (endLine === -1) {
      out.push(line);
      i++;
      continue;
    }
    i = endLine + 1;
    // Skip one trailing blank line if present
    if (i < lines.length && lines[i].trim() === '') {
      i++;
    }
    deleted++;
    continue;
  }
  out.push(line);
  i++;
}

fs.writeFileSync(path, out.join('\n'), 'utf8');
console.log(`${path}: deleted ${deleted} call(s) of ${funcName}`);