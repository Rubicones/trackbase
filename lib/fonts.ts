import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--tb-font-display',
  display: 'swap',
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--tb-font-mono',
  display: 'swap',
})

export const fontVariables = `${spaceGrotesk.variable} ${jetbrainsMono.variable}`
