import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

export interface SecretStatus {
  configured: boolean;
  source: 'environment' | 'local_env_file' | 'unset';
  malformed: boolean;
  warning?: string;
}

const PLACEHOLDER_VALUES = new Set(['', 'MY_GEMINI_API_KEY', 'YOUR_API_KEY', 'your-key-here']);

function readLocalDotEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    ...(process.env.STRANGE_DATA_DIR ? [path.resolve(process.env.STRANGE_DATA_DIR, '..', '.env')] : []),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return dotenv.parse(raw);
      }
    } catch {
      // skip unreadable candidate
    }
  }
  return {};
}

function isReasonableKeyFormat(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed.length < 12) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}

/**
 * Resolves the Gemini API key strictly on the server.
 * Priority:
 * 1. Process environment (`GEMINI_API_KEY` injected by AI Studio Secrets or Electron DPAPI safeStorage)
 * 2. Local `.env` file (reloaded dynamically so saving via CONFIGURE-GEMINI-KEY.bat works immediately)
 * Never exposes or logs the raw credential value.
 */
export function resolveServerSecret(name: string): { value: string | null; status: SecretStatus } {
  const envVal = (process.env[name] || '').trim();
  if (envVal && !PLACEHOLDER_VALUES.has(envVal)) {
    const valid = isReasonableKeyFormat(envVal);
    return {
      value: valid ? envVal : null,
      status: {
        configured: valid,
        source: 'environment',
        malformed: !valid,
        warning: valid ? undefined : `${name} in environment appears malformed (too short or contains whitespace).`,
      },
    };
  }

  const localEnv = readLocalDotEnv();
  const fileVal = (localEnv[name] || '').trim();
  if (fileVal && !PLACEHOLDER_VALUES.has(fileVal)) {
    const valid = isReasonableKeyFormat(fileVal);
    return {
      value: valid ? fileVal : null,
      status: {
        configured: valid,
        source: 'local_env_file',
        malformed: !valid,
        warning: valid ? undefined : `${name} in local .env appears malformed (too short or contains whitespace).`,
      },
    };
  }

  return {
    value: null,
    status: {
      configured: false,
      source: 'unset',
      malformed: false,
    },
  };
}

export function getGeminiSecretStatus(): SecretStatus {
  return resolveServerSecret('GEMINI_API_KEY').status;
}

export function getGeminiApiKeyOrThrow(): string {
  const { value, status } = resolveServerSecret('GEMINI_API_KEY');
  if (status.malformed) {
    throw new Error(
      status.warning || 'GEMINI_API_KEY appears malformed. Check the saved key and remove any extra spaces or quotes.'
    );
  }
  if (!value) {
    throw new Error(
      'GEMINI_API_KEY is not configured. In Google AI Studio, set it in Settings > Secrets; on Windows localhost, double-click CONFIGURE-GEMINI-KEY.bat in your STRANGE folder to save it securely.'
    );
  }
  return value;
}
