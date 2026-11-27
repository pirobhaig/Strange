import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFileSync } from 'child_process';

const ROOT_DIR = path.resolve(process.cwd());
const ENV_PATH = path.join(ROOT_DIR, '.env');

function readEnvLines() {
  if (!fs.existsSync(ENV_PATH)) return [];
  const raw = fs.readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
  return raw.split(/\r?\n/);
}

function getCurrentKeyStatus() {
  const lines = readEnvLines();
  const line = lines.find((l) => /^GEMINI_API_KEY\s*=/.test(l.trim()));
  if (!line) return { configured: false };
  const val = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  if (!val || val === 'MY_GEMINI_API_KEY' || val.length < 12) {
    return { configured: false };
  }
  return { configured: true, length: val.length, startsWithAIza: val.startsWith('AIza') };
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      promptLine(question).then(resolve);
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        } else if (ch === '\u0003') {
          // Ctrl+C
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\nCancelled.\n');
          process.exit(0);
        } else if (ch === '\u0008' || ch === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

function saveKey(rawKey) {
  // Strip accidental "GEMINI_API_KEY=" prefix or surrounding quotes if user pasted a full line
  let key = rawKey.trim();
  if (/^GEMINI_API_KEY\s*=/i.test(key)) {
    key = key.replace(/^GEMINI_API_KEY\s*=/i, '').trim();
  }
  key = key.replace(/^["']|["']$/g, '').trim();

  if (key.length < 12 || /\s/.test(key)) {
    console.log('\nERROR: The key appears empty, too short, or contains spaces. Nothing was saved.');
    return false;
  }

  if (!key.startsWith('AIza')) {
    console.log(
      '\nNOTE: Standard Google AI Studio Gemini API keys usually start with "AIza..." (from https://aistudio.google.com/apikey).'
    );
    console.log('Saving your entered key anyway — run the 6-Point AI Diagnostic in Settings to verify it.');
  }

  const existing = readEnvLines().filter((l) => l.trim() !== '' && !/^GEMINI_API_KEY\s*=/.test(l.trim()));
  existing.push(`GEMINI_API_KEY=${key}`);
  fs.writeFileSync(ENV_PATH, existing.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });

  // Restrict NTFS permissions on Windows when supported (silently skip on FAT32/exFAT drives)
  if (process.platform === 'win32' && process.env.USERNAME) {
    try {
      execFileSync('icacls', [ENV_PATH, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(R,W)`], {
        stdio: 'ignore',
      });
    } catch {
      // Non-NTFS drive or restricted icacls — file is still saved safely in .env
    }
  }

  console.log('\nSUCCESS: Saved GEMINI_API_KEY to .env (value hidden).');
  console.log('STRANGE reloads .env dynamically — you can now launch OPEN-STRANGE.bat or test in Settings.');
  return true;
}

function removeKey() {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('\nNo .env file found in this folder.');
    return;
  }
  const kept = readEnvLines().filter((l) => l.trim() !== '' && !/^GEMINI_API_KEY\s*=/.test(l.trim()));
  fs.writeFileSync(ENV_PATH, kept.length ? kept.join('\n') + '\n' : '', { encoding: 'utf8' });
  console.log('\nSUCCESS: Removed GEMINI_API_KEY from .env.');
}

function detectMisnamedEnvFiles() {
  try {
    return fs
      .readdirSync(ROOT_DIR)
      .filter((f) => /^GEMINI_API_KEY=/i.test(f) && f.toLowerCase().endsWith('.env'));
  } catch {
    return [];
  }
}

async function main() {
  console.log('============================================================');
  console.log('  STRANGE - Secure Local Gemini API Key Configuration');
  console.log('============================================================\n');
  console.log('Your key is saved ONLY in a local .env file on your computer.');
  console.log('It is never exposed to browser JS or included in backups.\n');

  const misnamed = detectMisnamedEnvFiles();
  if (misnamed.length > 0) {
    console.log('WARNING: Found misnamed file(s) where the key was put in the filename:');
    for (const f of misnamed) console.log(`  - ${f}`);
    console.log('The file must be named exactly ".env" with GEMINI_API_KEY=... inside it.\n');
  }

  console.log('  [1] Save or Update Gemini API Key (masked input)');
  console.log('  [2] Remove Saved Gemini API Key');
  console.log('  [3] Check Configuration Status (key hidden)');
  console.log('  [4] Exit\n');

  const choice = await promptLine('Choose an option (1-4): ');

  if (choice === '1') {
    console.log('\nPaste or type your Google AI Studio Gemini API key, then press Enter:');
    const key = await promptHidden('GEMINI_API_KEY: ');
    saveKey(key);
  } else if (choice === '2') {
    removeKey();
  } else if (choice === '3') {
    const status = getCurrentKeyStatus();
    if (status.configured) {
      console.log(
        `\nStatus: CONFIGURED in .env (value hidden, ${status.length} chars${status.startsWithAIza ? ', AIza format' : ''}).`
      );
    } else {
      console.log('\nStatus: NOT CONFIGURED in .env.');
    }
  } else {
    console.log('\nExiting.');
  }
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
