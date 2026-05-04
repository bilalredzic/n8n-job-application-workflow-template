# n8n Gmail Job Application Pipeline

This repo holds the local n8n workflow for turning job-alert emails into a daily application shortlist.

## Moving Between Mac and Windows

This repo is portable. The workflow JSON and helper scripts can run on either macOS or Windows as long as n8n, Node.js, Chrome/Chromium, and Ollama are available on that machine.

What transfers cleanly:

- `workflows/job-application-daily.template.json`
- `workflows/code/*.js`
- `scripts/*.js`
- `profile.md`
- `package.json`
- README/config docs

What does not transfer automatically:

- n8n OAuth credentials for Gmail and Google Sheets
- local Ollama models
- local browser login state in `browser-state/`

After moving the repo to another machine, expect to reconnect the Gmail, Google Sheets, and Ollama credentials inside n8n.

## Candidate Profile

Copy `profile.example.md` to `profile.md`, then put the person's resume summary, target roles, preferred locations, avoid list, salary preferences, ranking rules, and output preferences there.

The n8n workflow stays generic. When `npm run fetch:server` is running, the local helper reads `profile.md` and attaches it to each job before the AI scoring node runs. If you give this repo to someone else, they should edit `profile.md`, reconnect their own credentials, and keep the workflow logic unchanged.

## Setup on macOS

Install Node.js, n8n, and Ollama. From the repo directory:

```bash
npm install
npm run browser:login
npm run fetch:server
```

In another terminal, start n8n if it is not already running:

```bash
n8n
```

Then import the workflow:

```bash
n8n import:workflow --input=workflows/job-application-daily.template.json
```

Make sure Ollama is running:

```bash
ollama serve
ollama list
```

If `ollama serve` says `bind: address already in use`, that is usually fine. It means Ollama is already running on `127.0.0.1:11434`.

## Setup on Windows / WSL

Install:

- Node.js LTS
- n8n
- Ollama for Windows
- Git, if using GitHub to move the repo

Recommended for this repo: run n8n and the helper scripts in the same environment where this repo lives. If the repo is in WSL, run these from WSL/Ubuntu, not from PowerShell:

```bash
npm install
npm run browser:login
npm run fetch:server
```

Keep the fetch server terminal open.

In another WSL terminal, start n8n:

```bash
n8n
```

Then import the workflow:

```bash
n8n import:workflow --input=workflows/job-application-daily.template.json
```

Make sure Ollama is running and your model is installed:

```powershell
ollama list
```

The workflow expects the Ollama credential in n8n to point to:

```text
http://127.0.0.1:11434
```

The browser fetch server runs at:

```text
http://127.0.0.1:3456/fetch-batch
```

That URL is already configured in the workflow's `Fetch browser fetch batch` node.

If you run n8n in Docker instead of directly in WSL, `127.0.0.1` points inside the container. In that case you must either run the fetch server in the same container/network or change the workflow URL to a host-reachable address such as `http://host.docker.internal:3456/fetch-batch` and start the server with `JOB_FETCH_HOST=0.0.0.0`.

## Google Sheet Template

Create a Google Sheet named `Job Pipeline` with a first tab named `Sheet1`. Put these exact headers in row 1:

```csv
date_found,company,title,location,url,source,description,fit_score,priority,resume_variant,status,follow_up_date,notes,job_key
```

The workflow writes one job per row and uses `job_key` as the matching column in the final `Append or update row in sheet` node. Keep the header names unchanged unless you also update that node's column mapping.

Column meanings:

- `date_found`: timestamp when the workflow found the job.
- `company`: employer name.
- `title`: job title.
- `location`: posting location or remote/hybrid text.
- `url`: best available job URL.
- `source`: email/source site such as `linkedin`, `jobright`, `handshake`, `glassdoor`, or `ziprecruiter`.
- `description`: best available job description from browser fetch or email snippet.
- `fit_score`: final 0-100 score after deterministic scoring and AI review.
- `priority`: `high`, `medium`, or `low`.
- `resume_variant`: short resume/application angle chosen from `profile.md` when available, or `general`.
- `status`: starts as `new`; can later be changed manually to `applied`, `skip`, `closed`, etc.
- `follow_up_date`: blank by default for manual tracking.
- `notes`: browser-fetch status plus AI recommendation/reasoning.
- `job_key`: stable dedupe key used by Google Sheets append/update.

The template workflow intentionally has blank Google Sheets document and sheet selections. After importing it, open the Google Sheets nodes in n8n and select your own `Job Pipeline` document and tab.

## Workflow

Import [`workflows/job-application-daily.template.json`](workflows/job-application-daily.template.json) into n8n.

The workflow currently does this:

1. Runs manually from n8n.
2. Searches Gmail for recent alerts from Jobright, LinkedIn, ZipRecruiter, Glassdoor, and Handshake.
3. Normalizes email content into individual job rows. LinkedIn digest emails are split into separate jobs instead of one row per email.
4. Reads the existing Google Sheet and skips jobs already seen by exact `job_key`, canonical URL, or normalized company/title.
5. Dedupes the current Gmail batch by canonical URL or normalized company/title before browser fetch and AI review.
6. Calls a local Chrome/Playwright fetch server to open each new job URL in a rendered browser and try to extract the real job description.
7. Merges the browser result back into the original job row, corrects obvious LinkedIn/Glassdoor metadata shifts from browser page titles, and computes a generic deterministic fallback score.
8. Sends the finalized job context plus `profile.md` to a local Ollama-backed n8n AI decision node that scores the job against the candidate profile/ranking config.
9. Applies the AI decision back into the existing Sheet columns (`fit_score`, `priority`, `resume_variant`, `notes`) and appends or updates rows in the `Job Pipeline` Google Sheet using `job_key` for dedupe.

If a row should be rescored despite already being in the Sheet, set its `status` to `refresh`, `rescore`, `retry`, or `rerun` before running the workflow.

## Browser Description Fetching

The browser helper exists because some job pages, especially LinkedIn, do not expose the real "About the job" description through a plain HTTP Request node. A real browser can render the JavaScript page and read visible text.

Install the local helper dependency:

```bash
npm install
```

One-time login setup:

```bash
npm run browser:login
```

This opens a separate Chrome profile stored in `browser-state/`. Log into LinkedIn and any other job sites you want the automation to read, then press Enter in the terminal. Do not commit `browser-state/`; it contains local browser session data and is ignored by `.gitignore`.

Manual test:

```bash
node scripts/fetch-job-description.js "https://www.linkedin.com/jobs/view/JOB_ID/"
```

Start the local fetch server before running the n8n workflow:

```bash
JOB_FETCH_CONCURRENCY=4 npm run fetch:server
```

The workflow's `Fetch browser fetch batch` node calls:

```text
http://127.0.0.1:3456/fetch-batch
```

Keep that terminal open while the workflow runs. If n8n cannot connect to `127.0.0.1:3456`, the browser-description step will fail and the workflow will fall back to the email snippet.

The same server also reads `profile.md` and exposes it at:

```text
http://127.0.0.1:3456/profile
```

Expected output is compact JSON with:

```json
{
  "status": "ok",
  "page_title": "...",
  "description": "...",
  "description_source": "linkedin_about_section"
}
```

If `status` is `blocked_or_login`, rerun `npm run browser:login` and make sure the browser profile is logged into the relevant site.

The fetch server intentionally keeps same-host browser requests conservative. Glassdoor defaults to one active request at a time because higher concurrency triggered Glassdoor security pages during testing. You can inspect live queue state with:

```bash
curl http://127.0.0.1:3456/health
```

## Handshake and School Email

If a school blocks Gmail forwarding, use one of these approaches:

1. Best case: connect the school mailbox directly in n8n with a Gmail OAuth credential. This only works if the school allows third-party OAuth access for n8n.
2. Fallback: use n8n's IMAP Email node against the school mailbox. This only works if the school allows IMAP or app passwords.
3. Reliable workaround: change Handshake notification email settings to send alerts to your personal Gmail, or add the personal Gmail as a secondary/contact email in Handshake if the school allows it.
4. Manual fallback: keep Handshake alerts in the school inbox, then periodically export or copy matching Handshake emails into Gmail. This is less automatic but still lets the same parser and Sheet workflow work.

The workflow search includes Handshake domains, but it can only see emails that are present in the Gmail account connected to the Gmail node.

## Gmail Search

Current Gmail query:

```text
(from:(jobright.ai OR linkedin.com OR ziprecruiter.com OR glassdoor.com OR joinhandshake.com OR mail.joinhandshake.com OR m.joinhandshake.com) OR subject:(Jobright OR LinkedIn OR ZipRecruiter OR Glassdoor OR Handshake)) newer_than:2d
```

Tune this in the `Get many messages` node after seeing real emails. Keep role/location preferences in `profile.md`; the Gmail query should mainly decide which job-alert emails are included. If you run the workflow once per day, `newer_than:1d` is usually enough and reduces repeated work. If you run manually or miss a day, `newer_than:2d` is safer.

## Recommended Next Nodes

To get closer to "best picks for today":

1. Replace the manual trigger with a Schedule Trigger at 7-8 AM.
2. Add a Gmail or Slack/Discord node after Google Sheets to send yourself the top 5 high-priority rows.
3. Add separate credentials/nodes for a school mailbox if OAuth or IMAP is allowed.

## AI Job Fit Agent

The AI branch starts after `Finalize job rows`:

```text
Prepare AI job review -> AI Decision - score with profile -> Merge job and AI review -> Apply AI job review -> Google Sheets
```

The model node is `Ollama Job Fit Model` and currently uses the existing `Ollama account` credential with the local `qwen3:8b` model at temperature `0`, JSON output mode, and an 8192-token context window.

Before running the workflow, make sure Ollama is running and the model is installed:

```bash
ollama serve
ollama list
```

If `qwen3:8b` is missing:

```bash
ollama pull qwen3:8b
```

### Changing the Local Model

Use the exact model name shown by:

```bash
ollama list
```

Then update the n8n node:

1. Open the workflow in n8n.
2. Open `Ollama Job Fit Model`.
3. Change `Model` from `qwen3:8b` to the exact local model name, for example `qwen3:30b`.
4. Keep temperature at `0`.
5. Keep JSON output mode enabled.
6. Keep the Ollama credential pointed at `http://127.0.0.1:11434`.

You can also edit [`workflows/job-application-daily.template.json`](workflows/job-application-daily.template.json) directly and replace:

```json
"model": "qwen3:8b"
```

with:

```json
"model": "qwen3:30b"
```

Then re-import the workflow:

```bash
n8n import:workflow --input=workflows/job-application-daily.template.json
```

Recommended local model order:

- `qwen3:30b` or similar larger Qwen model if your Windows PC can run it.
- `qwen3:14b` if 30B is too slow.
- `qwen3:8b` as the current lightweight default.

Larger models should follow the profile/ranking config better, especially for borderline jobs. They will also run slower, so keep the workflow daily and keep the browser/model batch limit reasonable.

The prompt is built in [`workflows/code/prepare-ai-job-review.js`](workflows/code/prepare-ai-job-review.js). It includes `profile.md` plus each job's best available description from `ai_context`. The structured output parser forces the agent to return:

```json
{
  "fit_score": 0,
  "priority": "high|medium|low",
  "recommendation": "apply|consider|skip",
  "resume_variant": "short profile-based label, general, or none",
  "confidence": "high|medium|low",
  "reason": "...",
  "strengths": ["..."],
  "risks": ["..."]
}
```

If the AI node errors or the model output is not valid JSON, `Apply AI job review` keeps the deterministic score and adds a fallback note instead of blocking the Sheet update.

Do not commit raw OAuth secrets. The existing `client-ID-gmail` and `client-secret-gmail` files are local credential material.
