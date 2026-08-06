import fs from 'node:fs';
import path from 'node:path';
import type { StoreData } from '../types';

function isValidStoreData(data: unknown): data is StoreData {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.guilds === 'object' &&
    candidate.guilds !== null
  );
}

function readAndParse(filePath: string): StoreData | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return isValidStoreData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function loadStore(filePath: string): StoreData {
  if (!fs.existsSync(filePath)) {
    const defaultData: StoreData = { version: 1, guilds: {} };
    saveStore(filePath, defaultData);
    return defaultData;
  }

  const main = readAndParse(filePath);
  if (main) return main;

  const backup = readAndParse(`${filePath}.bak`);
  if (backup) {
    console.error(`[jsonStore] ${filePath} is corrupted, recovered from .bak`);
    return backup;
  }

  throw new Error(`Config file corrupted and no valid backup found: ${filePath}`);
}

export function saveStore(filePath: string, data: StoreData): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}
