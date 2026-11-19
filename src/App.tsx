import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, PointerEvent, ReactNode } from 'react'
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownToLine, ArrowUpRight, Check, Crop as CropIcon, Image, Images, ImagePlus, Maximize,
  LockKeyhole, Plus, RotateCcw, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { arrange, defaults, dimensions, ratios } from './layout'
import type { Ratio, Settings, Template, Tile } from './layout'
import { initialCrop, preparePhoto } from './photos'
import type { Crop, Photo } from './photos'
import { exportCollage, imageFrame, renderPreview, sourceCrop } from './render'

const templateInfo: Record<Template, [string, string]> = {
  magazine: ['旅行画报', '主图与旅行细节'],
  grid: ['经典网格', '均衡整齐的方阵'],
  free: ['自由拼贴', '错落的杂志排版'],
  polaroid: ['拍立得', '带相纸边框的回忆'],
  film: ['电影胶片', '带齿孔的电影画格'],
}
const demoNames = ['波西塔诺海岸', '柑橘色沙滩', '三角梅拱门', '柠檬树', '阿马尔菲日落', '海湾小艇', '石径人家', '沿岸航行', '海边小酌']
const swatches = [
  ['暖白', '#fffdf8'], ['白色', '#ffffff'], ['米杏', '#e8dacc'], ['蓝灰', '#dce6ed'], ['墨黑', '#272b32'],
]

function TemplateIcon({ template }: { template: Template }) {
  const shapes: Record<Template, number[][]> = {
    magazine: [[3, 3, 17, 23], [23, 3, 11, 10], [37, 3, 11, 10], [23, 16, 11, 10], [37, 16, 11, 10]],
    grid: [[4, 4, 12, 9], [20, 4, 12, 9], [36, 4, 12, 9], [4, 17, 12, 9], [20, 17, 12, 9], [36, 17, 12, 9]],
    free: [[4, 4, 25, 8], [33, 4, 15, 8], [4, 16, 12, 10], [20, 16, 12, 10], [36, 16, 12, 10]],
    polaroid: [[6, 6, 14, 18, -11], [19, 4, 14, 20, 7], [33, 7, 13, 17, -8]],
    film: [[3, 4, 46, 22], [3, 8, 15, 14], [18, 8, 16, 14], [34, 8, 15, 14]],
  }
  return <svg viewBox="0 0 52 30" aria-hidden="true">
    {template === 'film' && [8, 15, 22, 29, 36, 43].map(x =>
      <path key={x} d={`M${x} 4v4m0 14v4`} />)}
    {shapes[template].map(([x, y, w, h, angle], i) =>
      <rect key={i} x={x} y={y} width={w} height={h} rx="1.55" transform={angle ? `rotate(${angle} ${x + w / 2} ${y + h / 2})` : undefined} />)}
  </svg>
}

function RangeField({ label, value, max, min = 0, unit = 'px', onChange }: {
  label: string; value: number; max: number; min?: number; unit?: string; onChange: (value: number) => void
}) {
  const id = useId()
  return <div className="range-field">
    <label htmlFor={id}>{label}<span className="range-value" aria-hidden="true">{value}<small>{unit}</small></span></label>
    <input id={id} type="range" min={min} max={max} value={value} aria-valuetext={`${value}${unit}`}
      onChange={event => onChange(Number(event.target.value))}
      style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as CSSProperties} />
  </div>
}

function Thumbnail({ photo, index, selected, select, remove }: {
  photo: Photo; index: number; selected: boolean; select: () => void; remove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id })
  return <div className={`thumbnail ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
    ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button className="thumb-image" {...attributes} {...listeners} onClick={select}
      aria-label={`调整第 ${index + 1} 张照片：${photo.name}`} aria-pressed={selected}>
      <img src={photo.preview} alt="" draggable={false} />
      <span>{index + 1}</span>
    </button>
    <button className="thumb-remove" aria-label={`删除第 ${index + 1} 张照片`} onClick={remove}><X size={12} /></button>
  </div>
}

function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-content">
      <div className="flex items-center justify-between gap-4">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={close} disabled={busy}><X size={19} /></button>
      </div>
      {children}
    </div>
  </dialog>
}

type Pan = { id: string; pointerId: number; x: number; y: number; crop: Crop; sx: number; sy: number; angle: number }
type CanvasDrag = { id: string; pointerId: number; button: HTMLButtonElement; x: number; y: number; started: boolean }
type SwapPreview = { id: string; targetId: string | undefined; x: number; y: number }
type ModalName = 'export' | 'clear' | 'preview'
const dragDistance = 6

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [isDemo, setIsDemo] = useState(false)
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [template, setTemplate] = useState<Template>('magazine')
  const [settings, setSettings] = useState(defaults)
  const [variant, setVariant] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalName | null>(null)
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [resolution, setResolution] = useState(4096)
  const [exporting, setExporting] = useState<number | null>(null)
  const [exportError, setExportError] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [swapPreview, setSwapPreview] = useState<SwapPreview | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const largeCanvas = useRef<HTMLCanvasElement>(null)
  const working = useRef(false)
  const dragDepth = useRef(0)
  const pan = useRef<Pan | null>(null)
  const canvasDrag = useRef<CanvasDrag | null>(null)
  const suppressTileClick = useRef(false)
  const selected = photos.find(photo => photo.id === selectedId)
  const movingPhoto = swapPreview && photos.find(photo => photo.id === swapPreview.id)
  const canSwapOnCanvas = photos.length > 1 && !loading
  const layout = useMemo(() => arrange(photos, template, settings, variant), [photos, template, settings, variant])
  const size = dimensions(settings.ratio, resolution)
  const customBackground = !swatches.some(([, color]) => color === settings.background)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: dragDistance } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  async function useDemo() {
    if (working.current) return
    working.current = true
    setLoading({ done: 0, total: demoNames.length })
    const result = await Promise.allSettled(demoNames.map(async (name, index) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}demo/${index + 1}.jpg`)
        if (!response.ok) throw new Error('样片加载失败')
        return await preparePhoto(await response.blob(), name)
      } finally {
        setLoading(current => current && { ...current, done: current.done + 1 })
      }
    }))
    const sample = result.flatMap(item => item.status === 'fulfilled' ? [item.value] : [])
    setPhotos(sample)
    setIsDemo(sample.length > 0)
    if (sample.length !== demoNames.length) setNotice({ text: '部分旅行样片加载失败。你可以上传自己的照片。', error: true })
    setLoading(null)
    working.current = false
  }

  useEffect(() => { void useDemo() }, [])
  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  useLayoutEffect(() => {
    if (canvas.current) renderPreview(canvas.current, layout, photos, template, settings)
    if (largeCanvas.current) renderPreview(largeCanvas.current, layout, photos, template, settings)
  }, [layout, photos, template, settings, modal])

  const clearCanvasDrag = useCallback(() => {
    const drag = canvasDrag.current
    if (!drag) return
    canvasDrag.current = null
    if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId)
    if (drag.started) setSwapPreview(null)
  }, [])

  useLayoutEffect(clearCanvasDrag, [clearCanvasDrag, layout, loading, modal])
  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !canvasDrag.current) return
      suppressTileClick.current = true
      clearCanvasDrag()
    }
    window.addEventListener('keydown', cancelOnEscape)
    window.addEventListener('blur', clearCanvasDrag)
    window.addEventListener('scroll', clearCanvasDrag, true)
    window.addEventListener('resize', clearCanvasDrag)
    return () => {
      window.removeEventListener('keydown', cancelOnEscape)
      window.removeEventListener('blur', clearCanvasDrag)
      window.removeEventListener('scroll', clearCanvasDrag, true)
      window.removeEventListener('resize', clearCanvasDrag)
    }
  }, [clearCanvasDrag])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(previous => ({ ...previous, [key]: value }))
  }

  async function addFiles(files: FileList | File[]) {
    if (!files.length || working.current) return
    const input = Array.from(files)
    const added: Photo[] = []
    const failures: string[] = []
    working.current = true
    setNotice(null)
    setLoading({ done: 0, total: input.length })
    for (const [i, file] of input.entries()) {
      try {
        if (!/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name) &&
          !/^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(file.type)) throw new Error()
        added.push(await preparePhoto(file, file.name))
      } catch {
        failures.push(file.name)
      }
      setLoading({ done: i + 1, total: input.length })
    }
    if (added.length) {
      setPhotos(current => {
        if (!isDemo) return [...current, ...added]
        for (const photo of current) URL.revokeObjectURL(photo.preview)
        return added
      })
      if (isDemo) {
        setSelectedId(null)
        setVariant(0)
      }
      setIsDemo(false)
    }
    const invalid = failures.length > 0
    if (invalid) setNotice({ text: `${failures.length} 张照片无法读取（${failures.slice(0, 2).join('、')}${failures.length > 2 ? '等' : ''}）。请检查文件格式。`, error: true })
    else setNotice({ text: `已添加 ${added.length} 张照片` })
    setLoading(null)
    working.current = false
  }

  function removePhoto(id: string) {
    if (working.current) return
    const photo = photos.find(item => item.id === id)
    if (photo) URL.revokeObjectURL(photo.preview)
    setPhotos(current => current.filter(item => item.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function clearPhotos() {
    if (working.current) return
    for (const photo of photos) URL.revokeObjectURL(photo.preview)
    setPhotos([])
    setIsDemo(false)
    setSelectedId(null)
    setVariant(0)
    setModal(null)
  }

  function reorder(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || working.current) return
    setPhotos(current => {
      const from = current.findIndex(item => item.id === active.id)
      const to = current.findIndex(item => item.id === over.id)
      return from < 0 || to < 0 ? current : arrayMove(current, from, to)
    })
  }

  function changeCrop(id: string, crop: Partial<Crop>) {
    setPhotos(current => current.map(photo => photo.id === id ? { ...photo, crop: { ...photo.crop, ...crop } } : photo))
  }

  function startPan(event: PointerEvent<HTMLButtonElement>, tile: Tile, photo: Photo) {
    if (event.button !== 0 || !canvas.current || selectedId !== photo.id) return
    const frame = imageFrame(tile, template)
    const w = photo.image.width
    const h = photo.image.height
    const source = sourceCrop(w, h, frame, photo.crop)
    const screenScale = canvas.current.getBoundingClientRect().width / layout.width
    const sx = (w - source.w) * frame.w / source.w * screenScale
    const sy = (h - source.h) * frame.h / source.h * screenScale
    pan.current = { id: photo.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      crop: photo.crop, sx, sy, angle: tile.angle ?? 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePan(event: PointerEvent<HTMLButtonElement>) {
    const start = pan.current
    if (!start || start.pointerId !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const clamp = (n: number) => Math.max(0, Math.min(1, n))
    changeCrop(start.id, {
      x: start.sx > 1 ? clamp(start.crop.x - (dx * Math.cos(start.angle) + dy * Math.sin(start.angle)) / start.sx) : start.crop.x,
      y: start.sy > 1 ? clamp(start.crop.y - (dy * Math.cos(start.angle) - dx * Math.sin(start.angle)) / start.sy) : start.crop.y,
    })
  }

  function startTileDrag(event: PointerEvent<HTMLButtonElement>, tile: Tile, photo: Photo) {
    if (!event.isPrimary || event.button !== 0 || pan.current || canvasDrag.current) return
    if (selectedId === photo.id) {
      startPan(event, tile, photo)
      return
    }
    if (event.pointerType !== 'mouse' || !canSwapOnCanvas || working.current) return
    const { currentTarget: button, pointerId, clientX: x, clientY: y } = event
    canvasDrag.current = { id: photo.id, button, pointerId, x, y, started: false }
    button.setPointerCapture(pointerId)
  }

  function swapTarget(event: PointerEvent<HTMLButtonElement>, drag: CanvasDrag) {
    // Pointer capture routes the events to the source, so hit-test the actual mouse position.
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button[data-photo-id]')
    return target && target !== drag.button && target.parentElement === drag.button.parentElement ? target.dataset.photoId : undefined
  }

  function moveTileDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = canvasDrag.current
    if (!drag) {
      movePan(event)
      return
    }
    if (drag.pointerId !== event.pointerId) return
    const { clientX: x, clientY: y } = event
    if (!drag.started && Math.hypot(x - drag.x, y - drag.y) < dragDistance) return
    drag.started = true
    suppressTileClick.current = true
    setSwapPreview({ id: drag.id, targetId: swapTarget(event, drag), x, y })
  }

  function endTileDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    if (pan.current?.pointerId === event.pointerId) pan.current = null
    const drag = canvasDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const targetId = commit && drag.started ? swapTarget(event, drag) : undefined
    clearCanvasDrag()
    if (!targetId || working.current) return
    setPhotos(current => {
      const from = current.findIndex(photo => photo.id === drag.id)
      const to = current.findIndex(photo => photo.id === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      next[from] = current[to]
      next[to] = current[from]
      return next
    })
  }

  async function download() {
    if (exporting !== null || !photos.length) return
    setExportError(false)
    setExporting(0)
    try {
      const blob = await exportCollage(layout, photos, template, settings, size, format, setExporting)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Postcard-${size.width}x${size.height}.${format}`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      setModal(null)
      setNotice({ text: `已下载 ${size.width} × ${size.height} 的 ${format.toUpperCase()} 图片` })
    } catch {
      setExportError(true)
    } finally {
      setExporting(null)
    }
  }

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const pickFiles = () => fileInput.current?.click()
  const closeModal = () => { if (exporting === null) setModal(null) }

  const cropControls = selected && <div className="setting-group group-divider crop-group">
    <div className="flex items-center justify-between gap-2">
      <h3><CropIcon size={15} />调整照片 {photos.indexOf(selected) + 1}</h3>
      <div className="flex gap-1">
        <button className="icon-button" title="重置裁切" aria-label="重置裁切" onClick={() => changeCrop(selected.id, initialCrop(selected.aspect))}><RotateCcw size={14} /></button>
        <button className="subtle-button crop-done" aria-label="完成裁切" onClick={() => setSelectedId(null)}><Check size={15} />完成</button>
      </div>
    </div>
    <RangeField label="缩放" min={100} max={300} unit="%" value={Math.round(selected.crop.zoom * 100)} onChange={value => changeCrop(selected.id, { zoom: value / 100 })} />
    {(['x', 'y'] as const).map(key => <RangeField key={key} label={key === 'x' ? '水平位置' : '垂直位置'} max={100} unit="%"
      value={Math.round(selected.crop[key] * 100)} onChange={value => changeCrop(selected.id, { [key]: value / 100 })} />)}
  </div>

  return <div className="app" onDragEnter={event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (modal || working.current) return
    dragDepth.current++
    setDraggingFiles(true)
  }} onDragOver={event => {
    if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
  }} onDragLeave={event => {
    if (!hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDraggingFiles(false)
  }} onDrop={event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDraggingFiles(false)
    if (!modal) void addFiles(event.dataTransfer.files)
  }}>
    <header className="topbar">
      <div className="top-inner mx-auto flex items-center justify-between gap-3">
        <div className="brand">
          <span className="brand-mark"><Images size={21} strokeWidth={1.6} aria-hidden="true" /></span>
          Postcard
        </div>
        <div className="top-actions flex items-center gap-2.5">
          <button className="button secondary" onClick={pickFiles} disabled={!!loading}><Upload size={16} /><span>上传照片</span></button>
          <button className="button primary" onClick={() => { setExportError(false); setModal('export') }} disabled={!photos.length || !!loading}><ArrowDownToLine size={17} /><span>导出图片</span></button>
        </div>
        <input type="file" hidden multiple ref={fileInput} accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp"
          onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = '' }} />
      </div>
    </header>
    <main className="workspace">
      <div className="editor">
        <section className="preview-column" aria-label="拼图工作区">
          <div className="panel stage">
            <div className="stage-header">
              <div className="stage-title">
                <h1>画布预览</h1>
                {isDemo && <span className="sample-label">阿马尔菲海岸</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <button className="subtle-button" disabled={photos.length < 2 || !!loading} onClick={() => setVariant(n => n + 1)}>
                  <Shuffle size={15} /> <span>重新排版</span>
                </button>
                <button className="icon-button" aria-label="放大预览" title="放大预览" disabled={!photos.length} onClick={() => setModal('preview')}><Maximize size={16} /></button>
              </div>
            </div>
            <div className="stage-board">
              {photos.length ? <div className={`artwork ${canSwapOnCanvas ? 'can-swap' : ''} ${swapPreview ? 'is-swapping' : ''}`}
                style={{ '--aspect': layout.width / layout.height } as CSSProperties}
                onPointerDownCapture={event => { if (event.isPrimary && !canvasDrag.current) suppressTileClick.current = false }}
                onClickCapture={event => {
                  if (event.detail && suppressTileClick.current) {
                    suppressTileClick.current = false
                    event.stopPropagation()
                  }
                }}>
                <canvas ref={canvas} width={layout.width} height={layout.height} aria-label="拼图预览" />
                {layout.tiles.map(tile => {
                  const photo = photos[tile.index]
                  const active = selectedId === photo.id
                  const dropTarget = swapPreview?.targetId === photo.id
                  return <button key={photo.id} data-photo-id={photo.id}
                    className={`tile-target ${active ? 'selected-tile' : ''} ${swapPreview?.id === photo.id ? 'is-swap-source' : ''} ${dropTarget ? 'is-swap-target' : ''}`}
                    aria-label={`裁切第 ${tile.index + 1} 张照片`} aria-pressed={active}
                    style={{ left: `${tile.x / layout.width * 100}%`, top: `${tile.y / layout.height * 100}%`,
                      width: `${tile.w / layout.width * 100}%`, height: `${tile.h / layout.height * 100}%`,
                      transform: tile.angle ? `rotate(${tile.angle}rad)` : undefined }}
                    onClick={() => setSelectedId(photo.id)} onPointerDown={event => startTileDrag(event, tile, photo)}
                    onPointerMove={moveTileDrag} onPointerUp={event => endTileDrag(event, true)}
                    onPointerCancel={event => endTileDrag(event, false)} onLostPointerCapture={event => endTileDrag(event, false)}>
                    {dropTarget && <span className="swap-label" aria-hidden="true">松开交换</span>}
                  </button>
                })}
                {swapPreview && movingPhoto && <img className="swap-ghost" src={movingPhoto.preview} alt="" aria-hidden="true" draggable={false}
                  style={{ left: swapPreview.x, top: swapPreview.y }} />}
              </div> : <div className="empty-state">
                <span className="empty-icon"><ImagePlus size={30} strokeWidth={1.5} /></span>
                <h3>{loading ? '正在准备照片' : '添加你的旅行照片'}</h3>
                {!loading && <>
                  <p>拖入或选择 JPG、PNG、WebP 图片。</p>
                  <button className="button primary" onClick={pickFiles}><Plus size={17} />选择照片</button>
                  <button className="text-button" onClick={() => void useDemo()}>试用旅行样片 <ArrowUpRight size={14} /></button>
                </>}
              </div>}
            </div>
            <div className="stage-footer">
              {loading ? <div className="upload-progress" role="status">
                <progress aria-label="照片处理进度" max={loading.total} value={loading.done} />
                正在处理照片 {loading.done}/{loading.total}
              </div> : <><span>{settings.ratio} <i /> {photos.length} 张照片</span>
              {photos.length > 0 && <span className="crop-hint"><CropIcon className="touch-crop-icon" size={14} aria-hidden="true" />{selected ? '拖动所选照片调整裁切' : <>
                {canSwapOnCanvas && <span className="mouse-swap-hint">拖动换位 · </span>}点击裁切
              </>}</span>}</>}
            </div>
          </div>

          {selected && <div className="panel mobile-crop">{cropControls}</div>}
          <section className="panel photo-panel" aria-label="照片列表" aria-describedby="photo-order-hint">
            <div className="photo-header flex items-center justify-between gap-3">
              <h2>照片 <span>{photos.length}</span></h2>
              {photos.length > 0 && <button className="text-button muted" disabled={!!loading} onClick={() => isDemo ? clearPhotos() : setModal('clear')}><Trash2 className="touch-clear-icon" size={15} aria-hidden="true" />清空</button>}
            </div>
            <p className="sr-only" id="photo-order-hint">拖动缩略图可以调整顺序。</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
              <SortableContext items={photos.map(photo => photo.id)} strategy={rectSortingStrategy}>
                <div className="photo-tray">
                  <button className="add-photo" aria-label="添加照片" disabled={!!loading} onClick={pickFiles}><Plus size={21} className="tray-plus" /><Upload size={15} className="tray-upload" /><span>上传照片</span></button>
                  {photos.map((photo, index) => <Thumbnail key={photo.id} photo={photo} index={index} selected={selectedId === photo.id}
                    select={() => setSelectedId(current => current === photo.id ? null : photo.id)} remove={() => removePhoto(photo.id)} />)}
                </div>
              </SortableContext>
            </DndContext>
          </section>
        </section>

        <aside className="panel templates-panel" aria-label="拼图模板">
          <h2 className="panel-heading">拼图模板</h2>
          <div className="template-list">
            {(['magazine', 'grid', 'free', 'polaroid', 'film'] as const).map(value =>
              <button className={`template-card ${template === value ? 'active' : ''}`} key={value} aria-pressed={value === template}
                onClick={() => { setTemplate(value); setVariant(0) }}>
                <span className="template-icon"><TemplateIcon template={value} /></span>
                <span className="template-text"><strong>{templateInfo[value][0]}</strong><small>{templateInfo[value][1]}</small></span>
                {template === value && <Check className="template-active-icon" size={16} aria-hidden="true" />}
              </button>
            )}
          </div>
        </aside>

        <aside className="panel settings-panel" aria-label="画布设置">
          <h2 className="panel-heading"><Image size={18} aria-hidden="true" />画布设置</h2>
          <div className="setting-group">
            <h3>画布比例</h3>
            <div className="ratio-grid">
              {ratios.map(ratio => <button key={ratio} type="button" className={`ratio-button ${settings.ratio === ratio ? 'active' : ''}`}
                aria-pressed={settings.ratio === ratio} onClick={() => update('ratio', ratio as Ratio)}>
                {ratio}
              </button>)}
            </div>
          </div>
          <div className="setting-group group-divider">
            <h3>边距与圆角</h3>
            <RangeField label="照片间距" value={settings.gap} max={48} onChange={value => update('gap', value)} />
            <RangeField label="画布外边距" value={settings.margin} max={95} onChange={value => update('margin', value)} />
            <RangeField label="照片圆角" value={settings.radius} max={48} onChange={value => update('radius', value)} />
          </div>
          <div className="setting-group group-divider background-group">
            <h3>背景颜色</h3>
            <div className="swatches">
              {swatches.map(([name, color]) => <button type="button" key={color} className={`swatch ${settings.background === color ? 'active' : ''}`}
                aria-label={name} aria-pressed={settings.background === color} title={name} onClick={() => update('background', color)}
                style={{ '--swatch': color } as CSSProperties}>{settings.background === color && <Check size={15} />}</button>)}
              <label className={`color-picker ${customBackground ? 'active' : ''}`} title="自定义背景颜色"
                style={customBackground ? { backgroundColor: settings.background } : undefined}>
                {customBackground ? <Check size={14} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                <input type="color" aria-label="自定义背景颜色" value={settings.background} onChange={event => update('background', event.target.value)} />
              </label>
            </div>
          </div>
          {cropControls}
          <div className="settings-bottom">
            <button className="text-button muted" onClick={() => setSettings(defaults)}><RotateCcw size={14} />重置画布</button>
          </div>
        </aside>
        <footer className="workspace-footer"><LockKeyhole size={14} aria-hidden="true" />在浏览器内处理照片</footer>
      </div>
    </main>

    {draggingFiles && <div className="drop-overlay"><Upload size={35} /><strong>松开以上传照片</strong><span>JPG、PNG、WebP</span></div>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
      {!notice.error && <Check size={16} />}<span>{notice.text}</span>
      <button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button>
    </div>}
    {modal === 'export' && <Modal title="导出拼图" close={closeModal} busy={exporting !== null}>
      <fieldset disabled={exporting !== null}>
        <legend>图片格式</legend>
        <div className="dialog-options">
          {(['png', 'jpg'] as const).map(option => <button key={option} className={format === option ? 'active' : ''}
            aria-pressed={format === option} onClick={() => setFormat(option)}>{option.toUpperCase()}</button>)}
        </div>
      </fieldset>
      <fieldset disabled={exporting !== null}>
        <legend>分辨率</legend>
        <div className="dialog-options">
          {[2560, 4096].map(option => {
            const output = dimensions(settings.ratio, option)
            return <button key={option} className={resolution === option ? 'active' : ''}
              aria-pressed={resolution === option} onClick={() => setResolution(option)}>
              {option === 2560 ? '高清' : '超高清 · 4K'}<small>{output.width} × {output.height}</small>
            </button>
          })}
        </div>
      </fieldset>
      {exporting !== null && <span className="sr-only" role="status">正在导出 {exporting}/{photos.length}</span>}
      {exportError && <p className="dialog-error" role="alert">导出失败。请重试或选择较小的分辨率。</p>}
      <button className="button primary dialog-download" onClick={() => void download()} disabled={exporting !== null}>
        <ArrowDownToLine size={18} />{exporting === null ? '下载图片' : `正在导出 ${exporting}/${photos.length}`}
      </button>
    </Modal>}
    {modal === 'clear' && <Modal title="清空照片？" close={closeModal}>
      <p className="clear-message">清空会移除当前的 {photos.length} 张照片及其裁切调整。</p>
      <div className="flex justify-end gap-2"><button className="button secondary" onClick={closeModal}>取消</button>
        <button className="button danger" onClick={clearPhotos}>清空照片</button></div>
    </Modal>}
    {modal === 'preview' && <Modal title="拼图预览" close={closeModal}>
      <canvas className="large-canvas" ref={largeCanvas} width={layout.width} height={layout.height} aria-label="放大的拼图预览" />
    </Modal>}
  </div>
}
