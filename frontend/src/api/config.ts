import { createHttpClient } from './http'

export const apiClient = createHttpClient({ baseUrl: import.meta.env.VITE_API_BASE_URL })
