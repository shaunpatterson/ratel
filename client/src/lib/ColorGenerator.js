/*
 * SPDX-FileCopyrightText: © Hypermode Inc. <hello@hypermode.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import randomColor from 'randomcolor'

// Neo4j-inspired color palette: rich, saturated, distinct colors
export default class ColorGenerator {
  randomColorList = [
    '#4C8EDA', // blue
    '#57C7E3', // cyan
    '#F79767', // orange
    '#FFC454', // yellow
    '#D9C8AE', // tan
    '#C990C0', // purple/pink
    '#8DCC93', // green
    '#ECB5C9', // light pink
    '#4C8EDA', // blue variant
    '#DA7194', // rose
    '#569480', // teal
    '#848484', // gray
    '#FFC0CB', // pink
    '#FFD700', // gold
    '#00CED1', // dark turquoise
    '#FF6347', // tomato
    '#7B68EE', // medium slate blue
    '#3CB371', // medium sea green
    '#FF69B4', // hot pink
    '#1E90FF', // dodger blue
  ]

  get = () => this.randomColorList.shift() || randomColor({ luminosity: 'bright' })

  getRGBA = (alpha = 1) => {
    const col = this.get()
    const component = (idx) =>
      parseInt(col.substring(1 + idx * 2, 3 + idx * 2), 16)
    return [component(0), component(1), component(2), alpha]
  }
}
