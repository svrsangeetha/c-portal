/* ============================================================
 *  PORTAL CONFIGURATION  — edit this file only
 * ============================================================ */
window.CONFIG = {
  /* Paste the Web App URL of your Google Apps Script deployment here.
     Leave it empty ("") to run the portal in DEMO mode (data stays in the browser). */
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxQ4RAiOEKKF5zMeXQuCl4mdmZwYy3ssPW02K14X2n7m2M4ydxeHyQhVpYHNOJAmH86/exec",

  PORTAL_TITLE: "C Programming Portal",
  COLLEGE_NAME: "Department of CSE",
  ASSIGNMENT_TITLE: "Case Study Assignment — Functions, Loops, Structures, Pointers",

  /* Number of times a student may leave the window / full screen before the assignment locks */
  VIOLATION_LIMIT: 3,

  /* Autosave to Google Sheet every N seconds (a random 0–10 s is added so 65 students don't save together) */
  AUTOSAVE_SECONDS: 30,

  /* true  = Level 3 only if structure members are accessed with -> or pointer arithmetic (assignment rule)
     false = a[i].member style is also accepted for Level 3 */
  REQUIRE_POINTER_ACCESS: true,

  /* Time limit for one test run (compile + run) in milliseconds — stops infinite loops */
  RUN_TIMEOUT_MS: 10000,

  /* Lab panel weeks (programs will be added later) */
  LAB_WEEKS: [
    { week: 6, title: "Week 6", programs: [] },
    { week: 7, title: "Week 7", programs: [] }
  ]
};
