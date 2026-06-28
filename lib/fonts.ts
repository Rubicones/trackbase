import { Archivo, JetBrains_Mono } from 'next/font/google'

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--tb-font-display',
  display: 'swap',
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--tb-font-mono',
  display: 'swap',
})

export const fontVariables = `${archivo.variable} ${jetbrainsMono.variable}`
