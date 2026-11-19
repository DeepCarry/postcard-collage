export interface Crop { x: number; y: number; zoom: number }
export interface Photo {
  id: string
  name: string
  source: Blob
  preview: string
  image: HTMLImageElement
  aspect: number
  crop: Crop
}

export function initialCrop(aspect: number): Crop {
  return { x: .5, y: aspect < .85 ? .40 : .5, zoom: 1 }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取图片'))
    image.src = url
  })
}

export async function decode(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // The browser image decoder may support formats unavailable to ImageBitmap.
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => blob && blob.type === type ? resolve(blob) : reject(new Error('无法生成图片')), type, quality))
}

export async function preparePhoto(source: Blob, name: string): Promise<Photo> {
  const decoded = await decode(source)
  const aspect = decoded.width / decoded.height
  const scale = Math.min(1, 1152 / Math.max(decoded.width, decoded.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(decoded.width * scale))
  canvas.height = Math.max(1, Math.round(decoded.height * scale))
  try {
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height)
  } finally {
    decoded.close()
  }
  let blob: Blob
  try {
    blob = await encode(canvas, 'image/webp', .89)
  } catch {
    blob = await encode(canvas, 'image/png')
  } finally {
    canvas.width = canvas.height = 1
  }
  const preview = URL.createObjectURL(blob)
  try {
    return { id: crypto.randomUUID(), name, source, preview, image: await loadImage(preview), aspect, crop: initialCrop(aspect) }
  } catch (error) {
    URL.revokeObjectURL(preview)
    throw error
  }
}
