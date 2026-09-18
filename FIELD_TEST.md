# Tempo — iPhone Field Test

**URL:** `_______________________________` (from `LIVE_URL.txt` after running `DEPLOY.bat`)

Takes about 10 minutes. Tick as you go, and **write down what actually happened**,
especially where it differs from what's expected.

---

### 1. Open the public URL on iPhone Safari
- [ ] Page loads over HTTPS (padlock shown, no warning)
- [ ] Layout looks right — nothing cut off or sideways-scrolling

### 2. Add one known-embeddable song
Use this one, verified working: `https://youtu.be/dQw4w9WgXcQ`
- [ ] Title and artist fill in **automatically** (~1s) — you should NOT have to type a title
- [ ] Expected: "Rick Astley - Never Gonna Give You Up…" / "Rick Astley"
- [ ] Thumbnail appears

### 3. Play it
- [ ] Tap play — video starts
- [ ] **Audio comes out of the phone**

> ⚠️ This is the one thing never confirmed by automation. Chrome blocks media in
> background tabs, so playback was only ever verified up to "player loaded, duration
> known, controllable". **You are the first real playback test.**

### 4. Lock the phone / switch apps — record what ACTUALLY happens
- [ ] Press the side button to lock → audio: ☐ keeps playing ☐ **stops** ☐ other: ______
- [ ] Swipe to another app → audio: ☐ keeps playing ☐ **stops** ☐ other: ______
- [ ] Lock screen media controls: ☐ appear ☐ don't appear

> **Expected: audio stops.** YouTube's embedded player and iOS both restrict background
> playback, and Tempo deliberately does not work around that. If it stops, that is
> correct behaviour, not a bug. Record what you see either way.

### 5. Favorite it
- [ ] Tap ♡ in the player → fills in
- [ ] **The song does NOT restart** when you tap it
- [ ] Appears under the **Liked** tab

### 6. Queue two more songs
Suggested (both verified embeddable): `9bZkp7q19f0`, `kJQP7kiw5Fk`
- [ ] Add both, then queue them from Library (☷ button)
- [ ] Both listed under **Queue**
- [ ] Player shows "Up next · …"

### 7. Let the first song finish
- [ ] Next song starts **automatically** without touching anything
- [ ] It disappears from Queue when it starts

> ⚠️ iOS requires a user gesture before playback. Auto-advance is verified working on
> desktop, but **iOS may pause at the track boundary and wait for a tap.** Record which
> happens — this is the most likely iPhone-specific difference.

### 8. Test over Wi-Fi
- [ ] Everything above worked on Wi-Fi

### 9. Turn Wi-Fi OFF — test over cellular
- [ ] Site still loads (proves it's genuinely public, not your LAN)
- [ ] Song still plays
- [ ] Metadata still fills in on a new add

### 10. Add to Home Screen
- [ ] The hint "Install Tempo: tap Share ⇧ then Add to Home Screen" is visible at the top
- [ ] Tap **Share → Add to Home Screen**
- [ ] Icon looks correct on the home screen (not a blank/generic page icon)
- [ ] Name reads **Tempo**
- [ ] Dismissing the hint with × makes it stay gone

### 11. Launch from the Home Screen icon
- [ ] Opens **without Safari's address bar** (standalone mode)
- [ ] Install hint is gone (it hides itself once installed)
- [ ] Bottom navigation is **not** overlapped by the home indicator bar
- [ ] Top bar is not hidden under the notch / Dynamic Island
- [ ] Playback still works here

### 12. Close and reopen — confirm the library persists
- [ ] Swipe Tempo fully closed, reopen
- [ ] Library, Liked, Queue, and Recently Played are all still there

---

## Also worth trying

**Restricted video** — `https://youtu.be/jfKfPfyJRdk` (Lofi Girl) refuses embedding:
- [ ] Shows Tempo's own "This video can't play inside Tempo" card
- [ ] **Not** YouTube's grey "Video unavailable" error box
- [ ] Title, artist and artwork still shown
- [ ] "Open in YouTube" button works
- [ ] Row shows an amber "YouTube only" tag in Library

**Backup round-trip** — Library → bottom of the page:
- [ ] **Export library** downloads `tempo-backup-YYYY-MM-DD.json`
- [ ] **Import backup** restores it

> On iOS, Export saves to Files. If Safari blocks the download, note it — `<a download>`
> support on iOS is inconsistent and this is untested on a real device.

---

## Notes / anything broken

```
Playback (step 3):

Background audio (step 4):

Auto-advance on iOS (step 7):

Cellular (step 9):

Standalone mode (step 11):

Anything else:
```
