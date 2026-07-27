---
name: replit-pending-sql
description: SQL changes that need to be run on Replit PostgreSQL before next deploy
type: project
---

## Pending SQL for Replit

Run in Replit shell: `node -e "require('./server/db').query(\`<SQL HERE>\`).then(r => console.log(r)).catch(e => console.error(e))"`

### Sprint S02 — comisionPct column

```sql
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS "comisionPct" NUMERIC DEFAULT 0;
```

**Why:** Dashboard comercial commission tracking. Frontend sends comisionPct on save/edit.
**Status:** PENDING — causes 500 error on save until applied.
