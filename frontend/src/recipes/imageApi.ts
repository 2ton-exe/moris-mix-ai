import { apiClient } from '../api/config'
import { HttpError } from '../api/http'

const uploadPath = '/functions/v1/recipe-image-upload-url'
const attachPath = '/functions/v1/recipe-image-attach'
const downloadPath = '/functions/v1/recipe-image-download-url'
const maximumBytes = 10 * 1024 * 1024
const maximumDimension = 2048
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']
const r2HostPattern = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const signedUploadHeaders = 'content-length;content-type;host;if-none-match'
const missingImageCacheMs = 15_000

type Request = { userId: string; signal?: AbortSignal }
type UploadRequest = Request & { requestId: string }
export type UploadIntent = {
  id: string
  url: string
  contentType: string
  byteSize: number
  expiresAt: number
  headers: Record<string, string>
}
export type Download = { url: string; expiresAt: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function recipeImageErrorCode(error: unknown) {
  if (!(error instanceof HttpError) || !isRecord(error.payload) || !isRecord(error.payload.error)) return undefined
  return typeof error.payload.error.code === 'string' ? error.payload.error.code : undefined
}

export async function prepareRecipeImage(file: File): Promise<Blob> {
  if (!imageTypes.includes(file.type)) throw new Error('unsupported-image')
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    if (!bitmap.width || !bitmap.height) throw new Error('invalid-image')
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas-unavailable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('encode-failed')), 'image/webp', 0.82)
    })
    if (!imageTypes.includes(blob.type) || blob.size === 0 || blob.size > maximumBytes) throw new Error('invalid-output')
    return blob
  } catch {
    throw new Error('Could not prepare this image for upload.')
  } finally {
    bitmap?.close()
  }
}

export function createRecipeImageApi(client: typeof apiClient = apiClient) {
  const downloads = new Map<string, { download: Download | null; expiresAt: number; timer: number }>()
  const downloadRevisions = new Map<string, number>()
  let cacheEpoch = 0
  const downloadKey = (userId: string, recipeId: string) => JSON.stringify([userId, recipeId])
  const invalidateDownload = (recipeId: string, userId: string) => {
    const key = downloadKey(userId, recipeId)
    const cached = downloads.get(key)
    if (cached) window.clearTimeout(cached.timer)
    downloads.delete(key)
    downloadRevisions.set(key, (downloadRevisions.get(key) ?? 0) + 1)
  }

  return {
    clearDownloads() {
      for (const cached of downloads.values()) window.clearTimeout(cached.timer)
      downloads.clear()
      downloadRevisions.clear()
      cacheEpoch++
    },

    async createUpload(recipeId: string, image: Blob, request: UploadRequest): Promise<UploadIntent> {
      const value = await client.postAuthenticatedJson(uploadPath, {
        recipe_id: recipeId,
        content_type: image.type,
        byte_size: image.size,
        ...(import.meta.env.VITE_RECIPE_IMAGE_UPLOAD_IDEMPOTENCY === 'true'
          ? { request_id: request.requestId }
          : {}),
      }, request)
      const upload = isRecord(value) && isRecord(value.upload) ? value.upload : undefined
      let uploadUrl: URL | undefined
      if (typeof upload?.url === 'string') {
        try {
          uploadUrl = new URL(upload.url)
        } catch {
          // Reject malformed storage capabilities at the API boundary.
        }
      }
      const path = uploadUrl?.pathname.split('/').filter(Boolean) ?? []
      const signatureExpiry = Number(uploadUrl?.searchParams.get('X-Amz-Expires'))
      const expiresAt = typeof upload?.expires_at === 'string' ? Date.parse(upload.expires_at) : NaN
      if (typeof upload?.id !== 'string' || !uuidPattern.test(upload.id) || typeof upload.url !== 'string' || upload.method !== 'PUT' ||
        !uploadUrl || uploadUrl.protocol !== 'https:' || !r2HostPattern.test(uploadUrl.hostname) || uploadUrl.port ||
        uploadUrl.username || uploadUrl.password || uploadUrl.hash ||
        path.length !== 6 || path[1] !== 'recipe-images' || path[2] !== 'staging' ||
        path[3] !== request.userId.toLowerCase() || path[4] !== recipeId.toLowerCase() || path[5] !== upload.id ||
        uploadUrl.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
        uploadUrl.searchParams.get('X-Amz-SignedHeaders') !== signedUploadHeaders ||
        uploadUrl.searchParams.get('X-Amz-Content-Sha256') !== 'UNSIGNED-PAYLOAD' ||
        !/^[a-f0-9]{64}$/i.test(uploadUrl.searchParams.get('X-Amz-Signature') ?? '') ||
        !/^\d{8}T\d{6}Z$/.test(uploadUrl.searchParams.get('X-Amz-Date') ?? '') ||
        !Number.isInteger(signatureExpiry) || signatureExpiry < 1 || signatureExpiry > 600 ||
        upload.byte_size !== image.size || !isRecord(upload.headers) ||
        Object.keys(upload.headers).length !== 2 || upload.headers['Content-Type'] !== image.type ||
        upload.headers['If-None-Match'] !== '*' ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('Invalid image upload response.')
      }
      return {
        id: upload.id,
        url: upload.url,
        contentType: image.type,
        byteSize: image.size,
        expiresAt,
        headers: { 'Content-Type': image.type, 'If-None-Match': '*' },
      }
    },

    async uploadBytes(upload: UploadIntent, image: Blob, request: Request): Promise<void> {
      if (upload.contentType !== image.type || upload.byteSize !== image.size) throw new Error('Invalid image upload response.')
      const expired = () => new HttpError('http', 'The image upload authorization expired.', 410, { error: { code: 'UPLOAD_EXPIRED' } })
      if (Date.now() >= upload.expiresAt) throw expired()
      let status: number
      try {
        status = await client.putPresignedBytes(upload.url, image, upload.headers, request)
      } catch (error) {
        if (error instanceof HttpError && error.status === 403 && Date.now() >= upload.expiresAt) throw expired()
        throw error
      }
      if (status !== 200 && status !== 412) throw new Error('Invalid image upload response.')
    },

    async attach(recipeId: string, uploadId: string, image: Blob, request: Request): Promise<void> {
      const value = await client.postAuthenticatedJson(attachPath, { recipe_id: recipeId, upload_id: uploadId }, request)
      const result = isRecord(value) && isRecord(value.image) ? value.image : undefined
      if (result?.recipe_id !== recipeId || result.content_type !== image.type || result.byte_size !== image.size ||
        typeof result.uploaded_at !== 'string' || !Number.isFinite(Date.parse(result.uploaded_at))) {
        throw new Error('Invalid image attachment response.')
      }
    },

    async getDownload(recipeId: string, request: Request, forceRefresh = false): Promise<Download | null> {
      const key = downloadKey(request.userId, recipeId)
      if (forceRefresh) invalidateDownload(recipeId, request.userId)
      const cached = downloads.get(key)
      if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.download
      if (cached || !forceRefresh) invalidateDownload(recipeId, request.userId)
      const epoch = cacheEpoch
      const revision = downloadRevisions.get(key) ?? 0

      let value: unknown
      let missingImage = false
      try {
        value = await client.postAuthenticatedJson(downloadPath, { recipe_id: recipeId }, request)
      } catch (error) {
        if (error instanceof HttpError && error.status === 404 && recipeImageErrorCode(error) === 'IMAGE_NOT_FOUND') missingImage = true
        else throw error
      }
      let download: Download | null = null
      if (!missingImage) {
        if (!isRecord(value) || typeof value.url !== 'string' || typeof value.expires_at !== 'string') {
          throw new Error('Invalid image download response.')
        }
        let url: URL
        try {
          url = new URL(value.url)
        } catch {
          throw new Error('Invalid image download response.')
        }
        const expiresAt = Date.parse(value.expires_at)
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new Error('Invalid image download response.')
        }
        download = { url: url.toString(), expiresAt }
      }
      if (!request.signal?.aborted && epoch === cacheEpoch && revision === (downloadRevisions.get(key) ?? 0)) {
        // shortcut: cache missing images for 15 seconds, shorten if another tab must show new uploads sooner.
        const expiresAt = download?.expiresAt ?? Date.now() + missingImageCacheMs
        const entry = { download, expiresAt, timer: 0 }
        entry.timer = window.setTimeout(() => {
          if (downloads.get(key) === entry) {
            downloads.delete(key)
            if ((downloadRevisions.get(key) ?? 0) === revision) downloadRevisions.delete(key)
          }
        }, Math.max(0, expiresAt - Date.now()))
        downloads.set(key, entry)
      }
      return download
    },
  }
}

export const recipeImageApi = createRecipeImageApi()
