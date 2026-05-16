export function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const pad = (part: number) => String(part).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function formatSessionName(name: string) {
  const isoName = /^Session (\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name)
  if (isoName) {
    const [, year, month, day, hours, minutes, seconds = '00'] = isoName
    return `Session ${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  const dateOnlyName = /^Session (\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (dateOnlyName) {
    const [, year, month, day] = dateOnlyName
    return `Session ${year}-${month}-${day} 00:00:00`
  }

  const chineseName = /^Session (\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5(?:\s+(\d{2})\u65f6(\d{2})\u5206(\d{2})\u79d2)?/.exec(name)
  if (chineseName) {
    const [, year, month, day, hours = '00', minutes = '00', seconds = '00'] = chineseName
    return `Session ${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  return name
}

export function formatSessionDisplayName(name: string, lastActive?: string) {
  const formatted = formatSessionName(name)
  if (/^Session\b/.test(formatted)) {
    return '新会话'
  }

  return formatted
}
