import { useSyncExternalStore } from 'react'
import {
  NETWORK_CHANGED,
  getNetwork,
  syncNetworkFromStorage,
  type NetworkConfig,
} from '../chain'

function subscribe(onChange: () => void): () => void {
  const onStorage = () => {
    // another tab switched networks → adopt it here too
    syncNetworkFromStorage()
    onChange()
  }
  window.addEventListener(NETWORK_CHANGED, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(NETWORK_CHANGED, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** The active network; the component re-renders when it changes. */
export function useNetwork(): NetworkConfig {
  return useSyncExternalStore(subscribe, getNetwork, getNetwork)
}
