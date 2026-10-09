// Looks for secrets that should never be in the source tree: access tokens, private keys,
// connection strings with a real password, cloud keys. Run it with `pnpm audit:secrets`; the test
// suite runs it too, so a pasted secret fails the build.
//
// It reads files only and prints where it found something, never the secret itself.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'out', '.turbo']);
const SKIP_FILES = [
  // real environment files are never scanned (they are not committed), but the example file is
  /^\.env(?:\.(?!example$).*)?$/,
  /\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip|gz|lock)$/i,
  /^pnpm-lock\.yaml$/,
];

// Passwords that are published defaults for local test databases, or obvious placeholders.
const SAFE_PASSWORDS = new Set([
  'postgres',
  'password',
  'app_user_test_only',
  'app_user_dev',
  'changeme',
  'xxxx',
  'yourpassword',
  'your-password',
  'secret',
]);

export const RULES = [
  { name: 'Shopify access token or app secret', re: /\bshp(?:at|ss|ca|pa)_[A-Fa-f0-9]{24,}\b/ },
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  {
    name: 'a signed token (JWT) with a payload',
    re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'a 32-character hex value assigned to a secret',
    re: /\b(?:SHOPIFY_API_SECRET|CLIENT_SECRET|API_SECRET)\s*[:=]\s*["']?[a-f0-9]{32}["']?/i,
  },
  {
    name: 'a connection string with a password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|smtps?):\/\/[^:/\s@'"`]+:([^@\s'"`/]+)@/i,
    // a placeholder, an environment reference or a published test default is fine
    allow: (m) => {
      const pw = decodeURIComponent(m[1] ?? '');
      return (
        SAFE_PASSWORDS.has(pw.toLowerCase()) ||
        /^[*<{$%]/.test(pw) ||
        /^\$\{/.test(pw) ||
        /^(?:x+|\*+|\.\.\.|pw\d*|pass(?:word)?\d*|user|u|p|secret\w*|hunter2\w*|s3cret\w*|pw12345678|P%40ssw0rd|secretpw)$/i.test(
          pw,
        ) ||
        pw.length < 4
      );
    },
  },
];

/** Findings in one file's text: rule name and line number, never the matched value. */
export function scanText(path, text) {
  // A test file that needs fake secrets (to prove they are redacted or found) says so in its first lines.
  if (text.slice(0, 600).includes('secret-scan:ignore-file')) return [];
  const found = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 4000) return; // minified or generated
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (m && !(rule.allow && rule.allow(m))) found.push({ path, line: i + 1, rule: rule.name });
    }
  });
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (!SKIP_FILES.some((re) => re.test(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

export function scanRepo(root = ROOT) {
  const findings = [];
  let files = 0;
  for (const file of walk(root)) {
    let text;
    try {
      if (statSync(file).size > 2_000_000) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary
    files++;
    findings.push(...scanText(relative(root, file).split(sep).join('/'), text));
  }
  return { files, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, findings } = scanRepo();
  if (findings.length === 0) {
    console.log(`No secrets found in ${files} files.`);
  } else {
    for (const f of findings) console.error(`${f.path}:${f.line}  ${f.rule}`);
    console.error(
      `\n${findings.length} possible secret(s) found. Remove them and rotate the credential.`,
    );
    process.exit(1);
  }
}
