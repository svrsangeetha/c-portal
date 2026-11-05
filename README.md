# C Programming Portal (GitHub Pages + Google Sheet)

A student portal for the C case-study assignment:

* **Student login** (user ID + password from your Google Sheet).
* **Dashboard** with two panels: **Assignment panel** and **Lab panel** (Week 6, Week 7 — programs to be added later).
* **Exam mode**: full screen; copy / paste / drag-drop / right-click blocked; window or tab switches, leaving full screen and screenshot keys are detected and recorded; after 3 warnings the assignment **locks** until the teacher unlocks it.
* **C compiler runs inside each student's browser** (Clang compiled to WebAssembly). No compile server, so the "compiler busy" problem cannot happen. The compiler (~29 MB) downloads once per computer and is then cached.
* **Autosave** to the Google Sheet every ~30 s (plus a copy on the student's computer). **Resume** on any computer after logging in again.
* **Auto-submit** when the student clicks *Save & close*, closes the window/tab, or gets locked. *Final submit* stops further editing.
* **Auto-evaluation**: each question has 3 test cases (1 sample + 2 hidden). The **teacher report** re-runs every student's code, shows pass/fail per test case and a **logic level 1/2/3** per question, and writes the results to the Sheet / CSV.

| Level | Meaning |
|---|---|
| **3** | All 3 test cases pass **and** the code follows the rules (function written, loops, `->`/pointer access, no global variables, no file handling, no `qsort`/`bsearch`/`strstr`) |
| **2** | Moderate — 1 or 2 test cases pass, or all pass but a rule is not followed |
| **1** | Poor — does not compile or no test case passes |
| – | Not attempted |

Test cases are ready for **case studies 1–5**. Case studies 6–65 already appear in the portal (students can write and save code); their test cases will be added in batches.

---

## New in this version
* **Roll number login** — user ID = roll number, first password = roll number; students must set their own password at the first login (stored hashed) and can change it later with *Change password*.
* **One computer, one student** — if a computer was used for another student's assignment in the last 3 hours (`DEVICE_WINDOW_HOURS` in Code.gs), the login is refused with a warning and the event is shown in the teacher report (⚠ shared PC). Click **Allow** for a genuine seat change. Note: the check works per browser; a student who also switches to a different browser or private window is not detected.
* **Email results** — after *Evaluate all*, sends every student their own result (from your Gmail) and a class summary with the CSV to the co-faculty / supporting faculty addresses you type (remembered for next time). Google's limit is about 100 e-mails per day for a personal Gmail account (1,500 for Google Workspace).

## Folder layout

```
index.html            student portal
teacher.html          teacher report (re-evaluates all submissions)
js/config.js          ← the only file you edit (Apps Script URL, title, lab weeks, limits)
js/cases-text.js      the 65 case studies (text)
js/tests-data.js      function specs + test cases (hidden answers stored as SHA-256 hashes)
clang/                C compiler (WebAssembly) — do not modify
apps-script/Code.gs   backend for the Google Sheet (not used by GitHub Pages)
```

## Setup

### 1. Google Sheet + Apps Script (storage)
1. Create a new Google Sheet, e.g. *C Assignment 2026*.
2. **Extensions → Apps Script**. Delete the sample code, paste the contents of `apps-script/Code.gs`, click **Save**.
3. Select the function **setup** in the toolbar and click **Run**. Allow the permissions. The sheets *Students, Progress, Events, Results* are created.
4. **Project Settings (⚙) → Script properties**: change `TEACHER_KEY` to your own secret (used to open the teacher report).
5. **Deploy → New deployment → Select type: Web app**. *Execute as*: **Me**. *Who has access*: **Anyone**. Click **Deploy** and copy the **Web app URL** (ends with `/exec`).
6. Fill the **Students** sheet, one row per student: `RollNo | UserID | Password | Name | CaseNo | … | Email`. Leave **UserID** and **Password** empty: the roll number is then both the user ID and the first password, and the student must choose a new password at the first login. To reset a forgotten password, clear that student's Password cell. Fill **Email** to send results by e-mail.

### 2. GitHub Pages (portal)
1. Create a GitHub repository (e.g. `c-portal`) and upload **everything in this folder** (keep the folder structure, including the hidden `.nojekyll` file).
2. Edit `js/config.js` → paste the Web app URL into `APPS_SCRIPT_URL`.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. After 1–2 minutes the portal is live at `https://<your-username>.github.io/<repo-name>/` and the report at `…/teacher.html`.

Without an `APPS_SCRIPT_URL` the portal runs in **demo mode** (logins `demo1/pass1 … demo5/pass5`, teacher key `teacher123`) — useful for trying it out.

### 3. Before the lab session
* Open the portal once on every lab computer (or let students log in 5 minutes early) so the compiler is downloaded and cached. With many students downloading at the same moment the lab's internet link is the only bottleneck.
* Use **Chrome or Edge** (latest).

## Teacher report
Open `teacher.html`, enter the teacher key → **Evaluate all** (runs all students' code in your browser — about 1–2 s per question) → **Save results to Google Sheet** (sheet *Results*) or **Download CSV**. Click a student's name to see their code, each test case, the rule checks and the recorded window-switch events. **Unlock** re-opens a locked assignment; **Reopen** allows editing after a final submission.

## Honest limits of browser lockdown
A web page cannot fully stop: Alt+Tab, Win+Shift+S / Snipping Tool, a second monitor, or a phone camera. The portal **detects and records** window switches and screenshot keys, blanks the screen while the Windows key is held, and locks after the limit. For a fully locked-down exam, open the portal through **Safe Exam Browser** on the lab computers.

## Rules shown to students
Each student gets one complete C program: `#include`s, the structures and a menu-driven `main()` are given; they complete the five functions and can **Run program** (with keyboard input typed in the input box) like a normal compiler, or **Run tests** per question. When testing, the portal replaces their `main()` with its own test `main()`. No file handling, no global variables, type all code (no paste). Set `REQUIRE_POINTER_ACCESS: false` in `js/config.js` if `a[i].member` style should also earn Level 3.
