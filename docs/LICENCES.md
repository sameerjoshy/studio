# Licences

Studio itself is MIT. The engines it drives are not all MIT, and their terms
follow the output.

| Engine | Licence | What it means for you |
|---|---|---|
| Kokoro-82M | Apache-2.0 | Commercial use allowed. No voice cloning. |
| XTTS v2 (Coqui) | Coqui Public Model License 1.0.0 | **Non-commercial only.** Output may not be used in revenue-generating work. Coqui is closed, so no commercial licence is available. |
| HyperFrames | Renderer CLI | Check the package licence before redistributing the renderer. |
| pptxgenjs | MIT | Commercial use allowed. |
| ppt-master | MIT | The optional PDF path pulls PyMuPDF, which is AGPL-3.0. |
| OpenMontage | AGPL-3.0 | Copyleft. If you modify it and offer it as a network service, you must publish the source. Keep it an external process rather than a vendored module. |
| Groq free tier | Groq terms | Free tier with rate limits. Check whether your prompts may be used for service improvement. |
| Gemini free tier | Google terms | Free-tier prompts may be used to improve Google's models. Do not send material you cannot share with that policy. |
| DeepSeek API | DeepSeek terms | Paid, metered. Used as the fallback. |
| GitHub Actions | GitHub terms | Free for public repositories. Fair-use limits apply. |

## Practical rule

If the output is going into paid work, use Kokoro for voice. Treat XTTS as
experimental and label any file it produces as non-commercial.

The catalog surfaces the licence on every capability card so this decision is
made at the point of use, not buried in a doc.
