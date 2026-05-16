// Strip ANSI escape codes from terminal output
export function stripAnsi(str: string): string {
  return str.replace(
    /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  )
}
