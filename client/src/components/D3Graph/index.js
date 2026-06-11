/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as d3 from 'd3'
import { event as currentEvent } from 'd3-selection'
import debounce from 'lodash.debounce'
import React from 'react'

import './D3Graph.scss'

const ARROW_LENGTH = 8
const ARROW_WIDTH = 4

const MIN_NODE_RADIUS = 8
const MAX_NODE_RADIUS = 40
const DEFAULT_NODE_RADIUS = 12
const DOUBLE_CLICK_MS = 250

// Performance thresholds
const PERF = {
  LARGE_GRAPH: 300, // nodes: disable expensive effects
  HUGE_GRAPH: 800, // nodes: aggressive LOD
  MAX_VISIBLE_EDGES: 2000, // max edges to render at once
  MINIMAP_INTERVAL: 8, // only redraw minimap every N frames
  HULL_INTERVAL: 5, // only recompute hulls every N frames
}

const THEME = {
  nodeBorderActive: 3,
  nodeBorderDefault: 1.5,
  edgeWidthActive: 3.0,
  edgeWidthHighlight: 2.0,
  edgeWidthDefault: 1.2,
  edgeAlphaDefault: 0.35,
  edgeAlphaHighlight: 0.9,
  edgeAlphaDimmed: 0.06,
  nodeDimmedAlpha: 0.12,
  labelFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  hullAlpha: 0.07,
  hullStrokeAlpha: 0.25,
  hullPadding: 30,
}

function parseHexColor(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7)
    return { r: 128, g: 128, b: 128 }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function darkenColor(hex, factor = 0.3) {
  const { r, g, b } = parseHexColor(hex)
  return `rgb(${Math.round(r * (1 - factor))},${Math.round(g * (1 - factor))},${Math.round(b * (1 - factor))})`
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHexColor(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const fixedPosForce = () => {
  const self = { nodes: [] }
  const res = function tick() {
    for (let i = 0; i < self.nodes.length; i++) {
      const n = self.nodes[i]
      if (!n._posFixed) continue
      n.x = n._posFixed.x
      n.y = n._posFixed.y
    }
  }
  res.initialize = (nodes) => (self.nodes = nodes)
  res.setNodeCoords = (node, x, y) => {
    node._posFixed = { x, y }
    node.x = x
    node.y = y
  }
  return res
}

// ArangoDB-style cluster force — reuses allocations
const forceCluster = (strength = 0.35) => {
  let nodes = []
  // Reuse these maps across ticks to avoid GC
  const centerX = new Map()
  const centerY = new Map()
  const counts = new Map()

  function force(alpha) {
    // Reset accumulators
    centerX.forEach((_, k) => {
      centerX.set(k, 0)
      centerY.set(k, 0)
      counts.set(k, 0)
    })

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const g = n.group
      if (!g) continue
      if (!counts.has(g)) {
        centerX.set(g, 0)
        centerY.set(g, 0)
        counts.set(g, 0)
      }
      centerX.set(g, centerX.get(g) + n.x)
      centerY.set(g, centerY.get(g) + n.y)
      counts.set(g, counts.get(g) + 1)
    }

    // Normalize to centroids
    counts.forEach((c, g) => {
      if (c > 0) {
        centerX.set(g, centerX.get(g) / c)
        centerY.set(g, centerY.get(g) / c)
      }
    })

    const s = alpha * strength
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (!n.group || n._posFixed) continue
      const cx = centerX.get(n.group)
      const cy = centerY.get(n.group)
      if (cx === undefined) continue
      n.vx += (cx - n.x) * s
      n.vy += (cy - n.y) * s
    }
  }

  force.initialize = (_) => (nodes = _)
  force.strength = (s) => {
    strength = s
    return force
  }
  return force
}

export default class D3Graph extends React.Component {
  width = 100
  height = 100
  outer = React.createRef()
  devicePixelRatio = window.devicePixelRatio || 1

  state = {
    transform: d3.zoomTransform({}),
  }

  document = {
    nodes: new Map(),
    edges: new Map(),
  }

  nodeDegrees = new Map()
  adjacencyMap = new Map()
  groupColors = new Map()
  animationFrameId = null
  lastFrameTime = 0
  frameCount = 0

  // Pre-cached per-node render data (avoids per-frame allocation)
  nodeRenderCache = new Map()

  // Cached hull paths (recomputed every HULL_INTERVAL frames)
  cachedHulls = null

  // Pulse animation state
  pulsingNodes = new Map()

  computeNodeDegrees = () => {
    this.nodeDegrees.clear()
    this.adjacencyMap.clear()

    this.document.nodes.forEach((n) => {
      this.nodeDegrees.set(n.id, 0)
      this.adjacencyMap.set(n.id, new Set())
    })

    this.document.edges.forEach((edge) => {
      const srcId =
        typeof edge.source === 'object' ? edge.source.id : edge.source
      const tgtId =
        typeof edge.target === 'object' ? edge.target.id : edge.target
      this.nodeDegrees.set(srcId, (this.nodeDegrees.get(srcId) || 0) + 1)
      this.nodeDegrees.set(tgtId, (this.nodeDegrees.get(tgtId) || 0) + 1)
      if (this.adjacencyMap.has(srcId)) this.adjacencyMap.get(srcId).add(tgtId)
      if (this.adjacencyMap.has(tgtId)) this.adjacencyMap.get(tgtId).add(srcId)
    })

    this.maxDegree = 1
    this.nodeDegrees.forEach((deg) => {
      if (deg > this.maxDegree) this.maxDegree = deg
    })

    this.groupColors.clear()
    this.document.nodes.forEach((n) => {
      if (n.group && n.color && !this.groupColors.has(n.group)) {
        this.groupColors.set(n.group, n.color)
      }
    })

    // Pre-cache radius and colors per node (avoids recalc every frame)
    this.nodeRenderCache.clear()
    this.document.nodes.forEach((n) => {
      const degree = this.nodeDegrees.get(n.id) || 0
      let radius = DEFAULT_NODE_RADIUS
      if (this.maxDegree > 1) {
        const t = Math.sqrt(degree / this.maxDegree)
        radius = MIN_NODE_RADIUS + t * (MAX_NODE_RADIUS - MIN_NODE_RADIUS)
      }
      const color = n.color || '#848484'
      this.nodeRenderCache.set(n.id, {
        radius,
        degree,
        color,
        colorDark: darkenColor(color, 0.25),
      })
    })

    this.cachedHulls = null // invalidate hull cache
  }

  getNodeRadius = (node) => {
    const cached = this.nodeRenderCache.get(node.id)
    return cached ? cached.radius : DEFAULT_NODE_RADIUS
  }

  isInNeighborhood = (nodeId) => {
    const hoveredNode = this.props.activeNode
    if (!hoveredNode || !this._isHovering) return true
    if (nodeId === hoveredNode.id) return true
    const neighbors = this.adjacencyMap.get(hoveredNode.id)
    return neighbors && neighbors.has(nodeId)
  }

  isEdgeInNeighborhood = (edge) => {
    const hoveredNode = this.props.activeNode
    if (!hoveredNode || !this._isHovering) return true
    const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source
    const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target
    return srcId === hoveredNode.id || tgtId === hoveredNode.id
  }

  getWorldViewport = () => {
    const k = this.state.transform.k
    const tx = this.state.transform.x
    const ty = this.state.transform.y
    return {
      x0: -tx / k,
      y0: -ty / k,
      x1: (this.width - tx) / k,
      y1: (this.height - ty) / k,
    }
  }

  isInViewport = (x, y, pad = 60) => {
    const vp = this._viewport
    if (!vp) return true
    return (
      x >= vp.x0 - pad &&
      x <= vp.x1 + pad &&
      y >= vp.y0 - pad &&
      y <= vp.y1 + pad
    )
  }

  // Hull computation — cached and throttled
  computeHulls = () => {
    const nodeCount = this.document.nodes.size
    if (nodeCount > PERF.HUGE_GRAPH || nodeCount < 4) {
      this.cachedHulls = []
      return
    }

    const byGroup = new Map()
    this.document.nodes.forEach((n) => {
      if (!n.group) return
      if (!byGroup.has(n.group)) byGroup.set(n.group, [])
      byGroup.get(n.group).push([n.x, n.y])
    })

    const hulls = []
    byGroup.forEach((points, group) => {
      if (points.length < 3) return
      const hull = d3.polygonHull(points)
      if (!hull) return
      hulls.push({ hull, color: this.groupColors.get(group) || '#888888' })
    })
    this.cachedHulls = hulls
  }

  drawHulls = (context) => {
    if (!this.cachedHulls || !this.cachedHulls.length) return

    context.save()
    context.lineJoin = 'round'
    context.lineWidth = 1.5

    for (let h = 0; h < this.cachedHulls.length; h++) {
      const { hull, color } = this.cachedHulls[h]
      context.fillStyle = hexToRgba(color, THEME.hullAlpha)
      context.strokeStyle = hexToRgba(color, THEME.hullStrokeAlpha)

      const pad = THEME.hullPadding
      context.beginPath()
      for (let i = 0; i < hull.length; i++) {
        const p0 = hull[(i - 1 + hull.length) % hull.length]
        const p1 = hull[i]
        const p2 = hull[(i + 1) % hull.length]
        const v1x = p1[0] - p0[0],
          v1y = p1[1] - p0[1]
        const v2x = p2[0] - p1[0],
          v2y = p2[1] - p1[1]
        const len1 = Math.hypot(v1x, v1y) || 1
        const len2 = Math.hypot(v2x, v2y) || 1
        const pInX = p1[0] - (v1x / len1) * pad,
          pInY = p1[1] - (v1y / len1) * pad
        const pOutX = p1[0] + (v2x / len2) * pad,
          pOutY = p1[1] + (v2y / len2) * pad
        if (i === 0) context.moveTo(pInX, pInY)
        else context.lineTo(pInX, pInY)
        context.quadraticCurveTo(p1[0], p1[1], pOutX, pOutY)
      }
      context.closePath()
      context.fill()
      context.stroke()
    }
    context.restore()
  }

  // Minimap — throttled, simple rendering
  drawMinimap = () => {
    if (!this.minimapCanvas || !this.document.nodes.size) return
    // Only redraw minimap every N frames
    if (this.frameCount % PERF.MINIMAP_INTERVAL !== 0) return

    const mmw = this.minimapCanvas.width
    const mmh = this.minimapCanvas.height
    const mmctx = this.minimapContext

    mmctx.clearRect(0, 0, mmw, mmh)

    mmctx.fillStyle = 'rgba(20, 22, 30, 0.85)'
    roundRect(mmctx, 0, 0, mmw, mmh, 6)
    mmctx.fill()

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    this.document.nodes.forEach((n) => {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    })

    const pad = 10
    const gw = maxX - minX || 1
    const gh = maxY - minY || 1
    const sx = (mmw - pad * 2) / gw
    const sy = (mmh - pad * 2) / gh
    const s = Math.min(sx, sy)
    const ox = (mmw - s * gw) / 2
    const oy = (mmh - s * gh) / 2

    mmctx.save()
    mmctx.translate(ox - minX * s, oy - minY * s)
    mmctx.scale(s, s)

    // Skip edges in minimap for large graphs
    if (this.document.edges.size < 500) {
      mmctx.strokeStyle = 'rgba(255,255,255,0.1)'
      mmctx.lineWidth = 1 / s
      mmctx.beginPath()
      this.document.edges.forEach((edge) => {
        if (!edge.source.x) return
        mmctx.moveTo(edge.source.x, edge.source.y)
        mmctx.lineTo(edge.target.x, edge.target.y)
      })
      mmctx.stroke()
    }

    // Batch node drawing by color for fewer state changes
    const dotSize = Math.max(1.5, 2 / s)
    mmctx.globalAlpha = 0.8
    // Simple single-pass: just draw all nodes as one color for speed
    mmctx.fillStyle = 'rgba(180,190,200,0.9)'
    mmctx.beginPath()
    this.document.nodes.forEach((n) => {
      mmctx.moveTo(n.x + dotSize, n.y)
      mmctx.arc(n.x, n.y, dotSize, 0, Math.PI * 2)
    })
    mmctx.fill()
    mmctx.globalAlpha = 1

    // Viewport rectangle
    const vp = this.getWorldViewport()
    mmctx.strokeStyle = 'rgba(80,166,255,0.9)'
    mmctx.lineWidth = 2 / s
    mmctx.fillStyle = 'rgba(80,166,255,0.08)'
    mmctx.strokeRect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0)
    mmctx.fillRect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0)

    mmctx.restore()
  }

  labelEdge = (context, edge) => {
    const zoom = this.state.transform.k * this.devicePixelRatio
    if (this.document.edges.size > 200 && zoom < 1.5) return
    if (this.document.edges.size > 40 && zoom < 1.0) return
    if (zoom < 0.6) return

    const srcR = this.getNodeRadius(edge.source)
    const tgtR = this.getNodeRadius(edge.target)
    if (edge.arc.distance < srcR + tgtR + 40) return

    const fontSize = 11
    context.font = `500 ${fontSize}px ${THEME.labelFont}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    const maxWidth = 120
    const bgPadding = 4
    let { width } = context.measureText(edge.label)
    width = Math.min(width, maxWidth)

    const { centerX: cx, centerY: cy } = edge.arc
    const rw = width + 2 * bgPadding
    const rh = fontSize + bgPadding

    context.globalAlpha = 0.88
    context.fillStyle = '#ffffff'
    roundRect(context, cx - rw / 2, cy - rh / 2, rw, rh, 3)
    context.fill()
    context.globalAlpha = 1

    context.fillStyle = '#333333'
    context.fillText(edge.label, cx, cy, maxWidth)
  }

  labelNode = (context, node) => {
    const zoom = this.state.transform.k * this.devicePixelRatio
    const nodeCount = this.document.nodes.size
    const cached = this.nodeRenderCache.get(node.id)
    const degree = cached ? cached.degree : 0
    const radius = cached ? cached.radius : DEFAULT_NODE_RADIUS

    if (nodeCount > 500 && zoom < 2.0 && degree < 3) return
    if (nodeCount > 200 && zoom < 1.2 && degree < 2) return
    if (nodeCount > 50 && zoom < 0.8) return
    if (zoom < 0.4) return
    if (nodeCount > 100 && degree < 2 && zoom < 1.5) return

    const label = node.label || ''
    if (!label) return

    const fontSize = Math.max(10, Math.min(14, radius * 0.9))
    context.font = `600 ${fontSize}px ${THEME.labelFont}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    const maxWidth = radius * 4
    let { width: textWidth } = context.measureText(label)
    textWidth = Math.min(textWidth, maxWidth)

    const bgPadding = 3
    const textY = node.y + radius + fontSize / 2 + 4
    const rw = textWidth + 2 * bgPadding
    const rh = fontSize + bgPadding

    context.globalAlpha = 0.88
    context.fillStyle = '#2A2C34'
    roundRect(context, node.x - rw / 2, textY - rh / 2, rw, rh, rh / 2)
    context.fill()
    context.globalAlpha = 1

    context.fillStyle = '#FFFFFF'
    context.fillText(label, node.x, textY, maxWidth)
  }

  _drawAll = () => {
    const context = this.canvasContext
    if (!context) return

    const { highlightPredicate } = this.props
    this._isHovering = !!this.props.hoveredNode
    this.frameCount++

    context.save()
    const { devicePixelRatio: dpr } = this
    context.clearRect(0, 0, this.width * dpr, this.height * dpr)
    context.translate(
      this.state.transform.x * dpr,
      this.state.transform.y * dpr,
    )
    context.scale(this.state.transform.k * dpr, this.state.transform.k * dpr)

    this._viewport = this.getWorldViewport()

    const zoom = this.state.transform.k * dpr
    const isZoomedOut = zoom < 0.3
    const nodeCount = this.document.nodes.size
    const isLargeGraph = nodeCount > PERF.LARGE_GRAPH
    const isHugeGraph = nodeCount > PERF.HUGE_GRAPH

    // --- Hulls (throttled) ---
    if (!isZoomedOut && !isHugeGraph) {
      if (this.frameCount % PERF.HULL_INTERVAL === 0 || !this.cachedHulls) {
        this.computeHulls()
      }
      this.drawHulls(context)
    }

    // --- Arc helpers (defined once, not per-edge) ---
    const addArrow = (arc, target, vx, vy, nodeRadius) => {
      const baseOffset = nodeRadius + ARROW_LENGTH
      arc.arrowBase0 = target.x - vx * baseOffset
      arc.arrowBase1 = target.y - vy * baseOffset
      arc.arrowEnd0 = target.x - nodeRadius * vx
      arc.arrowEnd1 = target.y - nodeRadius * vy
      arc.arrowPt10 = arc.arrowBase0 + ARROW_WIDTH * vy
      arc.arrowPt11 = arc.arrowBase1 - ARROW_WIDTH * vx
      arc.arrowPt20 = arc.arrowBase0 - ARROW_WIDTH * vy
      arc.arrowPt21 = arc.arrowBase1 + ARROW_WIDTH * vx
      arc.hasArrow = true
    }

    const getArc = (edge) => {
      const dx = edge.target.x - edge.source.x
      const dy = edge.target.y - edge.source.y
      const l = Math.sqrt(dx * dx + dy * dy)

      const srcR = this.getNodeRadius(edge.source)
      const tgtR = this.getNodeRadius(edge.target)

      const arc = {
        radius: -1,
        distance: l,
        centerX: edge.source.x + dx / 2,
        centerY: edge.source.y + dy / 2,
        hasArrow: false,
      }

      if (
        !edge.siblingCount ||
        edge.siblingCount < 2 ||
        (edge.siblingCount % 2 && edge.siblingIndex === 0) ||
        l < srcR + tgtR
      ) {
        if (l > srcR + tgtR + 2 * ARROW_LENGTH) {
          addArrow(arc, edge.target, dx / l, dy / l, tgtR)
        }
        return arc
      }

      const LR = 4
      let offset
      if (edge.siblingCount % 2) {
        offset = LR * (1 + Math.ceil(edge.siblingIndex / 2) * 2)
      } else {
        offset = LR * (1 + Math.floor(edge.siblingIndex / 2) * 2)
      }
      if (edge.siblingCount * LR > (0.9 * l) / 2) {
        offset = (offset * 0.9 * l) / 2 / edge.siblingCount / LR
      }

      const norm0 = edge.siblingIndex % 2 ? dy / l : -dy / l
      const norm1 = edge.siblingIndex % 2 ? -dx / l : dx / l
      const R = (offset * offset + (l * l) / 4) / 2 / offset
      const h2 = (R * offset) / (R - offset)

      arc.radius = R
      arc.centerX = edge.source.x + dx / 2 + norm0 * offset
      arc.centerY = edge.source.y + dy / 2 + norm1 * offset
      arc.controlX = edge.source.x + dx / 2 + norm0 * (offset + h2)
      arc.controlY = edge.source.y + dy / 2 + norm1 * (offset + h2)

      if (l > srcR + tgtR + 2 * ARROW_LENGTH) {
        const rotateDir = edge.siblingIndex % 2 ? +1 : -1
        const alpha = Math.asin(Math.min(1, l / 2 / R))
        const theta = Math.asin(Math.min(1, tgtR / 2 / R))
        const ra = rotateDir * (alpha - theta)
        const cosA = Math.cos(ra),
          sinA = Math.sin(ra)
        const ndx = dx / l,
          ndy = dy / l
        addArrow(
          arc,
          edge.target,
          ndx * cosA - ndy * sinA,
          ndx * sinA + ndy * cosA,
          tgtR,
        )
      }

      return arc
    }

    // --- Edges ---
    context.lineCap = 'round'
    let edgesDrawn = 0
    this.document.edges.forEach((edge) => {
      // Hard cap on visible edges for huge graphs
      if (isHugeGraph && edgesDrawn >= PERF.MAX_VISIBLE_EDGES) return

      // Viewport culling
      if (
        !this.isInViewport(edge.source.x, edge.source.y, 100) &&
        !this.isInViewport(edge.target.x, edge.target.y, 100)
      )
        return

      edgesDrawn++
      const arc = (edge.arc = getArc(edge))

      const isHighlighted = edge.predicate === highlightPredicate
      const isActive = edge === this.props.activeEdge
      const inNeighborhood = this.isEdgeInNeighborhood(edge)

      context.strokeStyle = edge.color
      if (this._isHovering && !inNeighborhood) {
        context.globalAlpha = THEME.edgeAlphaDimmed
        context.lineWidth = 0.5
      } else if (isActive) {
        context.globalAlpha = THEME.edgeAlphaHighlight
        context.lineWidth = THEME.edgeWidthActive
      } else if (isHighlighted || (this._isHovering && inNeighborhood)) {
        context.globalAlpha = THEME.edgeAlphaHighlight
        context.lineWidth = THEME.edgeWidthHighlight
      } else {
        context.globalAlpha = THEME.edgeAlphaDefault
        context.lineWidth = THEME.edgeWidthDefault
      }

      context.beginPath()
      context.moveTo(edge.source.x, edge.source.y)
      if (arc.radius <= 0) {
        context.lineTo(edge.target.x, edge.target.y)
      } else {
        context.arcTo(
          arc.controlX,
          arc.controlY,
          edge.target.x,
          edge.target.y,
          arc.radius,
        )
      }
      context.stroke()

      // Arrowhead — skip for huge graphs when zoomed out
      if (arc.hasArrow && !(isHugeGraph && isZoomedOut)) {
        context.fillStyle = edge.color
        context.beginPath()
        context.moveTo(arc.arrowEnd0, arc.arrowEnd1)
        context.lineTo(arc.arrowPt10, arc.arrowPt11)
        context.lineTo(arc.arrowPt20, arc.arrowPt21)
        context.closePath()
        context.fill()
      }

      context.globalAlpha = 1
      if (!isLargeGraph && (!this._isHovering || inNeighborhood)) {
        this.labelEdge(context, edge)
      }
    })

    // --- Nodes ---
    this.document.nodes.forEach((d) => {
      if (!this.isInViewport(d.x, d.y, 50)) return

      const cached = this.nodeRenderCache.get(d.id)
      const radius = cached ? cached.radius : DEFAULT_NODE_RADIUS
      const color = cached ? cached.color : '#848484'
      const isActive = d === this.props.activeNode
      const inNeighborhood = this.isInNeighborhood(d.id)
      const dimmed = this._isHovering && !inNeighborhood

      if (dimmed) context.globalAlpha = THEME.nodeDimmedAlpha

      // LOD: dots at very low zoom
      if (isZoomedOut) {
        context.fillStyle = color
        context.beginPath()
        context.arc(d.x, d.y, Math.max(2, radius * 0.3), 0, 2 * Math.PI)
        context.fill()
        context.globalAlpha = 1
        return
      }

      // Solid fill
      context.fillStyle = color
      context.beginPath()
      context.arc(d.x, d.y, radius, 0, 2 * Math.PI, true)
      context.fill()

      // Border
      context.strokeStyle = cached ? cached.colorDark : darkenColor(color, 0.25)
      context.lineWidth = isActive
        ? THEME.nodeBorderActive
        : THEME.nodeBorderDefault
      context.stroke()

      // Active glow
      if (isActive && !dimmed) {
        context.strokeStyle = color
        context.globalAlpha = 0.4
        context.lineWidth = 4
        context.beginPath()
        context.arc(d.x, d.y, radius + 4, 0, 2 * Math.PI, true)
        context.stroke()
        context.globalAlpha = dimmed ? THEME.nodeDimmedAlpha : 1
      }

      // Search pulse
      const pulse = this.pulsingNodes.get(d.id)
      if (pulse && pulse > 0) {
        context.strokeStyle = '#50A6FF'
        context.globalAlpha = 0.6 * pulse
        context.lineWidth = 8 * pulse
        context.beginPath()
        context.arc(d.x, d.y, radius + 10 * (1 - pulse), 0, 2 * Math.PI)
        context.stroke()
        context.globalAlpha = 1
      }

      // Expanded dot
      if (d.expanded) {
        context.fillStyle = '#ffffff'
        context.beginPath()
        context.arc(d.x + radius * 0.55, d.y - radius * 0.55, 3, 0, 2 * Math.PI)
        context.fill()
      }

      context.globalAlpha = 1
      if (!dimmed) this.labelNode(context, d)
    })

    context.restore()
    this.drawMinimap()
  }

  startAnimationLoop = () => {
    const animate = (timestamp) => {
      const delta = timestamp - (this.lastFrameTime || timestamp)
      this.lastFrameTime = timestamp

      let hasPulse = false
      this.pulsingNodes.forEach((val, key) => {
        const newVal = val - delta * 0.002
        if (newVal <= 0) this.pulsingNodes.delete(key)
        else {
          this.pulsingNodes.set(key, newVal)
          hasPulse = true
        }
      })

      if (hasPulse) this._drawAll()

      this.animationFrameId = requestAnimationFrame(animate)
    }
    this.animationFrameId = requestAnimationFrame(animate)
  }

  drawGraph = debounce(this._drawAll, 5, { leading: true, trailing: true })

  createForces = () => {
    this.d3simulation
      .alphaTarget(0)
      .alphaMin(0.005)
      .alphaDecay(0.05)
      .velocityDecay(0.5)
      .force(
        'link',
        d3
          .forceLink()
          .distance((d) => {
            const srcDeg =
              this.nodeDegrees.get(
                typeof d.source === 'object' ? d.source.id : d.source,
              ) || 1
            const tgtDeg =
              this.nodeDegrees.get(
                typeof d.target === 'object' ? d.target.id : d.target,
              ) || 1
            const srcG = typeof d.source === 'object' ? d.source.group : null
            const tgtG = typeof d.target === 'object' ? d.target.group : null
            const cross = srcG && tgtG && srcG !== tgtG
            return (cross ? 100 : 60) + Math.sqrt(srcDeg + tgtDeg) * 15
          })
          .strength((d) => {
            const srcG = typeof d.source === 'object' ? d.source.group : null
            const tgtG = typeof d.target === 'object' ? d.target.group : null
            return srcG === tgtG ? 0.4 : 0.15
          })
          .id((d) => d.id),
      )
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength((d) => {
            const degree = this.nodeDegrees.get(d.id) || 0
            return -200 - degree * 30
          })
          .distanceMax(500)
          .theta(0.9),
      )
      .force(
        'collision',
        d3
          .forceCollide()
          .radius((d) => this.getNodeRadius(d) + 8)
          .strength(0.8),
      )
      .force('cluster', forceCluster(0.35))
      .force('fixedPosForce', fixedPosForce())

    this.fixedPosForce = this.d3simulation.force('fixedPosForce')
    this.edgesForce = this.d3simulation.force('link')
  }

  componentDidMount() {
    this.d3simulation = d3.forceSimulation().on('tick', this.drawGraph)
    this.createForces()

    this.graphCanvas = d3
      .select(this.outer.current)
      .append('canvas')
      .attr('width', this.width)
      .attr('height', this.height)
      .node()

    this.minimapCanvas = document.createElement('canvas')
    this.minimapCanvas.className = 'graph-minimap'
    this.minimapCanvas.width = 180
    this.minimapCanvas.height = 120
    this.outer.current.appendChild(this.minimapCanvas)
    this.minimapContext = this.minimapCanvas.getContext('2d')
    this.minimapCanvas.addEventListener('click', this.onMinimapClick)

    this.zoomBehavior = d3
      .zoom()
      .scaleExtent([(1 / 8) * this.devicePixelRatio, 6 * this.devicePixelRatio])
      .on('zoom', this.onZoom)

    d3.select(this.graphCanvas)
      .on('click', this.onClick)
      .on('dblclick', this.onDoubleClick)
      .on('mousemove', this.onMouseMove)
      .call(
        d3
          .drag()
          .subject(this.dragsubject)
          .on('start', this.dragstarted)
          .on('drag', this.dragged),
      )
      .call(this.zoomBehavior)

    this.onResize()
    this.updateDocument(this.props.nodes, this.props.edges)
    this.startAnimationLoop()
    this.resizeObserver = window.setInterval(this.onResize, 1000)
  }

  componentWillUnmount() {
    clearInterval(this.resizeObserver)
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId)
    if (this.minimapCanvas)
      this.minimapCanvas.removeEventListener('click', this.onMinimapClick)
  }

  onMinimapClick = (e) => {
    if (!this.document.nodes.size) return
    const rect = this.minimapCanvas.getBoundingClientRect()
    const px = e.clientX - rect.left,
      py = e.clientY - rect.top
    const mmw = this.minimapCanvas.width,
      mmh = this.minimapCanvas.height

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    this.document.nodes.forEach((n) => {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    })

    const pad = 10,
      gw = maxX - minX || 1,
      gh = maxY - minY || 1
    const s = Math.min((mmw - pad * 2) / gw, (mmh - pad * 2) / gh)
    const ox = (mmw - s * gw) / 2,
      oy = (mmh - s * gh) / 2
    const wx = (px - ox + minX * s) / s,
      wy = (py - oy + minY * s) / s

    const k = this.state.transform.k
    d3.select(this.graphCanvas)
      .transition()
      .duration(300)
      .call(
        this.zoomBehavior.transform,
        d3.zoomIdentity
          .translate(this.width / 2 - wx * k, this.height / 2 - wy * k)
          .scale(k),
      )
  }

  getD3EventCoords = (event) => this.state.transform.invert([event.x, event.y])

  findNodeAtPos = (x, y) => {
    let minNode,
      minD = 1e10
    this.document.nodes.forEach((n) => {
      const r = this.getNodeRadius(n)
      const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y)
      if (d < r * r && d < minD) {
        minNode = n
        minD = d
      }
    })
    return minNode
  }

  findEdgeAtPos = (x, y) => {
    let minEdge,
      minD = 1e10
    this.document.edges.forEach((edge) => {
      if (!edge.arc) return
      const { centerX: cx, centerY: cy } = edge.arc
      const d = (cx - x) * (cx - x) + (cy - y) * (cy - y)
      if (d < minD) {
        minEdge = edge
        minD = d
      }
    })
    return minD > 225 ? undefined : minEdge
  }

  onMouseMove = () => {
    const { offsetX: x, offsetY: y } = currentEvent
    const pt = this.getD3EventCoords({ x, y })
    const node = this.findNodeAtPos(...pt)
    this.props.onNodeHovered(node)
    if (this.graphCanvas)
      this.graphCanvas.style.cursor = node ? 'pointer' : 'default'
    if (!node) this.props.onEdgeHovered(this.findEdgeAtPos(...pt))
    this.drawGraph()
  }

  onClick = () => {
    const { offsetX: x, offsetY: y } = currentEvent
    const pt = this.getD3EventCoords({ x, y })
    const node = this.findNodeAtPos(...pt)
    if (node) {
      currentEvent.stopImmediatePropagation()
      return this.props.onNodeSelected(node)
    }
    const edge = this.findEdgeAtPos(...pt)
    if (edge) {
      currentEvent.stopImmediatePropagation()
      return this.props.onEdgeSelected(edge)
    }
  }

  onDoubleClick = () => {
    const { offsetX: x, offsetY: y } = currentEvent
    const pt = this.getD3EventCoords({ x, y })
    const node = this.findNodeAtPos(...pt)
    if (node) {
      currentEvent.stopImmediatePropagation()
      return this.props.onNodeDoubleClicked(node)
    }
  }

  dragsubject = () => {
    const { offsetX: x, offsetY: y } = currentEvent.sourceEvent
    const pt = this.getD3EventCoords({ x, y })
    const node = this.findNodeAtPos(...pt)
    this.props.onNodeSelected(node)
    return node
  }

  dragstarted = () => {
    if (!currentEvent.active)
      setTimeout(() => this.d3simulation.alpha(0.5).restart(), DOUBLE_CLICK_MS)
  }

  dragged = () => {
    const { offsetX: x, offsetY: y } = currentEvent.sourceEvent
    const pt = this.getD3EventCoords({ x, y })
    this.fixedPosForce.setNodeCoords(currentEvent.subject, ...pt)
    this.drawGraph()
    this.d3simulation.alpha(Math.max(0.12, this.d3simulation.alpha()))
  }

  _updateZoom = (transform) => {
    if (this.state.transform.toString() !== transform.toString())
      this.setState({ transform })
  }
  updateZoom = debounce(this._updateZoom, 2, { leading: true, trailing: true })
  onZoom = () => this.updateZoom(currentEvent.transform)

  zoomToFit = () => {
    if (!this.graphCanvas || !this.document.nodes.size) return
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    this.document.nodes.forEach((n) => {
      const r = this.getNodeRadius(n) + 20
      if (n.x - r < minX) minX = n.x - r
      if (n.y - r < minY) minY = n.y - r
      if (n.x + r > maxX) maxX = n.x + r
      if (n.y + r > maxY) maxY = n.y + r
    })
    const p = 40,
      gw = maxX - minX + p * 2,
      gh = maxY - minY + p * 2
    const scale = Math.min(this.width / gw, this.height / gh, 2) * 0.9
    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
    d3.select(this.graphCanvas)
      .transition()
      .duration(500)
      .call(this.zoomBehavior.transform, transform)
  }

  focusNode = (node) => {
    if (!this.graphCanvas || !node) return
    const k = 2.2
    d3.select(this.graphCanvas)
      .transition()
      .duration(500)
      .ease(d3.easeCubicOut)
      .call(
        this.zoomBehavior.transform,
        d3.zoomIdentity
          .translate(this.width / 2 - node.x * k, this.height / 2 - node.y * k)
          .scale(k),
      )
    this.pulsingNodes.set(node.id, 1.0)
  }

  searchNode = (query) => {
    if (!query) return null
    const q = query.toLowerCase().trim()
    let found = null
    this.document.nodes.forEach((n) => {
      if (found) return
      const name = (n.name || n.label || '').toLowerCase()
      const uid = (n.uid || n.id || '').toLowerCase()
      if (name.includes(q) || uid === q) found = n
    })
    return found
  }

  onResize = () => {
    let resized = false
    if (this.outer.current) {
      const el = this.outer.current
      resized |= this.width !== el.offsetWidth
      resized |= this.height !== el.offsetHeight
      this.width = el.offsetWidth
      this.height = el.offsetHeight
    }
    if (!resized) return

    this.zoomBehavior.scaleTo(d3.select(this.graphCanvas), 1)
    this.zoomBehavior.translateTo(d3.select(this.graphCanvas), 0, 0)

    const { width, height } = this
    this.d3simulation
      .force('x', d3.forceX(0).strength((0.02 * height) / width))
      .force('y', d3.forceY(0).strength((0.02 * width) / height))

    d3.select(this.graphCanvas)
      .attr('width', this.width * this.devicePixelRatio)
      .attr('height', this.height * this.devicePixelRatio)

    this.canvasContext = this.graphCanvas.getContext('2d')
    this._drawAll()
  }

  updateDocument = (nodes, edges) => {
    if (!this.d3simulation || !nodes || !edges) return

    const newNodesReceived =
      this.document.nodesLength !== nodes.size ||
      this.document.edgesLength !== edges.size

    this.document = {
      edges,
      edgesLength: edges.size,
      nodes,
      nodesLength: nodes.size,
    }
    this.computeNodeDegrees()

    if (newNodesReceived) {
      this.d3simulation
        .force(
          'link',
          d3
            .forceLink()
            .distance((d) => {
              const srcDeg =
                this.nodeDegrees.get(
                  typeof d.source === 'object' ? d.source.id : d.source,
                ) || 1
              const tgtDeg =
                this.nodeDegrees.get(
                  typeof d.target === 'object' ? d.target.id : d.target,
                ) || 1
              const srcG = typeof d.source === 'object' ? d.source.group : null
              const tgtG = typeof d.target === 'object' ? d.target.group : null
              return (
                (srcG && tgtG && srcG !== tgtG ? 100 : 60) +
                Math.sqrt(srcDeg + tgtDeg) * 15
              )
            })
            .strength((d) => {
              const srcG = typeof d.source === 'object' ? d.source.group : null
              const tgtG = typeof d.target === 'object' ? d.target.group : null
              return srcG === tgtG ? 0.4 : 0.15
            })
            .id((d) => d.id),
        )
        .force(
          'charge',
          d3
            .forceManyBody()
            .strength((d) => -200 - (this.nodeDegrees.get(d.id) || 0) * 30)
            .distanceMax(500)
            .theta(0.9),
        )
        .force(
          'collision',
          d3
            .forceCollide()
            .radius((d) => this.getNodeRadius(d) + 8)
            .strength(0.8),
        )
        .force('cluster', forceCluster(0.35))

      this.edgesForce = this.d3simulation.force('link')
      this.d3simulation.alpha(0.5).restart()
    }

    this.d3simulation.nodes(Array.from(nodes.values()))
    this.edgesForce.links(Array.from(edges.values()))
  }

  render() {
    this.updateDocument(this.props.nodes, this.props.edges)
    this.onResize()
    this.drawGraph()
    return <div ref={this.outer} className='graph-outer' />
  }
}
