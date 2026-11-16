/**
 * A satellite seen from above: a body with an antenna at the front and a solar panel either side, drawn
 * white so each billboard's colour tints it (by orbit), and pointing up, the way it travels. Drawn at 32 px
 * and shown far smaller; the panels' cells are a lighter shade so the tint still reads at 10 px.
 */
const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g fill="${fill}" stroke="#000000" stroke-opacity="0.55" stroke-width="1">
    <rect x="1.5" y="12" width="10" height="8" rx="1"/>
    <rect x="20.5" y="12" width="10" height="8" rx="1"/>
    <rect x="12.5" y="9.5" width="7" height="13" rx="2"/>
  </g>
  <g stroke="#000000" stroke-opacity="0.35" stroke-width="0.8">
    <line x1="6.5" y1="12" x2="6.5" y2="20"/>
    <line x1="25.5" y1="12" x2="25.5" y2="20"/>
    <line x1="1.5" y1="16" x2="11.5" y2="16"/>
    <line x1="20.5" y1="16" x2="30.5" y2="16"/>
  </g>
  <line x1="16" y1="9.5" x2="16" y2="4" stroke="${fill}" stroke-width="1.5"/>
  <circle cx="16" cy="3.5" r="1.6" fill="${fill}"/>
</svg>`

/** The icon in a colour, for keys; on the globe it's drawn white and each billboard tinted */
export const satelliteIconOf = (fill: string) => `data:image/svg+xml,${encodeURIComponent(svg(fill))}`

export const SATELLITE_ICON = satelliteIconOf('#ffffff')

/** Icon size in px for how many satellites are on show: big when there are few, small when there are thousands */
export const satelliteIconSize = (count: number) => (count <= 300 ? 20 : count <= 3000 ? 15 : 10)
