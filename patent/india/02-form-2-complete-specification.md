# FORM 2

**THE PATENTS ACT, 1970 (39 of 1970)**
**AND THE PATENTS RULES, 2003**

**COMPLETE SPECIFICATION**
**(See section 10 and rule 13)**

---

**DRAFT FOR REVIEW BY A REGISTERED INDIAN PATENT AGENT.**
This document has not been filed. It is not legal advice and it is not a patentability opinion. Names, addresses, and the application number are blanks. Do not submit it until a registered agent has settled the claims, run a prior-art search, and confirmed formal requirements on the filing day.

---

**TITLE OF THE INVENTION**

SYSTEM AND METHOD FOR MAINTAINING AN ORDERED STEP CURSOR AGAINST A LIVE ELECTRONIC FORM ON THE SAME COMPUTER

**APPLICANT**

Name: [TO FILL]
Address: [TO FILL]
Nationality: [TO FILL]

**PREAMBLE**

The following specification particularly describes the invention and the manner in which it is to be performed.

---

## Description

### Field of the invention

[0001] The invention relates to a process-execution system on a single computer. The system keeps an ordered step cursor aligned with controls of a live electronic form that an operator is watching in a browser on that same computer, and it stops writing the form when the operator takes over.

### Background of the invention

[0002] An electronic form displayed in a browser is a live document object model. Controls appear, change label, and share short option words such as “Yes” and “No”. A script that advances an index whenever any control matches a stored selector will mark a later step complete because an earlier short option, or a generic selector such as a bare input tag, already matches.

[0003] A robot that fills the form in a hidden or separate browser session writes controls the operator cannot see. When the operator needs to type one field, that session and the operator’s session diverge, and the step cursor no longer describes the form on the screen.

[0004] A recording of clicks on a page that has no stored procedure, if published immediately as an executable card, becomes a live procedure before a person has checked the steps. A list of allowed answers, if overwritten in the authored procedure each time an operator types a new value, loses the answers the author stored.

[0005] The technical problem addressed by this invention is to apply an ordered sequence of field steps to the form the operator is watching, on the same computer, without marking a later step complete on a weak match, and to return the same form to the operator without discarding the cursor.

### Summary of the invention

[0006] A process-execution system resident on one computer comprises a queue store, a desktop controller, a browser extension, a loopback bridge, and a matcher. The queue store holds queue cards. Each card is an ordered sequence of steps. Each step identifies a field action for an electronic form. The desktop controller presents one card and keeps a run state of idle, running, or paused, and a step cursor for the current step.

[0007] The browser extension runs in the browser that displays the form. The loopback bridge carries messages between the controller and the extension and does not leave the computer. While the run state is running, the extension applies the current step to a live control only when the form tab is visible to the operator.

[0008] The matcher associates a live control with a step. It withholds a completion mark from a later step when the candidate match rests only on a short option label or on a generic selector that does not stably identify the control. A placeholder and an unselected prompt are treated as no chosen value.

[0009] When the run state is paused, the extension stops applying further steps and leaves the form under the operator’s control. When the run state returns to running, application resumes at the first step that is not marked complete.

[0010] In further embodiments, one failed step is repaired from a capture of that step; work on a page that matches no card is held as a draft until a person approves it and a queue card is created; and answers typed on a marked step are stored apart from the authored allowed values and merged only on a copy of the card.

### Brief description of the drawings

[0011] The drawings are drafting figures. Reference numerals are consistent across the figures.

[0012] Figure 1 shows the process-execution system on one computer.

[0013] Figure 2 shows the loopback bridge and the messages it carries.

[0014] Figure 3 shows the run states and the return to the first incomplete step.

[0015] Figure 4 shows how the matcher accepts or withholds a completion mark.

[0016] Figure 5 shows application of one step to a visible form tab.

[0017] Figure 6 shows capture and repair of a single failed step.

[0018] Figure 7 shows recording of unmatched work, a draft, and approval into a queue card.

### Detailed description

[0019] Figure 1 shows a process-execution system 10 on a single computer 11. The computer 11 comprises a desktop controller 12, a queue store 14, a browser 24, and a loopback bridge 32. An operator 15 sits at the computer 11 and can see the browser 24. No part of the claimed message path between the controller 12 and the form requires a second computer.

[0020] The queue store 14 stores queue cards 16. A queue card 16 comprises an ordered sequence of steps 18 and, optionally, a form address and sample field data. Each step 18 has an identifier, an action, and one or more hints used to find a control. Actions used for writing or choosing include fill, select, click, and check. Actions that only point or delay include highlight and wait. A step 18 may carry a label, a find-by-label list, a find-by-text list, a selector, an expected value, a list of allowed values, and a mark that the step is mandatory.

[0021] The desktop controller 12 presents one queue card 16 and maintains a step cursor 20 and a run state 22. The run state 22 is one of idle, running, and paused, as shown in Figure 3. The step cursor 20 identifies the step 18 that is running or, if none is running, the first step 18 in the order that is not marked complete. In the best mode, a step marked failed is not selected as the coaching cursor while a later incomplete step remains; the failure is reported on that step, and repair of that step is separate.

[0022] The browser 24 displays an electronic form 28 in a tab. The form 28 is a live document comprising controls 30, such as text fields, lists, checkboxes, radio buttons, and buttons. A browser extension 26 executes inside the browser 24. The extension 26 reads the controls 30 and writes a control 30 only while the tab is visible to the operator 15.

[0023] The loopback bridge 32 couples the desktop controller 12 and the browser extension 26. In the best mode the bridge 32 is a WebSocket server bound on the same computer 11, and the extension 26 connects to the loopback address 127.0.0.1. The bridge 32 may listen on all local interfaces so that a health query can report the machine address, but the extension 26 uses the loopback address. Messages therefore stay on the computer 11. A capture channel 33, in the best mode a second local port, carries recordings and tab images. It is not required for the step cursor itself.

[0024] A matcher 34 runs where the live controls 30 can be read, in the best mode inside the extension 26, using the same rules on the controller 12 when a captured control must be paired with a step. A capture unit 36 records the visible control or the page when a step fails or when no card matches. A repair unit 38 builds a repair for one failed step. A recorder 40 stores an unmatched session as a draft procedure 42. An approval gate 44 publishes the draft and creates a queue card 16 only after a person accepts it. A learned-choice store 46 holds extra answers apart from the authored steps in the queue store 14.

[0025] Figure 2 shows the messages on the loopback bridge 32. On connection, each side exchanges a hello message 50 and thereafter ping and pong messages 51. If a connected socket gives no pong for a silence interval, in the best mode sixty seconds, the bridge 32 drops the socket so a half-open connection is not treated as a live extension.

[0026] A run-card message 52 carries the queue card 16, including the ordered steps 18 and the field data, to the extension 26. A watch-card message 53 asks the extension 26 to follow the card without treating every control change as a new procedure. An apply-step message 54 carries one step 18. A control message 55 carries an action of pause, resume, or stop. A step-update message 56 travels from the extension 26 back to the controller 12 and reports the step identifier and a status such as running, done, or failed. A repair-plan message 57 carries a repair for one identified failure. A value-check message 58 carries the result of comparing a control’s visible value with the values allowed for that step.

[0027] The bridge 32 normalises a shorthand fill, type, or set-value request into an apply-step message 54 whose action is fill, and a shorthand click or check request into an apply-step message 54 whose action is click or check. The normalised step receives an identifier, a selector when one was supplied, a label, and a find-by-label hint taken from the label when no hint was supplied. The bridge 32 forwards the message to a chosen extension client. If the sender names a client identifier, that client is used. Otherwise the bridge 32 uses the connected extension client. If no extension socket is open, the bridge 32 reports that the browser is unavailable and does not apply the step.

[0028] Figure 5 shows application of one step. At block 60 the controller 12 sends either a run-card message 52 or an apply-step message 54. At block 62 the extension 26 tests whether the form tab is visible to the operator 15. Visibility requires the document to be visible and not hidden. A hidden frame or a background tab fails the test. While the tab is not visible, the extension 26 waits, reports that the operator should switch to the form tab, and does not write a control 30. If the tab stays invisible until a visibility limit, in the best mode sixty seconds, the run stops with a failure and the form is unchanged by that run. At block 64, if the run state 22 is paused, the extension 26 waits, in the best mode polling about every 120 milliseconds, and does not write. At block 66 the matcher 34 binds the step 18 to a control 30. At block 68 the extension 26 performs the action: it sets a text value, chooses an option, clicks, or checks. At block 70 the extension 26 sends a step-update message 56. Highlight and wait actions may scroll or outline a control, and they do not by themselves mark a field step complete.

[0029] Figure 3 shows the run state 22. From idle 72 the operator starts a card and the state becomes running 74. From running 74 a pause control message 55 moves the state to paused 76. While paused 76, the form 28 remains the same document the operator 15 can type into. Resume returns to running 74 at the first step 18 that is not marked complete, shown as re-entry 78. Stop or completion returns to idle 72. Takeover is this pause on the same form 28, not the opening of a second form session. The step cursor 20 is kept in the controller 12, so the operator’s typing does not create a second index.

[0030] Figure 4 shows the matcher 34. Text is normalised by folding case, replacing non-breaking spaces, and collapsing whitespace. A short option label is a token of at most forty characters that is Yes, No, Y, N, true, false, on, or off, in any letter case. A weak question hint is a hint that, after non-alphanumeric characters are removed, is only a field-type word, optionally prefixed by a number word. Field-type words include yesno, text, textarea, dropdown, multiselect, checkbox, radio, date, number, and integer. Short option labels and weak question hints are discarded before a step is scored, so they cannot by themselves identify a step.

[0031] Distinctive hints for a step 18 are taken from its find-by-label list, its label, and its finder, and from checkbox labels that are not short option labels. A hint of eight characters or fewer matches a title only on an exact comparison, allowing a trailing required-field mark or a following space. A longer hint matches when the title contains the hint, or when the title is at least twenty characters and the hint contains the title. The score of a title against a set of hints is the length of the longest hint that matches. The score is zero when nothing matches.

[0032] A live control 30 exposes a title, an accessible name, a placeholder, and a current value. The matcher 34 scores the control against the distinctive hints of each step 18, skipping highlight and wait steps, and selects the step with the highest score above zero. A later step therefore receives a completion mark only when its own distinctive hint outscores earlier steps. A shared short option does not produce a positive score and cannot advance the cursor.

[0033] A selector is stable when it begins with an identifier hash or when it states a name, an id, a data-automation-id, a data-testid, or a data-test attribute. A selector that is only a tag name, with or without a type attribute, is not stable. The matcher 34 does not treat a hit on a non-stable selector as sufficient to mark a later step complete.

[0034] A visible widget string is not a chosen answer when it is empty, when it is a placeholder, or when it contains an unselected prompt. Placeholders include date masks, “select”, “select one”, “choose one”, “required”, and a string of only marks or dashes. Unselected prompts include “select one”, “select an option”, “please select”, “choose one”, and “choose an option”. When the widget string begins with a question of at least twelve characters, that prefix is removed before the test. A remaining string that is still a placeholder or a prompt, or a long string that ends with a question mark, is treated as no value. The resulting effective value is what the value check compares.

[0035] The value check compares that effective value with the expected list for the step. An empty value is not a match. A non-empty value matches an expected entry on equality, on a short expected entry appearing as a whole token inside the value, or on mutual inclusion when the expected entry has at least four characters. The value-check message 58 reports success, an empty control, or a wrong value. The step is not marked complete on an empty or wrong result.

[0036] A click step is matched by button text taken from find-by-text, find-button-by-text, and a label of at most forty-eight characters that contains no question mark. A button string matches a hint on equality. A hint of four to forty-eight characters may match by inclusion, and a short button string may match when the hint contains it, provided the button string is at most one hundred and twenty characters. When several click steps match, a caller-supplied preferred step identifier wins. Otherwise the last matching step in the ordered sequence is used, which avoids binding the click to an earlier step that reused the same button words.

[0037] Figure 6 shows repair of one failed step. At block 80 the extension 26 reports the step identifier, the failure, and a capture from the capture unit 36. The capture describes the control that was attempted, its visible text, and the selector that was used. At block 82 the repair unit 38 prepares a repair-plan message 57 for that step alone. The plan may widen matching, supply a replacement value, patch the step hints, or supply an alternate button text. At block 84 the bridge 32 delivers the plan to the extension 26, which resolves the pending repair by its repair identifier and retries that step. Other steps in the card are not re-run by the repair plan.

[0038] Figure 7 shows work that matches no queue card 16. At block 90 the recorder 40 stores the operator’s clicks and the field keys and values on the page, because the page address and the control labels do not match a card 16. At block 92 those events are synthesised into a draft procedure 42 whose status is draft. The draft is not offered to an operator as a runnable card. At block 94 a person edits the draft. At block 96 the approval gate 44 either dismisses the draft or approves it. Approval sets the procedure status to published, records the approval time, stores the ordered steps, and creates a queue card 16 in the queue store 14. Until that approval, the step cursor 20 of existing cards is unchanged.

[0039] The learned-choice store 46 records an extra answer only for a step 18 that is marked mandatory and whose action is fill or select. The authored allowed values in the queue store 14 are left as stored. A value that duplicates an authored allowed value, after case-folding and space-collapsing, is not written again. Rows are keyed by procedure identifier and step identifier. If a later value for the same step arrives inside a revise interval, in the best mode twelve seconds, that later value replaces the row, so a half-typed answer is not kept beside the finished answer. When the controller 12 prepares a card for a run, it builds a copy of the step list. On that copy, for each marked step, the allowed values are the authored values followed by each saved value once. The procedure record in the queue store 14 is not rewritten by this merge.

[0040] In a further embodiment, a document importer reads a procedure document and emits the same ordered step records the queue store 14 already holds. The importer does not change the matcher 34 or the bridge 32. Those steps become a queue card 16 only through the same store.

[0041] In a further embodiment, a desktop page actuator shares the run state 22. While the state is paused, the actuator waits and does not perform the next page action. This actuator is an alternative writer for a page the browser extension 26 is not attached to. The step cursor 20 remains the cursor in the desktop controller 12.

### Best mode

[0042] The best mode known to the applicant is as follows. The desktop controller 12 is a desktop application process on the computer 11. The browser 24 is a Chromium browser. The browser extension 26 is unpacked into that browser and connects as a client of the loopback bridge 32. The bridge 32 accepts WebSocket connections and also answers an HTTP health query. The extension endpoint is `ws://127.0.0.1:17321`. A capture endpoint on the same computer uses port 17322. Message type names on the bridge are `hello`, `ping`, `pong`, `run_card`, `watch_card`, `apply_step`, `repair_plan`, `value_check_result`, `step_update`, and `control`. The control actions include pause and resume.

[0043] Each queue card 16 is stored as a structured record with an identifier, a name, a form address, and a steps array. A step object carries `id`, `action`, `label`, and, according to the action, `selector`, `findByLabel`, `findByText`, `value`, `valueFrom`, `allowedValues`, and `mandatory`. Sample field data for a card is a flat map from field name to string. The extension 26 substitutes `valueFrom` against that map when applying a fill.

[0044] The matcher 34 implements the tests in paragraphs [0030] to [0036]. Highlight and wait steps are skipped when scoring a control for completion. The extension 26 refuses to fill while `document.hidden` is set or the visibility state is not visible, subject to an explicit bypass used only when the desktop controller has already brought the browser forward and the page visibility flag is stale. The pause wait and the visibility wait are those described in paragraphs [0028] and [0029].

[0045] Draft procedures produced by the recorder 40 remain in draft status until the approval gate 44 runs. Approval publishes the procedure and inserts a queue card whose title is the draft title with a leading “Draft:” prefix removed. Dismissal does not insert a card.

[0046] The learned-choice store 46 is a table of rows `sop_id`, `step_id`, `value`, and `created_at`, separate from the authored step records. The revise interval is twelve seconds. The merge in paragraph [0039] is performed on a copy at read time.

[0047] The foregoing best mode enables a person skilled in client-server browser programming to make and use the system. Equivalent bindings, ports, and storage formats that preserve the same cursor, match, pause, and approval behaviour are within the invention as claimed.

---

## Claims

1. A process-execution system resident on a single computer, the system comprising:

a queue store configured to store a plurality of queue cards, each queue card comprising an ordered sequence of steps, each step identifying a field action to be performed on an electronic form;

a desktop controller configured to present one of the queue cards and to maintain a run state selected from idle, running, and paused, and a step cursor identifying a current step in the ordered sequence;

a browser extension configured to execute in a browser on the same computer while the electronic form is displayed in a tab of the browser;

a loopback bridge on the same computer, configured to carry messages between the desktop controller and the browser extension without the messages leaving the computer; and

a matcher configured to associate a live control in the electronic form with a step of the presented queue card;

wherein, while the run state is running, the browser extension applies the current step to the associated live control only when the tab is visible to an operator of the computer;

wherein the matcher withholds a completion mark from a later step in the ordered sequence when a candidate association rests only on a short option label or only on a generic selector that does not stably identify the live control; and

wherein, when the run state changes to paused, the browser extension stops applying further steps and leaves the electronic form under control of the operator, and when the run state returns to running the desktop controller resumes application at the first step in the ordered sequence that does not carry a completion mark.

2. A method of executing an ordered sequence of field steps on an electronic form displayed in a browser on a computer, the method comprising:

storing, in a queue store on the computer, a queue card that comprises the ordered sequence;

maintaining, in a desktop controller on the computer, a run state selected from idle, running, and paused, and a step cursor identifying a current step of the ordered sequence;

transmitting the current step from the desktop controller to a browser extension in the browser over a loopback bridge that does not leave the computer;

applying, by the browser extension, the current step to a live control of the electronic form only while the run state is running and only while a tab that displays the electronic form is visible to an operator of the computer;

withholding a completion mark from a later step of the ordered sequence when a candidate association of the later step with a live control rests only on a short option label or only on a generic selector that does not stably identify the live control;

on a change of the run state to paused, stopping further application of steps and leaving the electronic form under control of the operator; and

on a return of the run state to running, resuming application at the first step of the ordered sequence that does not carry a completion mark.

3. The system as claimed in claim 1, wherein the matcher discards, before scoring a step, a hint that is a short option label selected from yes, no, and the one-letter and Boolean equivalents thereof, and a hint that reduces to a field-type word, so that the discarded hint produces no score toward a completion mark.

4. The system as claimed in claim 1, wherein a selector stably identifies the live control only when the selector comprises a control identifier or a named attribute selected from name, id, and a test-automation attribute, and wherein a selector that names only an element tag does not stably identify the live control.

5. The system as claimed in claim 1, wherein the matcher treats a visible control string as an empty value when the string is a placeholder or contains an unselected prompt, and wherein an empty value does not satisfy a value check for the step.

6. The system as claimed in claim 1, wherein a step whose action is highlight or wait is excluded from scoring toward a completion mark of a field step.

7. The system as claimed in claim 1, further comprising a repair unit configured to receive a capture of one failed step and to return, over the loopback bridge, a repair plan that addresses that failed step by a repair identifier without re-executing the remaining steps of the queue card.

8. The system as claimed in claim 1, further comprising a recorder configured, when no queue card matches a page the operator is using, to store the operator’s control interactions as a draft procedure that is withheld from execution, and an approval gate configured to create a new queue card from the draft procedure only after a person approves the draft procedure.

9. The system as claimed in claim 1, further comprising a learned-choice store, separate from authored allowed values of a step, configured to record an answer typed for a mandatory fill or select step and, when a later answer for the same step arrives within a revise interval, to replace the recorded answer, the desktop controller being configured to merge authored allowed values and recorded answers on a copy of the step while leaving the authored allowed values unchanged in the queue store.

10. The system as claimed in claim 1, wherein the loopback bridge carries a run-card message containing the ordered sequence, an apply-step message containing one step, a control message containing a pause action or a resume action, and a step-update message containing a step identifier and a status, and wherein the loopback bridge converts a shorthand fill request and a shorthand click request into the apply-step message.

---

## Annex of optional claims

These claims are not part of the ten-claim set above. Each claim beyond ten, and each page beyond the included page allowance, attracts an additional fee. Add a claim from this annex only after the agent confirms the fee and that the claim still shares one inventive concept with claim 1.

11. The system as claimed in claim 1, further comprising a document importer configured to convert a procedure document into an ordered sequence of steps and to place that sequence in the queue store as a queue card.

12. The system as claimed in claim 1, wherein the matcher binds a click step by comparing visible button text with a button hint of the click step and, when more than one click step matches, selects a click step identified by a supplied step identifier.

13. The system as claimed in claim 1, further comprising a page actuator on the computer, distinct from the browser extension, configured to perform a step of the queue card against a page and to wait without performing the next step while the run state is paused, the step cursor remaining the step cursor of the desktop controller.

14. The method as claimed in claim 2, comprising repairing a single failed step by sending a repair plan for a repair identifier of that step over the loopback bridge, without applying the repair plan to another step of the ordered sequence.

---

**Dated this [TO FILL] day of [TO FILL] 20[TO FILL]**

**Signature: [TO FILL]**

**Name: [TO FILL]**

**(Applicant / registered patent agent)**

**To**
**The Controller of Patents**
**The Patent Office, at [TO FILL: Delhi / Mumbai / Chennai / Kolkata]**
