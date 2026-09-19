# Tempo — iPhone Test

**URL:** https://elijahgib.github.io/tempo/ — **v0.6.3**

Laptop can be off. ~5 minutes.

> None of the below has been verified on a physical iPhone. Automation cannot
> confirm speaker output, lock-screen behaviour, or iOS storage durability.

---

### Import & persistence — the new thing

1. Open Tempo → **More** → **Import music**
2. Pick **2–3 MP3/M4A files** from Files
3. Confirm they appear with title/artist (tags, or filename fallback)
4. Play one → **does audio come out?**
5. **Lock the phone** → does it keep playing?
6. **Switch apps** → does it keep playing?
7. Check **Lock Screen / Dynamic Island** — title, artist, artwork, and do the
   play/pause/next buttons work?
8. Queue the other 2 (⋮ → Add to queue), let one end → **does it auto-advance?**
9. **Close Tempo completely** (swipe it away), reopen it
10. **Are your imported tracks still there?** ← the headline test
11. **Airplane Mode on** → does an imported track still play?
    Streaming rows should dim and show *NEEDS INTERNET*
12. Airplane Mode off

### Everything else

13. Tap ♥ on a track → appears under **My Favorites**
14. **Playlists** → **+ New** → create one
15. Add **one local track and one Audius track** to it → both play from it
16. **Search** a song you imported → it should rank **above** Audius results

---

## Record what actually happened

```
4.  Audio plays:
5.  Keeps playing when locked:
6.  Keeps playing when switching apps:
7.  Lock Screen shows artwork/title/artist:
7.  Lock Screen buttons work:
8.  Auto-advance:
10. Files survived app restart:
11. Local plays in Airplane Mode:
16. Local ranks above streaming:

Anything broken:
```

## Notes

- **Storage is not permanent ownership.** iOS can evict browser storage if the
  device gets very low on space. Keep originals in Files/iCloud.
- **Export is metadata only** — it does not contain your audio files.
- **Jamendo is off** until you add a free client ID (More → Jamendo).
- **YouTube is foreground-only** and will stop when you lock the phone. Expected.
- Rollback if anything is badly wrong: tag `v0.3.1-rollback`.
