// crypto.randomUUID() is only available in secure contexts (HTTPS/localhost).
// Fall back to manual generation for HTTP access (e.g. mobile via IP).
export function generateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Manual UUID v4 generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}
