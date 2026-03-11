import chalk from 'chalk'

interface OutputConfig {
  verbosity: 'quiet' | 'normal' | 'verbose'
}

let config: OutputConfig = {
  verbosity: 'normal'
}

export function setOutputConfig(newConfig: Partial<OutputConfig>): void {
  config = { ...config, ...newConfig }
}

export function outgoing(action: string, detail?: string): void {
  const prefix = chalk.blue('[->]')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

export function incoming(action: string, detail?: string): void {
  const prefix = chalk.green('[<-]')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

export function serverInitiated(action: string, detail?: string): void {
  const prefix = chalk.yellow('[<-] Server:')
  const msg = detail ? `${prefix} ${action}: ${detail}` : `${prefix} ${action}`
  console.log(msg)
}

export function error(message: string): void {
  console.log(chalk.red(`[!] ${message}`))
}

export function status(message: string): void {
  console.log(chalk.cyan(message))
}

export function verbose(message: string): void {
  if (config.verbosity === 'verbose') {
    console.log(chalk.gray(message))
  }
}

export function info(message: string): void {
  if (config.verbosity !== 'quiet') {
    console.log(message)
  }
}
