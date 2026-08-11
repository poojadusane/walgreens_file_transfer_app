const BASE = '/api'

function token() {
  return localStorage.getItem('lb_token') || ''
}

function headers() {
  return { 'Content-Type': 'application/json', 'X-LB-Token': token() }
}

// Silently re-mint the app JWT via /api/me. The Databricks SSO session outlives
// the short JWT, so X-Forwarded-* headers are still present and this succeeds
// without any user interaction. Returns true if a fresh token was stored.
async function refreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me`, { headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) return false
    const data = await res.json()
    if (data?.token) {
      localStorage.setItem('lb_token', data.token)
      return true
    }
    return false
  } catch {
    return false
  }
}

async function req<T>(method: string, path: string, body?: unknown, _retried = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    // JWT expired — try to silently re-mint it once and retry the request.
    // Don't retry the refresh call itself (path === '/me') to avoid a loop.
    if (!_retried && path !== '/me' && (await refreshToken())) {
      return req<T>(method, path, body, true)
    }
    // Genuine session loss (SSO gone) — fall back to the login screen.
    localStorage.removeItem('lb_token')
    localStorage.removeItem('lb_session')
    window.location.reload()
    throw new Error('Session expired — please sign in again')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const api = {
  ssoLogin: () => req<LoginResp>('GET', '/me'),

  getWorkspaces: ()               => req<Workspace[]>('GET', '/workspaces'),
  getVolumes: (ws: string)        => req<VolumeGroup[]>('GET', `/volumes?workspace_id=${ws}`),
  listFiles:  (ws: string, cat: string, sch: string, vol: string, folder: string) =>
    req<FileListResp>('GET', `/files?workspace_id=${ws}&uc_catalog=${encodeURIComponent(cat)}&uc_schema=${encodeURIComponent(sch)}&volume=${encodeURIComponent(vol)}&folder=${encodeURIComponent(folder)}`),

  browse: (ws: string, cat: string, sch: string, vol: string, folder: string) =>
    req<BrowseResp>('GET', `/browse?workspace_id=${ws}&uc_catalog=${encodeURIComponent(cat)}&uc_schema=${encodeURIComponent(sch)}&volume=${encodeURIComponent(vol)}&folder=${encodeURIComponent(folder)}`),

  downloadFile: (ws: string, cat: string, sch: string, vol: string, folder: string, filename: string) => {
    const url = `${BASE}/download?workspace_id=${ws}&uc_catalog=${encodeURIComponent(cat)}&uc_schema=${encodeURIComponent(sch)}&volume=${encodeURIComponent(vol)}&folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`
    return fetch(url, { headers: { 'X-LB-Token': token() } })
  },

  downloadZip: (ws: string, cat: string, sch: string, vol: string, folder: string, filenames: string[]) =>
    fetch(`${BASE}/download-zip`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workspace_id: ws, uc_catalog: cat, uc_schema: sch, volume: vol, folder, filenames }),
    }),

  adminGetPermissions: ()           => req<Permission[]>('GET', '/admin/permissions'),
  adminGetWorkspaces:  ()           => req<Workspace[]>('GET', '/admin/workspaces'),
  adminAddPermission:  (p: PermBody)    => req('POST', '/admin/permission', p),
  adminUpdatePermission: (p: PermBody)  => req('PUT', '/admin/permission', p),
  adminDeletePermission: (p: DeleteBody) => req('DELETE', '/admin/permission', p),
  adminBulkPermissions: (changes: BulkChange[]) => req('POST', '/admin/permissions/bulk', { changes }),
  adminAddWorkspace: (b: AddWorkspaceBody) => req('POST', '/admin/workspace', b),

  adminImportCsv: async (file: File): Promise<ImportResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/admin/import`, {
      method: 'POST',
      headers: { 'X-LB-Token': token() },
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Import failed')
    }
    return res.json()
  },

  previewFile: (ws: string, cat: string, sch: string, vol: string, folder: string, filename: string) =>
    req<{ content: string; filename: string }>('GET',
      `/preview?workspace_id=${ws}&uc_catalog=${encodeURIComponent(cat)}&uc_schema=${encodeURIComponent(sch)}&volume=${encodeURIComponent(vol)}&folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`),
}

// ── types ─────────────────────────────────────────────────
export interface LoginResp  { token: string; user: { user_id: string; display_name: string; is_admin: boolean } }
export type Scope = 'VOLUME' | 'FOLDER_TREE' | 'FOLDER'
export interface Workspace  { workspace_id: string; display_name: string; host_url: string }
export interface FolderPerm { folder: string; permission: 'READ' | 'DOWNLOAD'; scope: Scope }
export interface VolumeGroup { uc_catalog: string; uc_schema: string; volume: string; folders: FolderPerm[] }
export interface FileEntry  { name: string; size: number; modified: number }
export interface DirEntry   { name: string; path: string }
export interface FileListResp { files: FileEntry[]; permission: 'READ' | 'DOWNLOAD' }
export interface BrowseResp { dirs: DirEntry[]; files: FileEntry[]; permission: 'READ' | 'DOWNLOAD' }
export type PrincipalType = 'USER' | 'GROUP'
export interface Permission {
  principal_type: PrincipalType; principal_id: string
  display_name: string; databricks_upn?: string
  workspace_id: string; workspace_name: string
  uc_catalog: string; uc_schema: string
  volume: string; folder_path: string
  permission: string; scope: Scope; granted_by: string; granted_at: string
}
export interface PermBody   { principal_type: PrincipalType; principal_id: string; workspace_id: string; uc_catalog: string; uc_schema: string; volume: string; folder_path: string; permission: string; scope: Scope }
export interface DeleteBody { principal_type: PrincipalType; principal_id: string; workspace_id: string; uc_catalog: string; uc_schema: string; volume: string; folder_path: string }
export interface BulkChange { principal_type: PrincipalType; principal_id: string; workspace_id: string; uc_catalog: string; uc_schema: string; volume: string; folder_path: string; permission: string | null }
export interface ImportResult { users_added: number; permissions_added: number }
export interface AddWorkspaceBody { workspace_id: string; display_name: string; host_url: string }
