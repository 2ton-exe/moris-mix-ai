import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useMoriActivity } from '../mori/MoriCompanionContext'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { useAuth } from '../auth/context'
import { prepareRecipeImage, recipeImageApi, recipeImageErrorCode } from './imageApi'
import type { Download, UploadIntent } from './imageApi'

const IMAGE_OPERATION_TIMEOUT_MS = 90_000

export function RecipeImagePanel({ recipeId, recipeTitle, allowUpload = false, showEmpty = false, framed = false, cookedAt }: {
  framed?: boolean
  cookedAt?: string | null
  recipeId: string
  recipeTitle: string
  allowUpload?: boolean
  showEmpty?: boolean
}) {
  const { user } = useAuth()
  const featureEnabled = import.meta.env.VITE_RECIPE_IMAGES === 'true'
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
  const uploadRequestId = useRef<string | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  const currentUserId = useRef(user?.id)
  const imageLoadSequence = useRef(0)
  useMoriActivity(!featureEnabled ? null : selectionError || uploadError || downloadError
    ? { kind: 'confused', message: 'This recipe photo needs a little attention. Check the image controls for details and recovery.' }
    : preparing || uploading
      ? { kind: 'curious', message: preparing ? 'Taking a peek at your recipe photo…' : 'Adding your recipe photo to the journal…' }
      : null)


  const loadImage = useCallback(async (signal?: AbortSignal, resetRefreshAttempt = true, forceRefresh = false) => {
    const sequence = ++imageLoadSequence.current
    if (!featureEnabled) return false
    if (!user?.id) {
      setDownload(null)
      setLoading(false)
      return false
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      if (sequence !== imageLoadSequence.current) return
      imageLoadSequence.current++
      setDownloadError(true)
      setLoading(false)
    }, IMAGE_OPERATION_TIMEOUT_MS)
    try {
      const result = await recipeImageApi.getDownload(recipeId, { userId: user.id, signal }, forceRefresh)
      if (signal?.aborted || sequence !== imageLoadSequence.current) return false
      setDownload(result ? { ...result, userId: user.id } : null)
      setDownloadError(false)
      if (resetRefreshAttempt) refreshAttempted.current = false
      return result !== null
    } catch {
      if (signal?.aborted || sequence !== imageLoadSequence.current) return false
      setDownloadError(true)
      return false
    } finally {
      window.clearTimeout(timer)
      if (sequence === imageLoadSequence.current) setLoading(false)
    }
  }, [featureEnabled, recipeId, user?.id])

  useEffect(() => {
    if (!featureEnabled) return
    const imageLoadSequenceRef = imageLoadSequence
    const controller = new AbortController()
    void loadImage(controller.signal)
    return () => {
      imageLoadSequenceRef.current++
      controller.abort()
    }
  }, [featureEnabled, loadImage])

  useEffect(() => {
    if (!featureEnabled || !download || download.userId !== user?.id) return
    const imageLoadSequenceRef = imageLoadSequence
    const controller = new AbortController()
    const delay = Math.max(0, download.expiresAt - Date.now())
    const timer = window.setTimeout(() => { void loadImage(controller.signal) }, delay)
    return () => {
      window.clearTimeout(timer)
      imageLoadSequenceRef.current++
      controller.abort()
    }
  }, [download, featureEnabled, loadImage, user?.id])

  useEffect(() => {
    const selectionVersionRef = selectionVersion
    const imageLoadSequenceRef = imageLoadSequence
    if (currentUserId.current !== user?.id) {
      currentUserId.current = user?.id
      setDownload(null)
      setDownloadError(false)
      setLoading(true)
      setSelected(null)
      uploadRequestId.current = null
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
      imageLoadSequenceRef.current++
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
    uploadRequestId.current = crypto.randomUUID()
    setSelected(null)
    setIntent(null)
    setBytesUploaded(false)
    setAttached(false)
    setPreviewUrl(null)
    setSelectionError(null)
    setUploadError(null)
    setUploadSuccess(false)
    setPreparing(true)
    const timer = window.setTimeout(() => {
      if (version !== selectionVersion.current) return
      selectionVersion.current++
      setPreparing(false)
      setSelectionError('Preparing this image took too long. Please choose it again.')
    }, IMAGE_OPERATION_TIMEOUT_MS)
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
      window.clearTimeout(timer)
      if (version === selectionVersion.current) setPreparing(false)
    }
  }

  async function uploadImage() {
    if (!featureEnabled || !selected || !user?.id || busy.current) return
    const controller = new AbortController()
    uploadController.current = controller
    busy.current = true
    setUploading(true)
    setUploadError(null)
    const timer = window.setTimeout(() => {
      if (uploadController.current !== controller) return
      controller.abort()
      uploadController.current = null
      busy.current = false
      setUploading(false)
      setUploadError('The image request took too long. Check the current photo, then try again.')
    }, IMAGE_OPERATION_TIMEOUT_MS)
    try {
      if (attached) {
        const refreshed = await loadImage(controller.signal, true, true)
        if (controller.signal.aborted) return
        if (refreshed) {
          setSelected(null)
          setPreviewUrl(null)
          setIntent(null)
          setBytesUploaded(false)
          setAttached(false)
          uploadRequestId.current = null
          setUploadSuccess(true)
        } else {
          setUploadError('The image is attached, but could not be refreshed. Try again.')
        }
        return
      }

      let activeIntent = intent
      if (!activeIntent) {
        uploadRequestId.current ??= crypto.randomUUID()
        activeIntent = await recipeImageApi.createUpload(recipeId, selected, {
          userId: user.id,
          signal: controller.signal,
          requestId: uploadRequestId.current,
        })
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
            throw error
          } else if (recipeImageErrorCode(error) === 'UPLOAD_EXPIRED') {
            setIntent(null)
            setBytesUploaded(false)
            uploadRequestId.current = crypto.randomUUID()
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
      const refreshed = await loadImage(controller.signal, true, true)
      if (controller.signal.aborted) return
      if (refreshed) {
        setSelected(null)
        setPreviewUrl(null)
        setIntent(null)
        setBytesUploaded(false)
        setAttached(false)
        uploadRequestId.current = null
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
        uploadRequestId.current = crypto.randomUUID()
        setUploadError('This upload is no longer available. Retry to start a new upload.')
      } else if (code === 'UPLOAD_REQUEST_CONFLICT') {
        setIntent(null)
        setBytesUploaded(false)
        setAttached(false)
        uploadRequestId.current = crypto.randomUUID()
        setUploadError('This upload is no longer available. Retry to start a new upload.')
      } else if (code === 'UPLOAD_BYTES_MISSING') {
        setBytesUploaded(false)
        setUploadError('Uploaded image bytes are missing. Retry the upload.')
      } else {
        setUploadError(code === 'UPLOAD_IN_PROGRESS'
          ? 'This upload is still being processed. Wait, then retry the upload.'
          : code === 'UPLOAD_EXPIRED'
            ? 'This upload expired. Retry to start a new upload.'
            : error instanceof Error && error.message === 'Could not prepare this image for upload.'
              ? error.message
              : 'Could not upload this image. Try again.')
      }
    } finally {
      window.clearTimeout(timer)
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
    void loadImage(undefined, false, true)
  }

  if (!featureEnabled) return framed ? <RecipeScrapArtwork title={recipeTitle} cookedAt={cookedAt} size="detail" /> : null

  const currentDownload = download?.userId === user?.id ? download : null
  if (!framed && !allowUpload && !showEmpty && !loading && !currentDownload && !downloadError) return null

  return <section className={`recipe-image-panel${framed ? ' recipe-image-panel--framed' : ''}`} aria-label={allowUpload || showEmpty ? undefined : `Recipe photo for ${recipeTitle}`} aria-labelledby={allowUpload || showEmpty ? `${id}-heading` : undefined} aria-busy={loading || preparing || uploading}>
    {(allowUpload || showEmpty) && <h2 id={`${id}-heading`}>Recipe image</h2>}
    {loading && (allowUpload || showEmpty) && <p role="status">Loading current recipe image…</p>}
    {framed ? <RecipeScrapArtwork title={recipeTitle} cookedAt={cookedAt} size="detail"
      image={currentDownload && !downloadError ? <img className="recipe-image" src={currentDownload.url} alt={`${recipeTitle} photo`} onError={handleImageError} /> : undefined} />
      : currentDownload && <img className="recipe-image" src={currentDownload.url} alt={`${recipeTitle} photo`} onError={handleImageError} />}
    {previewUrl && <img className="recipe-image" src={previewUrl} alt="Selected recipe image preview" />}
    {!loading && !currentDownload && !downloadError && (allowUpload || showEmpty) && <p role="status">No recipe photo has been added yet.</p>}
    {downloadError && <div className="recipe-image-error">
      <p aria-live="polite">Could not load this recipe image.</p>
      <button type="button" className="button button-secondary" onClick={() => { refreshAttempted.current = false; void loadImage(undefined, true, true) }}>Refresh photo</button>
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
      {selected && <button type="button" className="button button-secondary" disabled={preparing || uploading} onClick={() => { void uploadImage() }}>
        {uploadError ? attached ? 'Refresh attached image' : bytesUploaded ? 'Retry attachment' : 'Retry upload' : 'Upload image'}
      </button>}
    </div>}
  </section>
}
