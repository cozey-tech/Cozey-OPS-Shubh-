# Cozey Ops

Unified FC operations dashboard for Cozey's Canadian fulfillment centres (Royalmount, Langley, Windsor).

Built on the same stack and security conventions as `cozey-tech/warehouse-dashboard-`.

## Sections

| Section | Views |
|---|---|
| **Inventory** | Low stock, Restock intel, Critical chart, Incoming POs, Cross-FC |
| **Productivity** | Pack scans, Label scans, Leaderboard, Order lookup, Pack time, Not scanned, Weekly summary, Scan trend, Prep drill-down |
| **Tools** | Barcode generator, Returns by product |

## Architecture

```
src/App.js              React UI — all sections and views
api/inventory.js        GET /api/inventory — inventory queries (tab param)
api/productivity.js     GET /api/productivity — scan/label queries (tab param)
api/barcodes.js         GET /api/barcodes — barcode label search
api/returns.js          GET /api/returns — returns by product
api/_cosPool.js         Pooled, TLS-verified, read-only COS connection
api/_auth.js            CORS scoping + office-secret helper
```

`api/_cosPool.js` and `api/_auth.js` mirror the conventions in the sibling `warehouse-dashboard-` repo:
a singleton `pg.Pool`, verified TLS, `BEGIN READ ONLY`, `statement_timeout`, transient-error retry,
and a `SELECT/WITH`-only guard.

## Security model

- **Access gate:** The API is read-only with no per-request auth. The production gate is **Vercel Deployment Protection** (password/SSO) — enable it before connecting production data.
- CORS is scoped to `DASHBOARD_ORIGIN` (no `*`). If `DASHBOARD_ORIGIN` is not set the API throws an error immediately.
- All user input is bound as query parameters or validated against allowlists — no string interpolation into SQL.
- TLS certificate verification is on (Neon's cert is publicly trusted).
- DB errors are logged server-side; clients get a generic `502` message.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_MCP_URL and DASHBOARD_ORIGIN
npm start                    # CRA dev server
```

To exercise the API locally, run `vercel dev` so the functions in `api/` are served.
Set `PGSSL=disable` only when pointing at a local Postgres without TLS.

## Environment variables

See `.env.example`. Required: `DATABASE_MCP_URL`, `DASHBOARD_ORIGIN`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_MCP_URL` | ✅ | COS Neon pooled connection string (`cos_mcp_reader` role) |
| `DASHBOARD_ORIGIN` | ✅ | App URL for CORS e.g. `https://cozey-ops.vercel.app` |
| `OFFICE_SECRET` | Optional | Header secret for any future write endpoints |
| `PGSSL` | Dev only | Set to `disable` for local Postgres without TLS |

## Deploy

Vercel project. Set env vars in Production + Preview, enable Deployment Protection, and push.
`vercel.json` rewrites `/api/*` to serverless functions and everything else to the SPA.
