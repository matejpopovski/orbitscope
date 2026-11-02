import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The script is exercised as a separate process against a local stand-in for
// CelesTrak, because its promises are about how many requests leave the machine.

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Reply {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

let reply: Reply;
let requests: { url: string; userAgent: string | undefined }[] = [];
let server: Server;
let url: string;
let out: string;

const usable = (count: number): string =>
  JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      OBJECT_NAME: `SAT ${i}`,
      OBJECT_ID: '2026-001A',
      EPOCH: '2026-11-01T20:01:28.068960',
      MEAN_MOTION: 15.5,
      ECCENTRICITY: 0.001,
      INCLINATION: 51.6,
      RA_OF_ASC_NODE: 10,
      ARG_OF_PERICENTER: 20,
      MEAN_ANOMALY: 30,
      BSTAR: 0.0001,
      NORAD_CAT_ID: i + 1,
    })),
  );

/** Asynchronous because the stand-in server lives in this same process. */
function run(...args: string[]): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/fetch-snapshot.mjs', '--url', url, '--out', out, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const files = (): string[] => readdirSync(out).sort();

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url ?? '', userAgent: request.headers['user-agent'] });
    response.writeHead(reply.status, reply.headers ?? {});
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gp`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  requests = [];
  out = mkdtempSync(join(tmpdir(), 'orbitscope-snapshot-'));
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('fetch-snapshot', () => {
  it('writes a dated snapshot and a manifest from a good response', async () => {
    reply = { status: 200, body: usable(1200) };
    const result = await run();
    expect(result.status).toBe(0);
    const [snapshot] = files().filter((name) => name.startsWith('active-'));
    expect(snapshot).toMatch(/^active-\d{4}-\d{2}-\d{2}\.json$/);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as {
      objects: number;
      file: string;
    };
    expect(manifest.objects).toBe(1200);
    expect(manifest.file).toBe(snapshot);
  });

  it('identifies itself', async () => {
    reply = { status: 200, body: usable(1200) };
    await run();
    expect(requests[0]?.userAgent).toMatch(/^orbitscope-snapshot\//);
  });

  it.each([403, 404, 500, 503])('makes one attempt and stops on HTTP %i', async (status) => {
    reply = { status, body: 'GP data has not updated since your last successful download' };
    const result = await run();
    expect(result.status).toBe(1);
    expect(requests).toHaveLength(1);
    expect(result.stderr).toContain(`HTTP ${status}`);
    expect(files()).toEqual([]);
  });

  it('treats a redirect as an error rather than following it', async () => {
    reply = { status: 301, body: '', headers: { location: `${url}/moved` } };
    const result = await run();
    expect(result.status).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it('makes no request while the snapshot is under 20 hours old', async () => {
    reply = { status: 200, body: usable(1200) };
    await run();
    requests = [];
    const result = await run();
    expect(result.status).toBe(0);
    expect(requests).toHaveLength(0);
    expect(result.stdout).toContain('skipping download');
  });

  it('downloads again once the snapshot is older than that', async () => {
    reply = { status: 200, body: usable(1200) };
    await run();
    const path = join(out, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { fetchedAt: string };
    manifest.fetchedAt = new Date(Date.now() - 21 * 3_600_000).toISOString();
    writeFileSync(path, JSON.stringify(manifest));
    requests = [];
    await run();
    expect(requests).toHaveLength(1);
  });

  it('keeps the last good snapshot when a response is suspiciously short', async () => {
    reply = { status: 200, body: usable(1200) };
    await run();
    const before = files();
    const manifest = readFileSync(join(out, 'manifest.json'), 'utf8');
    reply = { status: 200, body: usable(10) };
    const result = await run('--force');
    expect(result.status).toBe(1);
    expect(files()).toEqual(before);
    expect(readFileSync(join(out, 'manifest.json'), 'utf8')).toBe(manifest);
  });

  it('refuses a 200 response that is not JSON', async () => {
    reply = { status: 200, body: '<html>maintenance</html>' };
    const result = await run();
    expect(result.status).toBe(1);
    expect(files()).toEqual([]);
  });

  it('refuses to write a snapshot over the size limit', async () => {
    const huge = JSON.parse(usable(1200)) as Record<string, unknown>[];
    for (const record of huge) record.OBJECT_NAME = 'X'.repeat(6000);
    reply = { status: 200, body: JSON.stringify(huge) };
    const result = await run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('byte limit');
    expect(files()).toEqual([]);
  });
});
