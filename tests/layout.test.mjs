import assert from 'node:assert/strict'
import test from 'node:test'
import { arrange, defaults, dimensions, ratios, templates } from '../src/layout.ts'

const photos = Array.from({ length: 65 }, (_, index) => ({
  aspect: [1.5, .67, 2.7, .45, 1, 1.33, .82, 3.8, .29][index % 9],
}))
const epsilon = 1e-7
for (const count of [1, 2, 4, 5, 7, 9, 12, 20, 65]) {
  test(`${count} 张横竖混合照片在每种模板和比例都完整排布`, () => {
    for (const ratio of ratios) for (const template of templates) for (const variant of [0, 1, 3]) {
      for (const [gap, margin] of [[0, 0], [10, 18], [48, 95]]) {
        const { width, height, tiles } = arrange(photos.slice(0, count), template, { ...defaults, ratio, gap, margin }, variant)
        const context = `${ratio} / ${template} / ${variant} / ${gap} / ${margin}`
        assert.deepEqual(tiles.map(tile => tile.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i), context)
        for (const [i, a] of tiles.entries()) {
          assert.ok(a.w > 0 && a.h > 0, context)
          assert.ok(a.x >= -epsilon && a.y >= -epsilon && a.x + a.w <= width + epsilon && a.y + a.h <= height + epsilon, context)
          for (const b of tiles.slice(i + 1)) {
            const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
            const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
            assert.ok(overlapX <= epsilon || overlapY <= epsilon, context)
          }
        }
      }
    }
  })
}

test('空状态没有画格且高清规格保持方向', () => {
  assert.deepEqual(arrange([], 'magazine', defaults, 0).tiles, [])
  assert.deepEqual(dimensions('16:9', 4096), { width: 4096, height: 2304 })
  assert.deepEqual(dimensions('9:16', 4096), { width: 2304, height: 4096 })
  assert.deepEqual(dimensions('1:1', 2560), { width: 2560, height: 2560 })
})

test('9 张照片的五套模板有独立排布且可重新排版', () => {
  const layouts = templates.map(template => {
    const initial = arrange(photos.slice(0, 9), template, defaults, 0)
    assert.notDeepEqual(initial.tiles, arrange(photos.slice(0, 9), template, defaults, 1).tiles)
    return JSON.stringify(initial.tiles)
  })
  assert.equal(new Set(layouts).size, templates.length)
})
