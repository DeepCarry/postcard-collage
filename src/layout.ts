export const templates = ['grid', 'free', 'magazine', 'polaroid', 'film'] as const
export type Template = typeof templates[number]
export const ratios = ['1:1', '4:3', '3:2', '16:9', '9:16'] as const
export type Ratio = typeof ratios[number]

export interface Settings {
  ratio: Ratio
  gap: number
  margin: number
  radius: number
  background: string
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Tile extends Rect { index: number; angle?: number }
export interface PhotoShape { aspect: number }

export const defaults: Settings = {
  ratio: '3:2', gap: 10, margin: 18, radius: 4, background: '#fffdf8',
}

export function dimensions(ratio: Ratio, longestSide = 1200) {
  const [w, h] = ratio.split(':').map(Number)
  return {
    width: Math.round(longestSide * w / Math.max(w, h)),
    height: Math.round(longestSide * h / Math.max(w, h)),
  }
}

function split(total: number, groups: number) {
  return Array.from({ length: groups }, (_, i) =>
    Math.round((i + 1) * total / groups) - Math.round(i * total / groups))
}

function placeRows(area: Rect, counts: number[], weights: number[], gap: number, offset: number, aspects?: number[]) {
  const safeGap = Math.min(gap, area.w / (2 * Math.max(...counts)), area.h / (2 * counts.length))
  const room = area.h - (counts.length - 1) * safeGap
  const sum = weights.reduce((a, b) => a + b, 0)
  const tiles: Tile[] = []
  let y = area.y
  let index = offset
  for (const [row, count] of counts.entries()) {
    const h = room * weights[row] / sum
    const widths = aspects?.slice(index, index + count) ?? Array<number>(count).fill(1)
    const unit = (area.w - (count - 1) * safeGap) / widths.reduce((a, b) => a + b, 0)
    let x = area.x
    for (const weight of widths) {
      const w = weight * unit
      tiles.push({ x, y, w, h, index: index++ })
      x += w + safeGap
    }
    y += h + safeGap
  }
  return tiles
}

function grid(area: Rect, photos: PhotoShape[], gap: number, offset = 0, variant = 0) {
  const count = photos.length
  const estimate = Math.sqrt(count * area.h / area.w * 1.1)
  const ideal = Math.max(1, Math.round(estimate))
  const candidates = Array.from({ length: Math.min(count, ideal + 3) - Math.max(1, ideal - 3) + 1 },
    (_, index) => Math.max(1, ideal - 3) + index)
  const options = candidates.map(rows => {
    const groups = split(count, rows)
    if (variant % 2) groups.reverse()
    const tiles = placeRows(area, groups, groups.map(() => 1), gap, offset)
    const cost = tiles.reduce((sum, tile, i) => {
      const aspect = tile.w / tile.h
      return sum + Math.abs(Math.log(aspect / photos[i].aspect))
    }, 0) / count
    return { tiles, cost: cost + Math.abs(rows - estimate) * .12 + (Math.max(...groups) - Math.min(...groups)) * .045 }
  }).sort((a, b) => a.cost - b.cost)
  const eligible = options.filter(option => option.cost <= options[0].cost + .32)
  return eligible[Math.floor(variant / 2) % eligible.length].tiles
}

function free(area: Rect, photos: PhotoShape[], gap: number, variant: number) {
  const aspects = photos.map(({ aspect }) => Math.max(.48, Math.min(2.6, aspect)))
  const featured = variant % photos.length
  const visualWeights = aspects.map((aspect, i) => aspect * (i === featured ? 1.68 : 1))
  let best = { cost: Infinity, tiles: [] as Tile[] }
  const guess = Math.sqrt(photos.length * area.h / area.w * 1.34)
  for (let rows = Math.max(1, Math.floor(guess) - 2); rows <= Math.min(photos.length, Math.ceil(guess) + 2); rows++) {
    const groups: number[] = []
    let start = 0
    let remainingWeight = visualWeights.reduce((a, b) => a + b, 0)
    for (let left = rows; left > 1; left--) {
      const target = remainingWeight / left
      let end = start + 1
      let used = visualWeights[start]
      while (end < photos.length - left + 1 && Math.abs(used + visualWeights[end] - target) < Math.abs(used - target)) {
        used += visualWeights[end++]
      }
      groups.push(end - start)
      remainingWeight -= used
      start = end
    }
    groups.push(photos.length - start)
    let index = 0
    const weights = groups.map(count => {
      const rowWeight = visualWeights.slice(index, index + count).reduce((a, b) => a + b, 0)
      index += count
      return Math.max(.55, Math.min(2.4, (area.w - (count - 1) * gap) / rowWeight / (area.h / rows)))
    })
    const tiles = placeRows(area, groups, weights, gap, 0, visualWeights)
    const cost = tiles.reduce((sum, tile, i) => sum + Math.abs(Math.log(tile.w / tile.h / photos[i].aspect)), 0)
      / photos.length + Math.abs(rows - guess) * .16
    if (cost < best.cost) best = { cost, tiles }
  }
  return best.tiles
}

function magazine(area: Rect, photos: PhotoShape[], gap: number, variant: number): Tile[] {
  const count = photos.length
  if (count === 1) return [{ ...area, index: 0 }]
  const tall = area.h > area.w * 1.12
  const heroIndex = variant % count
  const rest = photos.map((_, i) => i).filter(i => i !== heroIndex)
  const bottomCount = count >= 6 && !tall ? Math.ceil((count - 1) / 2) : 0
  const sideCount = count - 1 - bottomCount
  const side = rest.slice(0, sideCount)
  const bottom = rest.slice(sideCount)
  const topH = bottomCount ? (area.h - gap) * .71 : area.h
  let hero: Rect
  let sidebar: Rect
  if (tall) {
    const h = (topH - gap) * (sideCount <= 2 ? .61 : .53)
    hero = { ...area, h }
    sidebar = { ...area, y: area.y + h + gap, h: topH - h - gap }
  } else {
    const observed = photos[heroIndex].aspect * topH / area.w
    const share = Math.max(.48, Math.min(.64, observed * .53 + .30))
    const w = (area.w - gap) * share
    const flip = variant % 2 === 1
    hero = { ...area, x: flip ? area.x + area.w - w : area.x, w, h: topH }
    sidebar = { ...area, x: flip ? area.x : area.x + w + gap, w: area.w - w - gap, h: topH }
  }
  const sideTiles = grid(sidebar, side.map(i => photos[i]), gap).map(tile => ({ ...tile, index: side[tile.index] }))
  const bottomTiles = bottomCount ? placeRows(
    { ...area, y: area.y + topH + gap, h: area.h - topH - gap },
    split(bottomCount, Math.ceil(bottomCount / 7)), Array(Math.ceil(bottomCount / 7)).fill(1), gap, 0,
  ).map(tile => ({ ...tile, index: bottom[tile.index] })) : []
  return [{ ...hero, index: heroIndex }, ...sideTiles, ...bottomTiles]
}

export function arrange(photos: PhotoShape[], template: Template, settings: Settings, variant: number) {
  const { width, height } = dimensions(settings.ratio)
  const margin = Math.min(settings.margin, Math.min(width, height) * .22)
  const area = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 }
  const gap = settings.gap
  if (!photos.length) return { width, height, tiles: [] as Tile[] }
  let tiles: Tile[]
  switch (template) {
    case 'free':
      tiles = free(area, photos, gap, variant)
      break
    case 'magazine':
      tiles = magazine(area, photos, gap, variant)
      break
    case 'polaroid':
      tiles = free(area, photos, gap, variant).map((tile, i) => {
        const inset = Math.min(tile.w, tile.h) * .075
        const tilt = [-.055, .038, -.027, .052, -.036][(i + variant) % 5]
        const angle = Math.sign(tilt) * Math.min(Math.abs(tilt), inset * 1.8 / Math.max(tile.w, tile.h))
        return { ...tile, x: tile.x + inset, y: tile.y + inset, w: tile.w - inset * 2, h: tile.h - inset * 2, angle }
      })
      break
    case 'film': {
      const rows = Math.max(1, Math.min(photos.length, Math.round(Math.sqrt(photos.length * area.h / area.w) * .79)))
      const groups = split(photos.length, rows)
      tiles = placeRows(area, groups, groups.map(() => 1), gap, 0)
      if (variant % 2) tiles = tiles.map(tile => ({ ...tile, x: width - tile.x - tile.w }))
      break
    }
    default:
      tiles = grid(area, photos, gap, 0, variant)
      if (variant % 2) tiles = tiles.map(tile => ({ ...tile, x: width - tile.x - tile.w, y: height - tile.y - tile.h }))
  }
  return { width, height, tiles }
}
