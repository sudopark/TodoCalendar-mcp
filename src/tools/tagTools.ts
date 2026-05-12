import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventTagSchema, statusOkSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const getTagsInput = z.object({}).describe('No parameters — returns all tags for the caller.')

type GetTagsInput = z.infer<typeof getTagsInput>

const getTagsOutput = z.array(eventTagSchema).describe('All event tags owned by the caller.')

type GetTagsOutput = z.infer<typeof getTagsOutput>

export const getTags: ToolDefinition<GetTagsInput, GetTagsOutput> = {
  name: 'get_tags',
  scopes: ['read:calendar'],
  description:
    'Fetch all event tags (categories) belonging to the authenticated user. Tags are reusable labels assigned to todos and schedules.',
  inputSchema: getTagsInput,
  outputSchema: getTagsOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetTagsOutput> => {
    getTagsInput.parse(args)
    try {
      return await callOpenApi<GetTagsOutput>(auth, 'GET', '/v2/open/tags/')
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
  scopes: ['write:calendar'],
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
  })
  .describe(
    'Update an existing event tag. Only name is required; color_hex is optional. The server enforces a duplicate-name guard — pick a unique name.',
  )

type UpdateTagInput = z.infer<typeof updateTagInput>

const updateTagOutput = eventTagSchema

type UpdateTagOutput = z.infer<typeof updateTagOutput>

export const updateTag: ToolDefinition<UpdateTagInput, UpdateTagOutput> = {
  name: 'update_tag',
  scopes: ['write:calendar'],
  description:
    "Update an event tag's name and/or color. The tag's uuid stays the same. Names must be unique among the caller's tags.",
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

const deleteTagInput = z
  .object({
    tag_id: z.string().min(1).describe('UUID of the tag to delete.'),
  })
  .describe(
    'Delete a single event tag by id. The openAPI exposes only single-target deletion — there is no bulk variant that also deletes events carrying the tag.',
  )

type DeleteTagInput = z.infer<typeof deleteTagInput>

const deleteTagOutput = statusOkSchema

type DeleteTagOutput = z.infer<typeof deleteTagOutput>

export const deleteTag: ToolDefinition<DeleteTagInput, DeleteTagOutput> = {
  name: 'delete_tag',
  scopes: ['write:calendar'],
  description:
    "Delete an event tag belonging to the authenticated user. Returns { status: 'ok' }. Events that referenced the tag are NOT deleted — only the tag itself is removed.",
  inputSchema: deleteTagInput,
  outputSchema: deleteTagOutput,
  execute: async (auth: Auth, args: unknown): Promise<DeleteTagOutput> => {
    const { tag_id } = deleteTagInput.parse(args)
    try {
      return await callOpenApi<DeleteTagOutput>(
        auth,
        'DELETE',
        `/v2/open/tags/${encodeURIComponent(tag_id)}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
