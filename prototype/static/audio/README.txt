Study audio
-----------
Voice PROMPTS (incoming message in Voice mode):
  • VoiceFiles/*.mp3  (project root)     → preferred location
  • audio/mp3/*.mp3   (project root)
  • static/audio/prompts/*               → also served as /static/audio/prompts/...

Participant replies are uploaded to the server under static/audio/ with
timestamped names (see server.py /api/upload_audio).

The bundled prompt.wav demo is no longer used by the participant UI.
