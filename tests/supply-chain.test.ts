import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
  };

  it('ships three.js and nothing else', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['three']);
  });

  it('never imports the cross-check library from application code', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const hits = files('src').filter((path) => readFileSync(path, 'utf8').includes('satellite.js'));
    expect(hits).toEqual([]);
  });
});
