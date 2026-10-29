import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read-night.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

function makeTempRunsDir(): string {
  return mkdtempSync(join(tmpdir(), 'rig-digest-'));
}

describe('readNight', () => {
  it('aggregates the sample night, counts malformed lines, and sorts jobs', () => {
    const digest = readNight('runs', '2026-10-28');

    expect(digest).not.toBeNull();
    if (!digest) throw new Error('sample night should exist');

    expect(digest.rows).toHaveLength(5);
    expect(digest.malformedLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual(
      [...digest.rows.map((row) => row.job)].sort((left, right) => left.localeCompare(right)),
    );
    expect(digest.rows.find((row) => row.job === 'fixtures/refresh')).toMatchObject({
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
  });

  it('returns null when the night file does not exist', () => {
    const runsDir = makeTempRunsDir();
    try {
      expect(readNight(runsDir, '2026-10-29')).toBeNull();
      expect(readNight(runsDir, '../2026-10-29')).toBeNull();
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('returns an empty digest for an empty file', () => {
    const runsDir = makeTempRunsDir();
    try {
      writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
      expect(readNight(runsDir, '2026-10-29')).toEqual({
        rows: [],
        malformedLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('keeps valid rows when another line is malformed', () => {
    const runsDir = makeTempRunsDir();
    try {
      const sample = readFileSync('runs/2026-10-28.jsonl', 'utf8').split(/\r?\n/)[0];
      writeFileSync(join(runsDir, '2026-10-29.jsonl'), `${sample}\nnot json\n`);
      const digest = readNight(runsDir, '2026-10-29');

      expect(digest).toEqual({
        rows: [
          {
            job: 'rig/rotate-logs',
            owner: 'lane-07',
            runs: 1,
            retries: 0,
            lastStatus: 'ok',
            lastError: null,
            firstAt: '2026-10-28T23:00:02+01:00',
            lastAt: '2026-10-28T23:00:02+01:00',
          },
        ],
        malformedLines: 1,
        counts: { ok: 1, retry: 0, fail: 0 },
      });
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});

describe('digest routes', () => {
  it('renders the fixture in the HTML page with problem rows marked', async () => {
    const response = await createApp(config).request('/digest/2026-10-28');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('digest/render');
    expect(html).toContain('—');
    expect(html).toContain('1 malformed line ignored');
    expect(html).toMatch(/<span class="warn">3<\/span>/);
    expect(html).toMatch(/<span class="warn">fail<\/span>/);
  });

  it('returns the same sorted rows as JSON', async () => {
    const app = createApp(config);
    const pageResponse = await app.request('/digest/2026-10-28');
    const apiResponse = await app.request('/api/digest/2026-10-28');
    const html = await pageResponse.text();
    const digest = await apiResponse.json() as {
      rows: { job: string }[];
      malformedLines: number;
      counts: { ok: number; retry: number; fail: number };
    };
    const positions = digest.rows.map((row) => html.indexOf(row.job));

    expect(apiResponse.status).toBe(200);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(digest.malformedLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('returns 404 for a missing night on both routes', async () => {
    const app = createApp(config);

    expect((await app.request('/digest/2026-10-30')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-30')).status).toBe(404);
  });

  it('renders an empty night and returns an empty JSON digest', async () => {
    const runsDir = makeTempRunsDir();
    try {
      writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
      const app = createApp({ ...config, runsDir });
      const pageResponse = await app.request('/digest/2026-10-29');
      const apiResponse = await app.request('/api/digest/2026-10-29');

      expect(pageResponse.status).toBe(200);
      expect(await pageResponse.text()).toContain('nothing ran');
      expect(await apiResponse.json()).toEqual({
        rows: [],
        malformedLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});