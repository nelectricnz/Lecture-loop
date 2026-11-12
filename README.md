# Lecture Loop

Upload lectures (PDF, Word, PowerPoint, transcripts, slide photos or pasted text) and study them as
notes, explanations in different styles, narrated explainer videos, flashcards, quizzes, a tutor chat
and teach-back grading.

## How it works

- `public/index.html` is the whole app. Lectures and study materials are saved in the browser (IndexedDB).
- `netlify/functions/ask.mts` serves `/api/ask`. It checks the site passcode, then streams answers from
  Claude. On Netlify, AI Gateway supplies the Claude credentials, so no Anthropic API key is needed.
- `public/tts-worker.js` runs the Kokoro text-to-speech model in the browser for the video voice-over.
  It is free, needs no account, and downloads about 90 MB the first time a video is narrated.

## Netlify settings

Set these under **Project configuration › Environment variables**, then redeploy:

| Variable | Required | Purpose |
|---|---|---|
| `SITE_PASSCODE` | Yes | Visitors must enter this before any Claude feature works. Without it the function refuses every request. |
| `CLAUDE_MODEL` | No | Model ID to use. Defaults to `claude-opus-5-5`. |
| `ANTHROPIC_API_KEY` | No | Your own key, if you prefer it to Netlify AI Gateway credits. |

Answers must finish within Netlify's 60-second function limit, so very long lectures work best split into parts.

## Run locally

```bash
npm install
npx netlify-cli dev
```

AI Gateway only works locally after the project has had one production deploy.
