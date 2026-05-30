import type { Order } from '../types'
import { getBotWarnings, isBotOrder, needsBotReview } from '../utils/botOrder'

type Props = {
  order: Order | null | undefined
}

export const BotBadge = ({ order }: Props) => {
  if (!isBotOrder(order)) return null

  const review = needsBotReview(order)
  const warnings = getBotWarnings(order)
  const tooltip = review
    ? `⚠️ Wymaga weryfikacji:\n${warnings.join('\n')}`
    : 'Zamówienie z konfiguratora online'

  return (
    <span className={`bot-badge ${review ? 'bot-badge--review' : ''}`} title={tooltip}>
      🤖 BOT
      {review && ' ⚠️'}
    </span>
  )
}
