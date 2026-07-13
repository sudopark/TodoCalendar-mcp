// tools/list description 슬림화(#73)로 tool별 반복 서술을 제거한 공통 정책의 단일 서술처.
// MCP 경로: initialize 응답 instructions로 전달. first-party(aiFrontAPI): 이 상수를
// import해 시스템 프롬프트에 포함 (Functions#262).
// 릴리스 순서 주의 — aiFrontAPI는 tool description만 모델에 전달하므로, Functions#262 반영 전에
// 0.3.0을 채택하면 슬림 description만 서빙되는 공백이 생긴다. 같은 배포로 묶을 것.
export const usageInstructions = `\
TodoCalendar MCP usage guide (applies to every tool):

- Time inputs: every absolute-time input field is an ISO 8601 string WITH timezone offset \
(e.g. "2026-05-22T10:00:00+09:00"). The server converts to Unix seconds — never compute epoch \
numbers yourself.
- Time outputs: responses keep raw Unix-second fields and add a sibling \`*_iso\` field for each \
(UTC ISO; for \`allday\` times, a YYYY-MM-DD local date). When a tool asks you to echo a previous \
response back (e.g. complete_todo 'origin', get_done_todos 'cursor'), pass the raw payload \
verbatim — do NOT convert its timestamps to ISO.
- \`event_time\` is a tagged union discriminated by \`time_type\` ('at' | 'period' | 'allday'). \
\`repeating.option\` is discriminated by \`optionType\`.
- CONFIRM-gated tools (delete_todo, delete_schedule): the first call does NOT mutate — it returns \
{ status: 'confirm_required', message, confirmToken }. Surface \`message\` to the end user; on \
approval re-call with the SAME arguments plus confirmToken (expires in 5 minutes, bound to \
user + tool + args).
- Tool descriptions in tools/list are intentionally brief. Before first use of an unfamiliar \
tool — especially mutations or repeating-event flows — call \`describe_tool\` with the tool name \
to get its full usage guide and complete input/output JSON Schemas.
- Repeating events: get_todos / get_schedules return raw origin rules only (NOT expanded). For \
the actual dates occurrences fall on, use get_expanded_todos / get_expanded_schedules.`
