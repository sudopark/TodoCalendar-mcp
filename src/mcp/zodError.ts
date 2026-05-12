import type { ZodError } from 'zod'

// ZodError → 한 줄 자연어. raw issue 배열을 그대로 노출하면 LLM 측이 파싱 부담을 지므로
// `path: message`(`; `로 join) 형태로 압축한다. 다중 issue는 모두 포함 — caller가 한 번에
// 모든 위반을 보고 수정할 수 있도록.
export const formatZodError = (e: ZodError): string => {
  if (e.issues.length === 0) return 'Invalid input'
  return e.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}
