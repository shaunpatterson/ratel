/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { circlepack, circular, random as randomLayout } from 'graphology-layout'
import FA2Layout from 'graphology-layout-forceatlas2/worker'
import React from 'react'
import Sigma from 'sigma'
import {
  extremityArrow,
  layerFill,
  pathCurved,
  pathLine,
  sdfCircle,
  sdfDiamond,
  sdfSquare,
  sdfTriangle,
} from 'sigma/rendering'

import { filterActive, nodeMatchesFilter } from '../../lib/graphFilter'
import { communityColor, metricNodeSize } from '../../lib/graphMetrics'
import { findPath } from '../../lib/graphPath'

import { NODE_MAX_SIZE, NODE_SIZE, buildGraph } from './buildGraph'

import './SigmaGraph.scss'

const LAYOUT_MS = 4000
const DIM_COLOR = '#e4e4e4'

// WebGL renderer for query results, replacing the d3-force canvas renderer.
// Same contract as the old D3Graph component: nodes/edges are the live Maps
// from GraphParser, callbacks receive the original node/edge objects.
export default class SigmaGraph extends React.Component {
  containerRef = React.createRef()

  componentDidMount() {
    this.graph = buildGraph(this.props.nodes, this.props.edges)
    this.recomputeFilter()

    this.renderer = new Sigma(this.graph, this.containerRef.current, {
      primitives: {
        nodes: {
          // All four built-in shapes are compiled into one program. The
          // per-node shape is selected by the styles/rules below, so a
          // single dataset can mix circles, squares, triangles, and
          // diamonds without swapping renderers.
          shapes: [sdfCircle(), sdfSquare(), sdfTriangle(), sdfDiamond()],
          layers: [layerFill()],
        },
        edges: {
          paths: [pathLine(), pathCurved()],
          extremities: [extremityArrow()],
        },
      },
      settings: {
        autoRescale: 'once',
        enableEdgeEvents: true,
        enableNodeDrag: true,
        renderEdgeLabels: true,
        labelDensity: 0.8,
        labelGridCellSize: 80,
        labelRenderedSizeThreshold: 5,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
      },
      nodeReducer: this.nodeReducer,
      edgeReducer: this.edgeReducer,
    })

    this.bindEvents()
    this.startLayout()

    this.datasetSignature = this.signature(this.props)
  }

  componentDidUpdate(prevProps) {
    const signature = this.signature(this.props)
    if (signature !== this.datasetSignature) {
      this.datasetSignature = signature
      this.syncGraph()
    } else if (prevProps.layout !== this.props.layout) {
      this.applyLayout()
    } else {
      // Only selection/highlight/style/filter props changed.
      if (prevProps.filter !== this.props.filter) {
        this.recomputeFilter()
      }
      this.renderer.refresh({ skipIndexation: true })
    }
  }

  componentWillUnmount() {
    this.stopLayout()
    if (this.renderer) {
      this.renderer.kill()
    }
  }

  signature = (props) =>
    [
      props.nodes ? props.nodes.size : 0,
      props.edges ? props.edges.size : 0,
      props.graphUpdateHack,
    ].join('/')

  // --- public API used via ref by GraphContainer -----------------------

  zoomToFit = () => {
    if (this.renderer) {
      this.renderer.getCamera().animatedReset({ duration: 500 })
    }
  }

  focusNode = (node) => {
    if (!this.renderer || !node) {
      return
    }
    const uid = node.id || node.uid
    if (!this.graph.hasNode(uid)) {
      return
    }
    const { x, y } = this.renderer.getNodeDisplayData(uid)
    this.renderer.getCamera().animate({ x, y, ratio: 0.35 }, { duration: 500 })
  }

  findPathBetween = (source, target) => findPath(this.graph, source, target)

  // Substring + simple subsequence scoring for the search dropdown.
  // Returns nodes whose label or uid contains the query (case-insensitive)
  // ranked by how tight the match is: exact > startsWith > includes >
  // subsequence-of-chars. We cap the list to keep the dropdown snappy.
  searchNodes = (query, limit = 12) => {
    if (!query || !this.props.nodes) {
      return []
    }
    const q = query.toLowerCase().trim()
    if (!q) {
      return []
    }
    const scored = []
    this.props.nodes.forEach((n) => {
      const label = (n.label || n.name || '').toLowerCase()
      const uid = (n.uid || n.id || '').toLowerCase()
      const score = scoreMatch(q, label, uid)
      if (score > 0) {
        scored.push({ node: n, score })
      }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.node)
  }

  searchNode = (query) => {
    if (!query || !this.props.nodes) {
      return null
    }
    const q = query.toLowerCase().trim()
    let found = null
    this.props.nodes.forEach((n) => {
      if (found) {
        return
      }
      const name = (n.name || n.label || '').toLowerCase()
      const uid = (n.uid || n.id || '').toLowerCase()
      if (name.includes(q) || uid === q) {
        found = n
      }
    })
    return found
  }

  syncGraph = () => {
    // Carry positions over so expanding/collapsing doesn't reshuffle nodes
    // the user already arranged.
    const prevPositions = new Map()
    this.graph.forEachNode((uid, attrs) =>
      prevPositions.set(uid, { x: attrs.x, y: attrs.y }),
    )

    const next = buildGraph(this.props.nodes, this.props.edges, prevPositions)
    this.graph.clear()
    this.graph.import(next)
    this.recomputeFilter()
    this.applyLayout()
  }

  // Set of node ids hidden by the active attribute/degree filter. Recomputed
  // whenever the filter spec or the dataset changes, so the per-element
  // reducers stay cheap membership tests.
  filterHidden = new Set()

  recomputeFilter = () => {
    const { filter } = this.props
    const hidden = new Set()
    if (filterActive(filter)) {
      this.graph.forEachNode((uid, attrs) => {
        const matches = nodeMatchesFilter(
          attrs.originalNode,
          this.graph.degree(uid),
          filter,
        )
        if (!matches) {
          hidden.add(uid)
        }
      })
    }
    this.filterHidden = hidden
  }

  applyLayout = () => {
    const layout = this.props.layout || 'force'
    this.stopLayout()
    if (layout === 'circular') {
      circular.assign(this.graph, { scale: 100 })
      this.renderer.refresh()
      this.zoomToFit()
    } else if (layout === 'circlepack') {
      circlepack.assign(this.graph, { hierarchyAttributes: ['group'] })
      this.renderer.refresh()
      this.zoomToFit()
    } else if (layout === 'random') {
      randomLayout.assign(this.graph, { scale: 100 })
      this.renderer.refresh()
      this.zoomToFit()
    } else {
      this.startLayout()
    }
  }

  startLayout = () => {
    this.stopLayout()
    if (this.graph.order < 2) {
      return
    }

    this.layout = new FA2Layout(this.graph, {
      settings: {
        gravity: 1,
        scalingRatio: 12,
        slowDown: 5,
        strongGravityMode: true,
        edgeWeightInfluence: 0,
      },
    })
    this.layout.start()
    this.layoutTimer = window.setTimeout(this.stopLayout, LAYOUT_MS)
  }

  stopLayout = () => {
    if (this.layoutTimer) {
      window.clearTimeout(this.layoutTimer)
      this.layoutTimer = null
    }
    if (this.layout) {
      this.layout.kill()
      this.layout = null
    }
  }

  // --- highlighting ---------------------------------------------------

  hoveredNode = null

  // Hidden by an explicit Hide verb, as opposed to by predicate or filter.
  // Kept as a scene layer over the live GraphParser Maps: expansion merges new
  // nodes into those Maps in place, so anything that hid a node by editing the
  // dataset would be quietly undone on the next merge.
  isNodeHidden = (uid) => {
    const { hiddenIds } = this.props
    return !!hiddenIds && hiddenIds.has(uid)
  }

  isHidden = (group) => {
    const { hiddenPredicates } = this.props
    return !!hiddenPredicates && hiddenPredicates.has(group)
  }

  // Timeline filter: a node is hidden once the scrubber sits before its time.
  // Untimed nodes (time == null) always stay, as structural context.
  isAfterCutoff = (time) => {
    const { timeCutoff } = this.props
    return timeCutoff != null && time != null && time > timeCutoff
  }

  // v4 still accepts nodeReducer / edgeReducer as escape hatches for
  // dynamic styling that the declarative styles API can't express yet.
  // We keep the same logic so behaviour stays identical to the v3
  // version, only the primitives + settings block above changes.
  // Signature is `(key, data, attrs, state, graphState, graph)`; `attrs`
  // are the raw graph attributes added in buildGraph, `data` is the
  // computed display data we mutate.
  nodeReducer = (uid, _data, attrs) => {
    const {
      activeNode,
      styleRules,
      colorBy,
      sizeBy,
      pathNodes,
      defaultLabelPosition,
    } = this.props
    const res = {}
    const group = attrs.originalNode && attrs.originalNode.group

    if (
      this.isHidden(group) ||
      this.isNodeHidden(uid) ||
      this.filterHidden.has(uid) ||
      this.isAfterCutoff(attrs._time)
    ) {
      res.hidden = true
      return res
    }

    // Metric-driven color/size modes. Defaults (group color, degree size)
    // leave rendering identical to buildGraph's output.
    if (colorBy === 'community') {
      res.color = communityColor(attrs.community)
    }
    if (sizeBy && sizeBy !== 'degree') {
      res.size = metricNodeSize(sizeBy, attrs, NODE_SIZE, NODE_MAX_SIZE)
    }

    // Explicit per-group style rules win over metric modes. Shape and
    // labelPosition ride on the same per-group rule so a single panel
    // can pick all of a group's visual properties in one place. The
    // global `defaultLabelPosition` prop applies when a group has no
    // rule of its own (e.g. when the user switches the active preset
    // to one that sets a different default).
    const rule = styleRules && styleRules[group]
    if (rule) {
      if (rule.color) {
        res.color = rule.color
      }
      if (rule.size) {
        res.size = rule.size
      }
      if (rule.shape) {
        res.shape = rule.shape
      }
      if (rule.labelPosition) {
        res.labelPosition = rule.labelPosition
      }
    } else if (defaultLabelPosition) {
      res.labelPosition = defaultLabelPosition
    }

    if (activeNode && attrs.originalNode === activeNode) {
      res.highlighted = true
    }

    // A computed path dominates hover/selection dimming so the route stays
    // legible while the rest of the graph fades back.
    if (pathNodes && pathNodes.size) {
      if (pathNodes.has(uid)) {
        res.highlighted = true
        res.zIndex = 1
      } else {
        res.color = DIM_COLOR
        res.label = null
      }
      return res
    }

    if (this.hoveredNode && uid !== this.hoveredNode) {
      if (!this.graph.areNeighbors(uid, this.hoveredNode)) {
        res.color = DIM_COLOR
        res.label = null
      }
    }
    return res
  }

  edgeReducer = (key, _data, attrs) => {
    const { activeEdge, highlightPredicate, styleRules, pathEdges } = this.props
    const res = {}
    const edge = attrs.originalEdge

    if (this.isHidden(edge.predicate)) {
      res.hidden = true
      return res
    }

    const { hiddenIds } = this.props

    if (
      (hiddenIds && hiddenIds.size) ||
      this.filterHidden.size ||
      this.props.timeCutoff != null
    ) {
      const [source, target] = this.graph.extremities(key)
      // An edge whose endpoint is hidden must go too, or Hide leaves edges
      // dangling into empty space where the node used to be.
      const endpointHidden =
        this.isNodeHidden(source) ||
        this.isNodeHidden(target) ||
        this.filterHidden.has(source) ||
        this.filterHidden.has(target) ||
        this.isAfterCutoff(this.graph.getNodeAttribute(source, '_time')) ||
        this.isAfterCutoff(this.graph.getNodeAttribute(target, '_time'))
      if (endpointHidden) {
        res.hidden = true
        return res
      }
    }

    const rule = styleRules && styleRules[edge.predicate]
    if (rule && rule.color) {
      res.color = rule.color
    }

    if (highlightPredicate && edge.predicate === highlightPredicate) {
      res.size = attrs.size * 2
    }
    if (activeEdge && edge === activeEdge) {
      res.size = attrs.size * 2.5
      res.zIndex = 1
    }

    if (pathEdges && pathEdges.size) {
      if (pathEdges.has(key)) {
        res.size = attrs.size * 2.5
        res.zIndex = 1
      } else {
        res.color = DIM_COLOR
        res.label = null
      }
      return res
    }

    if (this.hoveredNode) {
      const [source, target] = this.graph.extremities(key)
      if (source !== this.hoveredNode && target !== this.hoveredNode) {
        res.color = DIM_COLOR
        res.label = null
      }
    }
    return res
  }

  // --- events ----------------------------------------------------------

  bindEvents = () => {
    const renderer = this.renderer

    renderer.on('enterNode', ({ node }) => {
      this.hoveredNode = node
      this.props.onNodeHovered(this.originalNode(node))
      renderer.refresh({ skipIndexation: true })
    })
    renderer.on('leaveNode', () => {
      this.hoveredNode = null
      this.props.onNodeHovered(null)
      renderer.refresh({ skipIndexation: true })
    })
    // The DOM event rides along on `event.original`, which is the only place
    // the modifier keys survive; GraphContainer needs shiftKey to decide
    // between replacing the selection and adding to it.
    renderer.on('clickNode', ({ node, event }) =>
      this.props.onNodeSelected(this.originalNode(node), {
        shiftKey: !!(event && event.original && event.original.shiftKey),
      }),
    )
    renderer.on('doubleClickNode', (e) => {
      e.preventSigmaDefault()
      this.props.onNodeDoubleClicked(this.originalNode(e.node))
    })

    renderer.on('enterEdge', ({ edge }) =>
      this.props.onEdgeHovered(this.originalEdge(edge)),
    )
    renderer.on('leaveEdge', () => this.props.onEdgeHovered(null))
    renderer.on('clickEdge', ({ edge }) =>
      this.props.onEdgeSelected(this.originalEdge(edge)),
    )

    renderer.on('clickStage', () => this.props.onNodeSelected(null))

    // Right-click rides the same hit-resolution path as clickNode, so this is
    // just a binding -- sigma already emits the events.
    //
    // The preventDefault is load-bearing: sigma's own handleRightClick only
    // preventDefaults when enableCameraMouseRotation is set (it isn't), so
    // without this the browser's native context menu opens over the canvas and
    // ours is never seen. Screen coords come off the event so the menu can be
    // positioned where the pointer actually is.
    renderer.on('rightClickNode', ({ node, event }) => {
      event.original.preventDefault()
      if (this.props.onNodeContextMenu) {
        this.props.onNodeContextMenu(this.originalNode(node), {
          x: event.x,
          y: event.y,
        })
      }
    })
    renderer.on('rightClickStage', ({ event }) => {
      event.original.preventDefault()
      if (this.props.onStageContextMenu) {
        this.props.onStageContextMenu()
      }
    })

    // v4 ships with built-in node dragging via `enableNodeDrag: true`;
    // it handles coordinate conversion, camera panning suppression, and
    // the `isDragged` node state flag. We still expose a flag for any
    // future styling hooks (e.g. cursor management).
    renderer.on('nodeDragStart', () => {
      this.isDragging = true
    })
    renderer.on('nodeDragEnd', () => {
      this.isDragging = false
    })
  }

  originalNode = (uid) => this.graph.getNodeAttribute(uid, 'originalNode')
  originalEdge = (key) => this.graph.getEdgeAttribute(key, 'originalEdge')

  render() {
    const { containerStyle } = this.props
    return (
      <div
        ref={this.containerRef}
        className='sigma-graph-outer'
        style={containerStyle}
      />
    )
  }
}

// Substring scoring for the search dropdown. Higher = better match. 0
// means no match. We rank exact > startsWith > substring > chars-in-
// order, since the latter still gets a hit when the user mistypes.
function scoreMatch(query, label, uid) {
  if (label === query || uid === query) {
    return 1000
  }
  if (label.startsWith(query) || uid.startsWith(query)) {
    return 500
  }
  if (label.includes(query) || uid.includes(query)) {
    return 100
  }
  return subsequenceScore(query, label) || subsequenceScore(query, uid)
}

function subsequenceScore(query, text) {
  if (!text) {
    return 0
  }
  let qi = 0
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      qi++
    }
  }
  return qi === query.length ? 10 : 0
}
