declare module '*.css'

// Electron's <webview> tag, used for the apps that live inside Life System.
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      partition?: string
      allowpopups?: string
    }
  }
}

// Vite asset URLs (e.g. the sql.js WebAssembly file).
declare module '*?url' {
  const url: string
  export default url
}

// A file's text at build time (the MCP bridge script offered in Settings).
declare module '*?raw' {
  const text: string
  export default text
}
