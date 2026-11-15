/**
 * Colour ramps for grids drawn over the globe. Sequential ones run light to dark through a single family
 * of hues, so they read the same to people with colour-vision deficiency and in greyscale.
 */

export type Rgba = [r: number, g: number, b: number, a: number]

/** ColorBrewer YlOrRd: few to many */
export const SEQUENTIAL = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'] as const

const parse = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

/**
 * A function from a value to a colour along `stops`, from `min` to `max` (clamped at the top).
 * Below `min` it gives null: nothing drawn. Fainter at the low end, so sparse cells don't shout.
 */
export function ramp(
  stops: readonly string[],
  { min, max, alpha = [0.35, 0.85] }: { min: number; max: number; alpha?: [number, number] },
): (v: number) => Rgba | null {
  const rgb = stops.map(parse)
  return (v) => {
    if (!(v >= min)) return null
    const t = max > min ? Math.min(1, (v - min) / (max - min)) : 1
    const x = t * (rgb.length - 1)
    const i = Math.min(rgb.length - 2, Math.floor(x))
    const f = x - i
    const [a, b] = [rgb[i], rgb[i + 1]]
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
      Math.round(255 * (alpha[0] + (alpha[1] - alpha[0]) * t)),
    ]
  }
}
