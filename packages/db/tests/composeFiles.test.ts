import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two compose files must not drift apart.
 *
 * `docker-compose.yml` is what the college server deploys: it pulls both
 * application images. `docker-compose.dev.yml` builds from source
 * instead, for developing locally or running an unpublished change. They are otherwise the
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

const dev = read('docker-compose.dev.yml');
const prod = read('docker-compose.yml');

/** Everything from `services:` down — the part that defines the stack. */
const servicesOf = (text: string): string => text.slice(text.indexOf('services:'));

/** Non-empty, non-comment lines, so prose differences do not fail this. */
const significantLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

describe('docker-compose.yml — the deployed stack, pulled rather than built', () => {
  it('gives the three shared services the SAME settings in both files', () => {
    // The real drift risk, now that the deployed file also carries a
    // proxy: a setting added to one stack and forgotten in the other, so
    // the college server quietly runs something nobody described.
    // Compared by environment KEY rather than by line, because the two
    // legitimately differ in how the images arrive and in who may reach
    // the published port.
    const envKeys = (text: string, service: string): string[] => {
      const all = servicesOf(text).split('\n');
      const head = all.findIndex((l) => l.trim() === `${service}:`);
      if (head < 0) return [`NO SERVICE ${service}`];
      let inEnv = false;
      const keys: string[] = [];
      for (const line of all.slice(head + 1)) {
        if (/^  [a-z]/.test(line)) break;            // the next service
        if (/^    environment:/.test(line)) { inEnv = true; continue; }
        if (inEnv && /^    [a-z_]+:/.test(line)) break;  // the next block
        const m = inEnv ? /^      ([A-Z_]+):/.exec(line) : null;
        if (m) keys.push(m[1]!);
      }
      return keys.sort();
    };
    for (const service of ['db', 'app', 'backup']) {
      expect(envKeys(prod, service), service).toEqual(envKeys(dev, service));
    }
  });

  it('carries the proxy in the deployed file and not in the built one', () => {
    expect(dev).not.toContain('traefik');
    expect(prod).toContain('image: traefik:');
  });

  it('does NOT put the proxy behind a compose profile', () => {
    // It was, and that was a mistake worth a regression test. Profiles
    // are chosen by the docker compose COMMAND through COMPOSE_PROFILES;
    // they are not substituted into this file like every other setting.
    // A hosting panel that supplies the stack's variables interpolated
    // POSTGRES_PASSWORD correctly and ignored the profile, so the proxy
    // never started and the application was served over plain HTTP with
    // nothing anywhere reporting it. Deploying this file must mean
    // serving over HTTPS, with no second mechanism required to make it
    // true.
    expect(prod).not.toContain('profiles:');
  });

  it('serves the application over TLS and never beside it in the clear', () => {
    expect(prod).toContain('--entrypoints.web.http.redirections.entrypoint.to=websecure');
    expect(prod).toContain('permanent=true');
    // Routers opt in; nothing is exposed because it merely exists.
    expect(prod).toContain('--providers.docker.exposedbydefault=false');
    // The application's own port can be closed to everyone but this host.
    expect(prod).toContain('${APP_BIND:-0.0.0.0}');
  });

  it('does not hand the proxy more of the host than it needs', () => {
    // A writable docker socket is root on the host for whatever reaches
    // it; Traefik only ever needs to read which containers exist.
    expect(prod).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
    expect(prod).toContain('no-new-privileges:true');
    // acme.json in a named volume, not a bind mount: Traefik refuses a
    // certificate store that is group- or world-readable, and a
    // host-created file arrives with the wrong mode.
    expect(prod).toContain('letsencrypt:/letsencrypt');
    expect(prod).not.toMatch(/\.\/letsencrypt:/);
  });

  it('needs NOTHING from the repository on the server', () => {
    // The point of this file: a hosting panel that deploys from its URL
    // alone never puts ops/ on disk. Bind-mount it and the backup
    // container dies on a missing script while the database and the
    // application come up healthy beside it — so the first anyone learns
    // that nothing was ever dumped is when a restore is needed.
    const services = servicesOf(prod);
    expect(services).not.toContain('./ops');
    expect(services).not.toContain('build:');
    expect(services).not.toContain('context:');
  });

  it('still runs the backup loop — from the image rather than a mount', () => {
    // Dropping the mount must not quietly drop the backups with it.
    expect(prod).toContain('nmc-copo-backup');
    const backupImage = readFileSync(path.join(root, 'Dockerfile.backup'), 'utf8');
    expect(backupImage).toContain('COPY ops/ /ops/');
    expect(backupImage).toContain('/ops/backup-loop.sh');
    // Same Postgres major version as the database, or pg_dump mismatches.
    expect(backupImage).toContain('postgres:16');
    expect(dev).toContain('postgres:16-bookworm');
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
    // The loop itself now lives in the backup IMAGE (see the test below);
    // what this file still has to carry is the settings that drive it.
    expect(prod).toContain('BACKUP_SECONDARY_DIR');
    expect(prod).toContain('VERIFY_EVERY_DAYS');
    expect(prod).toContain('BACKUP_AT');
    expect(prod).toContain('KEEP_MONTHLY_DAYS');
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
