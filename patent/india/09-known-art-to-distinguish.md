# Known art the draft is written to stand apart from

**DO NOT FILE THIS NOTE.** It is not a patentability search, not a freedom-to-operate opinion, and not a list of citations for Form 2. A registered agent should search Indian and foreign patent databases, and the products below, before anything is filed. Publicly known attended robots and browser fillers may anticipate or render obvious some or all of claims 1 to 10.

## What this draft treats as already known

Attended and unattended robots that fill web forms are widely sold and described. Products in that category include UiPath, Automation Anywhere, Microsoft Power Automate, and browser recorders and macro extensions. They already store an ordered script, find a control by selector or label, type a value, pause for a person, and resume. A claim that says only “a desktop app tells a browser extension to fill the next field” does not distinguish that art.

Separate browser sessions and remote runners are also known. So are recordings that are saved as a script, human approval queues, and side stores of values that were typed at runtime.

## Where the draft tries to draw a line

The specification is written so that the claimed arrangement is narrower than “a robot fills a form”:

- The controller and the extension are on the same computer, and the step messages use a loopback bridge. The form being written is the tab the operator is watching, and a hidden tab is not written.
- The cursor does not advance a later step on a short shared option label, or on a selector that is only a tag name.
- A placeholder or an unselected prompt is an empty value and fails the value check.
- Pause leaves that same form with the operator and keeps the cursor in the controller, rather than handing the operator a different session.
- A repair plan names one failed step.
- A recording of a page that matches no card stays a draft until a person approves a new card.
- Typed answers do not overwrite the authored allowed values.

Those points are drafting choices. They are not a finding that the points are new or non-obvious. An examiner, or a court, may find each of them in a manual, a product, or a patent, or may find the combination obvious once the problem of false step completion is stated.

## What the agent should do before filing

- Search for attended robotic process automation, browser-extension form fillers, human-in-the-loop step cursors, and label-based field matching.
- Search the specific match rule: ignoring Yes/No and generic selectors so that a later field is not marked done.
- If the closest art already pauses an attended robot on the user’s own browser, expect claims 1 and 2 to be narrowed or refused for lack of an inventive step.
- Do not add the product name, customer procedures, or a business advantage to the specification in order to “differentiate” it. Differentiation for this filing is the cursor and match behaviour described in Form 2.
