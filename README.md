# WorkTalk

Everyday English for work. An ESL practice app for adult learners, made by Language Workshop.

- 2 decks: Everyday Workplace English (100 phrases) and Marketing English (50 phrases)
- Flashcards with pronunciation (Web Speech API), categories and Bulgarian translations
- Daily spaced-repetition review, streaks, mastered tracking
- 5-question quiz plus 7 Use of English exercise types
- Installable (PWA), works offline, progress saved in the browser

Static site. No build step, no dependencies.

## Run locally

```
npx serve
```

Then open http://localhost:3000.

## Deploy

Works as-is on Vercel or Netlify. Point the platform at the repo root, no build command, output directory `.`

## Turning on push reminders

Reminders are wired up but switched off. While the App ID below is empty, no
external script loads and students are never asked for notification permission.

1. Create a free account at https://onesignal.com (free up to 10,000 subscribers).
2. Add a new app, choose **Web** as the platform.
3. Site setup: name `WorkTalk`, URL `https://worktalk-pi.vercel.app`, and turn on
   **"My site is not fully HTTPS"**? No, leave it off.
4. Under **Advanced**, set the service worker path to `push/onesignal/` and the
   filename to `OneSignalSDKWorker.js`. The file is already in this repo.
5. Copy the **App ID** from Settings → Keys & IDs.
6. Paste it into `app.js`:

   ```js
   const PUSH = {
     oneSignalAppId: 'paste-the-app-id-here'
   };
   ```

7. Commit and push. Vercel redeploys and reminders are live.

Students are asked only after they finish their first review or quiz, in the
app's own words. A "no" is remembered and never asked again.

Scheduled messages ("Your review is ready 🔥" every morning) are set up in the
OneSignal dashboard under Messages → Automated, not in this code.

## Notes on notifications

- iPhone delivers web push only if the student added the app to their Home Screen (iOS 16.4+).
- Android, Windows and Mac work in the browser without installing.
- The app also shows an in-app "New version available" toast when a deploy lands.
