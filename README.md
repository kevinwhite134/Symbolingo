# Symbolingo

Symbolingo is a free, static maths notation trainer for Irish Leaving Cert Ordinary and Higher Level and for university maths.

- [Production](https://symbolingo.vercel.app/)
- [Source repository](https://github.com/kevinwhite134/Symbolingo)

## Run locally

Serve `dist` over HTTP. There is no build step.

```sh
python -m http.server 8000 --directory dist
```

Open http://localhost:8000. With Node 24 or later, run `node --test tests/pilot.test.mjs` to check the catalogue, search, migration, links, and review dates.

## Edit the catalogue

`dist/content/catalogue.json` defines the topics, packs, and syllabus version. Each card lives in one pack and can appear in both tracks. Keep its ID stable for shared links, bookmarks, and review history. Use aliases for ways students type the notation and add one or more incorrect readings for Quiz. Keep any original `legacyId` so bookmarks and quiz history from Notation Lab migrate correctly.

For a Leaving Cert card, assign the strand, syllabus section and applicable levels in `lc`. Tag material introduced at Higher with `["higher"]`. A card shared by both levels uses `["ordinary", "higher"]`. University membership is recorded separately in `uni`.

## Pilot review

Use the [published Leaving Certificate Mathematics syllabus](https://ncca.ie/media/2122/lc-mathematics-syllabus.pdf) to verify every tagged card. For each of the five strands, an educator should check its notation-bearing sections at both levels, whether the symbol is introduced at the tagged level, and whether the reading, worked example and quiz are mathematically correct. Send corrections by card link, with the syllabus section and suggested wording. Use [Trinity’s module catalogue](https://www.maths.tcd.ie/undergraduate/modules/allmods.php) to check the university branch coverage.

After preview and educator review, recruit 10 Leaving Cert students across both levels and 10 university students across CS and other maths modules. Give each student an unfamiliar expression from their course and observe whether they find the right explanation without help. Ask after a week whether they returned, which notation they could not find, and which feature they would pay for. Compare each group against the pilot targets of eight successful lookups and four returning students out of ten. Record aggregate results.

Vercel serves `dist` directly. Use a feature branch for the preview and release the reviewed change from `main`.
