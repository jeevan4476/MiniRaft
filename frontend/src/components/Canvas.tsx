'use client'

import { useEffect, useRef, useState } from 'react'

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Setup high-DPI canvas
    const dpr = window.devicePixelRatio || 1
    canvas.width = container.clientWidth * dpr
    canvas.height = container.clientHeight * dpr

    ctx.scale(dpr, dpr)
    canvas.style.width = `${container.clientWidth}px`
    canvas.style.height = `${container.clientHeight}px`

    // Set background layout color
    ctx.fillStyle = '#fefefe'
    ctx.fillRect(0, 0, container.clientWidth, container.clientHeight)

    const handleResize = () => {
      // In a real app we'd preserve stroke data on resize
      // For now this prevents canvas stretching
      canvas.width = container.clientWidth * dpr
      canvas.height = container.clientHeight * dpr
      ctx.scale(dpr, dpr)
      canvas.style.width = `${container.clientWidth}px`
      canvas.style.height = `${container.clientHeight}px`

      ctx.fillStyle = '#fefefe'
      ctx.fillRect(0, 0, container.clientWidth, container.clientHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(currentX, currentY)
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()


    lastPos.current = { x: currentX, y: currentY }
  }

  const stopDrawing = () => {
    setIsDrawing(false)
    lastPos.current = null
  }

  return (
    <div ref={containerRef} className="w-full h-full relative cursor-crosshair">
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
