export {}

declare global {
  interface SpeechRecognitionAlternative {
    transcript: string
    confidence: number
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    [index: number]: SpeechRecognitionAlternative
    item(index: number): SpeechRecognitionAlternative | null
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    [index: number]: SpeechRecognitionResult
    item(index: number): SpeechRecognitionResult | null
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onend: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null
    start(): void
    stop(): void
    abort(): void
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}
