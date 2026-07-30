# ops/ — deployment and operations scripts

These run the system on the college server. The full guide, written for a
non-specialist, is [`docs/OPERATIONS.md`](../docs/OPERATIONS.md); this file
is a quick index for whoever is editing the scripts.

| Script | Runs where | What it does |
|---|---|---|
| `deploy.sh` | server, by hand | first-time install: build, start, create the first admin |
| `upgrade.sh` | server, by hand | safety-backup → rebuild → restart; tells you how to roll back |
| `entrypoint-app.sh` | app container | applies DB migrations, then starts the server |
| `backup-loop.sh` | backup container | the sidecar's main loop: nightly backup + weekly restore drill |
| `backup.sh` | backup container | one `pg_dump`, copy to the second location, prune, record status |
| `verify-restore.sh` | backup container | restore the latest dump into a scratch DB and check it — the drill |
| `restore.sh` | backup container, by hand | rehearse a restore, or (with `--into-prod`) recover the live DB |
| `export-institution.sh` | server, by hand | full data export to CSV, works even if the app is down |

## The safety properties, and where they are proven

- **A backup is only trusted once it has been restored.** `verify-restore.sh`
  runs weekly and writes `lastVerifiedRestore` to `backup-status.json`,
  which the health page reads. `packages/db/tests/restore.integration.test.ts`
  performs the **real** dump→restore cycle and asserts the data — and the
  snapshot-immutability trigger — survive it. It is gated on
  `RESTORE_TEST_ADMIN_URL`; set that (and have `pg_dump`/`pg_restore`/`psql`
  on PATH) in CI to run it.
- **The script contents cannot silently lose their safeguards.**
  `packages/db/tests/opsScripts.test.ts` runs everywhere with no database
  and checks that `verify-restore.sh` still restores and checks coherence,
  that `backup.sh` writes a restorable dump and never leaves a half-written
  file with a valid name, and that `upgrade.sh` backs up before it builds.
- **Upgrades cannot proceed on a broken backup:** `upgrade.sh` takes a
  backup first and aborts if it fails.
- **Restoring over production is deliberately hard:** it needs the explicit
  `--into-prod` flag and typing `RESTORE`.

## Retention

`backup.sh` keeps every nightly dump for `KEEP_DAILY_DAYS`, each Sunday's
for `KEEP_WEEKLY_DAYS`, and each 1st-of-month for `KEEP_MONTHLY_DAYS`
(default ~6 years — a five-year accreditation cycle with margin). Tune in
`.env`.

Scripts avoid `jq` and other tools that may not be on a minimal host: they
use only what the `postgres` image already ships (`bash`, `sed`, `psql`,
`pg_dump`, `pg_restore`, coreutils).
