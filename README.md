## NFL Game Picks – Static Web App

Client-only web app to list upcoming NFL games, let friends pick winners, and show realtime picks via Firebase Firestore.

No build tools, works as plain files. Can be hosted on GitHub Pages.

### Files
- `index.html`: main page, loads `src/css/style.css`, `src/js/firebase-config.js`, `src/js/firebase-init.js`, `src/js/app.js`
- `src/css/style.css`: layout and styles
- `src/js/firebase-config.js`: place your Firebase config here (placeholder below)
- `src/js/firebase-init.js`: initializes Firebase and exports Firestore `db`
- `src/js/app.js`: schedule fetch, rendering, localStorage, Firestore reads/writes
- `.github/workflows/pages-deploy.yml` (optional): deploy to GitHub Pages on push to `main`

### 1) Create a Firebase project and get web config
1. Go to Firebase Console and create a project.
2. In Build → Firestore Database, click Create database (start in Test mode for prototyping).
3. In Project Overview (the gear icon → Project settings), click "Add app" → Web.
4. Register the app and copy the `firebaseConfig` object from the setup snippet.

### 2) Paste your Firebase config
Open `src/js/firebase-config.js` and replace the placeholder export with your config.

Exact placeholder text to replace:

```js
/* TODO: PASTE FIREBASE CONFIG OBJECT HERE
   Example:
   {
     apiKey: "ABC...",
     authDomain: "PROJECT.firebaseapp.com",
     projectId: "PROJECT-ID",
     storageBucket: "PROJECT-ID.appspot.com",
     messagingSenderId: "123456",
     appId: "1:123:web:abcd"
   }
*/
export const firebaseConfig = null;
```

Replace the `export const firebaseConfig = null;` line with:

```js
export const firebaseConfig = { /* your keys from Firebase Console */ };
```

Note: Do not commit secrets you don't want public. Firestore security rules must be configured appropriately before sharing.

### 3) Enable Firestore (test mode for prototyping)
- In Firebase Console → Firestore Database → Rules, use Test mode to get started quickly. This is insecure for production. Before sharing, restrict rules to authenticated users or specific conditions.

### 4) Test locally
- Open `index.html` in a browser (or use Cursor live preview). No server is required.
- Without config, the app runs in local-only mode: you can select picks locally but cannot submit to Firestore.

### 5) Deploy to GitHub Pages
Two options:

- Manual: push to `main`, then in GitHub repo Settings → Pages, set Source = Deploy from a branch, Branch = `main` (root). Save.
- Workflow (included): keep `.github/workflows/pages-deploy.yml`. Once you push to `main`, deployment will run automatically. In Settings → Pages, set Source = GitHub Actions.

### 6) Usage
- Enter your display name and a league code (defaults to `demo-league`).
- Pick a team for each game and click Submit pick.
- Picks are stored in Firestore collection `picks` with fields: `{ leagueId, gameId, displayName, pick, timestamp }` using server timestamp.
- Cards lock automatically at kickoff time.

### Security note
Test mode is only for prototyping. Tighten Firestore rules before sharing publicly.

# nfl-game-picks
Web app where friends can pick nfl game results and compete
