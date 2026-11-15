# TodoCalendar-mcp

An MCP server and npm tool library that let AI agents work with To-do Calendar todos, schedules and tags.

Two entry points, one tool layer:

- **MCP server** (Streamable HTTP) — for external AI agents (Claude Desktop and others)
- **`todocalendar-tools`** (npmjs.com, public) — imported directly by first-party AI hosts

---

## Connect from Claude

*For anyone connecting the hosted server from Claude, and for directory reviewers. Everything below this section is developer documentation, in Korean.*

**1. Add the connector.** In Claude, open **Settings → Connectors → Add custom connector** and enter:

```
https://mcp.todo-calendar.com/mcp
```

**2. Sign in.** Claude redirects you to the To-do Calendar sign-in page. The consent screen lists the two scopes being requested — `read:calendar` and `write:calendar`. The connector only ever acts on the account that approved it: the user identity is read from the verified access token, never from a tool argument.

**3. Ask for something.** A few prompts that exercise the main paths:

| Prompt | Tool |
| --- | --- |
| "What's on my calendar this week?" | `get_expanded_schedules` |
| "What to-dos do I have open?" | `get_todos` |
| "Add a to-do: buy coffee beans, tomorrow 9am" | `create_todo` |
| "Move it to 10am" | `update_todo` |
| "Mark it done" | `complete_todo` |
| "Add a weekly team meeting, Mondays 10am" | `create_schedule` |
| "Skip next Monday's team meeting" | `exclude_schedule_occurrence` |
| "Delete the team meeting" | `delete_schedule` (two steps — see below) |

**Deleting takes two steps.** `delete_todo` and `delete_schedule` do not delete on the first call. The first call changes nothing and returns a confirmation message with a token; the deletion happens only when the assistant calls again with the same arguments plus that token. Tokens expire after 5 minutes and are bound to the user, the tool and the arguments, so they cannot be replayed elsewhere.

**Disconnecting.** End the connection from Claude's connector settings, which drops the tokens it holds. Access tokens are short-lived (2 hours), and the refresh token can be revoked at the authorization server's RFC 7009 revocation endpoint.

### What the tools cover

30 tools. Repeating events are expanded on the server, so you get the dates each occurrence actually falls on — weekday accrual, month-end skips, leap years and lunar rules included.

| | |
| --- | --- |
| **To-dos** | list, create, edit, complete, restore, replace, delete |
| **Schedules** | list, create, edit, delete; edit or skip a single occurrence; split a repeating series |
| **Tags** | list, create, edit, delete |
| **Event details** | place, link, memo |
| **Pinned event** | read, set, clear |

Every tool carries a `title` and the applicable `readOnlyHint` / `destructiveHint` in `tools/list`. `describe_tool({name})` returns the full guide and the input/output JSON Schemas for any tool.

### Privacy

[Privacy policy](https://todo-calendar.com/privacy/en) (Korean: [/privacy/ko](https://todo-calendar.com/privacy/ko)). The "Connected external apps" section covers what a connected app can reach, which tokens are stored and for how long, and how to end a connection.

This server keeps no store of its own — it forwards requests to the To-do Calendar API and passes responses straight back.

### Support

todocalendar.help@gmail.com

---

## For external AI agents

### Endpoint

```
https://mcp.todo-calendar.com/mcp
```

Streamable HTTP transport (compatible with [MCP spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)).

### Auth

OAuth 2.1 **Resource Server**. The Authorization Server is a separate service hosted by TodoCalendar Functions. Clients get a token there, then send:

```
Authorization: Bearer <RS256 JWT>
```

The token must carry the required scopes:

- `read:calendar` — `get_*` tools
- `write:calendar` — create / update / delete tools
- `set_foremost_event` needs both — it reads the target first to tell whether it is a todo or a schedule

The server publishes the AS location and scope list at `GET /.well-known/oauth-protected-resource` (RFC 9728).

### Tools

30 tools, including the `describe_tool` meta tool. Responses are openAPI raw passthrough — no field renames, raw Unix-second timestamps kept, with `*_iso` siblings added alongside.

For the actual dates repeating events fall on in a range, use `get_expanded_*` (the server expands them into occurrences). For the raw recurrence rules only, use `get_todos` / `get_schedules`.

`tools/list` carries short summaries only (no outputSchema, 1–3 sentence descriptions). Each tool's full guide and complete I/O JSON Schemas come on demand from `describe_tool({name})`. Rules shared by every tool — ISO time handling, discriminators, the CONFIRM flow — are stated once in the initialize response `instructions`.

| domain             | tools                                                                                                                                                                                            | CONFIRM           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **todo**           | `get_todos` / `get_expanded_todos` / `create_todo` / `update_todo` / `complete_todo` / `replace_todo` / `delete_todo`                                                                            | `delete_todo`     |
| **schedule**       | `get_schedules` / `get_expanded_schedules` / `create_schedule` / `update_schedule` / `exclude_schedule_occurrence` / `replace_schedule_occurrence` / `branch_schedule_repeating` / `delete_schedule` | `delete_schedule` |
| **tag**            | `get_tags` / `create_tag` / `update_tag` / `delete_tag`                                                                                                                   | —                 |
| **done todo**      | `get_done_todos` / `update_done_todo` / `revert_done_todo` / `delete_done_todo`                                                                                           | —                 |
| **event detail**   | `get_event_details` / `set_event_detail` / `delete_event_detail`                                                                                                          | —                 |
| **foremost event** | `get_foremost_event` / `set_foremost_event` / `clear_foremost_event`                                                                                                      | —                 |
| **meta**           | `describe_tool`                                                                                                                                                           | —                 |

For detailed input/output schemas, see the `describe_tool({name})` response (`docs` + `input_schema` + `output_schema`).

**Two-step CONFIRM** (`delete_todo` / `delete_schedule`): the first call deletes nothing and returns only a `confirmToken`; echoing the token on a second call performs the deletion. Tokens expire in 5 minutes and are bound to user + tool + args, so they cannot be reused for another user or other arguments.

---

## For library consumers

First-party server-side AI hosts such as `aiFrontAPI` skip the MCP transport and import the tool functions directly.

### Install

Public package on npmjs.com — no auth or `.npmrc` setup needed.

```sh
npm install todocalendar-tools
```

### Use

```ts
import { tools, type Auth } from 'todocalendar-tools/tools'

// The caller builds the auth context. This library does not verify credentials:
// verify the token (e.g. Firebase Auth) first, then pass the resulting userId.
const auth: Auth = {
  userId: '<verified-user-id>',
  scopes: ['read:calendar', 'write:calendar'],
  // clientId?: OAuth client_id. Usually undefined on the dev/lib path.
}

const result = await tools.get_todos.execute(auth, { mode: 'current' })
```

### Caller responsibilities

- **Verify the auth context**: take `auth.userId` only from a verified token's `sub`. The library ignores any userId passed in tool args, but verifying the caller is your job.
- **Scopes are enforced only at the transport**: the MCP server transport uses `auth.scopes`; on the library import path they have no enforcing effect. openAPI calls always carry both `read:calendar` and `write:calendar`. The field exists for shape compatibility.
- **Set four environment variables** in the library process:
  - `OPENAPI_BASE_URL` — openAPI base URL
  - `OPENAPI_PAT_MCP` — service auth PAT (`mcp_<secret>` format)
  - `SIGNING_SECRET` — HS256 signing key for `x-open-user-token` (shared with openAPI)
  - `CONFIRM_SECRET` — HMAC key for confirm tokens

### Responses and errors

- **Raw passthrough**: response payloads are returned as openAPI sends them. `outputSchema` documents the shape for the LLM and is never parsed at runtime, so extra fields are preserved.
- **Errors**: thrown as `ToolError` — `{ status, code, message }`. `code` catalog: `InvalidParameter` (400) / `NotFound` (404) / `InsufficientScope` (403) / `Timeout` (0) and others. `message` adds a natural-language explanation; `code` and `status` are always the originals.

### Export surface

Only `todocalendar-tools/tools` is public. Signature or type changes are a semver major.

---

## License

MIT.
