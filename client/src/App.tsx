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
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'err', text: 'Only image files are supported.' })
      return
    }

    setUploading(true)
    try {
      const presignRes = await fetch(
        `${apiBase}/api/presigned-url?contentType=${encodeURIComponent(file.type)}`,
      )
      const presignBody = (await presignRes.json().catch(() => ({}))) as {
        error?: string
        signedUrl?: string
        key?: string
      }
      
      if (!presignRes.ok) {
        throw new Error(presignBody.error || `Presign failed (${presignRes.status})`)
      }

      const { signedUrl, key } = presignBody
      if (!signedUrl || !key) {
        throw new Error('Presign response missing signedUrl or key')
      }

      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      
      if (!putRes.ok) {
        throw new Error(
          `Direct upload to S3 failed (${putRes.status}). Check bucket CORS and credentials.`,
        )
      }

      const completeRes = await fetch(`${apiBase}/api/uploads/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          originalName: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      })
      const completeBody = (await completeRes.json().catch(() => ({}))) as {
        error?: string
      }
      if (!completeRes.ok) {
        throw new Error(completeBody.error || `Save failed (${completeRes.status})`)
      }

      setMessage({ type: 'ok', text: 'Image uploaded to S3 and record saved.' })
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
      <h1>Image uploads</h1>
      <p className="upload-lead">
        Files go straight to S3 using a short-lived presigned URL, then the app stores
        metadata and the object URL in MongoDB. Your S3 bucket must allow{' '}
        <code>PUT</code> from this site’s origin via CORS.
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
          {uploading ? 'Uploading…' : 'Upload to S3'}
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
                {u.storageUrl ? (
                  <a
                    className="upload-thumb-link"
                    href={u.storageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="upload-thumb"
                      src={u.storageUrl}
                      alt=""
                      loading="lazy"
                    />
                  </a>
                ) : null}
                <div className="upload-card-name" title={u.originalName}>
                  {u.originalName}
                </div>
                <div className="upload-card-meta">
                  <span>{u.mimeType}</span>
                  <span>{formatBytes(u.size)}</span>
                  <span className="upload-id">{u._id}</span>
                </div>
                <div className="upload-card-storage">
                  {u.storageUrl ? (
                    <a href={u.storageUrl} target="_blank" rel="noreferrer">
                      {u.storageUrl}
                    </a>
                  ) : (
                    <>storage: pending</>
                  )}
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
