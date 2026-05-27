import { createHash } from 'node:crypto'

// 사용량 집계 로그에 sub을 raw로 찍지 않기 위한 deterministic pseudonymizer.
// userId 자체의 앞 16자를 salt 자리에 끼워 같이 해시 — 외부 secret 없이 결정적.
// 같은 userId는 항상 같은 hash → distinct count 유효. 보안 강도는
// secret-salted HMAC 대비 약하지만(brute-force reverse 가능), raw 노출 회피가
// 본 함수의 목적이고 PII 강보호는 비범위.
export const hashUserId = (userId: string): string => {
  const salt = userId.slice(0, 16)
  return createHash('sha256').update(userId + salt).digest('hex')
}
