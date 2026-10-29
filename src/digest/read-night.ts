import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRead, DigestRow, ReadNight } from './types.js';

type RunRecord = {
  at: string;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error?: string;
};

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.at === 'string' &&
    !Number.isNaN(Date.parse(record.at)) &&
    typeof record.job === 'string' &&
    record.job.length > 0 &&
    (record.status === 'ok' || record.status === 'retry' || record.status === 'fail') &&
    (record.owner === null || typeof record.owner === 'string') &&
    (record.error === undefined || typeof record.error === 'string')
  );
}

export const readNight: ReadNight = (runsDir, night): DigestRead | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const rows = new Map<string, DigestRow>();
  let malformedLines = 0;
  const counts = { ok: 0, retry: 0, fail: 0 };

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isRunRecord(value)) {
      malformedLines++;
      continue;
    }

    counts[value.status]++;
    const timestamp = Date.parse(value.at);
    const row = rows.get(value.job);
    if (!row) {
      rows.set(value.job, {
        job: value.job,
        owner: value.owner,
        runs: 1,
        retries: value.status === 'retry' ? 1 : 0,
        lastStatus: value.status,
        lastError: value.error ?? null,
        firstAt: value.at,
        lastAt: value.at,
      });
      continue;
    }

    row.runs++;
    if (value.status === 'retry') row.retries++;
    if (timestamp < Date.parse(row.firstAt)) row.firstAt = value.at;
    if (timestamp >= Date.parse(row.lastAt)) {
      row.owner = value.owner;
      row.lastStatus = value.status;
      row.lastError = value.error ?? null;
      row.lastAt = value.at;
    }
  }

  return {
    rows: [...rows.values()].sort((left, right) => left.job.localeCompare(right.job)),
    malformedLines,
    counts,
  };
};