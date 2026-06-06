export async function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer
  if (typeof arrayBuffer === 'function') {
    return arrayBuffer.call(blob)
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Blob 读取失败。'))
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result)
        } else {
          reject(new Error('Blob 读取结果不是 ArrayBuffer。'))
        }
      }
      reader.readAsArrayBuffer(blob)
    })
  }

  return new Response(blob).arrayBuffer()
}
