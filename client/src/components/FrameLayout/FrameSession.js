/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { setPanelMinimized, setPanelSize } from 'actions/ui'

import EntitySelector from 'components/EntitySelector'
import GraphContainer from 'components/GraphContainer'
import { buildExpandQuery } from 'lib/expandQuery'
import { getGraphParser } from 'lib/graphParserCache'
import { executeQuery } from 'lib/helpers'

export default function FrameSession({ frame, tabResult }) {
  const { panelMinimized, panelHeight, panelWidth } = useSelector(
    (store) => store.ui,
  )

  const dispatch = useDispatch()

  const handlePanelResize = (panelSize) => dispatch(setPanelSize(panelSize))
  const handleSetPanelMinimized = (minimized) =>
    dispatch(setPanelMinimized(minimized))

  const [hoveredPredicate, setHoveredPredicate] = React.useState(null)
  const [hiddenPredicates, setHiddenPredicates] = React.useState(
    () => new Set(),
  )

  const togglePredicateHidden = (pred) => {
    setHiddenPredicates((prev) => {
      const next = new Set(prev)
      if (next.has(pred)) {
        next.delete(pred)
      } else {
        next.add(pred)
      }
      return next
    })
  }

  // TODO: updating graphUpdateHack will force Graphcontainer > D3Graph
  // to re-render, and before render it will refresh nodes/edges dataset.
  // When GraphParser creates a new node or edge the d3 renderer needs to
  // be notified, because they share nodes/edges arrays.
  // But right now d3 renderer and graphParser live in different components.
  // There's no way to send this notification.
  // Most likely solution - make d3 force layout a part of graphParser,
  // that way graphParser will be able to control/update it.
  const [graphUpdateHack, setGraphUpdateHack] = React.useState('')

  const isSchemaGraph =
    frame.action === 'query' && /^[ \t\n]*schema[{ \t\n].*/.test(frame.query)

  const graphParser =
    frame.action === 'query' &&
    getGraphParser(frame.id, tabResult && tabResult.response, isSchemaGraph)

  const forceReRender = () => {
    const graph = graphParser.getCurrentGraph()
    setGraphUpdateHack(
      `${Date.now()} ${graph.edges.length} ${graph.nodes.length}`,
    )
  }

  const onShowMoreNodes = () => {
    graphParser.processQueue()
    forceReRender()
  }

  const handleCollapseNode = (uid) => {
    graphParser.collapseNode(uid)
    forceReRender()
  }

  // Bounded neighbour expansion.
  //
  // This used to send two nested expand(_all_) blocks, which is unbounded on
  // the wire: a measured 5000-degree hub pulled 105,001 nodes / ~3.9MB so the
  // canvas could draw 400. It also swallowed every failure with a
  // console.error commented "Ignore errors and exceptions on this RPC", which
  // made a failed expansion indistinguishable from a node with no neighbours.
  //
  // Now the query names its predicates and divides one global budget across
  // them (see lib/expandQuery), and errors propagate to the caller, which puts
  // them on screen. The budget defaults here as well as in GraphContainer so
  // that any future caller that forgets to pass one still cannot send the
  // unbounded shape.
  const handleExpandNode = async (uid, options = {}) => {
    const {
      budget = 500,
      direction = 'out',
      predicates = [],
      nameFields = [],
    } = options

    const query = buildExpandQuery({
      uid,
      predicates,
      budget,
      direction,
      nameFields,
    })

    // Deliberately not wrapped in try/catch: the caller renders the failure.
    const { data } = await executeQuery(query, {
      action: 'query',
      debug: true,
    })
    sendNodesToGraphParser(data, uid)
  }

  const sendNodesToGraphParser = (data, expansionNode) => {
    graphParser.addResponseToQueue(data, expansionNode)
    graphParser.processQueue('Name')
    forceReRender()
  }

  const graph = graphParser && graphParser.getCurrentGraph()

  return (
    <React.Fragment>
      <GraphContainer
        graphUpdateHack={graphUpdateHack}
        edgesDataset={graph.edges}
        highlightPredicate={hoveredPredicate}
        onShowMoreNodes={onShowMoreNodes}
        nodesDataset={graph.nodes}
        onCollapseNode={handleCollapseNode}
        onExpandNode={handleExpandNode}
        onSetPanelMinimized={handleSetPanelMinimized}
        onPanelResize={handlePanelResize}
        panelMinimized={panelMinimized}
        panelHeight={panelHeight}
        panelWidth={panelWidth}
        remainingNodes={graph.remainingNodes}
        hiddenPredicates={hiddenPredicates}
      />
      <EntitySelector
        graphLabels={graph.labels}
        onPredicateHovered={setHoveredPredicate}
        hiddenPredicates={hiddenPredicates}
        onPredicateToggled={togglePredicateHidden}
      />
    </React.Fragment>
  )
}
