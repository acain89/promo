// src/pages/Terms.jsx
import React from "react";
import { Link } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";

/**
 * Terms & Conditions / Official Rules
 * drawnfray — Weekly Closest-Wins 3-Digit Promotional Contest
 *
 * IMPORTANT:
 * - This text is written to be clear, strict, and compliance-oriented.
 */

export default function Terms() {
  return (
    <PanelShell
      label="TERMS"
      labelClass="terms"
      bodyScroll
      footer={
        <>
          <div className="fineprint" style={{ textAlign: "center" }}>
            Not affiliated with any government or lottery entity.
          </div>
          <div className="form" style={{ marginTop: 0 }}>
            <Link to="/" className="secondary" style={{ display: "block", padding: "14px 16px" }}>
              Back to Landing
            </Link>
          </div>
        </>
      }
    >
      {/* Everything below scrolls INSIDE the panel only */}
      <div style={{ textAlign: "left" }}>
        <h1 style={{ margin: "0 0 10px", fontSize: "1.15rem", letterSpacing: "0.02em" }}>
          Terms &amp; Conditions / Official Rules
        </h1>

        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>No purchase necessary to enter or win.</strong> Void where prohibited. Please read carefully. By
          accessing the site, creating an account, purchasing a game pass (digital access), submitting an entry, or using
          any feature, you agree to these Terms &amp; Conditions / Official Rules (“Rules”). If you do not agree, do not
          use the site.
        </p>

        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>Effective Date:</strong> {new Date().toLocaleDateString("en-US")}
        </p>

        <hr className="headerRule" />

        <h2 style={{ margin: "14px 0 8px" }}>1) Sponsor / Operator</h2>
        <p className="miniMuted">
          The promotional contests are operated by the site operator (“Sponsor”, “we”, “us”, “our”). Sponsor conducts (a)
          a weekly paid-entry promotional contest and (b) a separate “No Purchase Necessary” Alternate Method of Entry
          (“AMOE”) promotional drawing, each as described in these Rules.
        </p>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>Sponsor:</strong> drawnfray (site operator) <br />
          <strong>Contact Email:</strong> DrawnFray@gmail.com <br />
          <strong>Mail-in Address:</strong> provided in the “No Purchase Necessary (AMOE)” section below.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>2) No Government / Lottery Affiliation</h2>
        <p className="miniMuted">
          This promotion and this website are independent and are <strong>not</strong> sponsored by, affiliated with,
          administered by, or endorsed by any state lottery, government entity, municipality, or agency. Any reference to
          publicly reported draw results is for informational and winner-determination purposes only.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>3) Promotion Overview (Closest-Wins)</h2>
        <p className="miniMuted">
          Participants select one (1) three-digit number from 000–999. The winner is determined by comparing each
          eligible entry’s selected number to a publicly available three-digit draw result (“Target Number”). The entry
          with the smallest absolute difference from the Target Number wins. Ties are broken as described below.
          <strong> Paid entries and AMOE entries are administered as separate promotions</strong>, with separate entry
          pools and winner determination events, as described in these Rules.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>4) Eligibility</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            Open only to natural persons who are at least <strong>18 years of age</strong> (or the age of majority in
            their jurisdiction, whichever is higher) at time of entry.
          </li>
          <li>
            Void where prohibited or restricted by law. Sponsor may restrict or block participation by location,
            identity, payment method, or other compliance factors.
          </li>
          <li>
            Employees, officers, directors, agents of Sponsor, and immediate household/family members may be ineligible
            (Sponsor reserves the right to enforce exclusions to maintain integrity).
          </li>
          <li>
            You must provide accurate account information. Sponsor may require identity verification before awarding a
            prize.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>5) Entry Limits</h2>
        <p className="miniMuted">
          Limit: <strong>one (1) paid entry per person per weekly contest period</strong>. Separately, limit:
          <strong> one (1) AMOE entry per person per AMOE drawing pool</strong>. Attempts to exceed limits (including via
          multiple accounts, emails, identities, devices, payment instruments, or other methods) may result in
          disqualification of all related entries and account action.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>6) Contest Period, Cutoff, and Timekeeping (Paid Weekly Contest)</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            The paid weekly contest uses a publicly reported <strong>Texas Pick 3 Saturday Night</strong> three-digit
            drawing result as the Target Number.
          </li>
          <li>
            The paid weekly Cutoff is <strong>9:30 p.m. Central Time (CT)</strong> (or as displayed on the site if
            updated).
          </li>
          <li>
            Sponsor’s servers are the official timekeeping mechanism. Displayed countdowns are provided for convenience;
            if there is a discrepancy, Sponsor’s server time controls.
          </li>
          <li>
            Paid entries submitted after the paid weekly Cutoff are not eligible for that weekly contest period and will
            apply to the next weekly contest period (if available).
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>7) How to Enter (Paid Game Pass Entry)</h2>
        <p className="miniMuted">
          A paid entry is made by purchasing a weekly game pass (digital access) and then locking a single three-digit
          submission for the contest period.
        </p>
        <ol className="miniMuted" style={{ marginTop: 0 }}>
          <li>Create an account (username, email, password).</li>
          <li>Purchase one (1) weekly game pass for the current contest period (if available).</li>
          <li>Select a three-digit number (000–999) and lock your submission before Cutoff.</li>
        </ol>
        <p className="miniMuted">
          <strong>Locked submissions are final and cannot be changed.</strong>
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>8) No Purchase Necessary — Alternate Method of Entry (AMOE)</h2>
        <p className="miniMuted">
          <strong>No purchase is necessary to enter or win.</strong> To enter without a purchase, you may submit a free
          mail-in entry for the <strong>separate AMOE promotional drawing</strong> described below. AMOE entries do{" "}
          <strong>not</strong> compete in the paid weekly contest and are instead collected into an AMOE drawing pool
          until the threshold described below is reached.
        </p>

        <h3 style={{ margin: "10px 0 6px" }}>AMOE Entry Requirements</h3>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          Mail-in AMOE entries must be handwritten or typed legibly and must include all of the following. AMOE entries
          require additional identifying information solely for eligibility verification, fraud prevention, and
          regulatory compliance:
        </p>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>Full legal name</li>
          <li>Valid email address</li>
          <li>Mailing address (for verification/contact, if needed)</li>
          <li>One (1) three-digit number guess (000–999)</li>
          <li>A statement: “I request one AMOE entry for drawnfray.”</li>
          <li>Signature and date</li>
        </ul>

        <h3 style={{ margin: "10px 0 6px" }}>AMOE Pooling, Threshold, and Timing</h3>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            AMOE entries are accumulated on a rolling basis until the AMOE drawing pool reaches{" "}
            <strong>five hundred (500) eligible AMOE entries</strong>.
          </li>
          <li>
            Once five hundred (500) eligible AMOE entries are received, the AMOE pool is locked and the AMOE winner will
            be determined using the <strong>next available</strong> publicly reported Texas Pick 3 Saturday Night
            three-digit drawing result after the pool lock.
          </li>
          <li>
            Sponsor may reject AMOE entries that are incomplete, illegible, postage-due, duplicated for the same person,
            or otherwise non-compliant. Sponsor is not responsible for lost, late, misdirected, or damaged mail.
          </li>
        </ul>

        <h3 style={{ margin: "10px 0 6px" }}>AMOE Mailing Address</h3>
        <address className="miniMuted" style={{ fontStyle: "normal" }}>
          drawnfray AMOE Entry
          <br />
          P.O. Box C4
          <br />
          Liberty, Texas 77575
          <br />
          United States
        </address>

        <p className="miniMuted">
          <strong>Important:</strong> Only one (1) AMOE entry per person per AMOE drawing pool is permitted. If multiple
          AMOE entries are received for the same person for the same AMOE pool, Sponsor may accept the first received
          that meets requirements and void the rest.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>9) Separate Promotions (Paid Weekly Contest vs. AMOE Drawing)</h2>
        <p className="miniMuted">
          The paid weekly contest and the AMOE drawing are conducted as <strong>separate and independent promotions</strong>,
          each with its own entry pool and winner determination event. Paid entries compete only against other paid
          entries in the paid weekly contest. AMOE entries compete only against other AMOE entries in the AMOE drawing
          pool.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>10) Winner Determination (Target Number + Distance)</h2>
        <h3 style={{ margin: "10px 0 6px" }}>Paid Weekly Contest</h3>
        <ol className="miniMuted" style={{ marginTop: 0 }}>
          <li>Each eligible paid entry contains one three-digit number from 000–999.</li>
          <li>
            After Cutoff, Sponsor identifies the Target Number for that weekly contest period based on the publicly
            reported <strong>Texas Pick 3 Saturday Night</strong> three-digit drawing result.
          </li>
          <li>
            Each entry’s distance (“DFT”, Distance From Target) is calculated as the absolute difference between the
            entry’s number and the Target Number.
          </li>
          <li>The winner is the eligible paid entry with the smallest DFT.</li>
          <li>
            <strong>Tie-breaker:</strong> if two (2) or more paid entries are equally close, the earliest locked timestamp
            recorded by Sponsor’s servers for that weekly contest period wins. If timestamps are identical due to system
            conditions, Sponsor may apply an additional deterministic tie-break rule (e.g., internal processing order) to
            resolve the tie.
          </li>
        </ol>

        <h3 style={{ margin: "10px 0 6px" }}>AMOE Drawing</h3>
        <ol className="miniMuted" style={{ marginTop: 0 }}>
          <li>Each eligible AMOE entry contains one three-digit number from 000–999.</li>
          <li>
            When the AMOE pool reaches five hundred (500) eligible AMOE entries and is locked, Sponsor identifies the
            Target Number based on the <strong>next available</strong> publicly reported Texas Pick 3 Saturday Night
            three-digit drawing result after the lock.
          </li>
          <li>
            Each AMOE entry’s DFT is calculated as the absolute difference between the AMOE entry’s number and the Target
            Number.
          </li>
          <li>The winner is the eligible AMOE entry with the smallest DFT.</li>
          <li>
            <strong>Tie-breaker:</strong> if two (2) or more AMOE entries are equally close, the earliest recorded AMOE
            entry timestamp (as recorded by Sponsor’s systems upon processing/entry) wins. If timestamps are identical due
            to system conditions, Sponsor may apply an additional deterministic tie-break rule (e.g., internal processing
            order) to resolve the tie.
          </li>
        </ol>

        <h2 style={{ margin: "14px 0 8px" }}>11) Odds</h2>
        <p className="miniMuted">
          Odds of winning depend on the number of eligible entries received for the applicable promotion (paid weekly
          contest or AMOE drawing) and the distribution of selected numbers. Sponsor does not guarantee any odds.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>12) Prize, Prize Display, and Limits</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            <strong>Paid weekly contest prize:</strong> the prize amount for a weekly contest period is displayed on the
            website. For each paid entry received for that weekly contest period, <strong>$3.55</strong> is added to the
            prize amount (before any caps, rollover policies, or promotional bonuses that may be disclosed for that
            period).
          </li>
          <li>
            The prize shown at the paid weekly Cutoff is the prize awarded for that paid weekly contest period, unless
            otherwise stated. Sponsor’s systems lock the prize amount at Cutoff for that weekly contest period.
          </li>
          <li>
            <strong>AMOE drawing prize:</strong> the AMOE prize amount is calculated using the same formula as the paid
            weekly contest, based on <strong>five hundred (500) paid-entry equivalents at $3.55 per entry</strong>, and is
            disclosed prior to AMOE winner determination.
          </li>
          <li>
            Sponsor may establish maximum prize caps, rollover policies, or promotional bonuses and will disclose such
            rules on the website for the applicable promotion.
          </li>
          <li>Prizes are non-transferable. No substitution except at Sponsor’s discretion where required for compliance.</li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>13) Taxes / Reporting</h2>
        <p className="miniMuted">
          Winners are solely responsible for all applicable federal, state, and local taxes, fees, and reporting
          obligations. Sponsor may require completion of tax forms (e.g., W-9) and may issue tax reporting documents
          (e.g., 1099) as required by law. Sponsor may withhold prize payment until required documentation is received
          and verified.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>14) Winner Verification, Disqualification, and Forfeiture</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            Potential winners may be required to verify identity, eligibility, and compliance (including providing valid
            email, confirming account ownership, and completing forms).
          </li>
          <li>
            If a potential winner is found ineligible, non-compliant, or cannot be verified within a reasonable
            timeframe, Sponsor may disqualify the entry and select the next closest eligible entry as winner (within the
            applicable promotion).
          </li>
          <li>
            Sponsor reserves the right to disqualify entries for fraud, abuse, tampering, automation, interference, or
            attempts to undermine the operation or integrity of the contest.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>15) Payment Processing (Stripe) and Financial Separation</h2>
        <p className="miniMuted">
          Stripe (or a similar payment processor) is used solely to process payments for weekly game passes (digital
          access) for the paid weekly contest. Sponsor does not provide payment processing services and does not hold user
          funds in escrow or custody.
        </p>
        <p className="miniMuted">
          To reduce risk and improve operational clarity, Sponsor may transfer net receipts (after processor fees) to a
          separate operating account. Prize payouts are funded from a separate account and/or separate payout method.
          Payment processing for entries is separate from prize payout processing.
        </p>
        <p className="miniMuted">
          If a payment is reversed (chargeback/dispute) or flagged as high-risk, Sponsor may suspend the associated
          account and may treat the paid entry as invalid for that contest period, consistent with fraud prevention and
          compliance rules.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>16) Refunds / Cancellations</h2>
        <p className="miniMuted">
          <strong>All sales are final</strong> unless Sponsor determines, in its sole discretion, that a refund or credit
          is appropriate due to a technical failure, duplicate charge, a voided contest period, or as otherwise required
          by law or payment processor rules. If a contest period is voided or materially disrupted, Sponsor may (where
          appropriate) refund paid game pass purchases for that affected period and/or apply credits.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>17) Prize Payment Method and Timing</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>Sponsor will display results on the site and may notify winners via the email associated with the account.</li>
          <li>
            Sponsor may require verification steps prior to payout. Payout timing may depend on verification, fraud
            review, and processor settlement periods.
          </li>
          <li>
            Sponsor is not responsible for an email being filtered, undelivered, or inaccessible due to user settings or
            provider issues.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>18) Public Results / Winners Record</h2>
        <p className="miniMuted">
          After each paid weekly contest period and after each AMOE drawing, Sponsor may publish a public winners record
          (e.g., winner username (or initials where appropriate), prize amount, Target Number, winning submission,
          distance, and submission timestamp). Sponsor may maintain a historical record (for example, up to the most
          recent fifty-two (52) contests/drawings).
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>19) Account Rules, Conduct, and Integrity</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You may not use bots, automation, scripts, or other methods to interfere with the contest or site.</li>
          <li>You may not attempt to bypass entry limits, verification processes, or security controls.</li>
          <li>Sponsor may suspend or terminate accounts for violations, suspected fraud, or actions that threaten platform integrity.</li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>20) Technical Disruptions / Force Majeure</h2>
        <p className="miniMuted">
          Sponsor is not responsible for lost, late, incomplete, misdirected, corrupted, or delayed entries; network
          outages; server failures; software bugs; or other technical issues. Sponsor may cancel, suspend, modify, or void
          a contest period if an event materially affects integrity, fairness, or lawful operation, including fraud,
          tampering, or technical failure.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>21) Privacy</h2>
        <p className="miniMuted">
          Sponsor collects and uses information to operate the site, enforce these Rules, prevent fraud, and administer
          prizes. Sponsor may share limited information with service providers (e.g., payment processors) as necessary to
          operate the service. Sponsor may publish winner usernames and contest results as described above. Do not use the
          service if you do not consent to these practices. A dedicated Privacy Policy may be provided on the site.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>22) Disclaimers</h2>
        <p className="miniMuted">
          THE SITE AND CONTEST ARE PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT
          PERMITTED BY LAW.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>23) Limitation of Liability</h2>
        <p className="miniMuted">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SPONSOR WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL,
          SPECIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM OR RELATING TO THE CONTEST
          OR SITE, EVEN IF SPONSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. SPONSOR’S TOTAL LIABILITY FOR ANY
          CLAIM WILL NOT EXCEED THE AMOUNT PAID BY YOU (IF ANY) FOR THE APPLICABLE CONTEST PERIOD.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>24) Disputes; Governing Law</h2>
        <p className="miniMuted">
          These Rules are governed by the laws of the State of Texas, without regard to conflict-of-law principles,
          except where prohibited. Any dispute must be brought in a court of competent jurisdiction in Texas, unless
          applicable law requires otherwise. Sponsor may, at its discretion, require informal dispute resolution prior to
          litigation.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>25) Changes to Rules</h2>
        <p className="miniMuted">
          Sponsor may update these Rules from time to time. Material changes will not be applied retroactively to a
          contest period that has already ended. The version posted on the site at time of entry governs that contest
          period.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>26) Contact</h2>
        <p className="miniMuted" style={{ marginBottom: 0 }}>
          For questions about these Rules, email <strong>DrawnFray@gmail.com</strong> or write to the AMOE mailing
          address listed above.
        </p>

        <div style={{ height: 10 }} />
      </div>
    </PanelShell>
  );
}
