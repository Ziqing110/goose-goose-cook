# Voice commands and tests

This is the command inventory from the current page handlers and matchers. Each
page table lists the supported voice commands and the tests that cover them.
The matcher tests feed transcripts into the same page-command matcher and
phrase definitions used by the handlers. They verify matching and captured
values; they do not mount each page or assert every handler's UI side effect.

## How to use voice

- Click **Unmute** and allow microphone access. Unmute is a button, not a spoken
  command.
- Only the top voice layer listens. An open dialog can take over from its page;
  the active Live Cook takes over while a run is in progress.
- Global navigation and page commands are English. Live Cook also recognizes
  the Mandarin intent phrases listed below.
- `<NAME>`, `<STEP>`, `<INGREDIENT>`, and `<NUMBER>` stand for the matching name,
  step, ingredient, or number. Step and ingredient names are matched against
  the current board.
- Page commands accept some filler words, including “please”, “kindly”, “just”,
  “go ahead and”, “could you”, “can you”, “would you”, “will you”, “I want to”,
  “I'd like to”, “let's”, and a bare “me”.
- A command that could change or remove something may ask for confirmation.
  Depending on the prompt, answer “yes” / “yeah” / “yep” / “yup” / “sure” /
  “ok” / “okay” / “do it” / “go ahead” / “confirm” / “please”, or “no” /
  “nope” / “nah” / “don't” / “do not” / “cancel” / “never mind” / “stop” /
  “wait”. Destructive run-abandon commands require the exact passphrase shown
  in their page table.

## Shared commands

These commands are available across pages when a dialog or active Live Cook has
not taken over the microphone.

| Voice command | Test |
|---|---|
| Navigate by saying `go`, `open`, `show`, `take me`, `jump`, `switch`, or `navigate` with a destination: `home` / `the start`; `kitchen setup` / `the kitchen` / `equipment`; `conversation` / `the questions`; `inventory` / `the recipe` / `the board` / `ingredients`; `voice binding` / `voices` / `the cooks`; `schedule` / `the timeline` / `the plan`; `live cook` / `cooking` / `the cook`. | `src/utils/navCommands.test.js` covers every listed alias and navigation verb. `scripts/voice-commands-e2e.mjs` checks browser navigation to Inventory. |
| Go back: `go back`; `last page/step/screen`; `previous page/step/screen`; or the short forms `back` and `previous`. | `src/utils/navCommands.test.js` covers every alias and the conversation guard. |
| Ask for help: `help`, `command`, `commands`, `what can I say`. | `src/utils/navCommands.test.js` covers every phrase. |

## Home

| Voice command | Test |
|---|---|
| Add a kitchen: `add a kitchen`, `add another kitchen`, `new kitchen`. | `src/utils/pageVoiceGrammar.test.js` covers all phrases. |
| Start a run: `start the run`, `start cooking`, `start the session`. | `src/utils/pageVoiceGrammar.test.js` covers all phrases. |
| Resume a run: `resume`, `carry on with the run`. | `src/utils/pageVoiceGrammar.test.js` covers both phrases. |
| Abandon a run: `abandon`, `abort`, `discard`, or `cancel` the run/session/cook. Confirm with the exact phrase `I want to abort this cooking session`. | `src/utils/pageVoiceGrammar.test.js` covers the action phrases. `src/utils/navCommands.test.js` checks the exact passphrase and rejects yes or extra words. |
| In the kitchen picker, say a kitchen’s full name or a distinctive word that belongs to only that kitchen. Cancel with `cancel`, `never mind`, or `go back`. | `src/utils/kitchenPick.test.js` checks full-name and unique-word selection and ambiguous words; `src/utils/pageVoiceGrammar.test.js` covers picker cancellation phrases. |
| When the Kitchen Profile dialog is open, use the commands in [Kitchen Profile dialog](#kitchen-profile-dialog). | `src/utils/pageVoiceGrammar.test.js` covers the dialog matcher phrases. |

## Kitchen setup

This page asks for a replacement kitchen if the session’s original kitchen was
removed.

| Voice command | Test |
|---|---|
| Say the kitchen’s full name or a distinctive word that belongs to only that kitchen to select it. A word shared by kitchens selects neither. | `src/utils/kitchenPick.test.js` covers full names, unique words, and ambiguous words. |
| Shared navigation and help commands are listed in [Shared commands](#shared-commands). | `src/utils/navCommands.test.js` covers every listed alias and verb. |

## Conversation

| Voice command | Test |
|---|---|
| Dictate an answer to the current question. Partial speech appears while you speak; the final transcript is submitted. | `scripts/voice-commands-e2e.mjs` checks partial and final dictation. `src/utils/voicePageCommands.test.js` checks shared dictation routing. |
| While dictating, use a short, clear named-destination command to navigate. | `src/utils/navCommands.test.js` tests named navigation during dictation. |
| After the conversation is complete: `check inventory`, `continue to inventory`, `go to inventory`. | `src/utils/pageVoiceGrammar.test.js` covers all three phrases. The browser e2e checks a separate navigation sequence to Inventory. |
| An answer that isn't one (fillers, wrong units, off-topic sentences, English or Chinese) is asked about again; "Did you mean …?" readings take a yes. | `src/utils/understanding.test.js` covers the offline reader. `scripts/voice-commands-e2e.mjs` runs it in the browser with the answer model unavailable. |
| Any time, including while dictating: `start over`, `start again`, `let's start over`, `restart`; `go back`, `go back home`, `go home`, `take me home` (goes Home); `go back to the last question`, `previous question`, `go back a question`. All three ask for confirmation. Only as the whole utterance. | `src/utils/pageVoiceGrammar.test.js` checks the phrases and that longer answers containing them do not match. `src/utils/voiceTurn.test.js` checks they are heard while dictating. `scripts/voice-commands-e2e.mjs` checks them in the browser. |

## Inventory and recipe board

| Voice command | Test |
|---|---|
| Mark an ingredient out: `no [more] <INGREDIENT>`, `out of <INGREDIENT>`, `<INGREDIENT> is out`, `don't/dont have [any] <INGREDIENT>`, `mark <INGREDIENT> out`. | `src/utils/pageVoiceGrammar.test.js` checks all forms with a multiword ingredient. |
| Mark an ingredient on hand: `got [the/some] <INGREDIENT>`, `have [the/some] <INGREDIENT>`, `found [the/some] <INGREDIENT>`, `<INGREDIENT> is back/on hand`, `mark <INGREDIENT> on hand`. | `src/utils/pageVoiceGrammar.test.js` checks all forms with a multiword ingredient. |
| Mark all ingredients on hand: `everything's on hand`, `everything is on hand`, `mark everything on hand`, `all on hand`. | `src/utils/pageVoiceGrammar.test.js` checks every phrase. |
| Add a task or step: `add a task`, `add another task`, `add a step`, `add another step`. Optionally add `to`, `called`, `named`, or `for` plus a task name; place it with `before <STEP>` or `between <STEP> and <STEP>`. | `src/utils/pageVoiceGrammar.test.js` checks each command, connector, and placement parse. `src/utils/stepNameMatch.test.js` covers shared step-name resolution. |
| Show ingredients: `show [me] [the] ingredients`, `ingredients tab`, `go to [the] ingredients`. Show the board: `show [me] [the] recipe graph/board`, `recipe graph`, `go to [the] recipe graph/board`. | `src/utils/pageVoiceGrammar.test.js` checks both tabs and their phrase variants. |
| Zoom: `zoom in`, `zoom closer`, `zoom in closer`, `zoom out`. Fit: `fit [the] board/graph`, `reset zoom`, `zoom to fit`. | `src/utils/pageVoiceGrammar.test.js` checks Inventory zoom phrases. `scripts/voice-commands-e2e.mjs` checks the actual zoom effect on Schedule. |
| Pan or scroll: `scroll/pan [to the] right`, `scroll/pan [to the] left`, `scroll/pan up`, `scroll/pan down`. | `src/utils/pageVoiceGrammar.test.js` checks every direction and verb. |
| Find a step: `scroll to [the] step <STEP>`, `find [the] step <STEP>`, `show me [the] step <STEP>`. Close matches ask for confirmation. | `src/utils/pageVoiceGrammar.test.js` checks all phrase forms and captures the step name. `src/utils/stepNameMatch.test.js` tests step-name matching. |
| Open a step for editing while the plan is unapproved: `open [the] step <STEP>`, `edit [the] step <STEP>`, `select [the] step <STEP>`. Close matches ask for confirmation. | `src/utils/pageVoiceGrammar.test.js` checks all phrase forms and captures the step name. `src/utils/stepNameMatch.test.js` tests step-name matching. |
| Approve with `approve` (confirmation required). After approval, use `revise`, `unapprove`, or `go back to editing`. | `src/utils/pageVoiceGrammar.test.js` checks the action phrases; `src/utils/navCommands.test.js` checks confirmation responses. |
| Remove blocked steps: `remove [the] blocked step(s)`, `drop [the] blocked step(s)` (confirmation required). | `src/utils/pageVoiceGrammar.test.js` checks the phrase variants. |
| When an equipment notice is shown: `edit the kitchen profile`, `edit the kitchen`, `cook it anyway`. The edit command opens the [Kitchen Profile dialog](#kitchen-profile-dialog). | `src/utils/pageVoiceGrammar.test.js` checks all phrases and the Kitchen Profile matcher. |

### Add Task dialog

| Voice command | Test |
|---|---|
| Name the task: `call it <NAME>`, `name it <NAME>`, `for <NAME>`. | `src/utils/pageVoiceGrammar.test.js` checks all naming phrases. |
| Set duration: `set duration/time to <NUMBER> minute(s)`, `make it <NUMBER> minute(s)`, `<NUMBER> minute(s)`. | `src/utils/pageVoiceGrammar.test.js` checks all duration forms. |
| Set difficulty: `set difficulty [to] low/medium/high`, `make it low/medium/high [difficulty]`. | `src/utils/pageVoiceGrammar.test.js` checks both phrase forms and the values. |
| Set phase: `set phase [to] prep/cook/plate`, `mark it [as] prep/cook/plate`. | `src/utils/pageVoiceGrammar.test.js` checks both phrase forms and the values. |
| Add equipment: `add <EQUIPMENT>`, `with <EQUIPMENT>`, `<EQUIPMENT> on`. Remove it: `remove/drop/without <EQUIPMENT>`, `<EQUIPMENT> off`. Equipment names are `cutting board`, `stove burner`, `wok`, `pot`, `oven`. | `src/utils/pageVoiceGrammar.test.js` checks every equipment name and action form. |
| Set dependencies: `runs/run after <STEP>`, `wait(s)/waiting on <STEP>`, `runs before <STEP>`. | `src/utils/pageVoiceGrammar.test.js` checks all dependency phrases and captures the name. `src/utils/stepNameMatch.test.js` tests shared step-name matching. |
| Add the task: `add it/this/the task to the board`, `add the task`, `create the step`, `that's it`. Cancel: `cancel`, `close the form`, `close this form`, `never mind`. | `src/utils/pageVoiceGrammar.test.js` checks all submit and cancel phrases. |

### Edit Step dialog

| Voice command | Test |
|---|---|
| Rename: `call it <NAME>`, `rename it <NAME>`, `name it <NAME>`. | `src/utils/pageVoiceGrammar.test.js` checks all rename phrases. |
| Duration, difficulty, phase, and equipment commands are the same as in the Add Task dialog. | `src/utils/pageVoiceGrammar.test.js` checks the shared forms in the Edit Step grammar. |
| Add a dependency: `runs/run after <STEP>`, `wait(s)/waiting on <STEP>`. Remove one: `stop waiting on <STEP>`, `remove <STEP> from runs after`, `don't/dont wait on <STEP>`. A dependency that creates a loop is refused. | `src/utils/pageVoiceGrammar.test.js` checks all add/remove phrases and captures the name. `src/utils/stepNameMatch.test.js` tests shared step-name matching. |
| Delete: `delete this step`, `delete it`, `remove this step` (confirmation required). Save: `save the step`, `save it`, `that's it`. Cancel: `cancel`, `close this/the step/editor`, `never mind`. | `src/utils/pageVoiceGrammar.test.js` checks all delete, save, and cancel phrases. |

### Delete Step dialog

| Voice command | Test |
|---|---|
| Choose dependency handling: `move them to what it/this step was waiting on`, `inherit`, `move it/them to/onto its/the old dependencies`; `choose for each`, `let me choose`, `pick it/them myself`; `just drop the link`, `drop the link(s)`. | `src/utils/pageVoiceGrammar.test.js` checks every mode-selection phrase. |
| Confirm with `remove the step`, `delete the step`, or `confirm`. Keep/cancel with `keep it`, `cancel`, or `never mind`. | `src/utils/pageVoiceGrammar.test.js` checks every confirmation and cancellation phrase. |

## Kitchen Profile dialog

This dialog is opened from Home, Inventory, or Schedule.

| Voice command | Test |
|---|---|
| Set the name: `call it <NAME>`, `name it <NAME>`, `call this kitchen <NAME>`, `the name is <NAME>`. | `src/utils/pageVoiceGrammar.test.js` checks all name phrases. |
| Set burners, cutting boards, or pots: `set <FIELD> to <NUMBER>`, `<NUMBER> <FIELD>`, `make it/that <NUMBER> <FIELD>`. Counts are clamped to the allowed ranges: burners 1–8, cutting boards 1–6, pots 0–6. | `src/utils/pageVoiceGrammar.test.js` checks all count phrase forms for each field. It does not test React state updates or clamping. |
| Increase a count by one: `add`, `one more`, or `another` plus `a/an` and the singular item, e.g. `one more burner`. Decrease it with `remove`, `drop`, `one less`, or `one fewer` plus the singular item. Applies to burners, cutting boards, and pots. | `src/utils/pageVoiceGrammar.test.js` checks all increase/decrease forms for each field. |
| Turn the wok or oven on: `<THING> on`, `yes <THING>`, `turn the <THING> on`, `turn on the <THING>`, `add/enable a|an|the <THING>`, `with a|an|the <THING>`. | `src/utils/pageVoiceGrammar.test.js` checks every switch-on form for both devices. |
| Turn the wok or oven off: `<THING> off`, `no <THING>`, `turn the <THING> off`, `turn off the <THING>`, `remove/drop/disable a|an|the <THING>`, `without a|an|the <THING>`. | `src/utils/pageVoiceGrammar.test.js` checks every switch-off form for both devices. |
| Save: `save the kitchen`, `save this kitchen`, `save it`, `that's it`. Close without saving: `cancel`, `close the form`, `close this form`, `never mind`, `discard this`. | `src/utils/pageVoiceGrammar.test.js` checks every save and cancel phrase. |

## Schedule

| Voice command | Test |
|---|---|
| Choose a mode: `co-op`, `coop`, `cooperation`, `cooperative`; or `versus`, `competition`, `competitive`, `vs`. | `src/utils/pageVoiceGrammar.test.js` checks every mode phrase. |
| Start: `go live`, `start the cook`, `start cooking` (confirmation required when ready). Without a mode or with a dependency loop, the page explains what is needed. | `src/utils/pageVoiceGrammar.test.js` checks all start phrases. Confirmation prompt and blocked-state UI are not mounted in this matcher test. |
| During a run, return to Live Cook with `go live`, `back to the cook`; view the result with `see the result`, `show the result`. | `src/utils/pageVoiceGrammar.test.js` checks all phrases. |
| Abandon an active run: `abandon`, `abort`, or `discard` the cook/run/session. Confirm with the exact phrase `I want to abandon this cook`. | `src/utils/pageVoiceGrammar.test.js` checks all action phrases. `src/utils/navCommands.test.js` checks the exact passphrase and rejects yes or extra words. |
| Return to the recipe board: `back to`, `go to`, `open`, or `show` the recipe graph/board; `fix the loop`. | `src/utils/pageVoiceGrammar.test.js` checks all phrases. |
| Edit the kitchen: `edit the kitchen`, `edit kitchen profile`. The opened form uses the [Kitchen Profile dialog](#kitchen-profile-dialog) commands. | `src/utils/pageVoiceGrammar.test.js` checks both opening phrases and the dialog grammar. |
| Zoom the co-op timeline: `zoom to fit`, `fit [the] timeline/plan/schedule/screen`, `fit`, `reset zoom`, `zoom in`, `zoom closer`, `zoom out`. | `src/utils/pageVoiceGrammar.test.js` checks all zoom phrases. `scripts/voice-commands-e2e.mjs` checks zoom in/out on Schedule. |
| Close details: `close`, `hide`, or `dismiss` the details/panel/sheet/step. | `src/utils/pageVoiceGrammar.test.js` checks every close phrase. |
| Open details: `select <STEP>`, `open <STEP>`, `show details for/on/of <STEP>`, `details for/on/of <STEP>`. Optionally prefix the name with `step` or `task`. Close matches ask for confirmation. Co-op only. | `src/utils/pageVoiceGrammar.test.js` checks the phrase forms and captured step name. `src/utils/stepNameMatch.test.js` tests shared step-name matching. |
| Ask about free time: `when am I/are we/do I/do we/can I/can we [get/be a] free/break`, `when is <NAME> [free/break]`, `free time`, `who's free`, `who is free`. Co-op only. | `src/utils/pageVoiceGrammar.test.js` checks the phrase variants. |

## Voice Binding

Cook references can use `first`, `1st`, `one`, `1`, `second`, `2nd`, `two`,
`too`, `2`, or a cook’s name.

| Voice command | Test |
|---|---|
| Name a cook: `call/name [the] [cook] <ORDINAL> [cook] [is/as] <NAME>`; `cook <ORDINAL> is/= <NAME>`; or `I'm <NAME>`, `I am <NAME>`, `my name is <NAME>`, `this is <NAME>` for the first unnamed cook. | `src/utils/pageVoiceGrammar.test.js` checks page phrase matching. `src/utils/cookVoice.test.js` covers ordinal/name resolution and spoken-name cleanup. |
| Open a chef/avatar picker: `pick`, `choose`, `select`, `change`, or `open` [my/the/a/your] `chef`, `bird`, or `avatar`, optionally `for/of <COOK>`. | `src/utils/pageVoiceGrammar.test.js` checks picker phrases; `src/utils/cookVoice.test.js` covers cook references. |
| Randomize a chef/avatar: `surprise me`, `surprise`, `roll the dice`, `random`, `random chef`, `random bird`. | `src/utils/pageVoiceGrammar.test.js` checks all phrases. |
| Start or redo a voice recording: `start reading`, `start recording`, optionally `for/of <COOK>`; `record again`, optionally `for/of <COOK>`. | `src/utils/pageVoiceGrammar.test.js` checks all recording-start phrases. |
| Add/remove a cook: `add a/another/the [second/2nd] cook`; `remove/delete [the] [cook] <COOK>` (confirmation required). | `src/utils/pageVoiceGrammar.test.js` checks page action phrases. `src/utils/cookVoice.test.js` covers cook reference resolution. |
| While recording, finish with `stop`, `stop and save`, `stop recording`, `stop reading`, `save`, `save it`, `done reading`, `that's it`; cancel with `cancel`, `never mind`, `discard`. | `src/utils/pageVoiceGrammar.test.js` checks every finish and cancel phrase. |
| In the open avatar picker, say an avatar’s name or color: Spoon/Blue, Whisk/Orange, Slurp/Green, Tomato/Violet, Booky/Red, Roller/Rose, Flip/Yellow, or Stir/Stone. Confirm with `that's me`, `confirm`, `this one`, `looks good`, `save`, `done`, `close`. Randomize with `random`, `surprise/me`, `roll the dice`; cancel with `cancel`, `never mind`, `go back`. | `src/utils/pageVoiceGrammar.test.js` checks every name/color and picker action phrase. |
| When the line-up is locked during a cook, return with `take me back`, `back to the cook`, `go back to the cook`; or go to Schedule with `continue to scheduling`, `go to scheduling`. | `src/utils/pageVoiceGrammar.test.js` checks both locked-page actions. |

## Live Cook

Address commands to **Goose**. After Goose asks a question, the answer can be
spoken without repeating its name. The keyword matcher below is the fallback;
the agent can also interpret natural English requests for the same actions.
Step names are resolved against steps the current cook can act on.

| Voice command | Test |
|---|---|
| Claim a step: `claim <STEP>`, `I'll take/do <STEP>`, `take <STEP>`, `I've got <STEP>`, `give me <STEP>`, `mine <STEP>`. | `src/utils/voiceCommands.test.js` checks every claim phrase against the claimable step; `src/utils/liveCook.test.js` and `src/utils/stepNameMatch.test.js` cover state and name matching. |
| Start a step: `start/starting <STEP>`, `begin <STEP>`, `let's go <STEP>`, `on it <STEP>`, `go <STEP>`. | `src/utils/voiceCommands.test.js` checks every start phrase against the current step. |
| Mark a step done: `done`, `finished`, `finish`, `complete/completed`, `got it`, `that's it`, optionally with a step name. | `src/utils/voiceCommands.test.js` checks the list. Its expected-behavior test for bare `finish` currently fails because the matcher returns `unknown`. |
| Skip a step: `skip`, `forget that/it`, `not doing`, `cancel that`. | `src/utils/voiceCommands.test.js` checks every skip phrase and the active-step fallback. |
| Put a step back: `drop`, `put it/this back`, `someone else can take`, `give it/this back/up`. | `src/utils/voiceCommands.test.js` checks every drop phrase and the active-step fallback. |
| Undo: `undo`, `never mind`, `oops`, `wait no`, `I didn't`. | `src/utils/voiceCommands.test.js` checks every undo phrase. |
| Pause: `pause`, `hold on`, `take a break`, `take five`, `time out`, `timeout`. Resume: `resume`, `unpause`, `back on`, `keep going`. | `src/utils/voiceCommands.test.js` checks every listed pause and resume phrase; `src/utils/liveCook.test.js` covers related run state. |
| Finish the cook: `we're/we are done`, `all done`, `finish [the] cook`, `end the cook`, `dinner's up`. | `src/utils/voiceCommands.test.js` checks every listed phrase; `src/utils/liveCook.test.js` covers finish state. |
| Ask for status: `status`, `what's next`, `what now`, `where are we`, `how long`, `how much`. Ask for score: `score/s`, `point/s`, `leaderboard`, `who's winning`, `am I winning`. Ask for help: `help`, `command(s)`, `what can I say`, `what can you do`. | `src/utils/voiceCommands.test.js` checks every listed status, score, and help phrase. `server/agent/turn.test.js` tests agent tool handling, not generated answers. |
| Ask a cooking question. If web search is configured, Goose can look up a technique, substitution, rescue, or measurement. | `server/agent/turn.test.js` tests tool handling, not generated answers or spoken question variants. |
| Mandarin intent phrases: resume `继续`, `接着`; pause `暂停`, `等一下`; finish `都好了`, `都做完了`, `可以上菜`, `全部完成`; status `还要多久`, `还有多久`, `到哪了`, `接下来`; claim `我来`, `我做`, `给我`; done `好了`, `做好`, `完成`, `弄好`; start `开始`, `我上`. | `src/utils/stepNameMatch.test.js` includes selected Mandarin and code-switched examples. The newer command matcher tests focus on English. |

## Cook Summary

| Voice command | Test |
|---|---|
| No voice commands. The VoiceBar is hidden on this page. | No voice command test applies. |

## Test coverage notes

- `src/utils/navCommands.test.js`, `src/utils/voicePageCommands.test.js`,
  `src/utils/pageVoiceGrammar.test.js`, `src/utils/kitchenPick.test.js`,
  `src/utils/voiceCommands.test.js`, `src/utils/liveCook.test.js`,
  `src/utils/stepNameMatch.test.js`, and `src/utils/cookVoice.test.js` are unit
  tests. Page grammar tests register the production phrase definitions with
  the shared matcher; they do not mount every page or verify all UI effects.
- `scripts/voice-commands-e2e.mjs` exercises a browser sequence: unmute, zoom in,
  zoom out, navigate to Inventory, then dictate and submit a Conversation answer.
  It uses fake microphone audio and deterministic mocked transcripts; it does
  not measure real speech-recognition accuracy or audible text-to-speech.
- `scripts/livecook-e2e.mjs` exercises typed Live Cook input, not microphone
  voice. `server/agent/turn.test.js` tests tool validation, not generated LLM
  wording.
- There is no generic “next page” command. Forward navigation uses the page’s
  own command, such as “approve” or “go live”.
