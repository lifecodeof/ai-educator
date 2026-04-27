export function convertFloat32ToInt16(floatSamples: Float32Array): Int16Array {
  const int16Buffer = new Int16Array(floatSamples.length)
  for (let i = 0; i < floatSamples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]))
    int16Buffer[i] = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0
  }
  return int16Buffer
}
