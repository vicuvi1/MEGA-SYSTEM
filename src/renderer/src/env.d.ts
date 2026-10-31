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
