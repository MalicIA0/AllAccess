import type { AllAccessApi } from './index'

declare global {
  interface Window {
    api: AllAccessApi
  }
}

export {}
