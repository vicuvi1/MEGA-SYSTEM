// Browser-only: a plugin's data (what its job fetched), kept fresh with live changes.
import { useEffect, useState } from 'react'
import { life } from '../renderer/src/bridge'
import { useLive } from '../renderer/src/live'
import './plugins.css'

export function usePluginData<T>(key: string): T | null {
  const [v, setV] = useState<T | null>(null)
  const load = () => void life.plugins?.data<T>(key).then(setV).catch(() => {})
  useEffect(load, [key])
  useLive(load)
  return v
}
