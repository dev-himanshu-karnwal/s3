import { useCallback, useEffect, useState } from 'react'
import './App.css'

const apiBase =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:3000'

type UploadRecord = {
  _id: string
  originalName: string
  mimeType: string
  size: number
  storageUrl: string | null
  createdAt: string
  updatedAt: string
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function App() {
  const [uploads, setUploads] = useState<UploadRecord[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  )

  const loadUploads = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch(`${apiBase}/api/uploads`)
      if (!res.ok) throw new Error(`List failed (${res.status})`)
      const data = (await res.json()) as UploadRecord[]
      setUploads(data)
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Could not load uploads',
      })
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage(null)
    const input = (e.currentTarget.elements.namedItem('image') as HTMLInputElement)
    const file = input.files?.[0]
    if (!file) {
      setMessage({ type: 'err', text: 'Choose an image file first.' })
      return
    }

    const body = new FormData()
    body.append('image', file)

    setUploading(true)
    try {
      const res = await fetch(`${apiBase}/api/uploads`, {
        method: 'POST',
        body,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Upload failed (${res.status})`)
      }
      setMessage({ type: 'ok', text: 'Metadata saved. File bytes are not stored yet.' })
      input.value = ''
      await loadUploads()
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Upload failed',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="upload-page">
      <h1>Image uploassds</h1>
      <p className="upload-lead">
        The API records <strong>metadata</strong> in MongoDB. Binary data is discarded
        for now; cloud storage can be wired in later via <code>storageUrl</code>.
      </p>

      <form className="upload-form" onSubmit={onSubmit}>
        <label className="upload-label">
          <span className="upload-label-text">Image file</span>
          <input
            className="upload-input"
            type="file"
            name="image"
            accept="image/*"
            disabled={uploading}
          />
        </label>
        <button className="upload-submit" type="submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      <p className="upload-api">
        API: <code>{apiBase}</code>
      </p>

      {message && (
        <p className={message.type === 'ok' ? 'upload-msg ok' : 'upload-msg err'}>
          {message.text}
        </p>
      )}

      <section className="upload-list-section">
        <h2>Recent uploads</h2>
        {loadingList ? (
          <p className="upload-muted">Loading…</p>
        ) : uploads.length === 0 ? (
          <p className="upload-muted">No uploads yet.</p>
        ) : (
          <ul className="upload-list">
            {uploads.map((u) => (
              <li key={u._id} className="upload-card">
                <div className="upload-card-name" title={u.originalName}>
                  {u.originalName}
                </div>
                <div className="upload-card-meta">
                  <span>{u.mimeType}</span>
                  <span>{formatBytes(u.size)}</span>
                  <span className="upload-id">{u._id}</span>
                </div>
                <div className="upload-card-storage">
                  storage: {u.storageUrl ?? 'pending'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
