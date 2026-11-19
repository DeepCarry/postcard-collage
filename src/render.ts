import type { Rect, Settings, Template, Tile } from './layout'
import { decode, encode } from './photos'
import type { Crop, Photo } from './photos'

type Layout = { width: number; height: number; tiles: Tile[] }

function path(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2))
}

function inset(rect: Rect, x: number, top: number, bottom = top): Rect {
  return { x: rect.x + x, y: rect.y + top, w: rect.w - 2 * x, h: rect.h - top - bottom }
}

export function imageFrame(tile: Tile, template: Template): Rect {
  const unit = Math.min(tile.w, tile.h)
  if (template === 'polaroid') return inset(tile, unit * .047, unit * .047, unit * .16)
  if (template === 'film') return inset(tile, unit * .03, unit * .12)
  return tile
}

export function sourceCrop(w: number, h: number, frame: Rect, crop: Crop) {
  const scale = Math.max(frame.w / w, frame.h / h) * crop.zoom
  const width = Math.min(w, frame.w / scale)
  const height = Math.min(h, frame.h / scale)
  return { x: (w - width) * crop.x, y: (h - height) * crop.y, w: width, h: height }
}

function drawTile(ctx: CanvasRenderingContext2D, tile: Tile, template: Template, settings: Settings,
  image: CanvasImageSource, width: number, height: number, crop: Crop) {
  ctx.save()
  if (tile.angle) {
    const x = tile.x + tile.w / 2
    const y = tile.y + tile.h / 2
    ctx.translate(x, y)
    ctx.rotate(tile.angle)
    ctx.translate(-x, -y)
  }
  const unit = Math.min(tile.w, tile.h)
  if (template === 'polaroid' || template === 'film') {
    ctx.fillStyle = template === 'polaroid' ? '#fff' : '#252729'
    if (template === 'polaroid') {
      const scale = ctx.getTransform().a
      ctx.shadowColor = '#392f2b44'
      ctx.shadowBlur = unit * .044 * scale
      ctx.shadowOffsetY = unit * .018 * scale
    }
    path(ctx, tile, Math.min(6, settings.radius))
    ctx.fill()
    ctx.shadowColor = 'transparent'
    if (template === 'film') {
      ctx.fillStyle = '#d9d3c5'
      const holes = Math.max(1, Math.floor(tile.w / (unit * .19)))
      for (let i = 0; i < holes; i++) {
        const x = tile.x + (i + .5) * tile.w / holes - unit * .037
        for (const y of [tile.y + unit * .038, tile.y + tile.h - unit * .080]) {
          path(ctx, { x, y, w: unit * .074, h: unit * .042 }, unit * .012)
          ctx.fill()
        }
      }
    }
  }
  const frame = imageFrame(tile, template)
  path(ctx, frame, settings.radius)
  ctx.clip()
  ctx.fillStyle = settings.background
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h)
  const source = sourceCrop(width, height, frame, crop)
  ctx.drawImage(image, source.x, source.y, source.w, source.h, frame.x, frame.y, frame.w, frame.h)
  ctx.restore()
}

function start(canvas: HTMLCanvasElement, layout: Layout, background: string) {
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.setTransform(canvas.width / layout.width, 0, 0, canvas.height / layout.height, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

export function renderPreview(canvas: HTMLCanvasElement, layout: Layout, photos: Photo[], template: Template, settings: Settings) {
  const ctx = start(canvas, layout, settings.background)
  for (const tile of layout.tiles) {
    const photo = photos[tile.index]
    drawTile(ctx, tile, template, settings, photo.image, photo.image.naturalWidth, photo.image.naturalHeight, photo.crop)
  }
}

export async function exportCollage(layout: Layout, photos: Photo[], template: Template, settings: Settings,
  size: { width: number; height: number }, format: 'png' | 'jpg', onProgress: (count: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  try {
    const ctx = start(canvas, layout, settings.background)
    for (const [index, tile] of layout.tiles.entries()) {
      const photo = photos[tile.index]
      const source = await decode(photo.source)
      try {
        drawTile(ctx, tile, template, settings, source.image, source.width, source.height, photo.crop)
      } finally {
        source.close()
      }
      onProgress(index + 1)
    }
    return await encode(canvas, format === 'png' ? 'image/png' : 'image/jpeg', .95)
  } finally {
    canvas.width = canvas.height = 1
  }
}
