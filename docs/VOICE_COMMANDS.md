# Voice commands by page

What you can say, page by page. Compiled from the code (`registerVoiceCommands`
call sites, `navCommands.js`, `voiceCommands.js`), not from design intent, so
gaps are listed as gaps.

## How matching works

- Speech is lowercased and stripped of punctuation. Commands are **English only**.
- Filler is forgiven: *please, just, could you, can you, I want to, let's*, and a bare *me*.
- Only the **top layer** listens. An open dialog (marked **exclusive** below)
  blocks page commands and navigation; the way out is one of its own commands.
- Utterances that contain a subject (*I, we, you, he, she, they, let's…*) are
  treated as conversation and ignored, so say commands as imperatives. Exception:
  the "I'm Mia" naming command on Voice Binding opts out of that rule.
- Low-confidence transcripts are dropped or, if borderline, the bar asks first.
- Some commands **ask before acting** (marked *asks*): say **yes** / **no**
  (*yeah, yep, sure, okay, do it, go ahead, confirm* / *nope, cancel, never mind, stop, wait*).
- The step-by-name commands pick the closest step. An exact match acts; a close one asks
  "…? Say yes or no."; no match says it couldn't tell.

## Everywhere (navigation)

Page commands are checked first, so a page can claim a phrase that would otherwise navigate.

| Say | Does |
|---|---|
| "go back", "previous page/step/screen" | Back one page |
| "back", "previous" (short, no subject) | Back one page |
| "go to / open / show / take me to / jump to / switch to / navigate to" + a name | Go to that page |
| "help", "what can I say", "commands" | Lists commands |

Page names: **home** / the start · **kitchen setup** / the kitchen / equipment ·
**conversation** / the questions · **inventory** / the recipe / the board / ingredients ·
**voice binding** / voices / the cooks · **schedule** / the timeline / the plan ·
**live cook** / cooking / the cook.
Page names match as whole words ("the homemade sauce" is not "home"). A destination
with a subject is conversation ("we should go home"), but the forgiven filler above
still counts ("can you take me home", "let's go to the schedule").

A page you can't go to says why instead of moving: "Not yet — finish this step
first." for a later stage, "Start a run first." with no run, and "This run already
has its kitchen." for kitchen setup, which only opens when a run's kitchen was
deleted. Reachable means the page's route guard would let you stay, so the voice bar
and the guards can't disagree (`routeGuards.js`). Live cook counts once the run exists.

A destination heard with middling confidence asks "Did you mean go to …? Say yes or
no." instead of moving; a garbled one is dropped. "Go back" from the first page of
the visit answers "That's as far back as I can go." rather than leaving the app.

While a page takes dictation (Conversation) only a named destination in six words
or fewer counts.

An open question (a *asks* command, or "Did you mean…?") closes on anything that
isn't yes or no, and what was said is then heard as a command in its own right.
A passphrase is the exception: anything but the exact sentence answers "That didn't
match, so nothing changed." and nothing else runs.

## Home

Commands depend on the hero state. "Add a kitchen" works in every state.

| State | Say | Does |
|---|---|---|
| any | "add a kitchen", "add another kitchen", "new kitchen" | Opens the kitchen form |
| Resumable run | "resume", "carry on with the run" | Resumes |
| Resumable run | "abandon / abort / discard / cancel the run / session / cook" | *Asks you to read back:* "I want to abort this cooking session" |
| Ready | "start the run / cooking / session" | Starts; with several kitchens asks "Which kitchen?" |
| Picking a kitchen | the kitchen's name, or one distinctive word of it | Starts there |
| Picking a kitchen | "cancel", "never mind", "go back" | Closes the picker |

A word shared by two kitchens picks neither.

## Kitchen form (dialog on Home and Inventory, **exclusive**)

| Say | Does |
|---|---|
| "call it / name it / call this kitchen / the name is" + name | Sets the name |
| "four burners", "set burners to four", "make it four burners" | Sets a count (burners 1–8, cutting boards 1–6, pots 0–6); out-of-range is clamped and says so |
| "add a burner", "one more / another burner" · "remove a burner", "one less / one fewer" | Steps a count (same for cutting board, pot) |
| "wok on", "add a wok", "with a wok", "turn on the wok", "yes wok" | Wok on (same for oven) |
| "wok off", "no wok", "without a wok", "remove / drop / disable the wok" | Wok off (same for oven) |
| "save the kitchen", "save it", "that's it" | Saves (asks for a name if empty) |
| "cancel", "close this / the form", "never mind", "discard this" | Closes |

## Conversation

Every answer is dictated into the answer box, so commands stand down. Only navigation
by name works while answering. When all questions are answered:

| Say | Does |
|---|---|
| "check the inventory", "continue to the inventory", "go to the inventory" | Goes to Inventory |

## Inventory

While the board is still being written nothing is live.

| Say | Does |
|---|---|
| "no ginger", "we're out of ginger", "ginger is out / gone", "I don't have any ginger", "mark ginger out" | Marks that ingredient out (not once approved) |
| "got ginger", "I have ginger", "found ginger", "add ginger back", "put the ginger back", "ginger is back / on hand", "mark ginger on hand" | Back on hand (says so if it already is) |
| "put it back", "add it back", "undo that" | Puts the last ingredient marked out back on hand |
| "show ingredients", "back to the ingredients", "go back to ingredients", "switch to ingredients", "ingredients tab", "ingredients" | Ingredients tab |
| "show the recipe graph / board", "recipe graph", "back to the graph", "switch to the board", "graph tab" | Graph tab |
| "zoom in", "zoom closer" · "zoom out" · "fit the board / graph", "reset zoom", "zoom to fit" | Zoom |
| "scroll / pan left / right / up / down" | Pans the graph |
| "scroll to step X", "find the step X", "show me the step X" | Scrolls to a step |
| "open / edit / select the step X" | Opens the step editor (not once approved) |
| "add a task", "add a step" | Opens the add-task form |
| "add a task to toast the sesame", "…called / named / for X" | Pre-fills the name |
| "add a task … before X" | Pre-fills "runs before X" |
| "add a task … between X and Y" | Pre-fills both positions |
| "approve", "approve the plan" | Approves and locks the board and the ingredient checklist, no yes/no (refused, with the reason, while a step is blocked) |
| "revise", "unapprove", "go back to editing" | Unlocks (only after approval) |
| "remove / drop the blocked steps" | *Asks*, then deletes them (only when steps are blocked) |
| "edit the kitchen (profile)" | Opens the kitchen form (only when the kitchen falls short) |
| "cook it anyway" | Dismisses the shortfall notice (same condition) |

The name after "add a task" is only read behind *to / called / named / for*;
otherwise the form opens and you type it.

### Add-task form (**exclusive**)

| Say | Does |
|---|---|
| "call it / name it / for" + name | Names the task |
| "five minutes", "set the duration to five minutes", "make it five minutes" | Duration |
| "difficulty low / medium / high", "make it high" | Difficulty |
| "phase prep / cook / plate", "mark it as plate" | Phase |
| "add a wok" / "wok on" · "remove the wok" / "wok off" | Equipment: cutting board, stove burner, wok, pot, oven |
| "runs after X", "waits on X" | Adds a dependency |
| "runs before X" | Adds a "runs before" |
| "add it to the board", "add the task", "create the step", "that's it" | Adds (needs a name) |
| "cancel", "close this form", "never mind" | Closes |

### Step editor (**exclusive**)

Duration, difficulty, phase and equipment work exactly as in the add-task form. Plus:

| Say | Does |
|---|---|
| "runs after X", "waits on X" | Adds a dependency (refused if it would create a loop) |
| "stop waiting on X", "don't wait on X" | Removes it |
| "delete this step", "delete it", "remove this step" | *Asks*, then deletes |
| "save the step", "save it", "that's it" | Saves |
| "cancel", "close this step / the editor", "never mind" | Closes |

### Delete-step dialog (**exclusive**)

| Say | Does |
|---|---|
| "move them to what it was waiting on", "inherit" | Dependents inherit its dependencies |
| "choose for each", "let me choose", "pick them myself" | Choose per step in the panel |
| "just drop the link", "drop the links" | Drop the links |
| "remove the step", "delete the step", "confirm" | Deletes |
| "keep it", "cancel", "never mind" | Cancels |

## Voice Binding

Cooks are "the first cook", "cook two", or by name once named.

| Say | Does |
|---|---|
| "call the first cook Mia", "name cook two Leo", "cook one is Mia" | Names that cook |
| "I'm Mia", "my name is Mia", "this is Mia" | Names the first unnamed cook |
| "pick a chef", "choose the bird", "change my avatar" (+ "for Mia" / "for the second cook") | Opens the chef picker |
| "start reading", "start recording", "record again" (+ "for Mia") | Starts the voice recording |
| "add a second cook", "add a cook" | Adds one (max two) |
| "remove the second cook", "remove Mia", "delete cook two" | *Asks*, then removes |
| "continue to scheduling", "go to scheduling" | Continues (needs a chef, name and voice for every cook) |

Names are at most two words and 24 characters; "I'm ready" and similar are not taken as names.

### Chef picker (**exclusive**)

| Say | Does |
|---|---|
| a bird's name or colour: "Whisk", "the orange one" | Selects it (Spoon/Blue, Whisk/Orange, Slurp/Green, Tomato/Violet, Booky/Red, Roller/Rose, Flip/Yellow, Stir/Stone); a taken bird is refused |
| "random", "surprise me", "roll the dice" | Random free bird |
| "that's me", "confirm", "this one", "looks good", "save", "done" | Confirms |
| "cancel", "never mind", "close", "go back" | Closes |

### While recording (**exclusive**)

Only two commands are heard, because the line being read starts "I'm Mia…".

| Say | Does |
|---|---|
| "stop", "stop and save", "stop recording", "save", "done reading", "that's it" | Saves the voice |
| "cancel", "never mind", "discard" | Discards |

### Line-up locked (a run is in progress)

| Say | Does |
|---|---|
| "take me back", "back to the cook" | Live cook |
| "continue to scheduling" | Schedule |

## Schedule

Nothing is live while the plan is still loading. Most commands need a plan on screen.

| Say | Does |
|---|---|
| "co-op", "cooperation" · "versus", "competition" | Picks the mode (refused once a run exists: the cards lock) |
| "go live", "start the cook" | *Asks*, then goes live. Without a mode, or with a dependency loop, says why instead |
| "go live", "back to the cook", "see the result" | With a run: back to Live cook, no question |
| "abandon / abort / discard the cook" | With a run in progress: *asks you to read back* "I want to abandon this cook" |
| "back to the recipe graph", "fix the loop" | Inventory |
| "edit the kitchen" | Opens the kitchen form (exclusive) |
| "zoom in", "zoom out", "fit the timeline", "zoom to fit" | Timeline zoom (co-op only) |
| "select / open the X", "details for X" | Opens that step's details (co-op only); a close name asks "Show …? Say yes or no." |
| "close the details" | Closes the details panel or sheet |
| "when am I free", "who's free", "free time" | Reads each cook's free stretches while something cooks on its own (co-op only) |

Free time follows the same rule as the lanes: hands-on steps and hands-on moments
(start, checks, finish) are busy; a gap under a running rail is free; a gap with
nothing running is a wait, not free time.

## Live cook

Before "Go live" the page is empty and navigation works as anywhere else ("go back
to the plan"). Once a run exists the page takes every turn and navigation stands down.

Say the agent's name first: **"Goose, I'm done with the onion"**. Turns without it
are ignored, and for a few seconds after Goose asks a question a short answer
("the garlic") needs no name. The other exception is a paused run: a short turn
that is only a resume ("resume", "keep going", "继续") restarts it without the name,
since the paused screen asks for exactly that; "we'll resume after the call" does not. The words go to a model that picks the action and the
step, so you can talk naturally ("take the garlic and start the rice"), and every
action runs through the same handler as its button. If the model is slow or
unreachable the page falls back to the keyword grammar below. Typed commands in
the agent box behave the same way. The mic must be unmuted in the voice bar.

Who is speaking comes from the local speaker service when it is running and both
cooks recorded their voice on the chef page; otherwise it is whoever is selected in
the speaker toggle.

The keyword grammar (also the fallback), parsed by `voiceCommands.js` and applied to
whichever cook is speaking. Tasks are matched by name among the ones that cook could
plausibly act on.

| Say | Does |
|---|---|
| "take the garlic", "claim …", "I'll take …", "mine" | Claims a step |
| "start", "begin", "on it", "go", "let's go" | Starts (own queue first) |
| "done", "finished", "complete", "got it", "that's it" | Finishes the current or named step |
| "skip", "forget it", "cancel that" | Skips |
| "drop", "put it back", "someone else take it" | Gives it up |
| "undo", "oops", "never mind", "wait no" | Undoes the last action |
| "pause", "hold on", "take a break", "time out" | Pauses every clock |
| "resume", "unpause", "back on", "keep going" | Resumes (no name needed while paused) |
| "status", "what's next", "where are we", "how long" | Reads status |
| "score", "points", "leaderboard", "who's winning" | Reads scores |
| "we're done", "all done", "finish the cook", "end the cook", "dinner's up" | Ends the run |
| "help", "what can I say", "commands" | Lists commands |

Intents are tried in that priority order, so "we're done" never counts as one step's "done".

## Other pages

**Pick a kitchen** (only reached when the session's kitchen was deleted): say a kitchen's name, or one word only it has, to use it and continue to Conversation. Cook Summary registers no voice commands beyond navigation.

## Known gaps

- **Recipe-graph step names** are matched by similarity, so near-identical steps
  ("cut the yellow onion" / "cut the red onion") will often ask rather than act.
- **Inventory "approve"** and **Voice Binding "remove"** ask a generic question
  rather than naming the target.
