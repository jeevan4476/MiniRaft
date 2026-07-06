'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWebSocket, type Stroke, type LogEntry } from '../hooks/useWebSocket'
import Toolbar from './Toolbar'


const CANVAS_BG_COLOR = '#fefefe'


export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const strokesRef = useRef<Stroke[]>([])


  const [isDrawing, setIsDrawing] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#3b82f6')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [isEraser, setIsEraser] = useState(false)


  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    ctx.beginPath()
    ctx.moveTo(stroke.x0, stroke.y0)
    ctx.lineTo(stroke.x1, stroke.y1)
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [])

  const redrawAllStrokes = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    ctx.fillStyle = CANVAS_BG_COLOR
    ctx.fillRect(0, 0, width, height)

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke)
    }
  }, [drawStroke])


  const handleHistory = useCallback((entries: LogEntry[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    console.log(`[Canvas] Rendering ${entries.length} historical strokes`)

    for (const entry of entries) {
      strokesRef.current.push(entry.stroke)
      drawStroke(ctx, entry.stroke)
    }
  }, [drawStroke])

  const handleRemoteStroke = useCallback((stroke: Stroke) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    strokesRef.current.push(stroke)
    drawStroke(ctx, stroke)
  }, [drawStroke])

  const { sendStroke, connectionState, reconnect } = useWebSocket({
    onHistory: handleHistory,
    onStroke: handleRemoteStroke,
  })


  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const setupCanvas = () => {
      const dpr = window.devicePixelRatio || 1
      const width = container.clientWidth
      const height = container.clientHeight

      canvas.width = width * dpr
      canvas.height = height * dpr

      ctx.scale(dpr, dpr)

      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      redrawAllStrokes(ctx, width, height)
    }

    setupCanvas()

    const handleResize = () => {
      setupCanvas()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [redrawAllStrokes])


  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    const { nativeEvent } = e
    lastPos.current = { x: nativeEvent.offsetX, y: nativeEvent.offsetY }
  }

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos.current) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { nativeEvent } = e
    const currentX = nativeEvent.offsetX
    const currentY = nativeEvent.offsetY

    const stroke: Stroke = {
      x0: lastPos.current.x,
      y0: lastPos.current.y,
      x1: currentX,
      y1: currentY,
      color: isEraser ? CANVAS_BG_COLOR : selectedColor,
      width: isEraser ? strokeWidth * 2 : strokeWidth,
    }

    drawStroke(ctx, stroke)

    strokesRef.current.push(stroke)

    sendStroke(stroke)

    lastPos.current = { x: currentX, y: currentY }
  }

  const stopDrawing = () => {
    setIsDrawing(false)
    lastPos.current = null
  }

  return (
    <div ref={containerRef} className={`w-full h-full relative ${isEraser ? 'cursor-cell' : 'cursor-crosshair'}`}>
      <Toolbar
        selectedColor={selectedColor}
        onSelectColor={setSelectedColor}
        strokeWidth={strokeWidth}
        onSelectWidth={setStrokeWidth}
        isEraser={isEraser}
        onToggleEraser={setIsEraser}
      />
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div
          className={`w-3 h-3 rounded-full transition-colors ${connectionState === 'connected'
            ? 'bg-green-500'
            : connectionState === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : 'bg-red-500'
            }`}
          title={`Status: ${connectionState}`}
        />
        {connectionState === 'disconnected' && (
          <button
            onClick={reconnect}
            className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded text-neutral-600 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerLeave={stopDrawing}
        className="touch-none absolute inset-0 rounded-2xl shadow-[inset_0_2px_20px_rgba(0,0,0,0.05)] border border-neutral-100"
      />
    </div>
  )
}
