import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two compose files must not drift apart.
 *
 * `docker-compose.yml` builds the application from source;
 * `docker-compose.prod.yml` pulls a published image instead, for a
 * server with too little memory to compile it. They are otherwise the
 * SAME stack, and that is the whole danger: a volume added to one, a
 * setting changed in one, and the college server quietly runs something
 * nobody described. The difference is meant to be exactly one line.
 *
 * Compared as text rather than by parsing YAML, deliberately: a comment
 * that stops being true is as much a defect here as a wrong value, since
 * these files are read by the person doing the deployment.
 */

const root = path.join(__dirname, '..', '..', '..');
const read = (name: string): string => readFileSync(path.join(root, name), 'utf8');

const dev = read('docker-compose.yml');
const prod = read('docker-compose.prod.yml');

/** Everything from `services:` down — the part that defines the stack. */
const servicesOf = (text: string): string => text.slice(text.indexOf('services:'));

/** Non-empty, non-comment lines, so prose differences do not fail this. */
const significantLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

describe('docker-compose.prod.yml — the same stack, pulled instead of built', () => {
  it('differs from the source-built file by exactly the image line', () => {
    const a = significantLines(servicesOf(dev));
    const b = significantLines(servicesOf(prod));

    const onlyInDev = a.filter((line) => !b.includes(line));
    const onlyInProd = b.filter((line) => !a.includes(line));

    // Dev builds: three lines (build:, context:, dockerfile:) plus its
    // own image line. Prod replaces all four with one pulled image.
    expect(onlyInDev.map((l) => l.trim()).sort()).toEqual(
      ['build:', 'context: .', 'dockerfile: Dockerfile', 'image: copo-app:${APP_VERSION:-latest}'].sort(),
    );
    expect(onlyInProd.map((l) => l.trim())).toEqual([
      'image: ${COPO_IMAGE:-ghcr.io/saavithriramani-hash/nmc-copo}:${APP_VERSION:-latest}',
    ]);
  });

  it('runs the same three containers, named the same', () => {
    for (const name of ['copo-db', 'copo-app', 'copo-backup']) {
      expect(prod).toContain(`container_name: ${name}`);
    }
  });

  it('keeps the database unpublished — only the other containers reach it', () => {
    expect(prod).not.toMatch(/ports:\s*\n\s*- '?\$\{?POSTGRES/);
    expect(servicesOf(prod)).toContain("expose:\n      - '5432'");
  });

  it('still refuses to start without a database password', () => {
    expect(prod).toContain('POSTGRES_PASSWORD:?');
  });

  it('caps container logs, so an unwatched server cannot fill its disk', () => {
    expect(prod).toContain("max-size: '10m'");
    expect(prod).toContain("max-file: '5'");
  });

  it('keeps the nightly backup, its second copy, and the restore drill', () => {
    expect(prod).toContain('/ops/backup-loop.sh');
    expect(prod).toContain('BACKUP_SECONDARY_DIR');
    expect(prod).toContain('VERIFY_EVERY_DAYS');
  });

  it('mounts the backups read-only into the application', () => {
    // The app reports on backups; it must never be able to write them.
    expect(prod).toContain('/backups:ro');
  });

  it('lets a fork point at its own registry without editing the file', () => {
    expect(prod).toContain('${COPO_IMAGE:-');
  });

  it('does not build anything — that is the entire point of it', () => {
    expect(servicesOf(prod)).not.toContain('build:');
    expect(servicesOf(prod)).not.toContain('dockerfile:');
  });
});

describe('the ops scripts serve both files', () => {
  const opsDir = path.join(root, 'ops');
  const script = (name: string): string => readFileSync(path.join(opsDir, name), 'utf8');

  for (const name of ['deploy.sh', 'upgrade.sh']) {
    it(`${name} pulls when there is nothing to build`, () => {
      const text = script(name);
      // Decided from the RESOLVED configuration, not a filename, so
      // COMPOSE_FILE and overrides work without editing the script.
      expect(text).toContain('docker compose config');
      expect(text).toMatch(/docker compose pull/);
      expect(text).toMatch(/docker compose build/);
    });
  }
});
