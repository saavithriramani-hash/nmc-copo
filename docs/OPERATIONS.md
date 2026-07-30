# Operations manual — CO–PO Attainment system

This manual is for the person keeping the CO–PO Attainment system running.
It assumes you have **not** seen the code and that nobody who built it is
available. You do not need to be a programmer. You need to be comfortable
typing commands into a terminal on the server.

Everything here is done with **Docker Compose**. There is no Kubernetes,
no cloud service, and nothing to install beyond Docker itself. The whole
system is three containers described in one file, `docker-compose.yml`:

| Container | What it is |
|---|---|
| `db` | PostgreSQL — the only place data is stored |
| `app` | the application staff use in their browser |
| `backup` | takes the nightly backup and proves weekly it can be restored |

All commands are run from the folder that contains `docker-compose.yml`
(the project folder). Lines beginning `#` are comments — do not type them.

---

## 0. What you need on the server

- A Linux server on the campus network (for example Ubuntu Server).
- **Docker Engine** with the **Compose v2** plugin. Check with:
  ```
  docker --version
  docker compose version
  ```
  If either fails, install Docker from https://docs.docker.com/engine/install/
  — this is the only external thing the system depends on.
- Enough disk for the database and five years of backups. As a rule of
  thumb, budget 50 GB and watch the **System health** page.

Keep a copy of the project folder (including `.env`) somewhere safe. The
`.env` file holds the database password.

---

## 1. Deploy (first-time install)

```
# 1. Get the code onto the server (git clone, or copy the folder across).
# 2. From inside the project folder:
ops/deploy.sh
```

The first time, `deploy.sh` will notice there is no `.env` file, create
one from the template, and stop. Open it and set a database password:

```
nano .env
#   change POSTGRES_PASSWORD to a long random value — nobody has to type
#   it, so make it long. Save with Ctrl-O, exit with Ctrl-X.
```

Then run `ops/deploy.sh` again. It will:

1. build the application image (a few minutes the first time),
2. start the database, the application and the backup service,
3. wait until the application is healthy,
4. ask for the **first administrator's** email and name, and print a
   **temporary password** — write it down, it is shown only once.

When it finishes, open `http://<server-address>:3000` in a browser, sign
in as that administrator with the temporary password, and change the
password when prompted.

Then open **System health** (top menu) and confirm everything is green.

> **Configure the second backup location now** (section 4). A backup on
> the same machine does not survive that machine dying.

---

## 2. Upgrade (install a new version)

```
git pull            # fetch the new code
ops/upgrade.sh
```

`upgrade.sh` is safe by design. It **takes a fresh backup before touching
anything**, and refuses to continue if that backup fails. It then rebuilds
and restarts the application. Database changes are applied automatically
when the new version starts.

If the new version does not come up healthy, the script says so and tells
you how to roll back. Your data is safe — a backup was taken first. To go
back to the previous version:

```
git checkout <previous-version>   # or: git checkout main~1
ops/upgrade.sh
```

---

## 3. Back up

**You do not need to do anything for routine backups.** The `backup`
container runs every night at the time set by `BACKUP_AT` in `.env`
(default 02:00). Each backup is a single compressed file named
`copo-YYYYMMDD-HHMMSS.dump` in the `backups/` folder.

Retention (set in `.env`): every night's backup is kept for about a month,
each **Sunday's** for over a year, and each **1st-of-the-month** for about
six years — comfortably covering a five-year accreditation cycle.

To take a backup **right now** (for example before a risky change):

```
docker compose exec backup bash /ops/backup.sh
```

To check backups are healthy, open **System health**, or:

```
cat backups/backup-status.json
```

### Backups are proven restorable automatically

Once a week the backup container **restores the latest backup into a
throwaway database and checks it** — because a backup nobody has ever
restored is not a backup. The result appears on the health page as "Last
proven restore". To run that drill yourself at any time:

```
docker compose exec backup bash /ops/verify-restore.sh
```

It never touches the live database.

---

## 4. The second copy on campus

A backup sitting next to the database is lost if the server is lost. Point
the system at a share on **another machine in another building**:

1. Mount that share on the server (for example the library NAS at
   `/mnt/library-nas/copo`).
2. In `.env`, set:
   ```
   BACKUP_SECONDARY_MOUNT=/mnt/library-nas/copo
   BACKUP_SECONDARY_DIR=/backups-secondary
   ```
3. Restart the backup service:
   ```
   docker compose up -d backup
   ```

Each nightly backup is now copied there too. The health page shows "Second
copy on campus"; if it ever turns red, the share has become unreachable —
check that it is still mounted.

---

## 5. Restore (recover the data)

You need this after a disaster, or to inspect an old backup. **Restoring
replaces live data, so read this carefully.**

### Rehearse safely (does not touch live data)

```
docker compose exec backup bash /ops/restore.sh
```

With no arguments this restores the **newest** backup into a scratch
database called `copo_restore_check`, leaving the live system untouched.
Use this to satisfy yourself a restore works.

To rehearse a specific backup:

```
docker compose exec backup bash /ops/restore.sh /backups/copo-20260724-020000.dump
```

### Restore over the live database (real recovery)

Only do this when you actually intend to replace the current data.

```
# 1. Stop the application so nothing writes during the restore.
docker compose stop app

# 2. Restore, choosing the backup file to recover from.
docker compose exec backup bash /ops/restore.sh /backups/copo-20260724-020000.dump --into-prod
#    It will warn you and ask you to type RESTORE to confirm.

# 3. Start the application again.
docker compose start app
```

Everything entered **after** the backup you chose is gone — that is the
nature of a restore. Pick the most recent good backup.

---

## 6. Add users and grant roles

Everything to do with accounts is done **inside** the application, on
**Accounts & roles** (top menu, administrators only). You only need the
command line for the **very first** administrator, which `deploy.sh`
already did.

### Add someone

1. **Accounts & roles** → *Add an account* → full name and college email.
2. The screen shows a **temporary password once**. Write it down and hand
   it over in person — it is never shown again and is not emailed. (If it
   is lost, use **Reset password**; nothing is broken.)
3. The new account can sign in but **sees nothing until you grant it a
   role**. That is deliberate, not a fault.

### Grant a role

In that person's row, choose the role and press **Grant role**:

| Role | What you must also choose |
|---|---|
| Faculty | nothing |
| Head of Department | the **department** |
| Programme coordinator | the **programme** |
| IQAC / Accreditation cell | nothing |
| Principal / Dean | nothing |
| System administrator | nothing |

*In force from* defaults to today. Back-date it when someone took up the
post earlier — the file must show who held which role when a course was
computed.

### When someone leaves or changes post

Press **End** next to the role. The assignment is **not deleted**; its
window is closed, so "who was Head of Department when this course was
locked" is still answerable years later. Grant the successor their role
the same way.

To stop someone signing in at all, use **Deactivate**. This signs them
out everywhere. Accounts are never deleted, because past work is
attributed to them.

### Two things the system will not let you do

- Deactivate **your own** account.
- End the **last** system administrator role, or deactivate the last
  administrator.

Both would leave the college unable to manage its own accounts, so the
screen refuses and tells you to appoint someone else first. Grant ADMIN
to a second person early — it is the cheapest insurance here.

Every action on this screen is written to the **audit log** (menu → Audit
log): who did what, when, and the previous value.

### If every administrator account is lost

If every administrator account is somehow lost, you can create a fresh
first administrator **only if none is currently active**. The bootstrap
route refuses once an administrator exists, so this is safe to attempt:

```
# Read the one-time token from .env:
grep BOOTSTRAP_TOKEN .env

# Then (replace the token, email and name):
curl -X POST http://localhost:3000/api/bootstrap/admin \
  -H 'Content-Type: application/json' \
  -H 'x-bootstrap-token: THE_TOKEN_FROM_ENV' \
  -d '{"email":"admin@college.example","fullName":"Full Name"}'
```

It prints a temporary password. If it returns "An administrator already
exists", then one does — use the application, or have that administrator
reset the account you need.

---

## 7. Export all the data (never be locked in)

At any time you can export **everything** in open formats (CSV), readable
by any spreadsheet or database, with no dependence on this software.

- From the application: sign in as IQAC or administrator → **Institution**
  → **Full institutional data export** → download the ZIP.
- From the command line (works even if the app is down):
  ```
  ops/export-institution.sh ./my-export
  ```

Read the `README.txt` inside the export first. The important rule: **an
empty field means "no value"; a `0` is a real zero.** In student marks, an
empty value means the student did not attempt that item; `0` means they
attempted and scored nothing. Any tool reading the data must keep that
difference.

---

## 8. Everyday commands

```
docker compose ps                 # are all three containers up and healthy?
docker compose logs -f app        # watch the application's log
docker compose logs --tail=100 db # last 100 lines of the database log
docker compose restart app        # restart just the application
docker compose down               # stop everything (data is kept)
docker compose up -d              # start everything again
```

The **System health** page (top menu, for administrators, IQAC and the
Principal) is the first place to look when something seems wrong. Every
item that is not green tells you exactly what to do.

---

## 9. Diagnosing the five most likely failures

For each: what you would see, and exactly what to do.

### 9.1 The application will not load in the browser

**Symptom.** The page does not open, or shows "connection refused".

```
docker compose ps
```

- If `app` is missing or **restarting**, look at why:
  ```
  docker compose logs --tail=50 app
  ```
- The most common cause is that the **database is not ready**. If `db` is
  not "healthy", see 9.2. The application applies database migrations when
  it starts; if the database is down it will keep restarting until the
  database is back.
- If `app` is **healthy** but you still cannot reach it, check you are
  using the right address and port (`http://<server>:3000`, or whatever
  `APP_PORT` is set to in `.env`) and that a firewall is not blocking it.

### 9.2 The database container keeps restarting

**Symptom.** `docker compose ps` shows `db` restarting; the app is down.

```
docker compose logs --tail=50 db
```

- **"database files are incompatible" / version mismatch** after an
  upgrade: the Postgres image version was changed. Restore the previous
  version in `docker-compose.yml` (the `db` image tag), or migrate the
  data volume properly — do not delete `db_data`.
- **Out of disk** (see 9.4): Postgres stops when it cannot write.
- **Corrupted volume** (after a hard power loss): this is what backups are
  for. Recover with section 5. Do not delete the volume until you have a
  known-good backup restored elsewhere.

### 9.3 Backups are not running (health page shows a backup problem)

**Symptom.** System health shows "Nightly backup" as ATTENTION or PROBLEM,
or "No successful backup has ever been recorded."

```
docker compose logs --tail=50 backup
cat backups/backup-status.json
```

- If the `backup` container is not running: `docker compose up -d backup`.
- **"could not write to second location"**: the campus share is
  unmounted or full. Remount it (section 4), or clear space on it.
- **"pg_dump failed"**: usually the database was unreachable at 02:00.
  Confirm `db` is healthy now and take a manual backup:
  `docker compose exec backup bash /ops/backup.sh`.
- If the restore drill is failing (RESTORE DRILL FAILED in the log), treat
  it as an emergency: the backups may not be usable. Take a fresh backup,
  then run `ops/verify-restore.sh` and read its output.

### 9.4 The disk is filling up

**Symptom.** System health shows a volume below 20% (ATTENTION) or 10%
(PROBLEM). Left alone, backups and then mark entry will start failing.

```
df -h                                   # overall disk
du -sh backups/*                        # size of each backup
du -sh /var/lib/docker/volumes/*        # database and app storage
```

- **Old accreditation bundles / data exports** pile up under the app's
  storage. They are safe to delete once downloaded:
  ```
  docker compose exec app sh -c 'ls -lh /app/storage/bundles /app/storage/exports'
  docker compose exec app sh -c 'rm -f /app/storage/bundles/*.zip /app/storage/exports/*.zip'
  ```
- If **backups** are the bulk and you are within policy, either extend the
  disk or reduce retention in `.env` (`KEEP_*_DAYS`) — but keep at least a
  full accreditation cycle of monthly dumps.
- If the **database volume** itself is large, that is expected at scale
  (millions of marks). Extend the disk; do not delete data.

### 9.5 A background job is stuck or failed

**Symptom.** System health shows a job running for hours, or a recent
failure. Background jobs are the programme/institution consolidations, the
accreditation bundle, and the data export.

- A job **stuck for hours** was almost certainly interrupted by a restart.
  Restart the application: `docker compose restart app`. The accreditation
  bundle **resumes from the reports it already produced** — it does not
  start over.
- A job that **failed**: open it on its page in the application and start
  it again. Consolidations recompute from scratch (they are quick); the
  bundle resumes.
- If a bundle repeatedly fails on the **same course**, that course's setup
  is probably incomplete. Open its **Pre-calculation review** in the
  application, fix what it flags, and rerun the bundle.

---

## 10. If you are truly stuck

1. Read the **System health** page — most problems name their own fix.
2. Read the relevant section above.
3. Look at the logs: `docker compose logs --tail=100 app` (or `db`, or
   `backup`).
4. You can always get the data out in open formats (section 7), so the
   institution's records are never trapped inside this system.

The behaviour of every backup and restore script in `ops/` is checked by
automated tests (`packages/db/tests/`), including a test that performs a
real backup-and-restore and confirms the data — and the safeguards — come
back intact. Those tests are the written proof that the procedures in this
manual work.
