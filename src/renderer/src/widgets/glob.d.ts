// Vite's import.meta.glob (the repo doesn't load vite/client types).
interface ImportMeta {
  glob(pattern: string, options?: { eager?: boolean; import?: string; query?: string }): Record<string, unknown>
}
