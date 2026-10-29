# An Album a Day 🎧

A responsive, browser-based music discovery and listening diary app. Pick moods, energy, familiarity, and listening time; get a personalized album recommendation; save ratings, favorite tracks, and notes.

## Features
- Weighted, explainable-feeling recommendation based on album metadata and user preferences
- Non-repeating recommendations within the session and exclusion of previously logged albums (until the collection is exhausted)
- Animated vinyl sleeve, responsive UI, keyboard-accessible buttons
- Spotify album links or search fallback
- Listening diary stored locally in your browser (`localStorage`), with JSON export

## Run locally

```bash
python3 -m http.server 8000
```

Visit http://localhost:8000 . You can also use VS Code Live Server. Opening `index.html` via `file://` may prevent the album JSON from loading.

## Add your own albums
Replace `data/albums.json` with a JSON object containing an `albums` array. Example:

```json
{"albums":[{"artist":"Radiohead","title":"In Rainbows","year":2007,"moods":["reflective","dreamy"],"energy_level":5,"comfort_vs_exploration":"exploration","length_min":43,"metadata":{"cover_art":"https://example.com/cover.jpg","sources":"https://open.spotify.com/album/..."}}]}
```

`metadata.cover_art` and `metadata.sources` are optional. Spotify search is used if no album link is provided. Cover art URLs are controlled by their respective hosts and may fail or change. Use appropriately licensed images if distributing assets yourself.

## Publish with GitHub Pages
1. Create a new public GitHub repository, e.g. `an-album-a-day`.
2. Upload the **contents** of this folder to the repository root (or push with Git).
3. Go to **Settings → Pages → Build and deployment** and choose **Deploy from a branch**, `main`, `/ (root)`.
4. Visit `https://YOUR_USERNAME.github.io/an-album-a-day/` once GitHub Pages deploys.

No API keys or backend required. Listening data is browser-local and will not sync across devices.

## Stack
HTML · CSS · vanilla JavaScript · JSON · localStorage · GitHub Pages

## Future work
Improve genre and mood tagging, diversify recommendations by artist and genre, add accessible data import and visualizations, and test recommendation quality against user feedback.
