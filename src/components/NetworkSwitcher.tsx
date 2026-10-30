import { NETWORKS, NETWORK_KEYS, setNetwork, type NetworkKey } from '../chain'
import { useNetwork } from '../lib/useNetwork'

/**
 * Network picker (canary / testnet, and local in dev). Switching rebuilds the RPC clients and
 * remounts the dashboard (see `App`), so all asset state is re-read from the
 * newly selected chain.
 */
export function NetworkSwitcher({ compact = false }: { compact?: boolean }) {
  const network = useNetwork()
  return (
    <label
      className={`network-switch ${network.testnet ? 'is-testnet' : ''} ${
        compact ? 'compact' : ''
      }`}
      title="Switch network"
    >
      <span className="network-dot" aria-hidden="true" />
      <select
        aria-label="Network"
        value={network.key}
        onChange={(e) => setNetwork(e.target.value as NetworkKey)}
      >
        {NETWORK_KEYS.map((key) => (
          <option key={key} value={key}>
            {NETWORKS[key].name}
            {compact ? '' : ` · chain ${NETWORKS[key].chainId}`}
          </option>
        ))}
      </select>
    </label>
  )
}
