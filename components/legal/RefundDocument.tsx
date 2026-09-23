"use client";
/* eslint-disable react/no-unescaped-entities -- verbatim legal copy; quotes render as written */

/* Copy is verbatim from sonicdesk_designs/src/routes/refund.tsx — keep in sync. */

import Link from "next/link";
import { LegalDocument, LegalSection } from "./LegalDocument";

const sections = [
  ["the-short-version", "The short version"],
  ["cancelling", "Cancelling"],
  ["refunds", "Refunds"],
  ["your-right-of-withdrawal", "Your right of withdrawal"],
  ["failed-payments", "Failed payments"],
  ["nothing-here-limits-your-legal-rights", "Nothing here limits your legal rights"],
  ["questions", "Questions"],
  ["who-we-are", "Who we are"],
] as const;

export default function RefundDocument() {
  return (
    <LegalDocument
      doc="refund"
      tag="Document · Refunds"
      titleLead="Refund"
      titleAccent="Policy"
      sections={sections}
    >
      <LegalSection number="01" id="the-short-version" title="The short version" featured>
        <p>
          Paid plans are <strong>monthly subscriptions</strong>. You can cancel at any time and you will not be charged
          again.
        </p>
        <p>
          We do not refund the month you are currently in. Because of that, we would rather you tried the{" "}
          <strong>free plan</strong> first. It includes versioning, the mixer, MIDI editing, song structure, comments,
          chat and rehearsal mode, with no time limit and no card required.
        </p>
      </LegalSection>


      <LegalSection number="02" id="cancelling" title="Cancelling">
        <p>
          You can cancel from your billing settings at any time. Nothing is sent to us for approval and nobody will ask
          you why.
        </p>
        <p>
          Cancelling takes effect at the end of the period you have already paid for. Until then, your plan and all its
          features keep working exactly as before.
        </p>
        <p>
          When the period ends, your account moves to the free plan. <strong>Nothing is deleted.</strong> If your
          account then exceeds the free plan's limits, you get 14 days to bring it back within them before any band
          becomes read-only — this is explained in section 7 of our{" "}
          <Link href="/terms" className="font-semibold">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>


      <LegalSection number="03" id="refunds" title="Refunds">
        <p>
          We do not issue refunds for partial months, or for months already paid, including where a plan was left
          unused.
        </p>
        <p>
          We <strong>do</strong> refund in these cases, because they are our mistakes rather than your decisions:
        </p>
        <ul>
          <li>You were charged twice for the same period.</li>
          <li>You were charged after cancelling, or charged on the wrong plan.</li>
          <li>The service was unavailable for an extended period through our fault.</li>
        </ul>
        <p>
          Write to{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>{" "}
          and we will refund to the original payment method. Refunds usually appear within 5–10 business days, depending
          on your bank.
        </p>
      </LegalSection>


      <LegalSection number="04" id="your-right-of-withdrawal" title="Your right of withdrawal">
        <p>
          If you are a consumer in the European Union, you normally have 14 days to withdraw from a distance contract
          and get your money back.
        </p>
        <p>
          Because a paid plan gives you access immediately, we ask you to confirm at checkout that you want it to start
          straight away and that you understand you lose the right of withdrawal once it does.
        </p>
        <p>
          If you would rather keep that right, do not tick the box — your plan will then start after the 14 days have
          passed.
        </p>
      </LegalSection>


      <LegalSection number="05" id="failed-payments" title="Failed payments">
        <p>
          If a renewal payment fails, we retry it over about a week and email you. Your plan stays active during that
          time.
        </p>
        <p>
          If it still fails, your account moves to the free plan. You are not charged for the period that was not paid,
          and nothing in your account is deleted.
        </p>
      </LegalSection>


      <LegalSection
        number="06"
        id="nothing-here-limits-your-legal-rights"
        title="Nothing here limits your legal rights"
        featured
      >
        <p>
          This policy sits alongside consumer law, it does not replace it. If the service is faulty or not as described,
          you keep every right the law in your country gives you, regardless of what this page says.
        </p>
        <p>
          EU consumers can also use the European Commission's Online Dispute Resolution platform:{" "}
          <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">
            https://ec.europa.eu/consumers/odr
          </a>
        </p>
      </LegalSection>


      <LegalSection number="06" id="questions" title="Questions">
        <p>
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>{" "}
          — we answer within a few days.
        </p>
      </LegalSection>

      <LegalSection number="07" id="who-we-are" title="Who we are">
        <p>
          Sonicdesk is operated by <strong>Margarita Popova</strong>, NIF 322938384, Portugal.
        </p>
        <p>
          Contact:{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
