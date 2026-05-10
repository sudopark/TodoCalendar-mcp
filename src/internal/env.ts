export const requireEnv = (key: string): string => {
  const v = process.env[key]
  if (v === undefined || v === '') throw new Error(`Missing env: ${key}`)
  return v
}
