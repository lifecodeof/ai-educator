type LegacyWindow = Window & { webkitAudioContext?: typeof AudioContext }

export function getAudioContextCtor() {
  const audioContextCtor = window.AudioContext ?? (window as LegacyWindow).webkitAudioContext
  if (!audioContextCtor) {
    throw new Error('Web Audio API is not supported in this browser.')
  }
  return audioContextCtor
}
