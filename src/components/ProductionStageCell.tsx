type ProductionStageCellProps = {
  value: string
  disabled?: boolean
  /**
   * Etap INNEGO stanowiska (pracownik produkcji bez przypisania do tego etapu):
   * komórka wygląda inaczej niż „swoja" i nie reaguje na klik — wcześniej
   * wszystkie szare komórki wyglądały tak samo, a błąd przychodził dopiero toastem.
   */
  foreign?: boolean
  title?: string
  onPickEmpty: () => void
  onPickFilled: () => void
}

export default function ProductionStageCell({
  value,
  disabled,
  foreign = false,
  title,
  onPickEmpty,
  onPickFilled,
}: ProductionStageCellProps) {
  const filled = Boolean(value.trim())
  const cls = [
    'production-stage-cell',
    filled ? 'production-stage-cell--done' : 'production-stage-cell--empty',
    foreign ? 'production-stage-cell--foreign' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled || foreign}
      title={title ?? (foreign ? 'Etap innego stanowiska — nie Twój' : undefined)}
      aria-disabled={foreign || undefined}
      onClick={() => (filled ? onPickFilled() : onPickEmpty())}
    >
      {filled ? value.trim() : ' '}
    </button>
  )
}
