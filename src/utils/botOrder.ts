import type { Order } from '../types'

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

export const isBotOrder = (order: Order | null | undefined): boolean => {
  return order?.source === 'bot'
}

export const getBotWarnings = (order: Order | null | undefined): string[] => {
  if (!isBotOrder(order)) return []
  const extras = asRecord(order?.extra_fields)
  const warnings = extras?.warnings
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === 'string') : []
}

export const needsBotReview = (order: Order | null | undefined): boolean => {
  if (!isBotOrder(order)) return false
  const extras = asRecord(order?.extra_fields)
  return extras?.needs_review === true || getBotWarnings(order).length > 0
}

export const getBotMetadata = (order: Order | null | undefined) => {
  if (!isBotOrder(order)) return null
  const extras = asRecord(order?.extra_fields)
  const sourceMetadata = asRecord(order?.source_metadata)
  return {
    receivedAt: typeof extras?.bot_received_at === 'string' ? extras.bot_received_at : undefined,
    apiKeyId: typeof extras?.api_key_id === 'number' ? extras.api_key_id : undefined,
    ipAddress: typeof sourceMetadata?.ip_address === 'string' ? sourceMetadata.ip_address : undefined,
    userAgent: typeof sourceMetadata?.user_agent === 'string' ? sourceMetadata.user_agent : undefined,
    rawPayload: asRecord(extras?.raw_payload) ?? undefined,
  }
}
