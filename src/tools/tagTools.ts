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

const updateTagInput = z
  .object({
    tag_id: z.string().min(1).describe('UUID of the tag to update.'),
    name: z.string().min(1).describe('Required new display name (non-empty).'),
    color_hex: z
      .string()
      .optional()
      .describe('Optional new hex color code (e.g. "#ff8800"). Omit to keep unchanged.'),
    skipCheckDuplicationName: z
      .boolean()
      .optional()
      .describe(
        'When true, the server skips its duplicate-name check. Use only when intentionally allowing identical names.',
      ),
  })
  .describe(
    'Update an existing event tag. Despite using PUT under the hood, this is effectively a partial-style update: only name is required; color_hex and skipCheckDuplicationName are optional flags.',
  )

type UpdateTagInput = z.infer<typeof updateTagInput>

const updateTagOutput = eventTagSchema

type UpdateTagOutput = z.infer<typeof updateTagOutput>

export const updateTag: ToolDefinition<UpdateTagInput, UpdateTagOutput> = {
  name: 'update_tag',
  description:
    "Update an event tag's name and/or color. The tag's uuid stays the same. Set skipCheckDuplicationName=true to bypass the server-side duplicate-name guard (use sparingly).",
  inputSchema: updateTagInput,
  outputSchema: updateTagOutput,
  execute: async (auth: Auth, args: unknown): Promise<UpdateTagOutput> => {
    const { tag_id, ...body } = updateTagInput.parse(args)
    try {
      return await callOpenApi<UpdateTagOutput>(
        auth,
        'PUT',
        `/v2/open/tags/${encodeURIComponent(tag_id)}`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
