import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventTagSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const getTagsInput = z.object({}).describe('No parameters — returns all tags for the caller.')

type GetTagsInput = z.infer<typeof getTagsInput>

const getTagsOutput = z.array(eventTagSchema).describe('All event tags owned by the caller.')

type GetTagsOutput = z.infer<typeof getTagsOutput>

export const getTags: ToolDefinition<GetTagsInput, GetTagsOutput> = {
  name: 'get_tags',
  description:
    'Fetch all event tags (categories) belonging to the authenticated user. Tags are reusable labels assigned to todos and schedules.',
  inputSchema: getTagsInput,
  outputSchema: getTagsOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetTagsOutput> => {
    getTagsInput.parse(args)
    try {
      return await callOpenApi<GetTagsOutput>(auth, 'GET', '/v2/open/tags/all')
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
