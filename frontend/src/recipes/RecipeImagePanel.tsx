import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import { prepareRecipeImage, recipeImageApi, recipeImageErrorCode } from './imageApi'
import type { Download, UploadIntent } from './imageApi'

export function RecipeImagePanel({ recipeId, recipeTitle, allowUpload = false, showEmpty = false }: {
  recipeId: string
  recipeTitle: string
  allowUpload?: boolean
  showEmpty?: boolean
}) {
  const { user } = useAuth()
  const id = useId()
  const [download, setDownload] = useState<(Download & { userId: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloadError, setDownloadError] = useState(false)
  const [selected, setSelected] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [intent, setIntent] = useState<UploadIntent | null>(null)
  const [bytesUploaded, setBytesUploaded] = useState(false)
  const [attached, setAttached] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const refreshAttempted = useRef(false)
  const busy = useRef(false)
  const selectionVersion = useRef(0)
  const uploadController = useRef<AbortController | null>(null)
  const currentUserId = useRef(user?.id)

  const loadImage = useCallback(async (signal?: AbortSignal, resetRefreshAttempt = true) => {
    if (!user?.id) {
      setDownload(null)
      setLoading(false)
      return false
    }
    setLoading(true)
    try {
      const result = await recipeImageApi.getDownload(recipeId, { userId: user.id, signal })
      setDownload(result ? { ...result, userId: user.id } : null)
      setDownloadError(false)
      if (resetRefreshAttempt) refreshAttempted.current = false
      return result !== null
    } catch {
      if (signal?.aborted) return false
      setDownloadError(true)
      return false
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [recipeId, user?.id])

  useEffect(() => {
    const controller = new AbortController()
    void loadImage(controller.signal)
    return () => controller.abort()
  }, [loadImage])

  useEffect(() => {
    if (!download || download.userId !== user?.id) return
    const controller = new AbortController()
    const delay = Math.max(0, download.expiresAt - Date.now())
    const timer = window.setTimeout(() => { void loadImage(controller.signal) }, delay)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [download, loadImage, user?.id])

  useEffect(() => {
    const selectionVersionRef = selectionVersion
    if (currentUserId.current !== user?.id) {
      currentUserId.current = user?.id
      setDownload(null)
      setDownloadError(false)
      setLoading(true)
      setSelected(null)
      setPreviewUrl(null)
      setPreparing(false)
      setSelectionError(null)
      setUploadError(null)
      setUploading(false)
      setIntent(null)
      setBytesUploaded(false)
      setAttached(false)
      setUploadSuccess(false)
    }
    return () => {
      selectionVersionRef.current++
      uploadController.current?.abort()
      uploadController.current = null
      busy.current = false
    }
  }, [user?.id])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  async function chooseImage(file: File | undefined) {
    if (!file) return
    const version = ++selectionVersion.current
    setSelected(null)
    setIntent(null)
    setBytesUploaded(false)
    setAttached(false)
    setPreviewUrl(null)
    setSelectionError(null)
    setUploadError(null)
    setUploadSuccess(false)
    setPreparing(true)
    try {
      const image = await prepareRecipeImage(file)
      if (version !== selectionVersion.current) return
      setSelected(image)
      setPreviewUrl(URL.createObjectURL(image))
    } catch {
      if (version === selectionVersion.current) {
        setSelectionError('Choose a JPEG, PNG, or WebP image that can be prepared within 10 MiB.')
      }
    } finally {
      if (version === selectionVersion.current) setPreparing(false)
    }
  }

  async function uploadImage() {
    if (!selected || !user?.id || busy.current) return
    const controller = new AbortController()
    uploadController.current = controller
    busy.current = true
    setUploading(true)
    setUploadError(null)
    try {
      if (attached) {
        const refreshed = await loadImage(controller.signal)
        if (controller.signal.aborted) return
        if (refreshed) {
          setSelected(null)
          setPreviewUrl(null)
          setIntent(null)
          setBytesUploaded(false)
          setAttached(false)
          setUploadSuccess(true)
        } else {
          setUploadError('The image is attached, but could not be refreshed. Try again.')
        }
        return
      }

      let activeIntent = intent
      if (!activeIntent) {
        activeIntent = await recipeImageApi.createUpload(recipeId, selected, { userId: user.id, signal: controller.signal })
        if (controller.signal.aborted) return
        setIntent(activeIntent)
      }
      if (!bytesUploaded) {
        try {
          await recipeImageApi.uploadBytes(activeIntent, selected, { userId: user.id, signal: controller.signal })
          if (controller.signal.aborted) return
        } catch (error) {
          if (controller.signal.aborted) return
          if (recipeImageErrorCode(error) === 'UPLOAD_ALREADY_USED') {
            setBytesUploaded(true)
          } else if (recipeImageErrorCode(error) === 'UPLOAD_IN_PROGRESS') {
            setBytesUploaded(true)
            throw error
          } else if (recipeImageErrorCode(error) === 'UPLOAD_EXPIRED') {
            setIntent(null)
            setBytesUploaded(false)
            throw error
          } else {
            throw error
          }
        }
        setBytesUploaded(true)
      }
      await recipeImageApi.attach(recipeId, activeIntent.id, selected, { userId: user.id, signal: controller.signal })
      if (controller.signal.aborted) return
      setAttached(true)
      const refreshed = await loadImage(controller.signal)
      if (controller.signal.aborted) return
      if (refreshed) {
        setSelected(null)
        setPreviewUrl(null)
        setIntent(null)
        setBytesUploaded(false)
        setAttached(false)
        setUploadSuccess(true)
      } else {
        setUploadError('The image is attached, but could not be refreshed. Try again.')
      }
    } catch (error) {
      if (controller.signal.aborted) return
      const code = recipeImageErrorCode(error)
      if (code === 'UPLOAD_NOT_FOUND') {
        setIntent(null)
        setBytesUploaded(false)
        setAttached(false)
        setUploadError('This upload is no longer available. Retry to start a new upload.')
      } else {
        setUploadError(code === 'UPLOAD_IN_PROGRESS'
          ? 'This upload is still being processed. Wait, then retry to finish attaching it.'
          : code === 'UPLOAD_EXPIRED'
            ? 'This upload expired. Retry to start a new upload.'
            : error instanceof Error && error.message === 'Could not prepare this image for upload.'
              ? error.message
              : 'Could not upload this image. Try again.')
      }
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = null
        busy.current = false
        if (!controller.signal.aborted) setUploading(false)
      }
    }
  }

  function handleImageError() {
    if (!download || refreshAttempted.current) {
      setDownloadError(true)
      return
    }
    refreshAttempted.current = true
    void loadImage(undefined, false)
  }

  const currentDownload = download?.userId === user?.id ? download : null
  if (!allowUpload && !showEmpty && !loading && !currentDownload && !downloadError) return null

  return <section className="recipe-image-panel" aria-labelledby={`${id}-heading`} aria-busy={loading || preparing || uploading}>
    {(allowUpload || showEmpty) && <h2 id={`${id}-heading`}>Recipe image</h2>}
    {loading && (allowUpload || showEmpty) && <p role="status">Loading current recipe image…</p>}
    {currentDownload && <img className="recipe-image" src={currentDownload.url} alt={`${recipeTitle} photo`} onError={handleImageError} />}
    {previewUrl && <img className="recipe-image" src={previewUrl} alt="Selected recipe image preview" />}
    {!loading && !currentDownload && !downloadError && (allowUpload || showEmpty) && <p role="status">No recipe photo has been added yet.</p>}
    {downloadError && <div className="recipe-image-error">
      <p aria-live="polite">Could not load this recipe image.</p>
      <button type="button" onClick={() => { refreshAttempted.current = false; void loadImage() }}>Refresh photo</button>
    </div>}
    {allowUpload && <div className="recipe-image-controls">
      <label htmlFor={`${id}-file`}>Choose recipe image</label>
      <input
        id={`${id}-file`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={preparing || uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void chooseImage(file)
        }}
      />
      {selectionError && <p role="alert">{selectionError}</p>}
      {preparing && <p role="status">Preparing image…</p>}
      {uploading && <p role="status">{bytesUploaded ? 'Attaching image…' : 'Uploading image…'}</p>}
      {uploadError && <p role="alert">{uploadError}</p>}
      {uploadSuccess && <p role="status">Recipe image saved.</p>}
      {selected && <button type="button" disabled={preparing || uploading} onClick={() => { void uploadImage() }}>
        {uploadError ? attached ? 'Refresh attached image' : bytesUploaded ? 'Retry attachment' : 'Retry upload' : 'Upload image'}
      </button>}
    </div>}
  </section>
}
