// The microphone's recent audio, shared between the mic hook (which fills
// it) and the pages that need a clip of it: the live cook to ask who
// spoke, voice binding to enrol a voice. One module-level ring because
// the app has exactly one mic. See utils/audioRing.js for the indexing.
import { createAudioRing } from "../utils/audioRing.js";

export const audioTap = createAudioRing();
