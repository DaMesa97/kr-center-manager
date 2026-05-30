type ProductionStageCellProps = {
  value: string
  disabled?: boolean
  onPickEmpty: () => void
  onPickFilled: () => void
}

export default function ProductionStageCell({
  value,
  disabled,
  onPickEmpty,
  onPickFilled,
}: ProductionStageCellProps) {
  const filled = Boolean(value.trim())
  return (
    <button
      type="button"
      className={`production-stage-cell ${filled ? 'production-stage-cell--done' : 'production-stage-cell--empty'}`}
      disabled={disabled}
      onClick={() => (filled ? onPickFilled() : onPickEmpty())}
    >
      {filled ? value.trim() : '\u00a0'}
    </button>
  )
}
