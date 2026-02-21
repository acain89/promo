// src/pages/Terms.jsx
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";

/**
 * Terms & Conditions / Official Rules
 * drawnfray — Weekly Closest-Wins 4-Digit Promotional Contest (Texas Daily 4)
 *
 * IMPORTANT:
 * - Paid entries and AMOE entries participate in the SAME weekly contest and are determined the SAME way.
 * - No purchase necessary to enter or win.
 */

export default function Terms() {
  const nav = useNavigate();

  return (
    <PanelShell
      label="OFFICIAL RULES"
      labelClass="terms"
      bodyScroll
      headerRight={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="secondary"
            onClick={() => nav("/")}
            style={{ padding: "8px 10px", fontSize: "0.82rem" }}
          >
            Home
          </button>

          <button
            className="secondary"
            onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}
            style={{ padding: "8px 10px", fontSize: "0.82rem" }}
          >
            Back
          </button>
        </div>
      }
      footer={
        <>
          <div className="fineprint" style={{ textAlign: "center", opacity: 0.75, lineHeight: 1.25 }}>
            For verification:{" "}
            <a
              href="https://www.texaslottery.com/export/sites/lottery/Games/Daily_4/index.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              Texas Lottery — Daily 4
            </a>
          </div>

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
      <div style={{ textAlign: "left" }}>
        <h1 style={{ margin: "0 0 10px", fontSize: "1.15rem", letterSpacing: "0.02em" }}>
          Terms &amp; Conditions / Official Rules
        </h1>

        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>No purchase necessary to enter or win.</strong> Void where prohibited. Please read carefully. By
          accessing the site, creating an account, submitting an entry (paid or free AMOE), or using any feature, you
          agree to these Terms &amp; Conditions / Official Rules (“Rules”). If you do not agree, do not use the site.
        </p>

        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>Effective Date:</strong> {new Date().toLocaleDateString("en-US")}
        </p>

        <hr className="headerRule" />

        <h2 style={{ margin: "14px 0 8px" }}>1) Sponsor / Operator</h2>
        <p className="miniMuted">
          The promotional contest is operated by the site operator (“Sponsor”, “we”, “us”, “our”) in accordance with
          these Rules.
        </p>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>Sponsor:</strong> drawnfray (site operator) <br />
          <strong>Contact Email:</strong> DrawnFray@gmail.com <br />
          <strong>Mail-in Address:</strong> provided in the “No Purchase Necessary (AMOE)” section below.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>2) No Government / Lottery Affiliation</h2>
        <p className="miniMuted">
          This promotion and this website are independent and are <strong>not</strong> sponsored by, affiliated with,
          administered by, or endorsed by any state lottery, government entity, municipality, or agency. Any reference
          to publicly reported draw results is for informational and winner-determination purposes only.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>3) Promotion Overview (Daily 4 + Closest-Wins)</h2>
        <p className="miniMuted">
          Participants select one (1) four-digit number from <strong>0000–9999</strong>. Winner determination uses the
          publicly available Texas Daily 4 draw results (“Target Numbers”) for{" "}
          <strong>Morning, Day, Evening, and Night</strong> drawings.
        </p>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          For each drawing, an eligible entry’s distance (“DFT”, Distance From Target) is calculated as the absolute
          difference between the entry’s number and that drawing’s Target Number. The Reveal page shows posted targets,
          the current Projected Winner, and final results when available.
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
          Limit: <strong>one (1) entry per person per contest period</strong>, whether entered via paid entry or via
          AMOE. Attempts to exceed limits (including via multiple accounts, emails, identities, devices, payment
          instruments, or other methods) may result in disqualification of all related entries and account action.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>6) Contest Window, Cutoff, and Timekeeping</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            Each contest period has a start and end time shown on the site countdown timer (“Contest Window”).{" "}
            <strong>Entries must be locked before the timer reaches zero</strong> to be eligible for that contest
            period.
          </li>
          <li>
            <strong>Sponsor’s servers are the official timekeeping mechanism.</strong> Displayed countdowns are provided
            for convenience; if there is a discrepancy, Sponsor’s server time controls.
          </li>
          <li>
            AMOE entries not recieved by Friday will be played in the next available contest.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>7) How to Enter</h2>
        <p className="miniMuted">
          You may enter either by (A) paid entry through the site checkout process or (B) free mail-in AMOE.{" "}
          <strong>Both entry methods participate in the same contest period.</strong>
        </p>

        <h3 style={{ margin: "10px 0 6px" }}>A) Paid Entry (Site Checkout)</h3>
        <ol className="miniMuted" style={{ marginTop: 0 }}>
          <li>Create an account (username, email, password).</li>
          <li>Select a four-digit number (0000–9999).</li>
          <li>Complete checkout to lock your entry for the active contest period (subject to cutoff/queue rules).</li>
        </ol>
        <p className="miniMuted">
          <strong>Locked submissions are final and cannot be changed.</strong>
        </p>

        <h3 style={{ margin: "10px 0 6px" }}>B) No Purchase Necessary — Alternate Method of Entry (AMOE)</h3>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          <strong>No purchase is necessary to enter or win.</strong> To enter without a purchase, you may submit a free
          mail-in entry. AMOE entries are processed for the applicable contest period subject to cutoff/queue rules
          described above.
        </p>

        <h4 style={{ margin: "10px 0 6px" }}>AMOE Entry Requirements</h4>
        <p className="miniMuted" style={{ marginTop: 0 }}>
          Mail-in AMOE entries must be handwritten or typed legibly and must include all of the following:
        </p>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>Full legal name</li>
          <li>Phone Number</li>
          <li>Valid email address</li>
          <li>One (1) four-digit number (0000–9999)</li>
          <li>A statement: “I request one AMOE entry for drawnfray.”</li>
          <li>Signature and date</li>
        </ul>

        <h4 style={{ margin: "10px 0 6px" }}>AMOE Mailing Address</h4>
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
          <strong>Important:</strong> Only one (1) entry per person per contest period is permitted. If Sponsor receives
          multiple entries for the same person for the same contest period (paid and/or AMOE), Sponsor may disqualify
          all related entries for that period.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>8) Unique Number Rule (First Locked Owns It)</h2>
        <p className="miniMuted">
          Each four-digit number (0000–9999) may be claimed by only one (1) participant per contest period. Numbers are
          assigned on a <strong>first-locked, first-served</strong> basis. If a number has already been locked for a
          contest period, later attempts to select that same number for that contest period will be rejected.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>9) Winner Determination (Daily 4 Targets + DFT + Tie-breaker)</h2>
        <ol className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            The official Target Numbers are the publicly reported Texas Daily 4 results for Morning, Day, Evening, and
            Night (as applicable for that contest period).
          </li>
          <li>
            For each drawing, each eligible entry’s DFT is the absolute difference between the entry’s number and that
            drawing’s Target Number.
          </li>
          <li>
            <strong>Instant win rule (Exact Match):</strong> If an eligible entry exactly matches a posted Target Number
            on any drawing (Morning/Day/Evening/Night), Sponsor will finalize that contest period and that entry is the
            winner.
          </li>
          <li>
            <strong>Closest-wins rule (No Exact Match):</strong> If no eligible entry exactly matches any posted Target
            Number, the winner is the eligible entry with the <strong>smallest DFT</strong>. In that case, winner
            determination is finalized after the Night draw result is available.
          </li>
          <li>
            <strong>Tie-breaker:</strong> If two (2) or more eligible entries are equally close under the applicable
            rule above, the earliest locked timestamp recorded by Sponsor’s servers for that contest period wins. If
            timestamps are identical due to system conditions, Sponsor may apply an additional deterministic tie-break
            rule (e.g., internal processing order) to resolve the tie.
          </li>
        </ol>

        <h2 style={{ margin: "14px 0 8px" }}>10) Odds</h2>
        <p className="miniMuted">
          Odds of winning depend on the number of eligible entries received for the contest period and the distribution
          of selected numbers. Sponsor does not guarantee any odds.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>11) Prize, Prize Display, and Limits</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            The prize amount for the contest period is displayed on the website and may include bonuses as shown on the
            site.
          </li>
          <li>
            Sponsor may establish maximum prize caps, rollover policies, or promotional bonuses and will disclose such
            rules on the website for the applicable contest period.
          </li>
          <li>Prizes are non-transferable. No substitution except at Sponsor’s discretion where required for compliance.</li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>12) Taxes / Reporting</h2>
        <p className="miniMuted">
          Winners are solely responsible for all applicable federal, state, and local taxes, fees, and reporting
          obligations. Sponsor may require completion of tax forms (e.g., W-9) and may issue tax reporting documents
          (e.g., 1099) as required by law. Sponsor may withhold prize payment until required documentation is received
          and verified.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>13) Winner Verification, Disqualification, and Forfeiture</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>
            Potential winners may be required to verify identity, eligibility, and compliance (including confirming
            account ownership and completing forms).
          </li>
          <li>
            If a potential winner is found ineligible, non-compliant, or cannot be verified within a reasonable
            timeframe, Sponsor may disqualify the entry and select the next closest eligible entry as winner.
          </li>
          <li>
            Sponsor reserves the right to disqualify entries for fraud, abuse, tampering, automation, interference, or
            attempts to undermine the operation or integrity of the contest.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>14) Payment Processing (Stripe)</h2>
        <p className="miniMuted">
          Stripe (or a similar payment processor) may be used solely to process payments for paid entries. Sponsor does
          not provide payment processing services and does not hold user funds in escrow or custody.
        </p>
        <p className="miniMuted">
          If a payment is reversed (chargeback/dispute) or flagged as high-risk, Sponsor may suspend the associated
          account and may treat the entry as invalid for that contest period, consistent with fraud prevention and
          compliance rules.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>15) Refunds / Cancellations</h2>
        <p className="miniMuted">
          <strong>All sales are final</strong> unless Sponsor determines, in its sole discretion, that a refund or credit
          is appropriate due to a technical failure, duplicate charge, a voided contest period, or as otherwise required
          by law or payment processor rules.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>16) Prize Payment Method and Timing</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>Sponsor will display results on the site and may notify winners via email and/or phone as provided.</li>
          <li>
            Sponsor may require verification steps prior to payout. Payout timing may depend on verification, fraud
            review, and processor settlement periods.
          </li>
          <li>
            Sponsor will pay the prize using a method selected by Sponsor (for example, an electronic transfer) after
            verification is completed.
          </li>
          <li>
            Sponsor is not responsible for an email or notification being filtered, undelivered, or inaccessible due to
            user settings or provider issues.
          </li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>17) Public Results / Winners Record</h2>
        <p className="miniMuted">
          Sponsor may publish a public winners record (e.g., winner username, prize/bonus amounts, submission, target
          drawing label, DFT, and timestamp) and may maintain a historical record (for example, up to the most recent
          fifty-two (52) contest periods).
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>18) Account Rules, Conduct, and Integrity</h2>
        <ul className="miniMuted" style={{ marginTop: 0 }}>
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You may not use bots, automation, scripts, or other methods to interfere with the contest or site.</li>
          <li>You may not attempt to bypass entry limits, verification processes, or security controls.</li>
          <li>Sponsor may suspend or terminate accounts for violations, suspected fraud, or actions that threaten platform integrity.</li>
        </ul>

        <h2 style={{ margin: "14px 0 8px" }}>19) Technical Disruptions / Force Majeure</h2>
        <p className="miniMuted">
          Sponsor is not responsible for lost, late, incomplete, misdirected, corrupted, or delayed entries; network
          outages; server failures; software bugs; or other technical issues. Sponsor may cancel, suspend, modify, or
          void a contest period if an event materially affects integrity, fairness, or lawful operation, including
          fraud, tampering, or technical failure.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>20) Privacy</h2>
        <p className="miniMuted">
          Sponsor collects and uses information to operate the site, enforce these Rules, prevent fraud, and administer
          prizes. Sponsor may publish winner usernames and contest results as described above. Do not use the service if
          you do not consent to these practices.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>21) Disclaimers</h2>
        <p className="miniMuted">
          THE SITE AND CONTEST ARE PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT
          PERMITTED BY LAW.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>22) Limitation of Liability</h2>
        <p className="miniMuted">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SPONSOR WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL,
          SPECIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM OR RELATING TO THE CONTEST
          OR SITE, EVEN IF SPONSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. SPONSOR’S TOTAL LIABILITY FOR ANY
          CLAIM WILL NOT EXCEED THE AMOUNT PAID BY YOU (IF ANY) FOR THE APPLICABLE CONTEST PERIOD.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>23) Disputes; Governing Law</h2>
        <p className="miniMuted">
          These Rules are governed by the laws of the State of Texas, without regard to conflict-of-law principles,
          except where prohibited. Any dispute must be brought in a court of competent jurisdiction in Texas, unless
          applicable law requires otherwise.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>24) Changes to Rules</h2>
        <p className="miniMuted">
          Sponsor may update these Rules from time to time. Material changes will not be applied retroactively to a
          contest period that has already ended. The version posted on the site at time of entry governs that contest
          period.
        </p>

        <h2 style={{ margin: "14px 0 8px" }}>25) Contact</h2>
        <p className="miniMuted" style={{ marginBottom: 0 }}>
          For questions about these Rules, email <strong>DrawnFray@gmail.com</strong> or write to the AMOE mailing
          address listed above.
        </p>

        <div style={{ height: 10 }} />
      </div>
    </PanelShell>
  );
}