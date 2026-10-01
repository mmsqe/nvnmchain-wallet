import { feeTokenSymbol } from '../chain'

/** Shared error-to-user-message helper for transaction failures. */
export function formatTxError(e: any): string {
  const msg = e?.shortMessage ?? e?.message ?? String(e)
  const details = e?.details ?? e?.cause?.details ?? ''
  if (/user rejected|rejected/i.test(msg)) {
    return 'Passkey prompt was cancelled — nothing was sent.'
  }
  if (/insufficient funds/i.test(details)) {
    return `Insufficient ${feeTokenSymbol()} to cover the fee.`
  }
  return `${msg}${details ? ` — ${details}` : ''}`
}
