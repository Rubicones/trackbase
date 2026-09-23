"use client";
/* eslint-disable react/no-unescaped-entities -- verbatim legal copy; quotes render as written */

/* Copy is verbatim from sonicdesk_designs/src/routes/privacy.tsx — keep in sync. */

import Link from "next/link";
import { LegalDocument, LegalSection, LegalTable } from "./LegalDocument";

const sections = [
  ["who-is-responsible", "Who is responsible"],
  ["what-we-collect", "What we collect"],
  ["why-we-use-it", "Why we use it, and on what basis"],
  ["who-we-share-it-with", "Who we share it with"],
  ["how-long-we-keep-it", "How long we keep it"],
  ["cookies", "Cookies and similar technologies"],
  ["your-rights", "Your rights"],
  ["children", "Children"],
  ["security", "Security"],
  ["changes", "Changes"],
  ["contact", "Contact"],
] as const;

export default function PrivacyDocument() {
  return (
    <LegalDocument
      doc="privacy"
      tag="Document · Privacy"
      titleLead="Privacy"
      titleAccent="Policy"
      sections={sections}
      intro={
        <>
          <p>This policy explains what personal data Sonicdesk collects, why, and what you can do about it.</p>
        </>
      }
    >
      <LegalSection number="01" id="who-is-responsible" title="Who is responsible">
        <p>
          The controller of your personal data is <strong>Margarita Popova</strong>, NIF 322938384, Portugal.
        </p>
        <p>
          Contact:{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
        </p>
      </LegalSection>

      <LegalSection number="02" id="what-we-collect" title="What we collect">
        <p>
          <strong>Account data.</strong> Your email address, username, display name and avatar colour. We sign you in
          with a one-time code, so we never store a password.
        </p>
        <p>
          <strong>Content you upload.</strong> Audio files, MIDI, project files, links, lyrics, song structure and
          chords, comments, chat messages, roadmap items and checklists.
        </p>
        <p>
          <strong>Band data.</strong> Which bands you belong to, your role in them, and your activity within them
          (uploads, versions created, comments left).
        </p>
        <p>
          <strong>Billing data.</strong> If you subscribe, we store your Stripe customer and subscription identifiers,
          your plan, and its status. <strong>We never see or store your card details</strong> — Stripe handles those
          directly.
        </p>
        <p>
          <strong>Support and feedback.</strong> If you send feedback or a bug report, we store the message, your email
          address, and the page you were on.
        </p>
        <p>
          <strong>Notifications.</strong> If you enable push notifications, we store the technical subscription details
          your browser provides.
        </p>
        <p>
          <strong>Usage data.</strong> Anonymous behavioural events — which features are used, which buttons are
          clicked. These contain no email address, no user identifier and no content.
        </p>
        <p>
          <strong>Technical data.</strong> IP address and browser user agent, processed as part of serving and securing
          the site.
        </p>
      </LegalSection>

      <LegalSection number="03" id="why-we-use-it" title="Why we use it, and on what basis">
        <LegalTable
          columns={["Purpose", "Legal basis"]}
          rows={[
            ["Running your account and bands, storing and serving your files", "Performance of our contract with you"],
            ["Taking payment and managing subscriptions", "Performance of our contract with you"],
            ["Issuing invoices and keeping tax records", "Legal obligation"],
            ["Keeping the service secure and preventing abuse", "Our legitimate interest"],
            ["Answering your support messages", "Our legitimate interest"],
            ["Analytics and advertising measurement", "Your consent"],
            ["Push notifications", "Your consent"],
          ]}
        />
        <p>
          You can withdraw consent at any time. For cookies and trackers, use the cookie settings on the site; for push
          notifications, turn them off in your account.
        </p>
      </LegalSection>

      <LegalSection number="04" id="who-we-share-it-with" title="Who we share it with" featured>
        <p>
          We do not sell your data and we do not share your content with anyone outside your band. We use the following
          service providers, who process data on our behalf:
        </p>
        <LegalTable
          columns={["Provider", "What they process", "Where"]}
          rows={[
            ["Supabase", "Database and authentication", "European Union"],
            ["Cloudflare R2", "Audio and file storage", "United States / global"],
            ["Vercel", "Website hosting and delivery", "United States / global"],
            ["Stripe", "Payments and subscriptions", "United States / Ireland"],
            ["Google Analytics", "Anonymous usage analytics", "United States"],
            ["Meta", "Advertising measurement", "United States"],
            ["Yandex Metrica", "Usage analytics", "Russian Federation"],
            ["Google Sheets", "A copy of feedback messages", "United States"],
            [
              "Browser push services (Google, Mozilla, Apple)",
              "Delivering push notifications",
              "United States / global",
            ],
          ]}
        />
        <p>
          Some of these are outside the European Economic Area. For transfers to the United States we rely on the
          European Commission's standard contractual clauses or, where applicable, the EU–US Data Privacy Framework.
        </p>
        <p>
          Yandex Metrica processes data in the Russian Federation, a country for which the European Commission has not
          issued an adequacy decision. This tool loads only if you consent to analytics cookies.
        </p>
        <p>We may also disclose data where we are legally required to.</p>
      </LegalSection>

      <LegalSection number="05" id="how-long-we-keep-it" title="How long we keep it" warning>
        <p>
          <strong>Your account and content</strong> are kept while your account exists.
        </p>
        <p>
          <strong>When you delete your account</strong>, your account data and content are removed from our database
          immediately and permanently. We do not keep backups from which they could be restored.
        </p>
        <p>Two exceptions, which we are required or unable to avoid:</p>
        <ul>
          <li>
            <strong>Invoices and payment records.</strong> Portuguese tax law requires us to keep accounting records,
            including invoices, for ten years. These are retained by us and by Stripe regardless of account deletion.
          </li>
          <li>
            <strong>Feedback messages.</strong> Messages you send through the feedback form are also stored in a
            separate spreadsheet, which is not connected to your account. Ask us at hi@sonicdesk.studio and we will
            delete them.
          </li>
        </ul>
        <p>
          <strong>Content you contributed to a band</strong> stays with that band if you leave or are removed. This is
          explained in our{" "}
          <Link href="/terms" className="font-semibold">
            Terms of Service
          </Link>
          .
        </p>
        <p>
          <strong>Anonymous usage data</strong> is retained by our analytics providers under their own retention
          settings.
        </p>
      </LegalSection>

      <LegalSection number="06" id="cookies" title="Cookies and similar technologies">
        <p>
          We use cookies that are strictly necessary for the site to work — keeping you signed in, remembering your
          theme and your place in the app. These do not require consent.
        </p>
        <p>
          We also use analytics and advertising cookies from Google Analytics, Meta and Yandex Metrica.{" "}
          <strong>These load only after you consent</strong>, and you can change or withdraw that choice at any time
          through the cookie settings on the site.
        </p>
      </LegalSection>

      <LegalSection number="07" id="your-rights" title="Your rights" featured>
        <p>Under the GDPR you have the right to:</p>
        <ul>
          <li>
            <strong>Access</strong> the personal data we hold about you
          </li>
          <li>
            <strong>Correct</strong> it if it is wrong
          </li>
          <li>
            <strong>Delete</strong> it — you can delete your account yourself, or ask us
          </li>
          <li>
            <strong>Export</strong> your data in a portable format
          </li>
          <li>
            <strong>Object</strong> to processing based on our legitimate interests
          </li>
          <li>
            <strong>Restrict</strong> processing in certain circumstances
          </li>
          <li>
            <strong>Withdraw consent</strong> where processing is based on it
          </li>
        </ul>
        <p>
          To exercise any of these, email{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
          . We will respond within one month.
        </p>
        <p>
          If you believe we are handling your data improperly, you can complain to the Portuguese data protection
          authority, <strong>Comissão Nacional de Proteção de Dados (CNPD)</strong> —{" "}
          <a href="https://www.cnpd.pt" target="_blank" rel="noreferrer">
            www.cnpd.pt
          </a>{" "}
          — or to the authority in the EU country where you live.
        </p>
      </LegalSection>

      <LegalSection number="08" id="children" title="Children">
        <p>
          Sonicdesk is not intended for children under 16. We do not knowingly collect data from anyone under that age.
          If you believe a child has given us personal data, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection number="09" id="security" title="Security">
        <p>
          Data is encrypted in transit. Access to the database is restricted by row-level security, so one band's data
          is not reachable from another's. Payment details never reach our systems.
        </p>
        <p>
          No service is perfectly secure. If a breach occurs that is likely to put your rights at risk, we will notify
          you and the CNPD as the law requires.
        </p>
      </LegalSection>

      <LegalSection number="10" id="changes" title="Changes">
        <p>
          We may update this policy. If a change materially affects how we handle your data, we will email you before it
          takes effect. The date at the top shows when it was last changed.
        </p>
      </LegalSection>

      <LegalSection number="11" id="contact" title="Contact">
        <p>
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
