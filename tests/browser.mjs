import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'

const resultDir = process.env.POSTCARD_TEST_RESULTS ?? 'test-results'
await mkdir(resultDir, { recursive: true })
const browser = await chromium.launch({ channel: process.env.POSTCARD_CHROMIUM_CHANNEL ?? 'chrome' })
const errors = []
const url = process.env.POSTCARD_URL ?? 'http://127.0.0.1:5173/'
const demo = await Promise.all(Array.from({ length: 9 }, (_, i) => readFile(new URL(`../public/demo/${i + 1}.jpg`, import.meta.url))))

function orientJpeg(bytes) {
  // EXIF orientation 6 rotates a stored landscape 90° clockwise.
  const exif = Buffer.from('ffe100224578696600004d4d002a00000008000101120003000000010006000000000000', 'hex')
  return Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)])
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.locator('.tile-target').nth(8).waitFor()
  await page.screenshot({ path: `${resultDir}/desktop.png`, fullPage: true })
  const signature = async () => page.locator('.artwork canvas').evaluate(canvas => {
    const reduced = document.createElement('canvas')
    reduced.width = 80
    reduced.height = 60
    reduced.getContext('2d').drawImage(canvas, 0, 0, reduced.width, reduced.height)
    return reduced.toDataURL()
  })
  const previewButton = page.getByRole('button', { name: '放大预览' })
  await previewButton.click()
  const largePreview = page.getByRole('dialog', { name: '拼图预览' })
  assert.ok(await largePreview.isVisible())
  assert.equal(await largePreview.locator('canvas').evaluate(canvas => canvas.toDataURL()),
    await page.locator('.artwork canvas').evaluate(canvas => canvas.toDataURL()))
  await page.keyboard.press('Escape')
  await largePreview.waitFor({ state: 'detached' })
  assert.equal(await previewButton.evaluate(button => button === document.activeElement), true)

  const variants = ['旅行画报', '经典网格', '自由拼贴', '拍立得', '电影胶片']
  const upload = page.locator('input[type=file]')
  const files = Array.from({ length: 12 }, (_, i) => ({
    name: `trip-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: demo[i % demo.length],
  }))
  files[2] = { name: 'portrait-exif.jpg', mimeType: 'image/jpeg', buffer: orientJpeg(demo[0]) }
  const encoded = await page.evaluate(async () => {
    const list = []
    for (const [uri, type] of [['demo/3.jpg', 'image/png'], ['demo/8.jpg', 'image/webp']]) {
      const image = new Image()
      image.src = uri
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d').drawImage(image, 0, 0)
      list.push(canvas.toDataURL(type).split(',')[1])
    }
    return list
  })
  files[3] = { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(encoded[0], 'base64') }
  files[4] = { name: 'landscape.webp', mimeType: 'image/webp', buffer: Buffer.from(encoded[1], 'base64') }

  for (const count of [4, 5, 7, 9, 12]) {
    const started = performance.now()
    await upload.setInputFiles(files.slice(0, count))
    await page.getByText(`已添加 ${count} 张照片`, { exact: true }).waitFor()
    if (count === 12) await page.getByRole('button', { name: '关闭提示' }).click()
    const uploadedMs = Math.round(performance.now() - started)
    assert.equal(await page.locator('.tile-target').count(), count)
    const portrait = await page.locator('.thumb-image img').nth(2).evaluate(img => img.naturalHeight > img.naturalWidth)
    assert.equal(portrait, true, 'EXIF 6 保持正确的图像方向')
    const results = []
    for (const template of variants) {
      await page.getByRole('button', { name: new RegExp(template) }).click()
      assert.equal(await page.locator('.tile-target').count(), count)
      results.push(await signature())
      if (count === 9) await page.locator('.stage').screenshot({ path: `${resultDir}/template-${results.length}.png` })
    }
    assert.equal(new Set(results).size, 5)
    console.log(`${count} 张照片 · 5 套模板，上传至首个画布 ${uploadedMs} ms`)
    if (count !== 12) {
      await page.getByRole('button', { name: '清空', exact: true }).click()
      await page.getByRole('button', { name: '清空照片', exact: true }).click()
      await page.getByRole('heading', { name: '添加你的旅行照片' }).waitFor()
    }
  }

  await page.getByRole('button', { name: /旅行画报/ }).click()
  const beforeShuffle = await signature()
  await page.getByRole('button', { name: '重新排版' }).click()
  assert.notEqual(await signature(), beforeShuffle)
  const thumbs = page.locator('.thumb-image')
  const tile = number => page.getByRole('button', { name: `裁切第 ${number} 张照片`, exact: true })
  const thumbOrder = () => thumbs.locator('img').evaluateAll(images => images.map(image => image.src))
  const center = async locator => {
    const { x, y, width, height } = await locator.boundingBox()
    return { x: x + width / 2, y: y + height / 2 }
  }
  async function dragOnCanvas(source, target) {
    const start = await center(tile(source))
    const end = typeof target === 'number' ? await center(tile(target)) : target
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
  }

  await page.getByRole('button', { name: /电影胶片/ }).click()
  await tile(9).click()
  const zoom = page.getByRole('slider', { name: /缩放/ })
  await zoom.press('End')
  const originalOrder = await thumbOrder()
  const swappedOrder = [...originalOrder]
  swappedOrder[0] = originalOrder[8]
  swappedOrder[8] = originalOrder[0]
  const beforeSwap = await signature()
  assert.notEqual((await center(tile(1))).y, (await center(tile(9))).y, '跨行拖动画布照片')
  await dragOnCanvas(1, 9)
  const highlighted = await tile(9).evaluate(node => node.classList.contains('is-swap-target'))
  const dropHint = await tile(9).getByText('松开交换', { exact: true }).isVisible()
  const ghostVisible = await page.locator('.swap-ghost').isVisible()
  if (highlighted) await page.screenshot({ path: `${resultDir}/canvas-drag.png` })
  await page.mouse.up()
  assert.deepEqual(await thumbOrder(), swappedOrder, '画布拖动只交换起点和目标照片')
  assert.equal(highlighted, true, '拖动时高亮目标照片')
  assert.equal(dropHint, true, '在目标照片上显示松开提示')
  assert.equal(ghostVisible, true, '拖动时显示源照片缩略图')
  assert.equal(await page.getByText('松开交换', { exact: true }).count(), 0)
  assert.notEqual(await signature(), beforeSwap)
  assert.equal(await tile(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await tile(9).getAttribute('aria-pressed'), 'false')
  assert.equal(await zoom.inputValue(), '300', '裁切设置跟随换位后的照片')
  await page.getByRole('button', { name: '完成裁切' }).click()
  await page.locator('.artwork').screenshot({ path: `${resultDir}/canvas-swap-preview.png` })
  await page.getByRole('button', { name: '导出图片' }).click()
  await verifyDownload('png', 4096, 2731, 'canvas-swap')

  const artwork = await page.locator('.artwork').boundingBox()
  for (const point of [{ x: artwork.x + 1, y: artwork.y + 1 }, { x: artwork.x - 6, y: artwork.y }]) {
    await dragOnCanvas(9, point)
    assert.equal(await page.getByText('松开交换', { exact: true }).count(), 0)
    await page.mouse.up()
    assert.deepEqual(await thumbOrder(), swappedOrder, '松在空隙或画布外取消换位')
    assert.equal(await tile(9).getAttribute('aria-pressed'), 'false')
  }
  await dragOnCanvas(9, 1)
  await tile(1).getByText('松开交换', { exact: true }).waitFor()
  const secondTarget = await center(tile(2))
  await page.mouse.move(secondTarget.x, secondTarget.y)
  await tile(2).getByText('松开交换', { exact: true }).waitFor()
  assert.equal(await page.locator('.is-swap-target').count(), 1, '目标提示只跟随当前命中的照片')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.is-swap-target').count(), 0)
  await page.mouse.up()
  assert.deepEqual(await thumbOrder(), swappedOrder, 'Esc 取消换位')
  assert.equal(await tile(9).getAttribute('aria-pressed'), 'false')
  await tile(9).click()
  assert.equal(await tile(9).getAttribute('aria-pressed'), 'true', '取消后仍可点击照片开始裁切')
  await page.getByRole('button', { name: '完成裁切' }).click()

  await dragOnCanvas(9, 1)
  await tile(1).getByText('松开交换', { exact: true }).waitFor()
  const tray = page.locator('.photo-tray')
  await tray.evaluate(element => {
    element.scrollLeft = element.scrollLeft > 0 ? 0 : 30
  })
  await page.locator('.swap-ghost').waitFor({ state: 'detached' })
  await page.mouse.up()
  assert.deepEqual(await thumbOrder(), swappedOrder, '滚动画布时取消换位')

  await page.getByRole('button', { name: /拍立得/ }).click()
  await dragOnCanvas(9, 1)
  await page.mouse.up()
  assert.deepEqual(await thumbOrder(), originalOrder, '可在拍立得旋转格子之间换位')
  console.log('画布拖动换位、放置提示和取消通过')
  await page.getByRole('button', { name: /旅行画报/ }).click()
  const first = await thumbs.nth(0).locator('img').getAttribute('src')
  await thumbs.nth(0).scrollIntoViewIfNeeded()
  const moving = await thumbs.nth(0).boundingBox()
  const destination = await thumbs.nth(2).boundingBox()
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2)
  await page.mouse.down()
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(src => document.querySelectorAll('.thumb-image img')[2]?.getAttribute('src') === src, first, { timeout: 2500 }).catch(async error => {
    console.log('drag evidence', await page.locator('[role=status]').allTextContents(), await thumbs.evaluateAll(nodes => nodes.slice(0, 4).map(node => node.getAttribute('aria-label'))))
    throw error
  })
  const removeThird = page.getByRole('button', { name: '删除第 3 张照片' })
  await removeThird.hover()
  // Dnd Kit suppresses click events for 50 ms after release to prevent accidental selection.
  await page.waitForFunction(() => [...document.querySelectorAll('.thumb-remove')].some(
    button => button.getAttribute('aria-label') === '删除第 3 张照片' && getComputedStyle(button).opacity === '1',
  ))
  await removeThird.click()
  await thumbs.nth(11).waitFor({ state: 'detached' })
  await upload.setInputFiles([{ name: 'bad.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('broken') }])
  await page.getByRole('alert').getByText(/1 张照片无法读取/).waitFor()
  assert.equal(await thumbs.count(), 11)
  await page.getByRole('button', { name: '关闭提示' }).click()

  const data = await page.evaluateHandle(async () => {
    const data = new DataTransfer()
    const blob = await fetch('demo/5.jpg').then(response => response.blob())
    data.items.add(new File([blob], 'dropped.jpg', { type: 'image/jpeg' }))
    return data
  })
  await page.locator('.stage-board').dispatchEvent('dragenter', { dataTransfer: data })
  await page.getByText('松开以上传照片').waitFor()
  await page.locator('.stage-board').dispatchEvent('drop', { dataTransfer: data })
  await page.getByText('已添加 1 张照片', { exact: true }).waitFor()
  await thumbs.nth(11).waitFor()
  assert.equal(await thumbs.count(), 12)

  await page.getByRole('button', { name: '9:16', exact: true }).click()
  const beforeStyle = await signature()
  await page.getByRole('slider', { name: /照片间距/ }).press('End')
  await page.getByRole('slider', { name: /画布外边距/ }).press('End')
  await page.getByRole('slider', { name: /照片圆角/ }).press('End')
  await page.getByRole('button', { name: '蓝灰', exact: true }).click()
  assert.notEqual(await signature(), beforeStyle)
  await page.getByRole('button', { name: '裁切第 2 张照片', exact: true }).click()
  const beforeCrop = await signature()
  await page.getByRole('slider', { name: /缩放/ }).press('End')
  await page.getByRole('slider', { name: /水平位置/ }).press('Home')
  const beforePan = await signature()
  assert.notEqual(beforePan, beforeCrop)
  const target = await page.getByRole('button', { name: '裁切第 2 张照片', exact: true }).boundingBox()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2 - 30, target.y + target.height / 2 + 25, { steps: 10 })
  await page.mouse.up()
  assert.notEqual(await signature(), beforePan, '直接拖动画布中的照片改变裁切')
  await page.getByRole('button', { name: '完成裁切' }).click()

  async function verifyDownload(format, width, height, name = 'export') {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载图片' }).click()
    const file = await pending
    assert.equal(file.suggestedFilename(), `Postcard-${width}x${height}.${format}`)
    const path = `${resultDir}/${name}.${format}`
    await file.saveAs(path)
    const fileBytes = await readFile(path)
    const comparison = await page.evaluate(async ({ base64, type, sampleSize }) => {
      const original = document.querySelector('.artwork canvas')
      const image = new Image()
      image.src = `data:image/${type};base64,${base64}`
      await image.decode()
      const scale = sampleSize / Math.max(original.width, original.height)
      const width = Math.round(original.width * scale)
      const height = Math.round(original.height * scale)
      const read = source => {
        const canvas = document.createElement('canvas')
        canvas.width = source.naturalWidth
        canvas.height = source.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(source, 0, 0)
        return sample(ctx, canvas.width, canvas.height)
      }
      // Average corresponding source areas to avoid browser-dependent downsampling at different scales.
      function sample(ctx, sourceWidth, sourceHeight) {
        const pixels = ctx.getImageData(0, 0, sourceWidth, sourceHeight).data
        const output = new Float32Array(width * height * 3)
        for (let row = 0; row < height; row++) {
          const y0 = Math.round(row * sourceHeight / height)
          const y1 = Math.round((row + 1) * sourceHeight / height)
          for (let column = 0; column < width; column++) {
            const x0 = Math.round(column * sourceWidth / width)
            const x1 = Math.round((column + 1) * sourceWidth / width)
            const offset = (row * width + column) * 3
            const area = (x1 - x0) * (y1 - y0)
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const pixel = (y * sourceWidth + x) * 4
                for (let channel = 0; channel < 3; channel++) output[offset + channel] += pixels[pixel + channel]
              }
            }
            for (let channel = 0; channel < 3; channel++) output[offset + channel] /= area
          }
        }
        return output
      }
      const actual = read(image)
      const preview = sample(original.getContext('2d'), original.width, original.height)
      const delta = actual.reduce((sum, pixel, index) => sum + Math.abs(pixel - preview[index]), 0)
      return { width: image.naturalWidth, height: image.naturalHeight, averageDelta: delta / actual.length }
    }, {
      base64: fileBytes.toString('base64'), type: format === 'jpg' ? 'jpeg' : 'png',
      // Compare the film photos and crop at a coarse scale, where fine sprocket edges carry less weight.
      sampleSize: name === 'canvas-swap' ? 96 : 400,
    })
    assert.equal(comparison.width, width)
    assert.equal(comparison.height, height)
    assert.ok(comparison.averageDelta < 5, JSON.stringify(comparison))
    console.log(`${format.toUpperCase()} 导出`, comparison)
  }

  await page.getByRole('button', { name: '导出图片' }).click()
  await verifyDownload('png', 2304, 4096)
  await page.getByRole('button', { name: '导出图片' }).click()
  await page.getByRole('button', { name: 'JPG', exact: true }).click()
  await page.getByRole('button', { name: /^高清/ }).click()
  await verifyDownload('jpg', 1440, 2560)

  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await thumbs.count(), 12, '取消清空保留照片')
  const color = page.getByLabel('自定义背景颜色')
  await color.fill('#c0925b')
  assert.equal(await color.inputValue(), '#c0925b')
  assert.equal(await color.locator('..').evaluate(label => label.classList.contains('active')), true)
  await page.getByRole('button', { name: '重置画布' }).click()
  assert.equal(await color.inputValue(), '#fffdf8')
  assert.equal(await page.getByRole('button', { name: '3:2', exact: true }).getAttribute('aria-pressed'), 'true')

  await page.reload()
  await page.locator('.tile-target').nth(8).waitFor()
  const largePhotos = await page.evaluate(async () => {
    const images = []
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    for (let index = 1; index <= 9; index++) {
      const image = new Image()
      image.src = `demo/${index}.jpg`
      await image.decode()
      const scale = 3072 / Math.max(image.naturalWidth, image.naturalHeight)
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      images.push(canvas.toDataURL('image/jpeg', .93).split(',')[1])
    }
    return images
  })
  const nine = largePhotos.map((value, index) => ({
    buffer: Buffer.from(value, 'base64'), name: `amalfi-${index + 1}.jpg`, mimeType: 'image/jpeg',
  }))
  const stressStart = performance.now()
  await upload.setInputFiles(nine)
  await page.getByText('已添加 9 张照片', { exact: true }).waitFor()
  const stressMs = Math.round(performance.now() - stressStart)
  assert.equal(await page.locator('.tile-target').count(), 9)
  console.log(`9 张长边 3072 px JPEG 上传并生成画布：${stressMs} ms`)
  await page.getByRole('button', { name: '导出图片' }).click()
  const nineDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片' }).click()
  const nineFile = await nineDownload
  assert.equal(nineFile.suggestedFilename(), 'Postcard-4096x2731.png')
  await nineFile.saveAs(`${resultDir}/amalfi-9.png`)
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.reload()
  await page.locator('.tile-target').nth(8).waitFor()
  await page.screenshot({ path: `${resultDir}/desktop.png`, fullPage: true })
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(url)
  await mobile.locator('.tile-target').nth(8).waitFor()
  assert.equal(await mobile.locator('.mouse-swap-hint').isVisible(), false)
  await mobile.screenshot({ path: `${resultDir}/mobile.png`, fullPage: true })
  await mobile.getByRole('button', { name: '裁切第 1 张照片', exact: true }).tap()
  await mobile.getByRole('slider', { name: /缩放/ }).waitFor()
  await mobile.screenshot({ path: `${resultDir}/mobile-crop.png`, fullPage: true })
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const mobileThumbs = mobile.locator('.thumb-image')
  await mobileThumbs.nth(0).scrollIntoViewIfNeeded()
  const mobileFirst = await mobileThumbs.nth(0).locator('img').getAttribute('src')
  const startTouch = await mobileThumbs.nth(0).boundingBox()
  const endTouch = await mobileThumbs.nth(1).boundingBox()
  const client = await mobile.context().newCDPSession(mobile)
  const tx = startTouch.x + startTouch.width / 2
  const ty = startTouch.y + startTouch.height / 2
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] })
  await mobile.locator('.thumbnail.is-dragging').waitFor()
  for (let step = 1; step <= 8; step++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: tx + (endTouch.x - startTouch.x) * step / 8, y: ty }],
    })
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await mobile.waitForFunction(src => document.querySelectorAll('.thumb-image img')[1]?.getAttribute('src') === src, mobileFirst)
  console.log('窄屏触控长按排序通过')
  await mobile.setViewportSize({ width: 320, height: 760 })
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.equal(await mobile.locator('.crop-group:visible').count(), 1, '窄屏只显示画布旁的裁切面板')

  const fineDetail = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4096
    canvas.height = 2731
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000'
    for (let x = 0; x < 1024; x += 2) ctx.fillRect(x, 0, 1, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await upload.setInputFiles({ name: '4096-detail.png', mimeType: 'image/png', buffer: Buffer.from(fineDetail, 'base64') })
  await page.getByText('已添加 1 张照片', { exact: true }).waitFor()
  const onlyPhoto = await thumbOrder()
  await dragOnCanvas(1, { x: 5, y: 5 })
  assert.equal(await page.locator('.swap-ghost').count(), 0)
  await page.mouse.up()
  assert.deepEqual(await thumbOrder(), onlyPhoto, '只有一张照片时不启动换位')
  assert.equal(await page.locator('.thumb-image img').first().evaluate(img => img.naturalWidth), 1152)
  await page.getByRole('slider', { name: /画布外边距/ }).press('Home')
  await page.getByRole('slider', { name: /照片圆角/ }).press('Home')
  await page.getByRole('button', { name: '导出图片' }).click()
  const detailDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片' }).click()
  const detailFile = await detailDownload
  await detailFile.saveAs(`${resultDir}/original-detail.png`)
  const detailBytes = await readFile(`${resultDir}/original-detail.png`)
  const detail = await page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 200, 900, 2, 1, 0, 0, 2, 1)
    const pixels = ctx.getImageData(0, 0, 2, 1).data
    return { width: image.naturalWidth, detail: Math.abs(pixels[0] - pixels[4]) }
  }, detailBytes.toString('base64'))
  assert.deepEqual(detail, { width: 4096, detail: 255 })
  console.log('使用原图导出：保留 4096 px 原图内相邻像素的黑白细节')
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
