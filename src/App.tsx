import { useEffect, useState } from 'react'
import type { WalletAccount } from './lib/passkey'
import * as keystore from './lib/keystore'
import { ConnectScreen } from './components/ConnectScreen'
import { Dashboard } from './components/Dashboard'
import { useNetwork } from './lib/useNetwork'

export default function App() {
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [stored, setStored] = useState<keystore.StoredCredential | null>(null)
  const [ready, setReady] = useState(false)
  const network = useNetwork()

  useEffect(() => {
    const lastId = keystore.getLastCredentialId()
    setStored(lastId ? keystore.getCredentialById(lastId) : null)
    setReady(true)
  }, [])

  if (!ready) return null

  if (!account && !stored) {
    return (
      <ConnectScreen
        key={network.key}
        onCreated={(a) => {
          setAccount(a)
          setStored(keystore.getCredentialById(a.credential.id))
        }}
      />
    )
  }

  return (
    <Dashboard
      key={network.key}
      credential={stored!}
      onConnected={setAccount}
      onDisconnect={() => {
        setAccount(null)
        setStored(null)
      }}
    />
  )
}
