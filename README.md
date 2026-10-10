# Mahfuz Chowdhury — portfolio

A scroll film in which one red ball, the lead, travels through a photographed marble run:
it rolls the rail, floods the screen red, lands among the parts (Build), threads three hoops
(Automate), multiplies (Grow), and comes to rest in a carved dish (Contact).

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # static production build
```

## Change the words

Every word, role and link is in `src/content/site.ts`.

The contact details are placeholders. While `contact.placeholder` is `true` the links are
shown but go nowhere; fill in the real email, WhatsApp and LinkedIn and set it to `false`.

## The pictures

- `art/raw/` holds the generated source images and `art/briefs/` the briefs they came from.
- `node scripts/prepare-art.mjs` turns them into the web files in `public/art/`.
- The portraits are re-renders of the original photo, and the "What you get" gallery uses
  illustrative product shots. Swap in real photographs and real work when they exist.

The ball's path is registered to each photograph by pixel coordinates at the top of
`src/components/Film.tsx` and `src/components/Contact.tsx`. Replace a plate and those
numbers need measuring again (`scripts/measure-rail.mjs` helps).

## Checking the motion

With the dev server on port 3210 and Google Chrome installed:

```bash
node scripts/shoot.mjs out.jpg 1440x810 "0,27,62,#grow+900@3000"   # contact sheet of stills
node scripts/record.mjs out-dir 1280x720 30                         # video of a full scroll
```
