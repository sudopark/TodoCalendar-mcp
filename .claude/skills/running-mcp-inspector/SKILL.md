---
name: running-mcp-inspector
description: Use when manually testing or verifying this MCP server's tools by hand in a real client — invoking get_expanded_*, create_*, etc. against the live openAPI, reproducing a tool bug a user hit, or checking a tool's input/output schema in a GUI. Boots the Functions emulator + this MCP server + MCP Inspector locally.
---

# Running MCP Inspector locally (TodoCalendar-mcp)

## Overview

Manually drive this server's tools through the MCP Inspector GUI, against a real Functions emulator backend. Three processes: **Functions emulator** (sibling repo, serves openAPI) → **this MCP server** (dev) → **MCP Inspector** (browser UI that calls `tools/call`).

Use for: hand-testing a tool, reproducing a user-reported tool error, eyeballing a tool's input/output schema. For automated checks prefer `npm run test:integration` instead.

## Prerequisites

- Sibling repo at `../TodoCalendar-Functions` on a branch that has the endpoints you need (e.g. `/expanded` landed in Functions #244).
- `.env.emulator` present (gitignored) — the dev server loads it. **Not** `.env.integration` (that one is for `test:integration` only — don't confuse them).

## Services & ports

| Process | Command | Port(s) |
|---|---|---|
| Functions emulator | `npm run emulator` (in `../TodoCalendar-Functions/functions`) | 5001 functions · 8080 firestore · 9099 auth · **5002 hosting (= OAuth AS)** |
| MCP server (dev) | `AUTH_MODE=dev npm run dev` | 3000 (`POST /mcp`) |
| MCP Inspector | `npx @modelcontextprotocol/inspector` | 6274 UI · 6277 proxy |

## Steps

**1. Emulator — detach so it survives (see Common Mistakes):**
```bash
cd ../TodoCalendar-Functions/functions && nohup npm run emulator > /tmp/fn-emulator.log 2>&1 < /dev/null &
```
Wait for `All emulators ready` in `/tmp/fn-emulator.log`. Verify a route exists (401 = route present, auth just missing):
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:5001/<project>/us-central1/apiV2/v2/open/todos/expanded?lower=1&upper=2"
```

**2. MCP server.** Pick an auth mode:
- **Dev header (simplest):** `AUTH_MODE=dev npm run dev`. Client must send header `X-Dev-User-Id: <anything>` → grants `read+write:calendar`.
- **OAuth flow (real RS path):** `npm run dev` (`.env.emulator` defaults `AUTH_MODE=oauth`). Inspector follows `401 → WWW-Authenticate → AS discovery(5002) → auth code`. Requires the hosting emulator's AS to answer: confirm `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5002/.well-known/oauth-authorization-server` returns `200`.

**3. Inspector:** `npx @modelcontextprotocol/inspector`, then open the token URL it prints (`http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...`).

**4. Connect** (left panel):
- Transport Type: `Streamable HTTP`
- URL: `http://localhost:3000/mcp`
- Auth: **dev mode** → Authentication header `X-Dev-User-Id` = any value. **oauth mode** → leave headers empty, hit Connect, complete the browser redirect.

**5. Seed then call** — emulator DB starts empty, so a query returns nothing until you create data with the *same user*:
1. `create_schedule` a repeating event (e.g. `every_day`).
2. `get_expanded_schedules` over a window covering it → expect `events` (one origin) + `occurrences` (turn 1,2,3…).

## Common Mistakes

| Symptom | Cause / fix |
|---|---|
| `command not found: setsid` | macOS has no `setsid`. Use `nohup ... &` to detach. |
| Emulator dies mid-session (`exit 143`/SIGTERM) | Started inside the agent sandbox, killed on sandbox teardown — OR another session already holds the ports. Run it detached outside the sandbox; if ports are taken, that's a second emulator, stop the other one. |
| Connect fails with `401` in dev mode | `X-Dev-User-Id` header not set. Inspector's Authentication field defaults to `Authorization`/Bearer — rename it to `X-Dev-User-Id`, don't leave it as Bearer. |
| OAuth flow won't start | AS not reachable: hosting emulator (5002) must return `200` on `.well-known/oauth-authorization-server`. If emulator is down, no flow. |
| Query returns empty `events`/`occurrences` | Empty DB, or you seeded under a different user than the one you're connected as. Seed first, same user. |
| Inspector `Validation Error: ... should have required property` | The tool's `outputSchema` doesn't match the real openAPI response shape. The server still returns raw (§6) — it's the *schema doc* that's wrong. Probe the real response and fix the schema, don't loosen the passthrough. |

## Cleanup

```bash
lsof -ti:3000 -ti:6274 -ti:6277 | xargs -r kill          # server + inspector
pkill -f "firebase emulators"                              # emulator
```
(Agent-launched background tasks: stop via TaskStop; the detached emulator via `pkill`.)
