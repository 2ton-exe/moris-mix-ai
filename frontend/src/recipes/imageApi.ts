import { apiClient } from '../api/config'
import { HttpError } from '../api/http'

const uploadPath = '/functions/v1/recipe-image-upload-url'
const attachPath = '/functions/v1/recipe-image-attach'
const downloadPath = '/functions/v1/recipe-image-download-url'
const maximumBytes = 10 * 1024 * 1024
const maximumDimension = 2048
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']

type Request = { userId: string; signal?: AbortSignal }
export type UploadIntent = { id: string; url: string; contentType: string }
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
    if (blob.type !== 'image/webp' || blob.size === 0 || blob.size > maximumBytes) throw new Error('invalid-output')
    return blob
  } catch {
    throw new Error('Could not prepare this image for upload.')
  } finally {
    bitmap?.close()
  }
}

export function createRecipeImageApi(client: typeof apiClient = apiClient) {
  return {
    async createUpload(recipeId: string, image: Blob, request: Request): Promise<UploadIntent> {
      const value = await client.postAuthenticatedJson(uploadPath, {
        recipe_id: recipeId,
        content_type: image.type,
        byte_size: image.size,
      }, request)
      const upload = isRecord(value) && isRecord(value.upload) ? value.upload : undefined
      let uploadUrl: URL | undefined
      if (typeof upload?.url === 'string') {
        try {
          uploadUrl = new URL(upload.url)
        } catch {
          // The authenticated transport accepts only configured-origin URLs.
        }
      }
      if (typeof upload?.id !== 'string' || typeof upload.url !== 'string' || upload.method !== 'PUT' ||
        !uploadUrl || !['https:', 'http:'].includes(uploadUrl.protocol) || uploadUrl.pathname !== uploadPath ||
        uploadUrl.username || uploadUrl.password || uploadUrl.hash ||
        !isRecord(upload.headers) || upload.headers['Content-Type'] !== image.type ||
        typeof upload.expires_at !== 'string' || !Number.isFinite(Date.parse(upload.expires_at)) ||
        Date.parse(upload.expires_at) <= Date.now()) {
        throw new Error('Invalid image upload response.')
      }
      return { id: upload.id, url: upload.url, contentType: image.type }
    },

    async uploadBytes(upload: UploadIntent, image: Blob, request: Request): Promise<void> {
      if (upload.contentType !== image.type) throw new Error('Invalid image upload response.')
      const value = await client.putAuthenticatedBytes(upload.url, image, request)
      const result = isRecord(value) && isRecord(value.upload) ? value.upload : undefined
      if (result?.id !== upload.id || result.received !== true) throw new Error('Invalid image upload response.')
    },

    async attach(recipeId: string, uploadId: string, image: Blob, request: Request): Promise<void> {
      const value = await client.postAuthenticatedJson(attachPath, { recipe_id: recipeId, upload_id: uploadId }, request)
      const result = isRecord(value) && isRecord(value.image) ? value.image : undefined
      if (result?.recipe_id !== recipeId || result.content_type !== image.type || result.byte_size !== image.size ||
        typeof result.uploaded_at !== 'string' || !Number.isFinite(Date.parse(result.uploaded_at))) {
        throw new Error('Invalid image attachment response.')
      }
    },

    async getDownload(recipeId: string, request: Request): Promise<Download | null> {
      let value: unknown
      try {
        value = await client.postAuthenticatedJson(downloadPath, { recipe_id: recipeId }, request)
      } catch (error) {
        if (error instanceof HttpError && error.status === 404 && recipeImageErrorCode(error) === 'IMAGE_NOT_FOUND') return null
        throw error
      }
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
      return { url: url.toString(), expiresAt }
    },
  }
}

export const recipeImageApi = createRecipeImageApi()
