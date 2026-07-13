import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { ToolError } from './shared/errors.js'
import { toDocJsonSchema, toInputJsonSchema } from './shared/jsonSchema.js'
import type { AnyToolDefinition, ToolDefinition } from './shared/tool.js'

const describeToolInput = z
  .object({
    name: z.string().min(1).describe('Tool name exactly as it appears in tools/list.'),
  })
  .describe('Look up the full documentation for one tool by name.')

type DescribeToolInput = z.infer<typeof describeToolInput>

const describeToolOutput = z
  .object({
    name: z.string(),
    docs: z
      .string()
      .describe(
        'Full usage guide: behavior, decision guides vs sibling tools, response-shape notes.',
      ),
    scopes: z.array(z.string()).describe('OAuth scopes required to invoke the tool.'),
    input_schema: z
      .record(z.string(), z.unknown())
      .describe(
        'Complete JSON Schema for the tool arguments (pre-transform side — ISO datetime strings).',
      ),
    output_schema: z
      .record(z.string(), z.unknown())
      .describe(
        'JSON Schema of the response for interpretation only — actual payloads are raw openAPI passthrough and may include extra fields.',
      ),
  })
  .describe('Full documentation for one tool.')

type DescribeToolOutput = z.infer<typeof describeToolOutput>

const DESCRIPTION = `\
Get the full documentation for any tool on this server: complete usage guide, decision guides \
vs sibling tools, and full input/output JSON Schemas. Tool descriptions in tools/list are \
intentionally brief — call this before first use of an unfamiliar tool, especially mutations \
or repeating-event flows.`

// registry가 자기 자신(describe_tool 포함)을 담아야 하므로 lazy getter 주입 —
// index.ts에서 `createDescribeTool(() => tools)`로 생성해 순환 없이 지연 해소 (#73).
export const createDescribeTool = (
  getRegistry: () => Readonly<Record<string, AnyToolDefinition>>,
): ToolDefinition<DescribeToolInput, DescribeToolOutput> => ({
  name: 'describe_tool',
  scopes: ['read:calendar'],
  description: DESCRIPTION,
  docs: DESCRIPTION,
  inputSchema: describeToolInput,
  outputSchema: describeToolOutput,
  execute: async (_auth: Auth, args: unknown): Promise<DescribeToolOutput> => {
    const { name } = describeToolInput.parse(args)
    const registry = getRegistry()
    // hasOwn 가드 — 'constructor' 같은 상속 키가 undefined 가드를 통과해 TypeError(Internal)로
    // 빠지지 않고 NotFound로 떨어지게 (PR #74 리뷰).
    const def = Object.hasOwn(registry, name) ? registry[name] : undefined
    if (def === undefined) {
      throw new ToolError(
        404,
        'NotFound',
        `Unknown tool: ${name}. Use the names listed in tools/list.`,
      )
    }
    return {
      name: def.name,
      docs: def.docs,
      scopes: [...def.scopes],
      input_schema: toInputJsonSchema(def.inputSchema),
      output_schema: toDocJsonSchema(def.outputSchema),
    }
  },
})
