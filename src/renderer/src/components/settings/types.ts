export interface TailscaleStatus {
  installed: boolean
  loggedIn: boolean
  online: boolean
  httpsEnabled: boolean
  httpsHost: string | null
  error: string | null
  serveActive: boolean
  serveUrl: string | null
}

export interface BuildInfo {
  electron: string
  chrome: string
  node: string
  platform: string
  release: string
}
