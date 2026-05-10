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

const createTagInput = z
  .object({
    name: z.string().min(1).describe('Display name for the new tag (non-empty).'),
    color_hex: z
      .string()
      .optional()
      .describe(
        'Optional hex color code (e.g. "#ff8800"). Omit to use the server-side default color.',
      ),
  })
  .describe('Body for creating a new event tag. The owner is taken from the auth context.')

type CreateTagInput = z.infer<typeof createTagInput>

const createTagOutput = eventTagSchema

type CreateTagOutput = z.infer<typeof createTagOutput>

export const createTag: ToolDefinition<CreateTagInput, CreateTagOutput> = {
  name: 'create_tag',
  description:
    'Create a new event tag (category) for the authenticated user. Returns the created tag with its assigned uuid.',
  inputSchema: createTagInput,
  outputSchema: createTagOutput,
  execute: async (auth: Auth, args: unknown): Promise<CreateTagOutput> => {
    const body = createTagInput.parse(args)
    try {
      return await callOpenApi<CreateTagOutput>(auth, 'POST', '/v2/open/tags/', body)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
