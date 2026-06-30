import { ImageResponse } from 'next/og'
import { SEO_DEFAULT_DESCRIPTION, SITE_NAME } from '@/lib/seo'

export const alt = SITE_NAME
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#070707',
          padding: '64px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: 22,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#FF4D00',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              background: '#FF4D00',
            }}
          />
          Private beta · open
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: '-0.04em',
              color: '#FF4D00',
            }}
          >
            sonicdesk.
          </div>
          <div
            style={{
              maxWidth: 900,
              fontSize: 34,
              lineHeight: 1.25,
              color: '#F5F5F5',
            }}
          >
            {SEO_DEFAULT_DESCRIPTION}
          </div>
        </div>

        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#737373',
          }}
        >
          sonicdesk.studio
        </div>
      </div>
    ),
    { ...size },
  )
}
