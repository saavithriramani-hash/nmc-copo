# Static assets

## `nmc-letterhead.png` — optional

The college letterhead shown on the sign-in page: the crest, the college
name, the NAAC A+ line and the Puthanampatti address, as one banner.

**The application does not require it.** A fresh checkout, a CI run and a
container build all produce a working sign-in page without it: when the
file is absent the page sets the same words in type instead, so it is
never unbranded and never shows a broken image.

To install it, save the banner here:

```
apps/web/public/nmc-letterhead.png
```

Nothing ignores that path, so **commit it if you want it to ship** — that
is the simplest way to get it into the container image and onto the
college server. Leaving it uncommitted is equally fine; the typographic
version is then what everyone sees.

A wide banner works best — roughly 8:1, at least 1200px across so it stays
sharp on a high-resolution screen. It is rendered at up to 576px wide and
scales down on a narrow one.

Nothing else needs changing: `components/Letterhead.tsx` picks it up on
the next page load, and `public/` is copied into the container image by
the existing Docker build.
