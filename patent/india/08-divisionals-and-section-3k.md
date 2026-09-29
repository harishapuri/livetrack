# Divisionals and section 3(k)

**DO NOT FILE THIS NOTE.** It is for the registered patent agent who reviews Form 2. It is not a legal opinion and not an instruction to the Patent Office.

## Why the claim set is this narrow

Section 10(5) requires one inventive concept. The concept in claims 1 and 2 is a same-computer arrangement that keeps an ordered step cursor aligned with the live form the operator is watching, withholds a completion mark on a weak match, and pauses without opening a second form.

These features are in the description as embodiments, and in the dependent claims, because they use that same cursor and bridge:

- Value check that treats a placeholder or an unselected prompt as empty (claim 5).
- Highlight and wait steps excluded from completion scoring (claim 6).
- Repair of one failed step over the bridge (claim 7).
- A draft recorded when no card matches, published only after a person approves it (claim 8).
- Extra answers stored apart from the authored allowed values (claim 9).
- The named bridge messages (claim 10).

The annex claims (document import, click-text binding, a second page actuator, method-form repair) stay out of the filed set unless the fee is accepted and unity still holds.

## What to argue if an examiner cites section 3(k)

Section 3(k) excludes a mathematical method, a business method, a computer programme per se, and algorithms. A business-method exclusion is not cured by putting the method on a computer. A computer-program exclusion is argued, where the facts support it, by showing a technical effect in how the system behaves.

The technical problem stated in the specification is alignment of an ordered cursor with a live document object model on the same computer:

- A later step is not marked complete because an earlier short option label, or a selector that is only a tag name, already matches.
- The extension writes a control only while the form tab is visible, so the cursor describes the form the operator sees.
- Pause stops further writes on that same form. The cursor stays in the desktop controller. Takeover does not open a second session and a second index.
- One repair plan names one failed step. It does not restart the card.
- A recorded page does not become an executable card until a person passes the approval gate, so an unreviewed event log cannot move the cursor of a live card.
- Authored allowed values stay in the queue store. Typed answers are merged on a copy.

Those are effects on control state, match errors, and session identity. They are not a claim to faster onboarding, ticket handling, or any business outcome. The agent should not answer an examination report by stressing time saved or labour saved.

An examiner can still treat the substance as a program that fills forms, or as administration of office work. This note does not say the argument will succeed. Claims 1 and 2 are the narrowest statement of the technical arrangement. If the examiner allows anything, it is likely to be narrower than claim 1. Dependent claims that recite only “store an answer” or “import a document” are easier to refuse and should be dropped in a reply if they weaken the technical case.

## Features left out of this filing

The product also ranks past work tickets, finds people with related experience, rewrites email, and captures Teams meetings and chat. Those do not share the step-cursor concept. Putting them in claim 1 would support a unity objection and a broader section 3(k) objection. They are not described as part of the claimed invention. If protection is wanted later, each needs its own search and, only if the search supports it, its own application. Outlines below are not claims and are not ready to file.

### Past-work retrieval

A search phrase is reduced to plain words. A model proposes related ticket identifiers. Any identifier that is not in the candidate list already retrieved from the tracker is discarded. The technical point, if one is pursued, is that the displayed set cannot contain an identifier the retrieval step did not return. That is a different invention from the form cursor.

### Expert search

A local index of people, built from tracker records, is queried and ranked. People on a deny list, and people the tracker marks inactive, are removed. The result is a ranked list of people. That is a search and ranking method. It does not move a form step cursor.

### Email rewrite

A draft message is rewritten under constraints on greeting and sign-off. The output is text. There is no live-form cursor and no same-computer bridge to a browser control.

### Teams minutes and chat overlay

A meeting window is selected, a transcript is turned into minutes, and a small overlay is positioned on a compose area. Window choice and overlay geometry are a different technical subject from form-step matching. They should not be added to claims 1 to 10.

## Sufficiency

The best-mode section names the loopback address, the ports, the message names, the match rules, the pause wait, the visibility limit, the draft status, and the separate answer table. It does not include source code, model prompts, credentials, or customer procedures. Publication will disclose what Form 2 contains. Do not add those omitted materials to “strengthen” the filing.
