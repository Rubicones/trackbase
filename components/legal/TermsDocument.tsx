"use client";
/* eslint-disable react/no-unescaped-entities -- verbatim legal copy; quotes render as written */

/* Copy is verbatim from sonicdesk_designs/src/routes/terms.tsx — keep in sync. */

import { LegalDocument, LegalSection } from "./LegalDocument";

const sections = [
  ["what-sonicdesk-is", "What Sonicdesk is"],
  ["your-account", "Your account"],
  ["your-content-stays-yours", "Your content stays yours"],
  ["bands-and-shared-work", "Bands and shared work"],
  ["acceptable-use", "Acceptable use"],
  ["plans-and-payment", "Plans and payment"],
  ["plan-limits", "Plan limits, downgrades and frozen bands"],
  ["deleting-things", "Deleting things"],
  ["availability", "Availability"],
  ["our-responsibility", "Our responsibility"],
  ["changes", "Changes to these terms"],
  ["law-and-disputes", "Law and disputes"],
  ["contact", "Contact"],
  ["who-we-are", "Who we are"],
] as const;

export default function TermsDocument() {
  return (
    <LegalDocument
      doc="terms"
      tag="Document · TOS"
      titleLead="Terms of"
      titleAccent="Service"
      sections={sections}
      intro={
        <>
          <p>
            These terms are an agreement between you and the operator of Sonicdesk. Please read them — particularly
            section 3, which covers who owns the music you upload, and section 8, which covers deletion.
          </p>
        </>
      }
    >
      <LegalSection number="01" id="what-sonicdesk-is" title="What Sonicdesk is">
        <p>
          Sonicdesk is a collaborative workspace for bands and musicians. It stores your tracks, keeps every version of
          them, and gives your band one place to comment, plan and talk about the music.
        </p>
        <p>
          It is not a digital audio workstation, a distribution service, or a backup service. You should keep your own
          copies of anything you care about.
        </p>
      </LegalSection>


      <LegalSection number="02" id="your-account" title="Your account">
        <p>
          You must be at least 16 years old to use Sonicdesk. If you are under 18, you need permission from a parent or
          guardian before buying a paid plan.
        </p>
        <p>
          We sign you in with a one-time code sent to your email address. Keep access to that email address secure —
          anyone who can read it can sign in as you.
        </p>
        <p>
          You are responsible for what happens under your account, and for having the right to upload everything you
          upload.
        </p>
      </LegalSection>


      <LegalSection number="03" id="your-content-stays-yours" title="Your content stays yours" featured>
        <p>
          <strong>You keep every right you have in the music, lyrics, files and text you upload.</strong> We claim no
          ownership of any of it.
        </p>
        <p>
          To run the service, we need a narrow permission from you. You grant us a limited, non-exclusive, revocable
          licence to store your content, process it technically, and transmit it to the members of your band — and to do
          nothing else with it.
        </p>
        <p>
          "Process it technically" means the operations the product visibly performs: converting audio to other formats,
          generating waveforms, rendering preview mixes, and creating the copies that versioning requires. These are
          mechanical operations that exist so the service works.
        </p>
        <p>
          To be explicit about what this licence does <strong>not</strong> include:
        </p>
        <ul>
          <li>We do not use your music to train machine learning models.</li>
          <li>We do not use your music to promote Sonicdesk.</li>
          <li>We do not sell, licence or share your content with anyone outside your band.</li>
          <li>
            We do not make your content public. Sonicdesk has no public profiles, no discovery feed and no sharing
            outside a band.
          </li>
        </ul>
        <p>
          This licence exists only while your content is on the service. Delete the content or your account and it ends.
        </p>
        <p>
          If any part of Sonicdesk ever sends your audio to a third-party service to perform a task you asked for, we
          will say so plainly in the interface before it happens, and in our Privacy Policy.
        </p>
      </LegalSection>


      <LegalSection number="04" id="bands-and-shared-work" title="Bands and shared work">
        <p>
          A band is a shared space. Everything uploaded to a band — tracks, versions, comments, structure, chat — is
          visible to every member of that band.
        </p>
        <p>
          The person who creates a band is its owner. The owner controls the band's plan, approves who joins, and can
          remove members.
        </p>
        <p>
          <strong>Content stays with the band.</strong> If a member leaves or is removed, the tracks, versions and
          comments they contributed remain in the band, and they lose access to them. This is deliberate: a song is made
          by several people, and removing one of them should not tear holes in the work. Consider this before uploading
          anything to a band you do not control.
        </p>
        <p>If you are removed from a band, we will email you to tell you.</p>
      </LegalSection>


      <LegalSection number="05" id="acceptable-use" title="Acceptable use">
        <p>
          Do not upload content you do not have the rights to. Do not use Sonicdesk to infringe anyone's copyright, to
          store unlawful material, or to harass anyone.
        </p>
        <p>
          Do not attempt to circumvent the limits of your plan, access other people's bands, or interfere with the
          service's operation.
        </p>
        <p>
          We may suspend or close an account that breaks these rules. Where it is reasonable to do so, we will tell you
          why first.
        </p>
      </LegalSection>


      <LegalSection number="06" id="plans-and-payment" title="Plans and payment">
        <p>
          Sonicdesk has a free plan and paid plans. Current prices and limits are on our pricing page, which forms part
          of these terms.
        </p>
        <p>
          Paid plans are <strong>monthly subscriptions that renew automatically</strong> until you cancel. You are
          charged at the start of each period. Payments are handled by Stripe; we never see your card details.
        </p>
        <p>
          A band's limits and features come from the <strong>band owner's plan</strong>. Members get the band's
          capabilities without needing their own paid plan.
        </p>
        <p>
          <strong>Cancelling.</strong> You can cancel at any time from your billing settings. Cancellation takes effect
          at the end of the period you have already paid for. We do not pro-rate partial months.
        </p>
        <p>
          <strong>Right of withdrawal.</strong> Under EU consumer law you normally have 14 days to withdraw from a
          distance contract. Because Sonicdesk gives you immediate access to a paid plan, you will be asked to confirm
          at checkout that you want access to start straight away and that you accept you lose the right of withdrawal
          once it does. If you do not accept, we cannot start the plan immediately.
        </p>
        <p>
          <strong>Failed payments.</strong> If a payment fails we retry it over about a week and email you. If it still
          fails, your account moves to the free plan and the rules in section 7 apply.
        </p>
        <p>
          <strong>Price changes.</strong> We will email you at least 30 days before any price increase takes effect. You
          can cancel before it does.
        </p>
      </LegalSection>


      <LegalSection number="07" id="plan-limits" title="Plan limits, downgrades and frozen bands" featured>
        <p>
          Each plan has limits on bands, members, storage and versions. When you move to a smaller plan — by choosing
          to, or because a payment failed — your account may exceed the new limits.
        </p>
        <p>
          When that happens, you get <strong>14 days</strong> to bring things within the new limits. During those 14
          days everything keeps working normally and we show you what needs to change.
        </p>
        <p>
          After 14 days, bands over the limit become <strong>frozen</strong>. A frozen band is read-only: you can still
          play, view and download everything in it, but you cannot upload, record or create new versions.
        </p>
        <p>
          <strong>Freezing never deletes anything.</strong> Your files remain exactly as they were. Move back within
          your limits — by upgrading again, or by deleting bands you no longer need — and the band unfreezes
          immediately.
        </p>
        <p>
          <strong>We never remove people from your band.</strong> If a band has more members than your plan allows, we
          stop new members being added; we do not remove anyone. That decision is always yours.
        </p>
      </LegalSection>


      <LegalSection number="08" id="deleting-things" title="Deleting things" warning>
        <p>
          <strong>Deleting is permanent.</strong> We do not operate a recycle bin, and we cannot restore deleted data.
        </p>
        <p>
          <strong>Deleting a band.</strong> A band can only be deleted when you are its only remaining member. If other
          people are in it, you must remove them first. This is deliberate — deleting a band destroys work that belongs
          to several people, and it should take explicit steps rather than one click.
        </p>
        <p>
          <strong>Deleting your account.</strong> You can delete your account at any time, once you no longer own any
          bands. Any active subscription is cancelled first.
        </p>
        <p>When you delete your account, your data is removed from our database immediately and permanently.</p>
      </LegalSection>


      <LegalSection number="09" id="availability" title="Availability">
        <p>
          Sonicdesk is under active development. Features change, and the service may be unavailable at times,
          planned or otherwise. We do not promise any particular level of uptime.
        </p>
        <p>
          We will give reasonable notice before removing a feature you rely on or making a change that would cause you
          to lose data.
        </p>
      </LegalSection>


      <LegalSection number="10" id="our-responsibility" title="Our responsibility">
        <p>
          We provide Sonicdesk with reasonable care and skill, but we cannot promise it will be free of faults or that
          it will never lose data. <strong>Keep your own copies of anything you cannot afford to lose.</strong>
        </p>
        <p>
          To the extent the law allows, we are not liable for lost profits, lost opportunities, or indirect losses.
          Where we are liable, our total liability is limited to the amount you paid us in the 12 months before the
          claim.
        </p>
        <p>
          Nothing in these terms limits any right you have under mandatory consumer law, or our liability for death,
          personal injury, fraud, or anything else that cannot be limited by law.
        </p>
      </LegalSection>


      <LegalSection number="11" id="changes" title="Changes to these terms">
        <p>
          We may update these terms. If a change materially affects your rights, we will email you at least 30 days
          before it takes effect. Continuing to use Sonicdesk after that means you accept the new terms; if you do not,
          you can cancel and delete your account.
        </p>
      </LegalSection>


      <LegalSection number="12" id="law-and-disputes" title="Law and disputes">
        <p>These terms are governed by the law of Portugal.</p>
        <p>
          If you are a consumer in the European Union, you keep the protection of the mandatory consumer law of the
          country you live in, and you may bring proceedings there.
        </p>
        <p>
          If we cannot resolve a dispute directly, EU consumers can use the European Commission's Online Dispute
          Resolution platform:{" "}
          <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">
            https://ec.europa.eu/consumers/odr
          </a>
        </p>
      </LegalSection>


      <LegalSection number="13" id="contact" title="Contact">
        <p>
          Questions about these terms:{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
        </p>
      </LegalSection>

      <LegalSection number="14" id="who-we-are" title="Who we are">
        <p>
          Sonicdesk is operated by <strong>Margarita Popova</strong>, NIF 322938384, Portugal.
        </p>
        <p>
          Contact:{" "}
          <strong>
            <a href="mailto:hi@sonicdesk.studio">hi@sonicdesk.studio</a>
          </strong>
        </p>
        <p>
          Throughout these terms, "we", "us" and "Sonicdesk" mean the operator above. "You" means the person using the
          service.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
