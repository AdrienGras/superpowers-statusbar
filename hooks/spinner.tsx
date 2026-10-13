// A surface module, drawn by the band's and the pane's `Client`s: it runs on the surface's own frame clock, so the
// spinner turns without the plugin's tree being drawn again.

import type { ClientModule } from 'claude-code'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_MS = 100

/** A braille spinner in the theme's `warning` colour, one cell wide; its state is the frame shown. */
const Spinner: ClientModule<null, number> = (_props, surface) => {
  if (surface.state === undefined) {
    let frame = 0
    surface.every(FRAME_MS, () => {
      frame = (frame + 1) % FRAMES.length
      surface.setState(frame)
    })
    surface.setState(frame)
  }
  const { Text } = surface.elements
  return <Text color="warning">{FRAMES[surface.state ?? 0]}</Text>
}

export default Spinner
