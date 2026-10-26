// electron-vite turns `?asset` imports into a file path that works in dev and in the installed app.
declare module '*?asset' {
  const path: string
  export default path
}
