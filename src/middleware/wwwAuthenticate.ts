export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

// RFC 7235 quoted-string — `"`와 `\` 모두 escape 필수. 정보 손실 없이 안전화.
export const escapeQuotedString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export interface WwwAuthenticateChallenge {
  error: string
  description?: string
  scope?: string
}

export const buildWwwAuthenticate = (
  canonicalUri: string | undefined,
  metadataUrl: string | undefined,
  challenge?: WwwAuthenticateChallenge,
): string => {
  const parts: string[] = []
  if (canonicalUri !== undefined) parts.push(`realm="${escapeQuotedString(canonicalUri)}"`)
  if (metadataUrl !== undefined) {
    parts.push(`resource_metadata="${escapeQuotedString(metadataUrl)}"`)
  }
  if (challenge !== undefined) {
    parts.push(`error="${escapeQuotedString(challenge.error)}"`)
    if (challenge.description !== undefined) {
      parts.push(`error_description="${escapeQuotedString(challenge.description)}"`)
    }
    if (challenge.scope !== undefined) {
      parts.push(`scope="${escapeQuotedString(challenge.scope)}"`)
    }
  }
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer'
}

export const metadataUrlFrom = (canonicalUri: string | undefined): string | undefined => {
  if (canonicalUri === undefined) return undefined
  try {
    const url = new URL(canonicalUri)
    return `${url.protocol}//${url.host}${PROTECTED_RESOURCE_METADATA_PATH}`
  } catch {
    return undefined
  }
}
