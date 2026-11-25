// Conservative POSIX-shell tokenizer for the OxEye guard hooks.
// It never executes or expands anything. Constructs whose effect cannot be
// determined statically (expansions, substitutions, heredocs, subshells,
// brace groups, comments, line continuations) raise ParseError, and callers
// treat that as a block (fail closed).

export class ParseError extends Error {}

const VAR_START = /[A-Za-z0-9_@*#?$!-]/;

/**
 * @param {string} cmd
 * @returns {{words: {text: string, glob: boolean, tilde: boolean}[], redirects: {op: string, target: string}[]}[]}
 */
export function parse(cmd) {
  if (typeof cmd !== 'string') throw new ParseError('command is not a string');
  if (!cmd.trim()) throw new ParseError('empty command');
  if (cmd.length > 20000) throw new ParseError('command too long');

  const segments = [];
  let words = [];
  let redirects = [];
  let cur = null; // current word text, null when no word is open
  let curGlob = false;
  let curTilde = false;
  let curQuoted = false;
  let pendingRedirect = null;
  const fail = (m) => {
    throw new ParseError(m);
  };

  const pushWord = () => {
    if (cur === null) return;
    if (pendingRedirect) {
      redirects.push({ op: pendingRedirect, target: cur });
      pendingRedirect = null;
    } else {
      words.push({ text: cur, glob: curGlob, tilde: curTilde });
    }
    cur = null;
    curGlob = false;
    curTilde = false;
    curQuoted = false;
  };
  const endSeg = (sep) => {
    pushWord();
    if (pendingRedirect) fail('redirection without a target');
    if (!words.length && !redirects.length) {
      if (sep === 'newline' || sep === 'end') return;
      fail(`empty command before "${sep}"`);
    }
    segments.push({ words, redirects });
    words = [];
    redirects = [];
  };
  const startRedirect = (op) => {
    // A word made only of digits immediately before the operator is a file descriptor.
    if (cur !== null && !curQuoted && /^\d+$/.test(cur)) {
      op = cur + op;
      cur = null;
      curGlob = false;
      curTilde = false;
    } else {
      pushWord();
    }
    if (pendingRedirect) fail('consecutive redirections');
    pendingRedirect = op;
  };
  const append = (s, quoted) => {
    if (cur === null) {
      cur = '';
      curTilde = !quoted && s === '~';
    }
    if (quoted) curQuoted = true;
    cur += s;
  };
  const checkDollar = (next) => {
    if (next === undefined) return;
    if (next === '(' || next === '{') fail('command substitution or parameter expansion');
    if (next === "'" || next === '"') fail('$-quoting');
    if (VAR_START.test(next)) fail('variable expansion');
  };

  const n = cmd.length;
  let i = 0;
  while (i < n) {
    const c = cmd[i];
    const nx = cmd[i + 1];

    if (c === ' ' || c === '\t') {
      pushWord();
      i++;
      continue;
    }
    if (c === '\r') {
      if (nx !== '\n') fail('stray carriage return');
      i++;
      continue;
    }
    if (c === '\n') {
      endSeg('newline');
      i++;
      continue;
    }
    if (c === ';') {
      if (nx === ';') fail('";;"');
      endSeg(';');
      i++;
      continue;
    }
    if (c === '&') {
      if (nx === '&') {
        endSeg('&&');
        i += 2;
        continue;
      }
      if (nx === '>') {
        const op = cmd[i + 2] === '>' ? '&>>' : '&>';
        startRedirect(op);
        i += op.length;
        continue;
      }
      endSeg('&');
      i++;
      continue;
    }
    if (c === '|') {
      if (nx === '|') {
        endSeg('||');
        i += 2;
        continue;
      }
      endSeg(nx === '&' ? '|&' : '|');
      i += nx === '&' ? 2 : 1;
      continue;
    }
    if (c === '>') {
      if (nx === '(') fail('process substitution');
      let op = '>';
      if (nx === '>' || nx === '|' || nx === '&') op += nx;
      startRedirect(op);
      i += op.length;
      continue;
    }
    if (c === '<') {
      if (nx === '<') fail('heredoc or herestring');
      if (nx === '(') fail('process substitution');
      if (nx === '>') fail('read-write redirection');
      const op = nx === '&' ? '<&' : '<';
      startRedirect(op);
      i += op.length;
      continue;
    }
    if (c === '(' || c === ')') fail('subshell or grouping');
    if (c === '{' || c === '}') fail('brace group or brace expansion');
    if (c === '`') fail('backtick command substitution');
    if (c === '#' && cur === null) fail('comment');
    if (c === '$') {
      checkDollar(nx);
      append('$', false);
      i++;
      continue;
    }
    if (c === '\\') {
      if (nx === undefined) fail('trailing backslash');
      if (nx === '\n' || nx === '\r') fail('line continuation');
      append(nx, true);
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) fail('unbalanced single quote');
      append(cmd.slice(i + 1, end), true);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      for (;;) {
        if (j >= n) fail('unbalanced double quote');
        const d = cmd[j];
        if (d === '"') break;
        if (d === '`') fail('backtick command substitution');
        if (d === '$') {
          checkDollar(cmd[j + 1]);
          buf += '$';
          j++;
          continue;
        }
        if (d === '\\') {
          const e = cmd[j + 1];
          if (e === undefined) fail('unbalanced double quote');
          if (e === '\n') fail('line continuation');
          if (e === '$' || e === '`' || e === '"' || e === '\\') {
            buf += e;
            j += 2;
            continue;
          }
          buf += '\\';
          j++;
          continue;
        }
        buf += d;
        j++;
      }
      append(buf, true);
      i = j + 1;
      continue;
    }
    if (c === '*' || c === '?' || c === '[') curGlob = true;
    append(c, false);
    i++;
  }
  endSeg('end');
  if (!segments.length) fail('empty command');
  return segments;
}

export const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Command name: basename, without .exe/.cmd/.bat, lower-case. */
export function cmdName(text) {
  const base = text.split(/[\\/]/).pop() || '';
  return base.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}
