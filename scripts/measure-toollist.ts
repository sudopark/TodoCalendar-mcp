// tools/list 페이로드 크기 측정 — #73 다이어트 회귀 감시용.
// 실행: npx tsx scripts/measure-toollist.ts
// 토큰 추정은 chars/4 근사. instructions는 initialize 응답에 1회 실리는 별도 채널이라 별도 표기.
import { tools } from '../src/tools/index.js'
import { usageInstructions } from '../src/tools/instructions.js'
import { toMcpTool } from '../src/mcp/toolSchema.js'

const rows = Object.values(tools).map((def) => {
  const mcp = toMcpTool(def)
  const desc = JSON.stringify(mcp.description ?? '').length
  const input = JSON.stringify(mcp.inputSchema).length
  const total = JSON.stringify(mcp).length
  return { name: mcp.name, desc, input, total }
})
rows.sort((a, b) => b.total - a.total)

const sum = rows.reduce(
  (acc, r) => ({ desc: acc.desc + r.desc, input: acc.input + r.input, total: acc.total + r.total }),
  { desc: 0, input: 0, total: 0 },
)

console.log('name'.padEnd(30), 'desc'.padStart(7), 'input'.padStart(8), 'total'.padStart(8))
for (const r of rows) {
  console.log(
    r.name.padEnd(30),
    String(r.desc).padStart(7),
    String(r.input).padStart(8),
    String(r.total).padStart(8),
  )
}
console.log(
  `TOTAL (${rows.length} tools)`.padEnd(30),
  String(sum.desc).padStart(7),
  String(sum.input).padStart(8),
  String(sum.total).padStart(8),
)
console.log(
  `\napprox tokens (chars/4): total ${Math.round(sum.total / 4)}`,
  `| desc ${Math.round(sum.desc / 4)} | input ${Math.round(sum.input / 4)}`,
)
console.log(
  `instructions (initialize 1회): ${usageInstructions.length} chars ≈ ${Math.round(usageInstructions.length / 4)} tokens`,
)
