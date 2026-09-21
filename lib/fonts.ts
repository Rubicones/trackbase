import { Archivo, Inter, JetBrains_Mono } from 'next/font/google'

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--tb-font-display',
  display: 'swap',
})

/**
 * Body face for surfaces ported 1:1 from the subscription design kit
 * (`sonicdesk_designs`), which sets `--font-body: Inter`. The app at large
 * stays on JetBrains Mono; this variable exists so a ported screen can look
 * like the kit instead of approximating it in mono.
 */
export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--tb-font-body',
  display: 'swap',
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--tb-font-mono',
  display: 'swap',
})

export const fontVariables = `${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`
