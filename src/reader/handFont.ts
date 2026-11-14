// The handwriting font used for everything drawn on top of the paper.
export const HAND_FONT = '"xkcd", "Comic Sans MS", cursive'

/** Resolves once the handwriting font is usable (or has failed to load), so text can be measured. */
export const handFontReady: Promise<unknown> = document.fonts.load('20px "xkcd"').catch(() => undefined)
