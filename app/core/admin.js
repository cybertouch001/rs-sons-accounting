
// R&S Sons Accounting - admin settings rules (password strength, username, app name, theme). Pure JS, shared by main process + tests.
'use strict';
const DEFAULT_APP_NAME = 'R&S Sons Accounting';
const THEMES = ['light', 'dark', 'system'];
const BUILTIN_ICONS = [
  { id: 'rs', label: 'R&S monogram (default)' },
  { id: 'ledger', label: 'Ledger book' },
  { id: 'rupee', label: 'Rupee coin' },
  { id: 'chart', label: 'Growth chart' },
  { id: 'calc', label: 'Calculator' },
];
const COMMON = new Set(['password', 'password1', 'password123', 'admin', 'admin123', 'admin@123', '123456', '1234567', '12345678', '123456789', 'qwerty', 'qwerty123', 'abc123', 'abcd1234', 'welcome', 'welcome1', 'letmein', 'india123', 'iloveyou', '111111', '000000']);

// Strength check: returns { ok, score 0..4, label, errors[] }. ok = may be saved.
function checkPassword(pw, opts = {}) {
  pw = String(pw == null ? '' : pw);
  const errors = [];
  if (pw.length < 8) errors.push('At least 8 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) errors.push('Use letters and numbers both');
  if (/^\s|\s$/.test(pw)) errors.push('No space at the start or end');
  if (COMMON.has(pw.toLowerCase())) errors.push('Too common — choose something harder to guess');
  if (opts.username && pw.toLowerCase().includes(String(opts.username).toLowerCase()) && String(opts.username).length >= 3) errors.push('Must not contain the username');
  if (opts.oldPw != null && pw === String(opts.oldPw)) errors.push('Must be different from the current password');
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (errors.length) score = Math.min(score, 1);
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score];
  return { ok: errors.length === 0, score, label, errors };
}

// Username: 3–30 chars, letters/numbers and . _ - @ ; unique (case-insensitive) among other users.
function validateUsername(name, existing = [], self = null) {
  const n = String(name == null ? '' : name).trim();
  if (n.length < 3 || n.length > 30) throw new Error('Username must be 3 to 30 characters');
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(n)) throw new Error('Username can have only letters, numbers and . _ - @ (no spaces)');
  const key = n.toLowerCase();
  if (existing.some(u => u.toLowerCase() === key && (!self || u.toLowerCase() !== String(self).toLowerCase()))) throw new Error(`Username "${n}" is already taken`);
  if (self && n === self) throw new Error('That is already your username');
  return n;
}

// App display name: 2–60 printable characters; blank/null = default.
function cleanAppName(name) {
  if (name == null) return DEFAULT_APP_NAME;
  const n = String(name).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return DEFAULT_APP_NAME;
  if (n.length < 2) throw new Error('App name is too short');
  if (n.length > 60) throw new Error('App name can be at most 60 characters');
  return n;
}
function cleanTheme(t) { if (!THEMES.includes(t)) throw new Error('Theme must be light, dark or system'); return t; }

module.exports = { DEFAULT_APP_NAME, THEMES, BUILTIN_ICONS, checkPassword, validateUsername, cleanAppName, cleanTheme };
